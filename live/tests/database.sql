-- Run as database owner. All test writes are rolled back, including on success.
begin;
select set_config('request.jwt.claim.sub',(select user_id::text from public.ams_app_users where active and is_primary_admin order by created_at limit 1),true);
set local role authenticated;
do $$
declare initial_revision bigint; result jsonb; fixture jsonb; invalid jsonb; own_id uuid;
begin
  own_id:=auth.uid();
  if own_id is null then raise exception 'No test identity'; end if;
  initial_revision:=(public.ams_live_get_state()->>'revision')::bigint;
  fixture:='{"products":[{"id":"test-product","name":"Integration test","total":1}],"lives":[],"orders":[{"id":"test-order","product":"test-product","qty":1,"customer":"Test","phone":"0700000000","city":"Test","delivery":"GLS","courier":0,"amount":100,"advance":0,"status":"pregătită","live":"","notes":""}]}'::jsonb;
  result:=public.ams_live_save_state(initial_revision,fixture);
  if (result->>'revision')::bigint<>initial_revision+1 then raise exception 'Revision did not advance'; end if;
  if public.ams_live_get_state()->'state'<>fixture then raise exception 'State did not persist'; end if;
  begin
    perform public.ams_live_save_state(initial_revision,fixture);
    raise exception 'Stale write accepted';
  exception when serialization_failure then null; end;
  invalid:=jsonb_set(fixture,'{products,0,total}','0');
  begin
    perform public.ams_live_save_state(initial_revision+1,invalid);
    raise exception 'Oversold stock accepted';
  exception when invalid_parameter_value then null; end;
  invalid:=jsonb_set(fixture,'{orders,0,qty}','1.5');
  if public.ams_live_valid_state(invalid) then raise exception 'Fractional quantity accepted'; end if;
  invalid:=jsonb_set(fixture,'{products}',(fixture->'products')||(fixture->'products'));
  if public.ams_live_valid_state(invalid) then raise exception 'Duplicate product accepted'; end if;
  invalid:=jsonb_set(fixture,'{orders,0,product}','"missing"');
  if public.ams_live_valid_state(invalid) then raise exception 'Orphan order accepted'; end if;
  invalid:=jsonb_set(jsonb_set(jsonb_set(fixture,'{products,0,total}','0'),'{orders,0,status}','"retur"'),'{orders,0,restocked}','true');
  if not public.ams_live_valid_state(invalid) then raise exception 'Restocked return rejected'; end if;
  if exists(select 1 from public.ams_live_catalog(0) where id is null or name is null) then raise exception 'Invalid catalog mapping'; end if;
  if (select count(*) from public.ams_live_catalog(0))>1000 then raise exception 'Unbounded catalog'; end if;
  begin
    insert into public.ams_live_state(owner_id,revision,data,updated_by) values(gen_random_uuid(),1,fixture,own_id);
    raise exception 'Cross-store insert accepted';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  if exists(select 1 from public.ams_live_state) then raise exception 'Other account can read store state'; end if;
  begin
    perform public.ams_live_get_state();raise exception 'Unknown account can read API';
  exception when insufficient_privilege then null; end;
  begin
    perform public.ams_live_save_state(0,fixture);raise exception 'Unknown account can write API';
  exception when insufficient_privilege then null; end;
  begin
    perform public.ams_live_catalog(0);raise exception 'Unknown account can read catalog';
  exception when insufficient_privilege then null; end;
end $$;
set local role anon;
do $$ begin
  begin perform public.ams_live_get_state();raise exception 'Anonymous API exposed';exception when insufficient_privilege then null;end;
  begin perform 1 from public.ams_live_state;raise exception 'Anonymous table exposed';exception when insufficient_privilege then null;end;
end $$;
rollback;
select 'PASS: persistence, conflict, stock validation, returns, catalog, owner isolation, anonymous denial; rolled back' as result;
