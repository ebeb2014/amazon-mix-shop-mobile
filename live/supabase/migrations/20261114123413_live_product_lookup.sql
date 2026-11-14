create or replace function ams_private.live_api(p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 uid uuid:=auth.uid(); own uuid:=public.ams_current_owner_id(); role_name text:=ams_private.live_role();
 actor text; result jsonb; o public.ams_live_orders%rowtype; prod public.ams_products%rowtype;
 oid uuid; item jsonb; arr jsonb:='[]'; prices jsonb; snap jsonb; codes text[]; id_list bigint[]:='{}';
 total numeric:=0; unit_price numeric; shipping_fee numeric; advance_amount numeric; rec text;
 detail jsonb:='{}'; cond text; target uuid; memberrole text; old_revision bigint; code text;
begin
 if uid is null or role_name is null or role_name='disabled' then raise exception 'Acces Live indisponibil pentru acest cont.' using errcode='42501'; end if;
 if octet_length(p_data::text)>200000 then raise exception 'Cerere prea mare.'; end if;
 select coalesce(nullif(display_name,''),username) into actor from public.ams_app_users where user_id=uid and active;
 if p_action='identity' then
  return jsonb_build_object('user_id',uid,'owner_id',own,'name',actor,'role',role_name,'primary_admin',public.ams_is_primary_admin());
 elsif p_action in ('catalog','product') then
  select coalesce(jsonb_agg(to_jsonb(x)),'[]') into result from (
   select p.id::text id,p.product_code code,p.name,p.ean,p.sale_price price,p.vat_rate,
    (p.status='In stoc' and coalesce(p.reservation_code,'')='') available,p.status,
    coalesce(d.short_code,'') short_code,coalesce(d.condition,'neverificat') condition,
    coalesce(d.notes,'') condition_notes,coalesce(d.photos,'[]') photos,coalesce(d.revision,0) detail_revision
   from public.ams_products p left join public.ams_live_product_details d on d.product_id=p.id and d.owner_id=own
   where p.owner_id=own and ((p_action='catalog' and p.status='In stoc' and p.id>coalesce((p_data->>'after')::bigint,0)) or (p_action='product' and p.id=(p_data->>'id')::bigint))
   order by p.id limit 1000
  ) x; return result;
 elsif p_action='list' then
  select coalesce(jsonb_agg(to_jsonb(x)),'[]') into result from (
   select * from public.ams_live_orders where owner_id=own and (coalesce(p_data->>'filter','')<>'open' or status in ('reserved','checkout')) order by updated_at desc limit 100 offset greatest(0,least(coalesce((p_data->>'offset')::int,0),1000000))
  ) x;return result;
 elsif p_action='sessions' then
  return coalesce((select jsonb_agg(to_jsonb(s) order by created_at desc) from (select * from public.ams_live_sessions where owner_id=own order by created_at desc limit 100) s),'[]');
 elsif p_action='team' then
  if role_name<>'manager' then raise exception 'Doar administratorul Live poate gestiona echipa.' using errcode='42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',u.user_id,'name',coalesce(nullif(u.display_name,''),u.username),'email',u.auth_email,'active',u.active,'primary',u.is_primary_admin,'role',case when u.is_primary_admin then 'manager' else coalesce(m.role,case when exists(select 1 from public.ams_user_permissions up where up.user_id=u.user_id and up.owner_id=own and up.permission_code='pos.sell' and up.access_mode='allow') then 'operator' else 'disabled' end) end)) from public.ams_app_users u left join public.ams_live_members m on m.user_id=u.user_id and m.owner_id=own where u.owner_id=own),'[]');
 elsif p_action='member' then
  if role_name<>'manager' then raise exception 'Acces refuzat.' using errcode='42501'; end if;
  target:=(p_data->>'user_id')::uuid;memberrole:=p_data->>'role';
  if memberrole not in ('manager','operator','packer','viewer','disabled') or not exists(select 1 from public.ams_app_users where user_id=target and owner_id=own and active and not is_primary_admin) then raise exception 'Utilizator sau rol invalid.'; end if;
  insert into public.ams_live_members(owner_id,user_id,role,updated_by) values(own,target,memberrole,uid)
  on conflict(user_id) do update set role=excluded.role,updated_at=now(),updated_by=uid;
  detail:=jsonb_build_object('user_id',target,'role',memberrole);
 elsif p_action='session_create' then
  if role_name not in ('manager','operator') then raise exception 'Acces refuzat.' using errcode='42501'; end if;
  insert into public.ams_live_sessions(owner_id,name,created_by) values(own,trim(p_data->>'name'),uid) returning to_jsonb(ams_live_sessions.*) into result;
 elsif p_action='product_save' then
  if role_name not in ('manager','operator') then raise exception 'Acces refuzat.' using errcode='42501'; end if;
  select * into prod from public.ams_products where id=(p_data->>'id')::bigint and owner_id=own for update;
  if not found then raise exception 'Produs inexistent.'; end if;
  select revision into old_revision from public.ams_live_product_details where product_id=prod.id;
  if coalesce(old_revision,0)<>coalesce((p_data->>'revision')::bigint,-1) then raise exception 'Detaliile au fost modificate. Reîncarcă.' using errcode='40001'; end if;
  arr:=coalesce(p_data->'photos','[]');
  if jsonb_typeof(arr)<>'array' or jsonb_array_length(arr)>8 or exists(select 1 from jsonb_array_elements_text(arr) v where v not like own::text||'/'||prod.id::text||'/%' or v like '%..%' or length(v)>200 or not exists(select 1 from storage.objects s where s.bucket_id='ams-live-products' and s.name=v)) then raise exception 'Fotografii invalide.'; end if;
  insert into public.ams_live_product_details(product_id,owner_id,short_code,condition,notes,photos,updated_by)
   values(prod.id,own,trim(coalesce(p_data->>'short_code','')),coalesce(p_data->>'condition','neverificat'),coalesce(p_data->>'notes',''),arr,uid)
   on conflict(product_id) do update set short_code=excluded.short_code,condition=excluded.condition,notes=excluded.notes,photos=excluded.photos,revision=ams_live_product_details.revision+1,updated_at=now(),updated_by=uid;
  detail:=jsonb_build_object('product_id',prod.id,'condition',p_data->>'condition','short_code',p_data->>'short_code');
 else
  oid:=(p_data->>'id')::uuid;
  if p_action='checkout_release' then
   select * into o from public.ams_live_orders where owner_id=own and receipt_code=p_data->>'receipt_code' for update;
   if not found then return jsonb_build_object('handled',false); end if; oid:=o.id;
  else
   select * into o from public.ams_live_orders where id=oid and owner_id=own for update;
  end if;
  if p_action='save' then
   if role_name not in ('manager','operator') then raise exception 'Acces refuzat.' using errcode='42501'; end if;
   if o.id is not null and (o.status<>'draft' or o.revision<>coalesce((p_data->>'revision')::bigint,0)) then raise exception 'Comanda nu mai poate fi modificată. Reîncarcă.' using errcode='40001'; end if;
   if o.id is null and exists(select 1 from public.ams_live_orders where id=oid) then raise exception 'Comandă indisponibilă.' using errcode='42501'; end if;
   if jsonb_typeof(p_data->'items') is distinct from 'array' or jsonb_array_length(p_data->'items') not between 1 and 100 then raise exception 'Alege între 1 și 100 de bucăți.'; end if;
   if jsonb_typeof(p_data->'customer') is distinct from 'object' or length(trim(coalesce(p_data#>>'{customer,name}','')))=0 or length((p_data->'customer')::text)>5000 then raise exception 'Completează numele clientului.'; end if;
   for item in select value from jsonb_array_elements(p_data->'items') loop
    select * into prod from public.ams_products where owner_id=own and id=(item->>'id')::bigint;
    if not found or prod.status<>'In stoc' or coalesce(prod.reservation_code,'')<>'' then raise exception 'Produs indisponibil: %',item->>'id'; end if;
    if prod.id=any(id_list) then raise exception 'Aceeași bucată apare de două ori.'; end if;
    id_list:=array_append(id_list,prod.id);unit_price:=round((item->>'price')::numeric,2);
    if unit_price is null or unit_price<=0 or unit_price>1000000 then raise exception 'Preț invalid.'; end if;
    total:=total+unit_price;
    arr:=arr||jsonb_build_array(jsonb_build_object('id',prod.id::text,'code',prod.product_code,'name',prod.name,'ean',prod.ean,'price',unit_price,'vat_rate',coalesce(prod.vat_rate,19)));
   end loop;
   if nullif(p_data->>'session_id','') is not null and not exists(select 1 from public.ams_live_sessions where id=(p_data->>'session_id')::uuid and owner_id=own) then raise exception 'Sesiune invalidă.'; end if;
   insert into public.ams_live_orders(id,owner_id,customer,items,session_id,goods_total,shipping,advance,delivery,notes,created_by,updated_by)
   values(oid,own,p_data->'customer',arr,nullif(p_data->>'session_id','')::uuid,total,coalesce((p_data->>'shipping')::numeric,0),coalesce((p_data->>'advance')::numeric,0),coalesce(p_data->>'delivery','curier'),coalesce(p_data->>'notes',''),uid,uid)
   on conflict(id) do update set customer=excluded.customer,items=excluded.items,session_id=excluded.session_id,goods_total=excluded.goods_total,shipping=excluded.shipping,advance=excluded.advance,delivery=excluded.delivery,notes=excluded.notes,revision=ams_live_orders.revision+1,updated_at=now(),updated_by=uid;
  else
   if o.id is null then raise exception 'Comandă inexistentă.'; end if;
   if p_action='get' then return to_jsonb(o);
   elsif p_action='audit' then return coalesce((select jsonb_agg(to_jsonb(a) order by created_at desc) from (select * from public.ams_live_audit where owner_id=own and order_id=oid order by created_at desc limit 100) a),'[]'); end if;
   if p_action in ('reserve','cancel','fulfill','contact') and o.revision<>coalesce((p_data->>'revision')::bigint,-1) then raise exception 'Comanda s-a schimbat. Reîncarcă.' using errcode='40001'; end if;
   select array_agg(x->>'code'),array_agg((x->>'id')::bigint) into codes,id_list from jsonb_array_elements(o.items) x;
   if p_action='contact' then
    if role_name not in ('manager','operator') then raise exception 'Acces refuzat.' using errcode='42501'; end if;
    if o.status not in ('draft','reserved') then raise exception 'Comanda este deja la casă sau finalizată.'; end if;
    if jsonb_typeof(p_data->'customer') is distinct from 'object' or trim(coalesce(p_data#>>'{customer,name}',''))='' or length((p_data->'customer')::text)>5000 then raise exception 'Date client invalide.'; end if;
    update public.ams_live_orders set customer=p_data->'customer' where id=oid;
   elsif p_action='fulfill' then
    if role_name not in ('manager','operator','packer') then raise exception 'Acces refuzat.' using errcode='42501'; end if;
    cond:=p_data->>'fulfillment';
    if o.status not in ('reserved','checkout','paid') or cond not in ('new','packing','packed','shipped','delivered','return') then raise exception 'Stare invalidă.'; end if;
    if cond in ('shipped','delivered','return') and o.status<>'paid' then raise exception 'Finalizează vânzarea fiscală înainte de expediere.'; end if;
    if cond='shipped' and o.delivery='curier' and (trim(coalesce(p_data->>'awb',''))='' or trim(coalesce(p_data->>'courier',''))='') then raise exception 'Completează curierul și AWB-ul.'; end if;
    if o.delivery='curier' and cond in ('packed','shipped') and (trim(coalesce(o.customer->>'phone',''))='' or trim(coalesce(o.customer->>'city',''))='' or trim(coalesce(o.customer->>'address',''))='') then raise exception 'Completează telefonul, localitatea și adresa înainte de rezervare / ambalare.'; end if;
    update public.ams_live_orders set fulfillment=cond,courier=left(coalesce(p_data->>'courier',''),100),awb=left(coalesce(p_data->>'awb',''),100) where id=oid;
    detail:=jsonb_build_object('from',o.fulfillment,'to',cond,'awb',p_data->>'awb');
   elsif p_action in ('reserve','cancel') then
    if role_name not in ('manager','operator') then raise exception 'Acces refuzat.' using errcode='42501'; end if;
    if o.status not in ('draft','reserved') then raise exception 'Comanda este la casă sau finalizată. Verifică bonul.'; end if;
    perform 1 from public.ams_products where owner_id=own and id=any(id_list) order by id for update;
    if p_action='reserve' then
     if trim(coalesce(o.customer->>'phone',''))='' then raise exception 'Completează telefonul clientului.'; end if;
     if (select count(*) from public.ams_products where owner_id=own and id=any(id_list) and status='In stoc' and coalesce(reservation_code,'') in ('','LIVE:'||oid::text))<>cardinality(id_list) then raise exception 'O bucată a fost vândută sau rezervată între timp. Stocul nu a fost modificat.'; end if;
     update public.ams_products set reservation_code='LIVE:'||oid::text,reservation_started_at=now() where owner_id=own and id=any(id_list);
     update public.ams_live_orders set status='reserved' where id=oid;
    else
     update public.ams_products set reservation_code='',reservation_started_at=null where owner_id=own and id=any(id_list) and reservation_code='LIVE:'||oid::text;
     update public.ams_live_orders set status='cancelled' where id=oid;
    end if;
   elsif p_action in ('checkout_prepare','checkout_commit','checkout_release') then
    if public.ams_permission_mode('pos.sell')<>'allow' then raise exception 'Este necesar dreptul de vânzare la casă.' using errcode='42501'; end if;
    if role_name not in ('manager','operator') then raise exception 'Acces refuzat.' using errcode='42501'; end if;
    rec:=coalesce(p_data->>'receipt_code',p_data#>>'{snapshot,receipt_code}');
    if rec is null or rec='' or rec like 'LIVE:%' then raise exception 'Cod bon invalid.'; end if;
    if p_action='checkout_release' then
     if o.status<>'checkout' then return jsonb_build_object('handled',true); end if;
     if exists(select 1 from public.ams_fiscal_receipts where owner_id=own and receipt_code=rec and sale_saved) then raise exception 'Bon salvat: rezervarea nu poate fi eliberată.'; end if;
     perform public.ams_release_sale(rec,coalesce(p_data->>'reason','Eroare fiscală confirmată'));
     if (select count(*) from public.ams_products where owner_id=own and id=any(id_list) and status='In stoc' and coalesce(reservation_code,'')='')<>cardinality(id_list) then raise exception 'Stoc modificat: verificare necesară.'; end if;
     update public.ams_products set reservation_code='LIVE:'||oid::text,reservation_started_at=now() where owner_id=own and id=any(id_list);
     update public.ams_live_orders set status='reserved',receipt_code=null where id=oid;
     result:=jsonb_build_object('handled',true);
    else
     snap:=p_data->'snapshot'; prices:=snap->'discounted_prices';
     if jsonb_typeof(snap->'items') is distinct from 'array' or jsonb_array_length(snap->'items')<>cardinality(id_list) or jsonb_typeof(prices) is distinct from 'array' or jsonb_array_length(prices)<>cardinality(id_list) or round((snap->>'total')::numeric,2) is distinct from o.goods_total then raise exception 'Coșul diferă de comanda online. Reimportă comanda.'; end if;
     if exists(select 1 from jsonb_array_elements(snap->'items') with ordinality x(v,n) left join jsonb_array_elements(o.items) y(v) on x.v->>'product_code'=y.v->>'code' where y.v is null or round((prices->>(x.n::int-1))::numeric,2) is distinct from (y.v->>'price')::numeric or x.v->>'live_order_id' is distinct from oid::text) or (select count(distinct v->>'product_code') from jsonb_array_elements(snap->'items') v)<>cardinality(id_list) then raise exception 'Produsele sau prețurile diferă de comanda online.'; end if;
     if p_action='checkout_prepare' then
      if o.status='checkout' and o.receipt_code=rec then return jsonb_build_object('status','reserved'); end if;
      if o.status<>'reserved' then raise exception 'Comanda este deja preluată sau anulată.'; end if;
      perform 1 from public.ams_products where owner_id=own and id=any(id_list) order by id for update;
      if (select count(*) from public.ams_products where owner_id=own and id=any(id_list) and status='In stoc' and reservation_code='LIVE:'||oid::text)<>cardinality(id_list) then raise exception 'Rezervarea online nu mai este integrală.'; end if;
      update public.ams_products set reservation_code='' where owner_id=own and id=any(id_list);
      perform public.ams_reserve_sale(rec,codes,(snap->>'sale_date')::date,snap->>'payment_method',o.goods_total,coalesce(snap#>>'{customer,tax_code}',''));
      update public.ams_live_orders set status='checkout',receipt_code=rec where id=oid;
      result:=jsonb_build_object('status','reserved');
     else
      if o.status not in ('checkout','paid') or o.receipt_code is distinct from rec then raise exception 'Bonul nu aparține comenzii.'; end if;
      if p_data->>'fiscal_status' is distinct from 'ok' then raise exception 'Lipsește confirmarea fiscală BONOK=1.'; end if;
      result:=public.ams_commit_sale_atomic_p1311(snap,'[]',coalesce(p_data->>'fiscal_number',''),coalesce(p_data->>'response_text',''));
      if result->>'status' not in ('saved','already_saved') then raise exception 'Vânzare neconfirmată.'; end if;
      update public.ams_live_orders set status='paid',fiscal_number=p_data->>'fiscal_number' where id=oid;
     end if;
    end if;
    detail:=jsonb_build_object('receipt_code',rec);
   else raise exception 'Acțiune necunoscută.';
   end if;
   update public.ams_live_orders set revision=revision+1,updated_at=now(),updated_by=uid where id=oid;
  end if;
  if result is null then select to_jsonb(t) into result from public.ams_live_orders t where id=oid and owner_id=own; end if;
 end if;
 insert into public.ams_live_audit(owner_id,order_id,actor_id,actor_name,action,detail) values(own,oid,uid,actor,p_action,detail);
 return coalesce(result,'{"ok":true}'::jsonb);
end $$;
