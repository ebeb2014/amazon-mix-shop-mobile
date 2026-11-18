-- The saved reservation is reused for both GLS and the fiscal receipt.
DO $migration$
declare src text; old text;
begin
 src:=pg_get_functiondef('ams_private.live_gls_api(text,jsonb)'::regprocedure);
 old:=$body$o.status<>'paid' or o.fulfillment$body$;
 if position(old in src)=0 then raise exception 'GLS status guard changed'; end if;
 src:=replace(src,old,$body$o.status not in ('reserved','paid') or o.fulfillment$body$);
 src:=replace(src,'finalizează bonul; comanda trebuie să fie pentru curier, fără AWB sau expediere existentă.','salvează și rezervă comanda pentru curier, fără AWB sau expediere existentă.');
 execute src;
 src:=pg_get_functiondef('ams_private.live_api(text,jsonb)'::regprocedure);
 old:=$body$if p_action='archive' then$body$;
 if position(old in src)=0 then raise exception 'Order function changed'; end if;
 src:=replace(src,old,$body$if p_action in ('cancel','contact') and exists(select 1 from ams_private.live_gls_jobs where order_id=oid and state in ('pending','unknown','ready')) then
    raise exception 'Comanda are o cerere GLS sau un AWB. Verifică expedierea în GLS înainte de anulare sau schimbarea adresei.';
   end if;
   if p_action='archive' then$body$);
 execute src;
end $migration$;
