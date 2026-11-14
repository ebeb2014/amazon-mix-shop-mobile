-- Additive storage for the independent Live PWA. Existing fiscal flows are untouched.
create function public.ams_live_valid_state(s jsonb)
returns boolean language plpgsql immutable security invoker set search_path = '' as $$
declare k text; item jsonb; n numeric; p jsonb; allocated numeric;
begin
  if jsonb_typeof(s) is distinct from 'object' or octet_length(s::text)>2097152 then return false; end if;
  foreach k in array array['products','orders','lives'] loop
    if jsonb_typeof(s->k) is distinct from 'array' then return false; end if;
    if exists(select 1 from jsonb_array_elements(s->k) x where jsonb_typeof(x->'id') is distinct from 'string' or length(btrim(x->>'id')) not between 1 and 80) then return false; end if;
    if (select count(*) from jsonb_array_elements(s->k)) <> (select count(distinct x->>'id') from jsonb_array_elements(s->k) x) then return false; end if;
  end loop;
  for item in select value from jsonb_array_elements(s->'products') loop
    if jsonb_typeof(item->'name') is distinct from 'string' or length(btrim(item->>'name')) not between 1 and 150 or jsonb_typeof(item->'total') is distinct from 'number' then return false; end if;
    n := (item->>'total')::numeric;
    if n<0 or n>1000000 or trunc(n)<>n then return false; end if;
  end loop;
  for item in select value from jsonb_array_elements(s->'lives') loop
    if jsonb_typeof(item->'name') is distinct from 'string' or length(btrim(item->>'name')) not between 1 and 150 then return false; end if;
    if coalesce(item->>'date','') !~ '^\d{4}-\d{2}-\d{2}$' then return false; end if;
    perform (item->>'date')::date;
  end loop;
  for item in select value from jsonb_array_elements(s->'orders') loop
    if jsonb_typeof(item->'product') is distinct from 'string' or not exists(select 1 from jsonb_array_elements(s->'products') x where x->>'id'=item->>'product') then return false; end if;
    if coalesce(item->>'live','')<>'' and not exists(select 1 from jsonb_array_elements(s->'lives') x where x->>'id'=item->>'live') then return false; end if;
    if coalesce(item->>'status','') not in ('nouă','de verificat','pregătită','expediată','livrată','retur','anulată') then return false; end if;
    if jsonb_typeof(item->'qty') is distinct from 'number' then return false; end if;
    n := (item->>'qty')::numeric;
    if n<1 or n>1000000 or trunc(n)<>n then return false; end if;
    foreach k in array array['courier','amount','advance'] loop
      if jsonb_typeof(item->k) is distinct from 'number' then return false; end if;
      n := (item->>k)::numeric;
      if n<0 or n>1000000000 then return false; end if;
    end loop;
    foreach k in array array['customer','phone','city'] loop
      if jsonb_typeof(item->k) is distinct from 'string' or length(btrim(item->>k)) not between 1 and 150 then return false; end if;
    end loop;
  end loop;
  for p in select value from jsonb_array_elements(s->'products') loop
    select coalesce(sum((x->>'qty')::numeric),0) into allocated from jsonb_array_elements(s->'orders') x
    where x->>'product'=p->>'id' and x->>'status' in ('pregătită','expediată','livrată','retur')
      and not(x->>'status'='retur' and coalesce(x->'restocked','false'::jsonb)='true'::jsonb);
    if allocated>(p->>'total')::numeric then return false; end if;
  end loop;
  return true;
exception when others then return false;
end $$;

revoke all on function public.ams_live_valid_state(jsonb) from public,anon,authenticated;
grant execute on function public.ams_live_valid_state(jsonb) to authenticated;

create table public.ams_live_state (
  owner_id uuid primary key references auth.users(id),
  revision bigint not null check(revision between 1 and 9007199254740991),
  data jsonb not null check(public.ams_live_valid_state(data)),
  updated_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id)
);
alter table public.ams_live_state enable row level security;
revoke all on table public.ams_live_state from public,anon,authenticated;
grant select,insert,update on table public.ams_live_state to authenticated;

create policy ams_live_store_read on public.ams_live_state for select to authenticated
using(owner_id=(select public.ams_current_owner_id()) and (select public.ams_permission_mode('pos.sell'))='allow');
create policy ams_live_store_insert on public.ams_live_state for insert to authenticated
with check(owner_id=(select public.ams_current_owner_id()) and updated_by=(select auth.uid()) and (select public.ams_permission_mode('pos.sell'))='allow');
create policy ams_live_store_update on public.ams_live_state for update to authenticated
using(owner_id=(select public.ams_current_owner_id()) and (select public.ams_permission_mode('pos.sell'))='allow')
with check(owner_id=(select public.ams_current_owner_id()) and updated_by=(select auth.uid()) and (select public.ams_permission_mode('pos.sell'))='allow');

create function public.ams_live_get_state()
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare result jsonb;
begin
  if auth.uid() is null or public.ams_permission_mode('pos.sell')<>'allow' then raise exception 'Acces nepermis.' using errcode='42501'; end if;
  select jsonb_build_object('revision',revision,'state',data) into result from public.ams_live_state where owner_id=public.ams_current_owner_id();
  return coalesce(result,'{"revision":0,"state":{"products":[],"orders":[],"lives":[]}}'::jsonb);
end $$;

create function public.ams_live_save_state(p_revision bigint,p_state jsonb)
returns jsonb language plpgsql volatile security invoker set search_path = '' as $$
declare next_revision bigint; store_owner uuid;
begin
  if auth.uid() is null or public.ams_permission_mode('pos.sell')<>'allow' then raise exception 'Acces nepermis.' using errcode='42501'; end if;
  if p_revision is null or p_revision<0 or not public.ams_live_valid_state(p_state) then raise exception 'Date invalide.' using errcode='22023'; end if;
  store_owner:=public.ams_current_owner_id();
  if p_revision=0 then
    insert into public.ams_live_state(owner_id,revision,data,updated_by) values(store_owner,1,p_state,auth.uid()) on conflict(owner_id) do nothing returning revision into next_revision;
  else
    update public.ams_live_state set revision=revision+1,data=p_state,updated_by=auth.uid(),updated_at=now()
    where owner_id=store_owner and revision=p_revision returning revision into next_revision;
  end if;
  if next_revision is null then raise exception 'Datele au fost schimbate pe alt dispozitiv.' using errcode='40001'; end if;
  return jsonb_build_object('revision',next_revision);
end $$;

create function public.ams_live_catalog(p_after bigint default 0)
returns table(id text,code text,name text,ean text,price numeric,available boolean)
language plpgsql stable security invoker set search_path = '' as $$
begin
  if auth.uid() is null or public.ams_permission_mode('pos.sell')<>'allow' then raise exception 'Acces nepermis.' using errcode='42501'; end if;
  return query select p.id::text,p.product_code,p.name,coalesce(p.ean,''),p.sale_price,coalesce(p.reservation_code,'')=''
  from public.ams_products p where p.owner_id=public.ams_current_owner_id() and p.status='In stoc' and p.id>coalesce(p_after,0)
  order by p.id limit 1000;
end $$;

revoke all on function public.ams_live_get_state() from public,anon,authenticated;
revoke all on function public.ams_live_save_state(bigint,jsonb) from public,anon,authenticated;
revoke all on function public.ams_live_catalog(bigint) from public,anon,authenticated;
grant execute on function public.ams_live_get_state() to authenticated;
grant execute on function public.ams_live_save_state(bigint,jsonb) to authenticated;
grant execute on function public.ams_live_catalog(bigint) to authenticated;
