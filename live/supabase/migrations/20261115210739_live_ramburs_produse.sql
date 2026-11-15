-- Preserve the deployed role, order, and shipment checks while updating totals.
do $migration$
declare
 function_def text;
begin
 function_def := pg_get_functiondef('ams_private.live_gls_api(text,jsonb)'::regprocedure);
 if strpos(function_def, 'cod>o.goods_total+o.shipping-o.advance') = 0 then
  raise exception 'Unexpected GLS validation definition';
 end if;
 execute replace(function_def, 'cod>o.goods_total+o.shipping-o.advance',
   'cod<>greatest(0,o.goods_total-o.advance)');

 function_def := pg_get_functiondef('ams_private.live_team_api(text,jsonb)'::regprocedure);
 if strpos(function_def, 'sum(ord.goods_total+ord.shipping)') = 0 then
  raise exception 'Unexpected Live session totals definition';
 end if;
 execute replace(function_def, 'sum(ord.goods_total+ord.shipping)', 'sum(ord.goods_total)');

 function_def := pg_get_functiondef('ams_private.live_customer(text,jsonb,bigint)'::regprocedure);
 if strpos(function_def, '''total'',o.goods_total+o.shipping,''shipping'',o.shipping') = 0 then
  raise exception 'Unexpected customer totals definition';
 end if;
 execute replace(function_def, '''total'',o.goods_total+o.shipping,''shipping'',o.shipping',
   '''total'',o.goods_total,''shipping'',0');
end
$migration$;
