-- ============================================================
-- 06. СНАБЖЕНИЕ: лист дефицита, заявки в закуп, заказы поставщикам,
--     статусы Заказано → Оплачено → В пути → На складе
-- ============================================================

create type public.pr_status as enum ('new', 'in_work', 'ordered', 'partially_received', 'closed', 'cancelled');
create type public.po_status as enum ('draft', 'ordered', 'paid', 'in_transit', 'received', 'cancelled');

-- ------------------------- Заявка в закуп (лист дефицита) -------------------------

create table public.purchase_requests (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  deal_id uuid references public.deals(id) on delete set null,
  status public.pr_status not null default 'new',
  priority int not null default 2 check (priority between 1 and 3),
  required_by date,
  note text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  closed_at timestamptz
);

create index on public.purchase_requests (status);
create index on public.purchase_requests (deal_id);

create or replace function public.fn_pr_number()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.number is null or new.number = '' then
    new.number := public.next_doc_number('ЗАК');
  end if;
  return new;
end; $$;

create trigger trg_pr_number before insert on public.purchase_requests
  for each row execute function public.fn_pr_number();

create table public.purchase_request_items (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.purchase_requests(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete restrict,
  spec_item_id uuid references public.spec_items(id) on delete set null,
  qty numeric(14,3) not null check (qty > 0),
  qty_ordered numeric(14,3) not null default 0,
  qty_received numeric(14,3) not null default 0,
  required_by date,
  target_price numeric(14,2) not null default 0,
  note text,
  created_at timestamptz not null default now()
);

create index on public.purchase_request_items (request_id);
create index on public.purchase_request_items (item_id);

-- ------------------------- Заказ поставщику -------------------------

create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  supplier_id uuid not null references public.counterparties(id) on delete restrict,
  request_id uuid references public.purchase_requests(id) on delete set null,
  deal_id uuid references public.deals(id) on delete set null,
  status public.po_status not null default 'draft',
  currency text not null default 'KZT',
  total numeric(16,2) not null default 0,

  ordered_at date,
  paid_at date,
  in_transit_at date,
  eta_date date,                 -- ожидаемая дата прихода
  received_at date,

  invoice_number text,
  tracking_info text,
  note text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on public.purchase_orders (status);
create index on public.purchase_orders (supplier_id);
create index on public.purchase_orders (deal_id);

create trigger trg_touch_po before update on public.purchase_orders
  for each row execute function public.fn_touch_updated_at();

create or replace function public.fn_po_number()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.number is null or new.number = '' then
    new.number := public.next_doc_number('ЗП');
  end if;
  return new;
end; $$;

create trigger trg_po_number before insert on public.purchase_orders
  for each row execute function public.fn_po_number();

-- Проставляем даты статусов автоматически
create or replace function public.fn_po_status_dates()
returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'ordered'    and new.ordered_at is null    then new.ordered_at := current_date; end if;
    if new.status = 'paid'       and new.paid_at is null       then new.paid_at := current_date; end if;
    if new.status = 'in_transit' and new.in_transit_at is null then new.in_transit_at := current_date; end if;
    if new.status = 'received'   and new.received_at is null   then new.received_at := current_date; end if;
  end if;
  return new;
end; $$;

create trigger trg_po_status_dates before update on public.purchase_orders
  for each row execute function public.fn_po_status_dates();

create table public.purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.purchase_orders(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete restrict,
  request_item_id uuid references public.purchase_request_items(id) on delete set null,
  qty numeric(14,3) not null check (qty > 0),
  price numeric(14,2) not null default 0,
  qty_received numeric(14,3) not null default 0,
  line_total numeric(16,2) generated always as (round(qty * price, 2)) stored,
  note text,
  created_at timestamptz not null default now()
);

create index on public.purchase_order_items (order_id);

create or replace function public.fn_recalc_po_total()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_order uuid := coalesce(new.order_id, old.order_id);
begin
  update public.purchase_orders
     set total = coalesce((select sum(line_total) from public.purchase_order_items where order_id = v_order), 0)
   where id = v_order;
  return coalesce(new, old);
end; $$;

create trigger trg_recalc_po_total after insert or update or delete on public.purchase_order_items
  for each row execute function public.fn_recalc_po_total();

-- Отложенный FK из 03
alter table public.batches
  add constraint batches_po_fk foreign key (purchase_order_id)
  references public.purchase_orders(id) on delete set null;

-- ------------------------- Формирование листа дефицита -------------------------

create or replace function public.rpc_build_deficit(p_deal_id uuid, p_required_by date default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_spec uuid;
  v_request uuid;
  r record;
  v_need numeric;
  v_reserved numeric;
  v_free numeric;
  v_short numeric;
  v_lines int := 0;
  v_result jsonb := '[]'::jsonb;
begin
  select id into v_spec from public.specifications where deal_id = p_deal_id and is_current limit 1;
  if v_spec is null then raise exception 'У сделки нет текущей спецификации'; end if;

  for r in
    select si.id as spec_item_id, si.item_id, si.qty, si.name_snapshot, i.lead_time_days, i.last_purchase_price
      from public.spec_items si
      join public.items i on i.id = si.item_id
     where si.spec_id = v_spec and si.item_id is not null and i.is_stock_tracked
       and si.source in ('stock','purchase')
  loop
    select coalesce(sum(qty), 0) into v_reserved
      from public.reservations
     where deal_id = p_deal_id and item_id = r.item_id and status = 'active';

    v_need := r.qty - v_reserved;
    if v_need <= 0 then continue; end if;

    -- Уже заказанное, но не пришедшее по этой сделке
    select coalesce(sum(poi.qty - poi.qty_received), 0) into v_free
      from public.purchase_order_items poi
      join public.purchase_orders po on po.id = poi.order_id
     where poi.item_id = r.item_id and po.deal_id = p_deal_id
       and po.status in ('ordered','paid','in_transit');

    v_short := v_need - v_free;
    if v_short <= 0 then continue; end if;

    if v_request is null then
      insert into public.purchase_requests (deal_id, required_by, note, created_by, priority)
      values (p_deal_id, p_required_by,
              'Автоматически сформировано из спецификации сделки', auth.uid(), 1)
      returning id into v_request;
    end if;

    insert into public.purchase_request_items (request_id, item_id, spec_item_id, qty, required_by, target_price)
    values (v_request, r.item_id, r.spec_item_id, v_short,
            coalesce(p_required_by, current_date + r.lead_time_days), r.last_purchase_price);

    v_lines := v_lines + 1;
    v_result := v_result || jsonb_build_object('item_id', r.item_id, 'name', r.name_snapshot, 'qty', v_short);
  end loop;

  if v_request is not null then
    insert into public.tasks (type, title, description, assignee_role, entity_type, entity_id, priority, created_by)
    select 'deficit',
           'Лист дефицита по сделке ' || d.number,
           'Позиций к закупу: ' || v_lines,
           'procurement', 'purchase_request', v_request, 1, auth.uid()
      from public.deals d where d.id = p_deal_id;
  end if;

  return jsonb_build_object(
    'request_id', v_request,
    'lines', v_lines,
    'items', v_result
  );
end;
$$;

-- ------------------------- Приёмка позиции заказа на склад -------------------------

create or replace function public.rpc_receive_po_item(
  p_po_item_id uuid,
  p_qty numeric,
  p_warehouse_id uuid,
  p_batch_number text default null,
  p_heat_number text default null,
  p_unit_cost numeric default null,
  p_cert_number text default null,
  p_cert_issued_at date default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_poi public.purchase_order_items%rowtype;
  v_po public.purchase_orders%rowtype;
  v_item public.items%rowtype;
  v_batch uuid;
  v_cost numeric;
  v_left numeric;
begin
  select * into v_poi from public.purchase_order_items where id = p_po_item_id for update;
  if not found then raise exception 'Позиция заказа не найдена'; end if;
  select * into v_po from public.purchase_orders where id = v_poi.order_id;
  select * into v_item from public.items where id = v_poi.item_id;

  if p_qty <= 0 then raise exception 'Количество приёмки должно быть больше нуля'; end if;
  if v_poi.qty_received + p_qty > v_poi.qty + 0.001 then
    raise exception 'Приёмка превышает заказанное количество (заказано %, уже принято %)', v_poi.qty, v_poi.qty_received;
  end if;

  if v_item.requires_certificate and coalesce(p_cert_number, '') = '' then
    raise exception 'Для позиции «%» обязателен сертификат качества (номер плавки/сертификата)', v_item.name;
  end if;

  v_cost := coalesce(p_unit_cost, v_poi.price, 0);

  insert into public.batches (item_id, batch_number, heat_number, supplier_id, purchase_order_id,
                              qty_received, unit_cost, currency, cert_number, cert_issued_at, created_by)
  values (v_poi.item_id,
          coalesce(nullif(p_batch_number, ''), v_po.number || '/' || left(p_po_item_id::text, 8)),
          p_heat_number, v_po.supplier_id, v_po.id,
          p_qty, v_cost, v_po.currency, p_cert_number, p_cert_issued_at, auth.uid())
  returning id into v_batch;

  insert into public.stock_moves (move_type, item_id, batch_id, warehouse_to, qty, unit_cost,
                                  deal_id, doc_ref, created_by)
  values ('receipt', v_poi.item_id, v_batch, p_warehouse_id, p_qty, v_cost,
          v_po.deal_id, v_po.number, auth.uid());

  update public.purchase_order_items
     set qty_received = qty_received + p_qty
   where id = p_po_item_id;

  if v_poi.request_item_id is not null then
    update public.purchase_request_items
       set qty_received = qty_received + p_qty
     where id = v_poi.request_item_id;
  end if;

  -- Закрываем заказ, если всё принято
  select coalesce(sum(qty - qty_received), 0) into v_left
    from public.purchase_order_items where order_id = v_po.id;

  if v_left <= 0.001 then
    update public.purchase_orders set status = 'received', received_at = current_date where id = v_po.id;
    update public.purchase_requests pr
       set status = 'closed', closed_at = now()
     where pr.id = v_po.request_id
       and not exists (
         select 1 from public.purchase_request_items pri
          where pri.request_id = pr.id and pri.qty_received < pri.qty - 0.001);
  end if;

  return v_batch;
end;
$$;

-- ------------------------- Контроль сроков поставки -------------------------

create view public.v_purchase_watchlist as
  select
    po.id, po.number, po.status, po.eta_date, po.supplier_id,
    c.name as supplier_name,
    po.deal_id, d.number as deal_number, d.title as deal_title,
    po.total, po.currency,
    (po.eta_date is not null and po.eta_date < current_date and po.status <> 'received') as is_overdue,
    case when po.eta_date is not null then (po.eta_date - current_date) end as days_left
  from public.purchase_orders po
  join public.counterparties c on c.id = po.supplier_id
  left join public.deals d on d.id = po.deal_id
  where po.status in ('draft','ordered','paid','in_transit');
