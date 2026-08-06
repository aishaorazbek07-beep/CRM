-- ============================================================
-- 03. СКЛАД: площадки, партии прихода, сертификаты плавок, движения
-- ============================================================

create type public.warehouse_kind as enum ('material', 'production', 'finished');

create type public.move_type as enum (
  'receipt',        -- приход от поставщика
  'issue',          -- выдача в производство
  'transfer',       -- перемещение между складами
  'writeoff',       -- списание
  'return',         -- возврат из цеха на склад
  'shipment',       -- отгрузка клиенту
  'adjustment'      -- корректировка по инвентаризации
);

-- ------------------------- Склады / зоны -------------------------

create table public.warehouses (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  kind public.warehouse_kind not null default 'material',
  address text,
  is_active boolean not null default true,
  sort_order int not null default 100
);

comment on column public.warehouses.kind is
  'material — основной склад материалов; production — цех (материал «в работе»); finished — склад готовой продукции';

-- ------------------------- Партии прихода -------------------------

create table public.batches (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id) on delete restrict,
  batch_number text not null,
  heat_number text,                    -- номер плавки
  supplier_id uuid references public.counterparties(id),
  purchase_order_id uuid,              -- FK добавляется в 06
  received_at date not null default current_date,
  qty_received numeric(14,3) not null check (qty_received > 0),
  unit_cost numeric(14,2) not null default 0,
  currency text not null default 'KZT',
  cert_number text,
  cert_issued_at date,
  cert_verified boolean not null default false,
  note text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index on public.batches (item_id);
create index on public.batches (heat_number);

comment on table public.batches is
  'Партия прихода. Сертификат плавки жёстко привязан к партии; расход материала прослеживается до плавки.';

-- Сертификаты качества / паспорта (файлы в Storage)
create table public.certificates (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid references public.batches(id) on delete cascade,
  production_order_id uuid,            -- FK добавляется в 07 (паспорт изделия)
  doc_type text not null default 'cert_quality'
    check (doc_type in ('cert_quality','heat_cert','passport','conformity','test_report','other')),
  number text,
  issued_at date,
  issuer text,
  file_path text,
  file_name text,
  uploaded_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  check (batch_id is not null or production_order_id is not null)
);

create index on public.certificates (batch_id);

-- ------------------------- Движения товара -------------------------

create table public.stock_moves (
  id uuid primary key default gen_random_uuid(),
  move_type public.move_type not null,
  item_id uuid not null references public.items(id) on delete restrict,
  batch_id uuid references public.batches(id) on delete set null,
  warehouse_from uuid references public.warehouses(id),
  warehouse_to uuid references public.warehouses(id),
  qty numeric(14,3) not null check (qty > 0),
  unit_cost numeric(14,2) not null default 0,
  deal_id uuid,                 -- FK добавляется в 04
  production_order_id uuid,     -- FK добавляется в 07
  doc_ref text,
  note text,
  moved_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  constraint stock_moves_direction_chk check (
    (move_type = 'receipt'    and warehouse_to is not null) or
    (move_type = 'transfer'   and warehouse_to is not null and warehouse_from is not null) or
    (move_type = 'return'     and warehouse_to is not null and warehouse_from is not null) or
    (move_type in ('issue','writeoff','shipment') and warehouse_from is not null) or
    (move_type = 'adjustment' and (warehouse_to is not null or warehouse_from is not null))
  )
);

create index on public.stock_moves (item_id, moved_at desc);
create index on public.stock_moves (deal_id);
create index on public.stock_moves (production_order_id);
create index on public.stock_moves (batch_id);

-- ------------------------- Остатки -------------------------

create view public.v_stock_ledger as
  select item_id, warehouse_to as warehouse_id, batch_id, qty, unit_cost, moved_at
    from public.stock_moves where warehouse_to is not null
  union all
  select item_id, warehouse_from as warehouse_id, batch_id, -qty, unit_cost, moved_at
    from public.stock_moves where warehouse_from is not null;

create view public.v_stock_balances as
  select
    l.item_id,
    l.warehouse_id,
    sum(l.qty)::numeric(14,3) as qty
  from public.v_stock_ledger l
  group by l.item_id, l.warehouse_id
  having sum(l.qty) <> 0;

create view public.v_stock_balances_by_batch as
  select
    l.item_id,
    l.warehouse_id,
    l.batch_id,
    sum(l.qty)::numeric(14,3) as qty
  from public.v_stock_ledger l
  group by l.item_id, l.warehouse_id, l.batch_id
  having sum(l.qty) <> 0;

-- Итоговый остаток по позиции (по всем складам)
create or replace function public.fn_stock_qty(p_item_id uuid, p_warehouse_id uuid default null)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(qty), 0)::numeric
  from public.v_stock_ledger
  where item_id = p_item_id
    and (p_warehouse_id is null or warehouse_id = p_warehouse_id)
$$;

-- ------------------------- Средневзвешенная себестоимость -------------------------

create or replace function public.fn_update_avg_cost()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_avg numeric;
begin
  if new.move_type = 'receipt' and new.unit_cost > 0 then
    select case when sum(qty) > 0 then sum(qty * unit_cost) / sum(qty) else 0 end
      into v_avg
      from public.stock_moves
     where item_id = new.item_id and move_type = 'receipt';

    update public.items
       set avg_cost = coalesce(v_avg, 0),
           last_purchase_price = new.unit_cost
     where id = new.item_id;
  end if;
  return new;
end;
$$;

create trigger trg_stock_avg_cost after insert on public.stock_moves
  for each row execute function public.fn_update_avg_cost();

-- ------------------------- Неснижаемый остаток → задача снабжению -------------------------

create or replace function public.fn_check_min_stock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.items%rowtype;
  v_qty numeric;
  v_key text;
begin
  select * into v_item from public.items where id = new.item_id;
  if not found or v_item.min_stock <= 0 then
    return new;
  end if;

  v_qty := public.fn_stock_qty(new.item_id);
  v_key := 'min_stock:' || new.item_id::text;

  if v_qty < v_item.min_stock then
    insert into public.tasks (type, title, description, assignee_role, entity_type, entity_id, priority, dedup_key)
    values (
      'min_stock',
      'Неснижаемый остаток: ' || v_item.name,
      'Текущий остаток ' || round(v_qty, 3) || ' при минимуме ' || round(v_item.min_stock, 3) ||
      '. Рекомендуемый заказ: ' || round(greatest(v_item.reorder_qty, v_item.min_stock - v_qty), 3) || '.',
      'procurement', 'item', new.item_id, 1, v_key
    )
    on conflict (dedup_key) do update
      set status = case when public.tasks.status = 'done' then 'open'::public.task_status else public.tasks.status end,
          description = excluded.description,
          closed_at = null;
  else
    update public.tasks
       set status = 'done', closed_at = now()
     where dedup_key = v_key and status <> 'done';
  end if;

  return new;
end;
$$;

create trigger trg_stock_min_check after insert on public.stock_moves
  for each row execute function public.fn_check_min_stock();
