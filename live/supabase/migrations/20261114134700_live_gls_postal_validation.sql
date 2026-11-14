create or replace function ams_private.live_gls_api(p_action text,p_data jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();own uuid:=public.ams_current_owner_id();r text:=ams_private.live_role();cfg ams_private.live_gls_config%rowtype;j ams_private.live_gls_jobs%rowtype;o public.ams_live_orders%rowtype;secret jsonb;sid uuid;cod numeric;kg numeric;ref text;
begin
 if uid is null or coalesce(r,'disabled')='disabled' then raise exception 'Acces refuzat.' using errcode='42501';end if;
 select * into cfg from ams_private.live_gls_config where owner_id=own;
 if p_action='status' then
  if cfg.owner_id is null then return '{"connected":false}';end if;
  if public.ams_is_primary_admin() then select decrypted_secret::jsonb into secret from vault.decrypted_secrets where id=cfg.secret_id;end if;
  return jsonb_build_object('connected',true,'mode',cfg.mode,'settings',coalesce(secret-'Password','{}'));
 elsif p_action='save_config' then
  if not public.ams_is_primary_admin() then raise exception 'Doar administratorul principal poate conecta GLS.' using errcode='42501';end if;
  secret:=p_data->'config';
  if secret is null or octet_length(secret::text)>16000 or jsonb_typeof(secret->'Password')<>'array' or jsonb_array_length(secret->'Password')<>64 or length(secret->>'Username') not between 3 and 254 or (secret->>'ClientNumber')::bigint<=0 or secret->>'mode' not in ('test','production') then raise exception 'Configurare GLS invalidă.';end if;
  sid:=vault.create_secret(secret::text,'ams_gls_'||own||'_'||gen_random_uuid());
  insert into ams_private.live_gls_config(owner_id,secret_id,mode) values(own,sid,secret->>'mode') on conflict(owner_id) do update set secret_id=excluded.secret_id,mode=excluded.mode,updated_at=now();
  return '{"connected":true}';
 end if;
 select * into o from public.ams_live_orders where id=(p_data->>'id')::uuid and owner_id=own for update;
 if not found then raise exception 'Comandă inexistentă.';end if;
 select * into j from ams_private.live_gls_jobs where order_id=o.id;
 if p_action='job' then return coalesce(to_jsonb(j)-'secret_id'-'parcel','{}');end if;
 if r not in ('manager','operator','packer') then raise exception 'Acces refuzat.' using errcode='42501';end if;
 if p_action='start' then
  if j.order_id is not null then return to_jsonb(j)-'secret_id';end if;
  if cfg.owner_id is null then raise exception 'Conectează contul GLS din meniul Curier.';end if;
  if o.status<>'paid' or o.fulfillment<>'packed' or o.delivery<>'curier' or coalesce(o.awb,'')<>'' then raise exception 'AWB automat: comanda trebuie fiscalizată, verificată și împachetată, fără AWB existent.';end if;
  if (p_data->>'revision')::bigint is distinct from o.revision then raise exception 'Comanda s-a schimbat.' using errcode='40001';end if;
  if o.assigned_to is distinct from uid and r<>'manager' then raise exception 'Doar responsabilul poate crea AWB-ul.';end if;
  cod:=(p_data->>'cod')::numeric;kg:=(p_data->>'weight')::numeric;
  if cod is null or cod<0 or cod>o.goods_total+o.shipping-o.advance or cod='NaN'::numeric or kg is null or kg<=0 or kg>40 or kg='NaN'::numeric or length(p_data->>'street') not between 2 and 200 or length(p_data->>'house') not between 1 and 20 or p_data->>'house' !~ '^\d+$' or coalesce(p_data->>'postal',o.customer->>'postal','') !~ '^\d{6}$' then raise exception 'Verifică rambursul, greutatea (max. 40 kg), strada, numărul și codul poștal de 6 cifre.';end if;
  if p_data->>'pickup_date' is null or (p_data->>'pickup_date')::date<current_date or (p_data->>'pickup_date')::date>current_date+30 then raise exception 'Data ridicării trebuie să fie în următoarele 30 de zile.';end if;
  select decrypted_secret::jsonb into secret from vault.decrypted_secrets where id=cfg.secret_id;
  ref:='AMS-'||replace(o.id::text,'-','');
  insert into ams_private.live_gls_jobs(order_id,owner_id,secret_id,mode,reference,parcel) values(o.id,own,cfg.secret_id,cfg.mode,ref,jsonb_build_object(
   'ClientNumber',(secret->>'ClientNumber')::bigint,'ClientReference',ref,'Count',1,'CODAmount',cod,'CODCurrency','RON','CODReference',ref,'Content','Comanda AMS #'||o.number,
   'PickupDate',p_data->>'pickup_date','PickupAddress',secret->'PickupAddress',
   'DeliveryAddress',jsonb_build_object('Name',o.customer->>'name','ContactName',o.customer->>'name','ContactPhone',o.customer->>'phone','Street',p_data->>'street','HouseNumber',p_data->>'house','HouseNumberInfo',left(coalesce(p_data->>'address_extra',''),200),'City',o.customer->>'city','ZipCode',coalesce(p_data->>'postal',o.customer->>'postal'),'CountryIsoCode','RO'),
   'ServiceList','[]'::jsonb,'ParcelPropertyList',jsonb_build_array(jsonb_build_object('Content','Comanda AMS #'||o.number,'PackageType',2,'Weight',kg)))) returning * into j;
  return to_jsonb(j)-'secret_id';
 elsif p_action='reset_rejected' then
  if j.state is distinct from 'rejected' then raise exception 'Doar cererile respinse explicit de GLS pot fi reluate.';end if;
  delete from ams_private.live_gls_jobs where order_id=o.id;return '{"ok":true}';
 elsif p_action='resolve' then
  if j.order_id is null then raise exception 'Nu există cerere GLS.';end if;
  if j.state in ('pending','unknown') and j.updated_at>now()-interval '2 minutes' then raise exception 'Cererea GLS este încă în curs. Verifică din nou peste 2 minute.';end if;
  return to_jsonb(j)-'secret_id';
 else raise exception 'Acțiune invalidă.';end if;
end $$;
