create or replace function ams_private.live_team_api(p_action text,p_data jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();own uuid:=public.ams_current_owner_id();r text:=ams_private.live_role();o public.ams_live_orders%rowtype;result jsonb;token text;pid text;actor text;target uuid;
begin
 if uid is null or r is null or r='disabled' then raise exception 'Acces refuzat.' using errcode='42501';end if;
 if p_data is null or octet_length(p_data::text)>12000 then raise exception 'Cerere invalidă.';end if;
 select coalesce(nullif(display_name,''),username) into actor from public.ams_app_users where user_id=uid;
 if p_action='reports' then
  return coalesce((select jsonb_agg(to_jsonb(x)) from (
   select s.id,s.name,count(ord.id) orders,coalesce(sum(ord.goods_total+ord.shipping) filter(where ord.status<>'cancelled'),0) total,
    count(ord.id) filter(where ord.status in ('reserved','checkout')) reserved,count(ord.id) filter(where ord.status='cancelled') cancelled,
    count(ord.id) filter(where ord.status in ('reserved','checkout','paid') and ord.fulfillment in ('new','packing','packed')) unshipped
   from (select id,name from public.ams_live_sessions where owner_id=own union all select null::uuid,'Fără sesiune') s
   left join public.ams_live_orders ord on ord.session_id is not distinct from s.id and ord.owner_id=own group by s.id,s.name order by s.name
  ) x),'[]');
 elsif p_action='events' then
  return jsonb_build_object('events',coalesce((select jsonb_agg(to_jsonb(e) order by e.id desc) from (select id,order_id,title,created_at from ams_private.live_events where owner_id=own order by id desc limit 100) e),'[]'),
   'unread',(select count(*) from ams_private.live_events where owner_id=own and created_at>coalesce((select last_read from ams_private.live_readers where user_id=uid),'epoch')));
 elsif p_action='read_events' then
  insert into ams_private.live_readers values(uid,now()) on conflict(user_id) do update set last_read=excluded.last_read;return '{"ok":true}';
 elsif p_action='stale' then
  return coalesce((select jsonb_agg(to_jsonb(x)) from (select id,number,customer,reserved_at from public.ams_live_orders where owner_id=own and status='reserved' and coalesce(reserved_at,created_at)<now()-interval '24 hours' order by reserved_at nulls first limit 500) x),'[]');
 end if;
 select * into o from public.ams_live_orders where id=(p_data->>'id')::uuid and owner_id=own for update;
 if not found then raise exception 'Comanda nu există.';end if;
 if p_action='details' then
  return jsonb_build_object('assigned_to',o.assigned_to,'assigned_name',(select coalesce(nullif(display_name,''),username) from public.ams_app_users where user_id=o.assigned_to),'checks',coalesce((select jsonb_agg(to_jsonb(c)) from ams_private.live_checks c where order_id=o.id),'[]'),'link_active',exists(select 1 from ams_private.live_links where order_id=o.id and expires_at>now()));
 end if;
 if r not in ('manager','operator','packer') then raise exception 'Acces refuzat.' using errcode='42501';end if;
 if (p_data->>'revision')::bigint is distinct from o.revision then raise exception 'Comanda s-a schimbat. Redeschide comanda.' using errcode='40001';end if;
 if p_action='claim' then
  if o.status not in ('reserved','paid') then raise exception 'Comanda nu poate fi preluată acum.';end if;
  if o.assigned_to is not null and o.assigned_to<>uid then raise exception 'Comanda este deja preluată de un coleg.';end if;
  update public.ams_live_orders set assigned_to=uid,revision=revision+1,updated_at=now(),updated_by=uid where id=o.id returning to_jsonb(ams_live_orders.*) into result;
 elsif p_action='release' then
  if o.assigned_to is distinct from uid and r<>'manager' then raise exception 'Doar responsabilul sau administratorul poate elibera comanda.';end if;
  update public.ams_live_orders set assigned_to=null,revision=revision+1,updated_at=now(),updated_by=uid where id=o.id returning to_jsonb(ams_live_orders.*) into result;
 elsif p_action='scan' then
  if o.assigned_to is distinct from uid then raise exception 'Preia comanda înainte de scanare.';end if;
  if o.status not in ('reserved','paid') or o.fulfillment not in ('new','packing') then raise exception 'Coletul nu poate fi verificat în această stare.';end if;
  select i->>'id' into pid from jsonb_array_elements(o.items) i where i->>'code'=trim(p_data->>'code');
  if pid is null then raise exception 'Codul nu aparține coletului. Scanează codul intern al bucății, nu EAN-ul comun.';end if;
  if exists(select 1 from ams_private.live_checks where order_id=o.id and product_id=pid) then raise exception 'Această bucată a fost deja verificată.';end if;
  insert into ams_private.live_checks(order_id,product_id,checked_by) values(o.id,pid,uid);
  update public.ams_live_orders set fulfillment='packing',revision=revision+1,updated_at=now(),updated_by=uid where id=o.id returning to_jsonb(ams_live_orders.*) into result;
 elsif p_action in ('link_create','link_revoke') then
  if r not in ('manager','operator') then raise exception 'Acces refuzat.' using errcode='42501';end if;
  if p_action='link_revoke' then delete from ams_private.live_links where order_id=o.id;result:='{"ok":true}';
  else
   if o.status not in ('draft','reserved') then raise exception 'Datele comenzii sunt deja închise.';end if;
   token:=encode(extensions.gen_random_bytes(32),'hex');
   insert into ams_private.live_links values(o.id,encode(extensions.digest(token,'sha256'),'hex'),now()+interval '7 days') on conflict(order_id) do update set token_hash=excluded.token_hash,expires_at=excluded.expires_at;
   result:=jsonb_build_object('token',token);
  end if;
 else raise exception 'Acțiune necunoscută.';end if;
 insert into public.ams_live_audit(owner_id,order_id,actor_id,actor_name,action,detail) values(own,o.id,uid,actor,p_action,jsonb_build_object('product_id',pid));
 return result;
end $$;
create or replace function ams_private.live_push(p_action text,p_data jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();own uuid:=public.ams_current_owner_id();push_endpoint text:=p_data->>'endpoint';pub text;
begin
 if uid is null or coalesce(ams_private.live_role(),'disabled')='disabled' then raise exception 'Acces refuzat.' using errcode='42501';end if;
 if p_action='config' then
  select decrypted_secret into pub from vault.decrypted_secrets where name='ams_live_vapid_public';return jsonb_build_object('publicKey',pub);
 elsif p_action='disable' then
  update ams_private.live_push_subscriptions set enabled=false where user_id=uid and ams_private.live_push_subscriptions.endpoint=p_data->>'endpoint';return '{"ok":true}';
 elsif p_action='subscribe' then
  if push_endpoint is null or push_endpoint !~ '^https://(web\.push\.apple\.com|fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9.-]+\.notify\.windows\.com)/' or length(push_endpoint)>3000 or length(p_data#>>'{keys,p256dh}') not between 80 and 100 or length(p_data#>>'{keys,auth}') not between 20 and 30 then raise exception 'Abonament push invalid.';end if;
  insert into ams_private.live_push_subscriptions(owner_id,user_id,endpoint,p256dh,auth) values(own,uid,push_endpoint,p_data#>>'{keys,p256dh}',p_data#>>'{keys,auth}')
  on conflict(endpoint) do update set owner_id=excluded.owner_id,user_id=excluded.user_id,p256dh=excluded.p256dh,auth=excluded.auth,enabled=true,created_at=now();
  return '{"ok":true}';
 end if;raise exception 'Acțiune invalidă.';
end $$;
