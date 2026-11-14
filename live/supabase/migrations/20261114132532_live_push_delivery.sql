create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create table ams_private.live_push_subscriptions(id uuid primary key default gen_random_uuid(),owner_id uuid not null,user_id uuid not null references public.ams_app_users(user_id),endpoint text unique not null,p256dh text not null,auth text not null,created_at timestamptz not null default now(),enabled boolean not null default true);
create table ams_private.live_push_deliveries(event_id bigint references ams_private.live_events(id),subscription_id uuid references ams_private.live_push_subscriptions(id) on delete cascade,attempts int not null default 0,lease_until timestamptz,sent boolean not null default false,primary key(event_id,subscription_id));
alter table ams_private.live_push_subscriptions enable row level security;
alter table ams_private.live_push_deliveries enable row level security;
revoke all on ams_private.live_push_subscriptions,ams_private.live_push_deliveries from public,anon,authenticated;
create function ams_private.live_push(p_action text,p_data jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();own uuid:=public.ams_current_owner_id();endpoint text:=p_data->>'endpoint';pub text;
begin
 if uid is null or coalesce(ams_private.live_role(),'disabled')='disabled' then raise exception 'Acces refuzat.' using errcode='42501';end if;
 if p_action='config' then
  select decrypted_secret into pub from vault.decrypted_secrets where name='ams_live_vapid_public';return jsonb_build_object('publicKey',pub);
 elsif p_action='disable' then
  update ams_private.live_push_subscriptions set enabled=false where user_id=uid and ams_private.live_push_subscriptions.endpoint=p_data->>'endpoint';return '{"ok":true}';
 elsif p_action='subscribe' then
  if endpoint is null or endpoint !~ '^https://(web\.push\.apple\.com|fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9.-]+\.notify\.windows\.com)/' or length(endpoint)>3000 or length(p_data#>>'{keys,p256dh}') not between 80 and 100 or length(p_data#>>'{keys,auth}') not between 20 and 30 then raise exception 'Abonament push invalid.';end if;
  insert into ams_private.live_push_subscriptions(owner_id,user_id,endpoint,p256dh,auth) values(own,uid,endpoint,p_data#>>'{keys,p256dh}',p_data#>>'{keys,auth}')
  on conflict(endpoint) do update set owner_id=excluded.owner_id,user_id=excluded.user_id,p256dh=excluded.p256dh,auth=excluded.auth,enabled=true,created_at=now();
  return '{"ok":true}';
 end if;raise exception 'Acțiune invalidă.';
end $$;
create function public.ams_live_push(p_action text,p_data jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select ams_private.live_push(p_action,p_data)$$;
revoke all on function ams_private.live_push(text,jsonb),public.ams_live_push(text,jsonb) from public,anon;
grant execute on function ams_private.live_push(text,jsonb),public.ams_live_push(text,jsonb) to authenticated;

-- Only the authenticated service role can consume deliveries or read signing keys.
create function ams_private.live_push_worker(p_action text,p_data jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if p_action='config' then
  return (select jsonb_object_agg(name,decrypted_secret) from vault.decrypted_secrets where name in ('ams_live_vapid_public','ams_live_vapid_private','ams_live_worker_token'));
 elsif p_action='claim' then
  insert into ams_private.live_events(owner_id,order_id,kind,title,dedupe)
   select owner_id,id,'stale','Rezervare de peste 24 ore #'||number,id||':stale:'||to_char(now() at time zone 'Europe/Bucharest','YYYY-MM-DD') from public.ams_live_orders where status='reserved' and coalesce(reserved_at,created_at)<now()-interval '24 hours' on conflict(dedupe) do nothing;
  insert into ams_private.live_push_deliveries(event_id,subscription_id)
   select e.id,s.id from ams_private.live_events e join ams_private.live_push_subscriptions s on s.owner_id=e.owner_id and s.enabled and e.created_at>=s.created_at
   join public.ams_app_users u on u.user_id=s.user_id and u.active
   left join public.ams_live_members m on m.user_id=u.user_id and m.owner_id=u.owner_id
   where e.created_at>now()-interval '1 day' and (u.is_primary_admin or coalesce(m.role,case when exists(select 1 from public.ams_user_permissions p where p.user_id=u.user_id and p.permission_code='pos.sell' and p.access_mode='allow') then 'operator' else 'disabled' end)<>'disabled') on conflict do nothing;
  with batch as (select d.event_id,d.subscription_id from ams_private.live_push_deliveries d join ams_private.live_push_subscriptions s on s.id=d.subscription_id join public.ams_app_users u on u.user_id=s.user_id left join public.ams_live_members m on m.user_id=u.user_id where not d.sent and d.attempts<5 and coalesce(d.lease_until,'epoch')<now() and s.enabled and u.active and (u.is_primary_admin or coalesce(m.role,case when exists(select 1 from public.ams_user_permissions p where p.user_id=u.user_id and p.permission_code='pos.sell' and p.access_mode='allow') then 'operator' else 'disabled' end)<>'disabled') order by d.event_id limit 30 for update of d skip locked),
  claimed as (update ams_private.live_push_deliveries d set attempts=attempts+1,lease_until=now()+interval '3 minutes' from batch b where d.event_id=b.event_id and d.subscription_id=b.subscription_id returning d.event_id,d.subscription_id)
  select coalesce(jsonb_agg(jsonb_build_object('event_id',c.event_id,'subscription_id',c.subscription_id,'title',e.title,'endpoint',s.endpoint,'keys',jsonb_build_object('p256dh',s.p256dh,'auth',s.auth))),'[]') into result from claimed c join ams_private.live_events e on e.id=c.event_id join ams_private.live_push_subscriptions s on s.id=c.subscription_id;
  return result;
 elsif p_action='finish' then
  update ams_private.live_push_deliveries set sent=coalesce((p_data->>'sent')::boolean,false) where event_id=(p_data->>'event_id')::bigint and subscription_id=(p_data->>'subscription_id')::uuid;
  if coalesce((p_data->>'expired')::boolean,false) then update ams_private.live_push_subscriptions set enabled=false where id=(p_data->>'subscription_id')::uuid;end if;
  return '{"ok":true}';
 end if;raise exception 'Invalid action';
end $$;
create function public.ams_live_push_worker(p_action text,p_data jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select ams_private.live_push_worker(p_action,p_data)$$;
revoke all on function ams_private.live_push_worker(text,jsonb),public.ams_live_push_worker(text,jsonb) from public,anon,authenticated;
grant usage on schema ams_private to service_role;
grant execute on function ams_private.live_push_worker(text,jsonb),public.ams_live_push_worker(text,jsonb) to service_role;
create function ams_private.live_push_tick() returns void language plpgsql security definer set search_path='' as $$
declare token text;
begin
 select decrypted_secret into token from vault.decrypted_secrets where name='ams_live_worker_token';
 if token is null then return;end if;
 perform net.http_post(url:='https://cudsiqyutfvqtlluuwnc.supabase.co/functions/v1/ams-live-push',headers:=jsonb_build_object('Content-Type','application/json','x-live-worker',token),body:='{}'::jsonb,timeout_milliseconds:=10000);
end $$;
revoke all on function ams_private.live_push_tick() from public,anon,authenticated;
select cron.schedule('ams-live-push','* * * * *','select ams_private.live_push_tick()');
