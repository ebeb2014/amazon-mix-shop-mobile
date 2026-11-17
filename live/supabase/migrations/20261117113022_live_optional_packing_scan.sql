do $migration$
declare definition text := pg_get_functiondef('ams_private.live_order_guard()'::regprocedure);
removed text := $block$ if new.fulfillment in ('packed','shipped','delivered') and new.fulfillment is distinct from old.fulfillment then
  if exists(select 1 from jsonb_array_elements(new.items) i where not exists(select 1 from ams_private.live_checks c where c.order_id=new.id and c.product_id=i->>'id')) then raise exception 'Scanează fiecare bucată înainte de finalizarea coletului.'; end if;
 end if;
$block$;
begin
 if strpos(definition,removed)=0 then raise exception 'Unexpected packing guard definition'; end if;
 execute replace(definition,removed,'');
end $migration$;
