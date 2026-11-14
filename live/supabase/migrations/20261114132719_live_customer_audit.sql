alter table public.ams_live_audit alter column actor_id drop not null;
create or replace function ams_private.live_customer(p_token text,p_customer jsonb default null,p_revision bigint default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.ams_live_orders%rowtype;c jsonb;
begin
 if p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception 'Link invalid sau expirat.';end if;
 select a.* into o from public.ams_live_orders a join ams_private.live_links l on l.order_id=a.id where l.token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and l.expires_at>now() and a.status in ('draft','reserved') and a.fulfillment in ('new','packing') for update of a;
 if not found then raise exception 'Link expirat, revocat sau comandă închisă.';end if;
 if p_customer is not null then
  if o.revision is distinct from p_revision then raise exception 'Comanda s-a schimbat. Reîncarcă pagina.' using errcode='40001';end if;
  if jsonb_typeof(p_customer)<>'object' or octet_length(p_customer::text)>4000 then raise exception 'Date invalide.';end if;
  select jsonb_object_agg(k,trim(coalesce(p_customer->>k,''))) into c from unnest(array['name','phone','address','city','county','postal']) k;
  if length(c->>'name') not between 2 and 160 or length(c->>'phone') not between 7 and 30 or length(c->>'address') not between 3 and 500 or length(c->>'city') not between 2 and 100 or length(c->>'county') not between 2 and 100 or length(c->>'postal')>20 then raise exception 'Completează numele, telefonul și adresa de livrare.';end if;
  update public.ams_live_orders set customer=c,revision=revision+1,updated_at=now() where id=o.id returning * into o;
  insert into public.ams_live_audit(owner_id,order_id,actor_name,action,detail) values(o.owner_id,o.id,'Client prin link','customer_contact','{}');
 end if;
 return jsonb_build_object('number',o.number,'revision',o.revision,'customer',o.customer,'items',(select jsonb_agg(jsonb_build_object('name',i->>'name','price',i->'price')) from jsonb_array_elements(o.items)i),'total',o.goods_total+o.shipping,'shipping',o.shipping,'advance',o.advance);
end $$;
create or replace function ams_private.live_order_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='reserved' and old.status is distinct from 'reserved' then new.reserved_at:=coalesce(new.reserved_at,now()); end if;
 if new.fulfillment is distinct from old.fulfillment and new.fulfillment in ('packing','packed','shipped','delivered') and new.assigned_to is distinct from auth.uid() and coalesce(ams_private.live_role(),'disabled')<>'manager' then raise exception 'Preia comanda înainte de pregătire.';end if;
 if new.items is distinct from old.items then delete from ams_private.live_checks where order_id=new.id; end if;
 if new.fulfillment in ('packed','shipped','delivered') and new.fulfillment is distinct from old.fulfillment then
  if exists(select 1 from jsonb_array_elements(new.items) i where not exists(select 1 from ams_private.live_checks c where c.order_id=new.id and c.product_id=i->>'id')) then raise exception 'Scanează fiecare bucată înainte de finalizarea coletului.'; end if;
 end if;
 return new;
end $$;
