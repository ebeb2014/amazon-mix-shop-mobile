-- Hide cancelled orders across devices while retaining receipts and audit history.
alter table public.ams_live_orders add column if not exists archived_at timestamptz;
DO $migration$
declare src text; old text;
begin
 src:=pg_get_functiondef('ams_private.live_api(text,jsonb)'::regprocedure);
 old:='where owner_id=own and (coalesce(p_data->>''filter'','''')<>''open''';
 if position(old in src)=0 then raise exception 'List function changed'; end if;
 src:=replace(src,old,'where owner_id=own and archived_at is null and (coalesce(p_data->>''filter'','''')<>''open''');
 src:=replace(src,'''reserve'',''cancel'',''fulfill'',''contact''','''reserve'',''cancel'',''fulfill'',''contact'',''archive''');
 old:='if p_action=''contact'' then';
 if position(old in src)=0 then raise exception 'Mutation function changed'; end if;
 src:=replace(src,old,$body$if p_action='archive' then
    if role_name not in ('manager','operator') then raise exception 'Acces refuzat.' using errcode='42501'; end if;
    if o.status<>'cancelled' then raise exception 'Poți elimina din listă doar comenzile anulate.'; end if;
    update public.ams_live_orders set archived_at=coalesce(archived_at,now()) where id=oid;
   elsif p_action='contact' then$body$);
 execute src;
 src:=pg_get_functiondef('ams_private.live_order_guard()'::regprocedure);
 old:=$body$if new.fulfillment is distinct from old.fulfillment and new.fulfillment in ('packing','packed','shipped','delivered') and new.assigned_to is distinct from auth.uid() and coalesce(ams_private.live_role(),'disabled')<>'manager' then raise exception 'Preia comanda înainte de pregătire.';end if;$body$;
 if position(old in src)=0 then raise exception 'Order guard changed'; end if;
 execute replace(src,old,'');
 src:=pg_get_functiondef('ams_private.live_gls_api(text,jsonb)'::regprocedure);
 old:=$body$if o.assigned_to is distinct from uid and r<>'manager' then raise exception 'Doar responsabilul poate crea AWB-ul.';end if;$body$;
 if position(old in src)=0 then raise exception 'GLS ownership guard changed'; end if;
 src:=replace(src,old,'');
 old:=$body$o.fulfillment<>'packed'$body$;
 if position(old in src)=0 then raise exception 'GLS stage guard changed'; end if;
 src:=replace(src,old,$body$o.fulfillment not in ('new','packing','packed')$body$);
 src:=replace(src,'comanda trebuie fiscalizată, verificată și împachetată, fără AWB existent.','finalizează bonul; comanda trebuie să fie pentru curier, fără AWB sau expediere existentă.');
 execute src;
end $migration$;
