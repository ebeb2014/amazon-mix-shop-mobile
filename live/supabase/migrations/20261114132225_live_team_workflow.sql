-- Live teamwork: scoped writes, immutable packing evidence and customer capabilities.
alter table public.ams_live_orders add column assigned_to uuid references public.ams_app_users(user_id), add column reserved_at timestamptz;
create table ams_private.live_checks(order_id uuid references public.ams_live_orders(id) on delete cascade,product_id text,checked_by uuid,checked_at timestamptz not null default now(),primary key(order_id,product_id));
create table ams_private.live_links(order_id uuid primary key references public.ams_live_orders(id) on delete cascade,token_hash text unique not null,expires_at timestamptz not null);
create table ams_private.live_events(id bigint generated always as identity primary key,owner_id uuid not null,order_id uuid references public.ams_live_orders(id),kind text not null,title text not null,created_at timestamptz not null default now(),dedupe text unique not null);
create index live_events_owner_time on ams_private.live_events(owner_id,created_at desc);
create table ams_private.live_readers(user_id uuid primary key,last_read timestamptz not null default now());
alter table ams_private.live_checks enable row level security;
alter table ams_private.live_links enable row level security;
alter table ams_private.live_events enable row level security;
alter table ams_private.live_readers enable row level security;
revoke all on all tables in schema ams_private from public,anon,authenticated;

create function ams_private.live_order_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='reserved' and old.status is distinct from 'reserved' then new.reserved_at:=coalesce(new.reserved_at,now()); end if;
 if new.items is distinct from old.items then delete from ams_private.live_checks where order_id=new.id; end if;
 if new.fulfillment in ('packed','shipped','delivered') and new.fulfillment is distinct from old.fulfillment then
  if exists(select 1 from jsonb_array_elements(new.items) i where not exists(select 1 from ams_private.live_checks c where c.order_id=new.id and c.product_id=i->>'id')) then raise exception 'Scanează fiecare bucată înainte de finalizarea coletului.'; end if;
 end if;
 return new;
end $$;
create trigger live_order_guard before update on public.ams_live_orders for each row execute function ams_private.live_order_guard();
create function ams_private.live_order_event() returns trigger language plpgsql security definer set search_path='' as $$
declare k text;t text;
begin
 if tg_op='INSERT' then k:='new';t:='Comandă nouă';
 elsif new.status='cancelled' and old.status<>'cancelled' then k:='cancel';t:='Comandă anulată';
 elsif new.fulfillment='packed' and old.fulfillment<>'packed' then k:='packed';t:='Colet pregătit';
 else return new;end if;
 insert into ams_private.live_events(owner_id,order_id,kind,title,dedupe) values(new.owner_id,new.id,k,t||' #'||new.number,new.id||':'||k||':'||new.revision) on conflict(dedupe) do nothing;
 return new;
end $$;
create trigger live_order_event after insert or update on public.ams_live_orders for each row execute function ams_private.live_order_event();

create function ams_private.live_team_api(p_action text,p_data jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();own uuid:=public.ams_current_owner_id();r text:=ams_private.live_role();o public.ams_live_orders%rowtype;result jsonb;token text;pid text;actor text;target uuid;
begin
 if uid is null or r is null or r='disabled' then raise exception 'Acces refuzat.' using errcode='42501';end if;
 if p_data is null or octet_length(p_data::text)>12000 then raise exception 'Cerere invalidă.';end if;
 select coalesce(nullif(display_name,''),username) into actor from public.ams_app_users where user_id=uid;
 if p_action='reports' then
  return coalesce((select jsonb_agg(to_jsonb(x)) from (
   select s.id,s.name,count(o.id) orders,coalesce(sum(o.goods_total+o.shipping) filter(where o.status<>'cancelled'),0) total,
    count(o.id) filter(where o.status in ('reserved','checkout')) reserved,count(o.id) filter(where o.status='cancelled') cancelled,
    count(o.id) filter(where o.status in ('reserved','checkout','paid') and o.fulfillment in ('new','packing','packed')) unshipped
   from (select id,name from public.ams_live_sessions where owner_id=own union all select null::uuid,'Fără sesiune') s
   left join public.ams_live_orders o on o.session_id is not distinct from s.id and o.owner_id=own group by s.id,s.name order by s.name
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
create function public.ams_live_team_api(p_action text,p_data jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select ams_private.live_team_api(p_action,p_data)$$;
revoke all on function ams_private.live_team_api(text,jsonb),public.ams_live_team_api(text,jsonb) from public,anon;
grant execute on function ams_private.live_team_api(text,jsonb),public.ams_live_team_api(text,jsonb) to authenticated;

create function ams_private.live_customer(p_token text,p_customer jsonb default null,p_revision bigint default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.ams_live_orders%rowtype;c jsonb;
begin
 if p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception 'Link invalid sau expirat.';end if;
 select a.* into o from public.ams_live_orders a join ams_private.live_links l on l.order_id=a.id where l.token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and l.expires_at>now() and a.status in ('draft','reserved') for update of a;
 if not found then raise exception 'Link expirat, revocat sau comandă închisă.';end if;
 if p_customer is not null then
  if o.revision is distinct from p_revision then raise exception 'Comanda s-a schimbat. Reîncarcă pagina.' using errcode='40001';end if;
  if jsonb_typeof(p_customer)<>'object' or octet_length(p_customer::text)>4000 then raise exception 'Date invalide.';end if;
  select jsonb_object_agg(k,trim(coalesce(p_customer->>k,''))) into c from unnest(array['name','phone','address','city','county','postal']) k;
  if length(c->>'name') not between 2 and 160 or length(c->>'phone') not between 7 and 30 or length(c->>'address') not between 3 and 500 or length(c->>'city') not between 2 and 100 or length(c->>'county') not between 2 and 100 or length(c->>'postal')>20 then raise exception 'Completează numele, telefonul și adresa de livrare.';end if;
  update public.ams_live_orders set customer=c,revision=revision+1,updated_at=now() where id=o.id returning * into o;
  insert into public.ams_live_audit(owner_id,order_id,actor_name,action,detail) values(o.owner_id,o.id,'Client prin link','customer_contact','{}');
 end if;
 return jsonb_build_object('number',o.number,'revision',o.revision,'customer',o.customer,'items',(select jsonb_agg(jsonb_build_object('name',i->>'name','price',i->'price')) from jsonb_array_elements(o.items)i),'total',o.goods_total+o.shipping,'shipping',o.shipping,'advance',o.advance);
end $$;
create function public.ams_live_customer(p_token text,p_customer jsonb default null,p_revision bigint default null) returns jsonb language sql security invoker set search_path='' as $$select ams_private.live_customer(p_token,p_customer,p_revision)$$;
grant usage on schema ams_private to anon;
revoke all on function ams_private.live_customer(text,jsonb,bigint),public.ams_live_customer(text,jsonb,bigint) from public;
grant execute on function ams_private.live_customer(text,jsonb,bigint),public.ams_live_customer(text,jsonb,bigint) to anon,authenticated;
revoke all on function ams_private.live_order_guard(),ams_private.live_order_event() from public,anon,authenticated;
