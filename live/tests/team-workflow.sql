begin;
select set_config('request.jwt.claim.sub',(select user_id::text from public.ams_app_users where active and is_primary_admin order by created_at limit 1),true);
set local role authenticated;
do $$
declare p jsonb;o jsonb;details jsonb;token text;oid uuid:=gen_random_uuid();uid uuid:=auth.uid();staff uuid;denied boolean;oldrev bigint;
begin
 select jsonb_build_object('id',id::text,'price',100) into p from public.ams_products where owner_id=public.ams_current_owner_id() and status='In stoc' and coalesce(reservation_code,'')='' order by id limit 1;
 o:=public.ams_live_api('save',jsonb_build_object('id',oid,'items',jsonb_build_array(p),'customer',jsonb_build_object('name','QA team','phone','0700000000','city','Test','address','Test')));
 o:=public.ams_live_api('reserve',jsonb_build_object('id',oid,'revision',o->'revision'));
 token:=public.ams_live_team_api('link_create',jsonb_build_object('id',oid,'revision',o->'revision'))->>'token';
 details:=public.ams_live_customer(token);
 if details ? 'owner_id' or details ? 'id' or details ? 'receipt_code' then raise exception 'Customer data leak';end if;
 details:=public.ams_live_customer(token,'{"name":"QA client","phone":"0700000000","address":"Test address","city":"Bucuresti","county":"Sector 4","postal":""}',(details->>'revision')::bigint);
 if details#>>'{customer,name}'<>'QA client' then raise exception 'Customer save failed';end if;
 o:=public.ams_live_api('get',jsonb_build_object('id',oid));
 denied:=false;begin perform public.ams_live_api('fulfill',jsonb_build_object('id',oid,'revision',o->'revision','fulfillment','packed'));exception when raise_exception then denied:=true;end;
 if not denied then raise exception 'Incomplete parcel accepted';end if;
 oldrev:=(o->>'revision')::bigint;
 o:=public.ams_live_team_api('claim',jsonb_build_object('id',oid,'revision',o->'revision'));
 begin perform public.ams_live_team_api('claim',jsonb_build_object('id',oid,'revision',oldrev));raise exception 'Stale claim accepted';exception when serialization_failure then null;end;
 select user_id into staff from public.ams_app_users where owner_id=public.ams_current_owner_id() and active and not is_primary_admin limit 1;
 if staff is not null then
  perform public.ams_live_api('member',jsonb_build_object('user_id',staff,'role','packer'));
  perform set_config('request.jwt.claim.sub',staff::text,true);
  denied:=false;begin perform public.ams_live_team_api('claim',jsonb_build_object('id',oid,'revision',o->'revision'));exception when raise_exception then denied:=true;end;
  if not denied then raise exception 'Second staff claimed order';end if;
  perform set_config('request.jwt.claim.sub',uid::text,true);
 end if;
 denied:=false;begin perform public.ams_live_team_api('scan',jsonb_build_object('id',oid,'revision',o->'revision','code','WRONG-CODE'));exception when raise_exception then denied:=true;end;
 if not denied then raise exception 'Wrong product accepted';end if;
 o:=public.ams_live_team_api('scan',jsonb_build_object('id',oid,'revision',o->'revision','code',o#>>'{items,0,code}'));
 denied:=false;begin perform public.ams_live_team_api('scan',jsonb_build_object('id',oid,'revision',o->'revision','code',o#>>'{items,0,code}'));exception when raise_exception then denied:=true;end;
 if not denied then raise exception 'Duplicate scan accepted';end if;
 perform public.ams_live_team_api('link_revoke',jsonb_build_object('id',oid,'revision',o->'revision'));
 denied:=false;begin perform public.ams_live_customer(token);exception when raise_exception then denied:=true;end;
 if not denied then raise exception 'Revoked link accepted';end if;
 o:=public.ams_live_api('fulfill',jsonb_build_object('id',oid,'revision',o->'revision','fulfillment','packed'));
 details:=public.ams_live_team_api('events');if not exists(select 1 from jsonb_array_elements(details->'events') e where e->>'order_id'=oid::text and e->>'title' like 'Colet pregătit%') then raise exception 'Packing event missing';end if;
 perform public.ams_live_team_api('reports');
 begin perform public.ams_live_push_worker('config');raise exception 'Worker secrets exposed';exception when insufficient_privilege then null;end;
end$$;
set local role anon;
do $$begin
 begin perform public.ams_live_team_api('events');raise exception 'Anonymous team access';exception when insufficient_privilege then null;end;
 begin perform public.ams_live_push_worker('config');raise exception 'Anonymous secret access';exception when insufficient_privilege then null;end;
end$$;
rollback;
select 'PASS packing gates, exclusive claim, CAS, wrong/duplicate scans, customer edits and revocation, notifications, restricted worker; rollback' result;
