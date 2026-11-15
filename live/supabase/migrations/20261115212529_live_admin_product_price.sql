do $migration$
declare
 definition text := pg_get_functiondef('ams_private.live_api(text,jsonb)'::regprocedure);
 anchor text := $anchor$ elsif p_action='product_save' then$anchor$;
 price_check text := $check$    if unit_price is null or unit_price<=0 or unit_price>1000000 then raise exception 'Preț invalid.'; end if;$check$;
begin
 if strpos(definition,anchor)=0 or strpos(definition,price_check)=0 then
  raise exception 'Unexpected Live API definition';
 end if;
 definition := replace(definition,anchor,$branch$ elsif p_action='price_save' then
  if public.ams_is_primary_admin() is not true then
   raise exception 'Doar administratorul principal poate modifica prețul.' using errcode='42501';
  end if;
  unit_price:=(p_data->>'price')::numeric;
  if unit_price is null or unit_price<=0 or unit_price>1000000 or unit_price<>round(unit_price,2) then
   raise exception 'Introdu un preț valid, cu cel mult două zecimale.';
  end if;
  select * into prod from public.ams_products where owner_id=own and id=(p_data->>'id')::bigint for update;
  if not found or prod.status<>'In stoc' or coalesce(prod.reservation_code,'')<>'' then
   raise exception 'Poți modifica doar prețul unei bucăți disponibile.';
  end if;
  if prod.sale_price is distinct from (p_data->>'expected_price')::numeric then
   raise exception 'Prețul a fost modificat între timp. Redeschide produsul.' using errcode='40001';
  end if;
  if prod.sale_price is distinct from unit_price then
   update public.ams_products set sale_price=unit_price,updated_at=now() where owner_id=own and id=prod.id;
   insert into public.ams_live_audit(owner_id,actor_id,actor_name,action,detail)
   values(own,uid,actor,'price_save',jsonb_build_object('product_id',prod.id,'old_price',prod.sale_price,'new_price',unit_price));
  end if;
  return jsonb_build_object('id',prod.id::text,'price',unit_price);
 elsif p_action='product_save' then$branch$);
 definition := replace(definition,price_check,price_check || $rule$
    if public.ams_is_primary_admin() is not true
      and unit_price is distinct from round(prod.sale_price,2)
      and not exists(select 1 from jsonb_array_elements(coalesce(o.items,'[]'::jsonb)) saved
        where saved->>'id'=prod.id::text and (saved->>'price')::numeric=unit_price) then
     raise exception 'Prețul diferă de cel din stoc. Redeschide comanda sau cere reducerea administratorului.' using errcode='42501';
    end if;$rule$);
 execute definition;
end
$migration$;
