begin;
select set_config('request.jwt.claim.sub',(select user_id::text from public.ams_app_users where active and is_primary_admin order by created_at limit 1),true);
set local role authenticated;
do $$declare o jsonb;p jsonb;j jsonb;cfg jsonb;denied boolean;begin
 cfg:=jsonb_build_object('Username','qa@example.test','Password',(select jsonb_agg(0) from generate_series(1,64)),'ClientNumber',123,'mode','test','TypeOfPrinter','A4_2x2','PickupAddress','{"Name":"QA","Street":"QA","HouseNumber":"1","City":"QA","ZipCode":"123456","ContactPhone":"0700000000","CountryIsoCode":"RO"}'::jsonb);
 perform public.ams_live_gls('save_config',jsonb_build_object('config',cfg));
 if public.ams_live_gls('status')#>'{settings,Password}' is not null then raise exception 'GLS password exposed';end if;
 select jsonb_build_object('id',id::text,'price',100) into p from public.ams_products where owner_id=public.ams_current_owner_id() and status='In stoc' and coalesce(reservation_code,'')='' order by id limit 1;
 o:=public.ams_live_api('save',jsonb_build_object('id',gen_random_uuid(),'items',jsonb_build_array(p),'customer','{"name":"QA","phone":"0700000000","address":"Test 1","city":"Test","postal":"123456"}'::jsonb));
 o:=public.ams_live_api('reserve',jsonb_build_object('id',o->>'id','revision',o->'revision'));
 perform set_config('ams.test_gls_order',o->>'id',true);
 denied:=false;begin perform public.ams_live_gls('start',jsonb_build_object('id',o->>'id','revision',o->'revision'));exception when raise_exception then denied:=true;end;
 if not denied then raise exception 'Unpaid/unpacked AWB allowed';end if;
 o:=public.ams_live_team_api('claim',jsonb_build_object('id',o->>'id','revision',o->'revision'));
 o:=public.ams_live_team_api('scan',jsonb_build_object('id',o->>'id','revision',o->'revision','code',o#>>'{items,0,code}'));
 o:=public.ams_live_api('fulfill',jsonb_build_object('id',o->>'id','revision',o->'revision','fulfillment','packed'));
end$$;
reset role;
-- Test fixture only, rolled back. Fiscal integration is verified separately in workflow.sql.
update public.ams_live_orders set status='paid' where id=current_setting('ams.test_gls_order')::uuid;
set local role authenticated;
do $$declare o jsonb;j jsonb;b jsonb;payload jsonb;begin
 o:=public.ams_live_api('get',jsonb_build_object('id',current_setting('ams.test_gls_order')));
 payload:=jsonb_build_object('id',o->>'id','revision',o->'revision','street','Test','house','1','weight',2,'cod',100,'pickup_date',current_date::text);
 j:=public.ams_live_gls('start',payload);b:=public.ams_live_gls('start',payload);
 if j->>'request_id'<>b->>'request_id' then raise exception 'Duplicate shipment job';end if;
 if j ? 'secret_id' then raise exception 'Secret reference exposed';end if;
 begin perform public.ams_live_gls_worker('secret',payload);raise exception 'Authenticated GLS secret access';exception when insufficient_privilege then null;end;
end$$;
set local role service_role;
do $$declare p jsonb;result jsonb;begin
 p:=jsonb_build_object('id',current_setting('ams.test_gls_order'),'owner_id',public.ams_current_owner_id());
 result:=public.ams_live_gls_worker('dispatch',p);if result->>'dispatch'<>'true' then raise exception 'First dispatch rejected';end if;
 result:=public.ams_live_gls_worker('dispatch',p);if result->>'dispatch'<>'false' then raise exception 'Duplicate dispatch allowed';end if;
end$$;
rollback;
select 'PASS GLS credentials hidden, fiscal/packing gate, idempotent job, dispatch once; no GLS request sent, rolled back' result;
