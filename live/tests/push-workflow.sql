begin;
select set_config('request.jwt.claim.sub',(select user_id::text from public.ams_app_users where active and is_primary_admin order by created_at limit 1),true);
set local role authenticated;
do $$declare p jsonb;o jsonb;token text;begin
 perform public.ams_live_push('subscribe',jsonb_build_object('endpoint','https://web.push.apple.com/QA-ROLLBACK','keys',jsonb_build_object('p256dh',repeat('a',87),'auth',repeat('a',22))));
 select jsonb_build_object('id',id::text,'price',100) into p from public.ams_products where owner_id=public.ams_current_owner_id() and status='In stoc' and coalesce(reservation_code,'')='' order by id limit 1;
 o:=public.ams_live_api('save',jsonb_build_object('id',gen_random_uuid(),'items',jsonb_build_array(p),'customer',jsonb_build_object('name','QA')));
 token:=public.ams_live_team_api('link_create',jsonb_build_object('id',o->>'id','revision',o->'revision'))->>'token';
 perform set_config('ams.test_customer_token',token,true);
end$$;
set local role anon;
do $$declare o jsonb;begin
 o:=public.ams_live_customer(current_setting('ams.test_customer_token'));
 o:=public.ams_live_customer(current_setting('ams.test_customer_token'),' {"name":"QA Customer","phone":"0700000000","address":"Test only","city":"Test","county":"Test"}',(o->>'revision')::bigint);
 if o#>>'{customer,name}'<>'QA Customer' then raise exception 'Public customer edit failed';end if;
end$$;
set local role service_role;
do $$declare a jsonb;b jsonb;begin
 a:=public.ams_live_push_worker('claim');
 if jsonb_array_length(a)<>1 then raise exception 'Expected one queued delivery';end if;
 b:=public.ams_live_push_worker('claim');
 if jsonb_array_length(b)<>0 then raise exception 'Lease did not prevent double sending';end if;
 perform public.ams_live_push_worker('finish',jsonb_build_object('event_id',a#>>'{0,event_id}','subscription_id',a#>>'{0,subscription_id}','sent',true));
 b:=public.ams_live_push_worker('claim');
 if jsonb_array_length(b)<>0 then raise exception 'Sent delivery repeated';end if;
end$$;
rollback;
select 'PASS public customer edit, push subscription, worker claim lease and delivery deduplication; no notifications sent, rolled back' result;
