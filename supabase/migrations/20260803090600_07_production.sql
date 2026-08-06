-- ============================================================
-- 07. ПРОИЗВОДСТВО: маршрутный лист, 7 стадий, запрет запуска без комплектующих,
--     ОТК, отгрузка, аналитика длительности этапов
-- ============================================================

create type public.prod_stage as enum (
  'waiting_components',  -- 1. Ожидание комплектующих (резерв)
  'cutting',             -- 2. Заготовительный участок (резка/рубка)
  'welding',             -- 3. Сварка и сборка
  'assembly',            -- 4. Комплектация и монтаж оборудования
  'qc',                  -- 5. ОТК
  'painting',            -- 6. Покраска / антикоррозийная обработка
  'ready_to_ship',       -- 7. Готово к отгрузке (склад ГП)
  'shipped'              -- Отгружено
);

create type public.prod_status as enum ('planned', 'in_progress', 'done', 'cancelled', 'on_hold');

-- ------------------------- Производственный заказ -------------------------

create table public.production_orders (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  barcode text not null unique,          -- код маршрутного листа для сканирования
  deal_id uuid references public.deals(id) on delete set null,
  spec_id uuid references public.specifications(id) on delete set null,
  title text not null,
  qty numeric(14,3) not null default 1,
  stage public.prod_stage not null default 'waiting_components',
  status public.prod_status not null default 'planned',
  priority int not null default 2 check (priority between 1 and 3),

  master_id uuid references public.profiles(id),      -- мастер цеха
  planned_start date,
  planned_finish date,
  started_at timestamptz,
  finished_at timestamptz,
  stage_entered_at timestamptz not null default now(),

  materials_issued boolean not null default false,
  note text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on public.production_orders (stage) where status not in ('done','cancelled');
create index on public.production_orders (deal_id);

create trigger trg_touch_prod before update on public.production_orders
  for each row execute function public.fn_touch_updated_at();

create or replace function public.fn_prod_number()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.number is null or new.number = '' then
    new.number := public.next_doc_number('ПР');
  end if;
  if new.barcode is null or new.barcode = '' then
    new.barcode := replace(new.number, '-', '');
  end if;
  return new;
end; $$;

create trigger trg_prod_number before insert on public.production_orders
  for each row execute function public.fn_prod_number();

-- Отложенные FK из 03
alter table public.stock_moves
  add constraint stock_moves_prod_fk foreign key (production_order_id)
  references public.production_orders(id) on delete set null;

alter table public.certificates
  add constraint certificates_prod_fk foreign key (production_order_id)
  references public.production_orders(id) on delete cascade;

-- ------------------------- Комплектация заказа -------------------------

create table public.production_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.production_orders(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete restrict,
  spec_item_id uuid references public.spec_items(id) on delete set null,
  qty_required numeric(14,3) not null check (qty_required > 0),
  qty_issued numeric(14,3) not null default 0,
  unit_id uuid references public.units(id),
  note text,
  created_at timestamptz not null default now()
);

create index on public.production_order_items (order_id);

-- ------------------------- Журнал стадий -------------------------

create table public.production_stage_log (
  id bigserial primary key,
  order_id uuid not null references public.production_orders(id) on delete cascade,
  from_stage public.prod_stage,
  to_stage public.prod_stage not null,
  changed_by uuid references public.profiles(id),
  changed_at timestamptz not null default now(),
  duration_seconds bigint,      -- время, проведённое на предыдущей стадии
  comment text,
  photo_path text
);

create index on public.production_stage_log (order_id, changed_at);

-- ------------------------- ОТК -------------------------

create table public.qc_checks (
  id uuid primary key default gen_random_uuid(),
  production_order_id uuid not null references public.production_orders(id) on delete cascade,
  check_type text not null default 'visual'
    check (check_type in ('visual','weld_seam','pressure_test','geometry','valve_test','coating','other')),
  result text not null default 'pass' check (result in ('pass','fail','conditional')),
  checked_by uuid references public.profiles(id),
  checked_at timestamptz not null default now(),
  defects text,
  notes text
);

create index on public.qc_checks (production_order_id);

-- ------------------------- Готовность комплектации -------------------------

create or replace function public.fn_production_readiness(p_order_id uuid)
returns table (
  item_id uuid,
  item_name text,
  qty_required numeric,
  qty_reserved numeric,
  qty_available numeric,
  qty_missing numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    poi.item_id,
    i.name,
    poi.qty_required,
    coalesce((select sum(r.qty) from public.reservations r
               where r.item_id = poi.item_id and r.status = 'active' and r.kind = 'hard'
                 and r.deal_id = po.deal_id), 0) as qty_reserved,
    coalesce((select sum(qty) from public.v_stock_ledger where item_id = poi.item_id), 0) as qty_available,
    greatest(
      poi.qty_required - poi.qty_issued
      - least(
          coalesce((select sum(r.qty) from public.reservations r
                     where r.item_id = poi.item_id and r.status = 'active' and r.kind = 'hard'
                       and r.deal_id = po.deal_id), 0),
          coalesce((select sum(qty) from public.v_stock_ledger where item_id = poi.item_id), 0)
        ), 0) as qty_missing
  from public.production_order_items poi
  join public.production_orders po on po.id = poi.order_id
  join public.items i on i.id = poi.item_id
  where poi.order_id = p_order_id
    and i.is_stock_tracked
$$;

-- ------------------------- Создание производственного заказа из сделки -------------------------

create or replace function public.rpc_create_production_order(
  p_deal_id uuid,
  p_title text default null,
  p_planned_finish date default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_spec uuid;
  v_deal public.deals%rowtype;
  v_order uuid;
begin
  select * into v_deal from public.deals where id = p_deal_id;
  if not found then raise exception 'Сделка не найдена'; end if;

  select id into v_spec from public.specifications where deal_id = p_deal_id and is_current limit 1;
  if v_spec is null then raise exception 'У сделки нет текущей спецификации'; end if;

  insert into public.production_orders (deal_id, spec_id, title, planned_finish, created_by, planned_start)
  values (p_deal_id, v_spec, coalesce(p_title, v_deal.title),
          coalesce(p_planned_finish, v_deal.required_ship_date), auth.uid(), current_date)
  returning id into v_order;

  insert into public.production_order_items (order_id, item_id, spec_item_id, qty_required, unit_id)
  select v_order, si.item_id, si.id, si.qty, si.unit_id
    from public.spec_items si
    join public.items i on i.id = si.item_id
   where si.spec_id = v_spec
     and si.item_id is not null
     and i.kind in ('material','component')
     and si.source in ('stock','purchase');

  update public.deals set stage = 'production' where id = p_deal_id and stage < 'production';

  return v_order;
end;
$$;

-- ------------------------- Выдача материалов в цех -------------------------

create or replace function public.rpc_issue_materials(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po public.production_orders%rowtype;
  v_wh_from uuid;
  v_wh_to uuid;
  r record;
  v_qty numeric;
  v_batch uuid;
  v_left numeric;
  v_issued jsonb := '[]'::jsonb;
begin
  select * into v_po from public.production_orders where id = p_order_id for update;
  if not found then raise exception 'Производственный заказ не найден'; end if;

  select id into v_wh_from from public.warehouses where kind = 'material' and is_active order by sort_order limit 1;
  select id into v_wh_to   from public.warehouses where kind = 'production' and is_active order by sort_order limit 1;
  if v_wh_from is null or v_wh_to is null then
    raise exception 'Не настроены склады (материалы / цех)';
  end if;

  for r in
    select poi.*, i.name from public.production_order_items poi
      join public.items i on i.id = poi.item_id
     where poi.order_id = p_order_id and i.is_stock_tracked
  loop
    v_qty := r.qty_required - r.qty_issued;
    if v_qty <= 0 then continue; end if;

    -- Списываем партиями FIFO, чтобы сохранить прослеживаемость плавок
    v_left := v_qty;
    for v_batch in
      select b.batch_id from public.v_stock_balances_by_batch b
       where b.item_id = r.item_id and b.warehouse_id = v_wh_from and b.qty > 0
       order by (select received_at from public.batches where id = b.batch_id) nulls last
    loop
      exit when v_left <= 0;
      declare
        v_avail numeric;
        v_take numeric;
        v_cost numeric;
      begin
        select qty into v_avail from public.v_stock_balances_by_batch
         where item_id = r.item_id and warehouse_id = v_wh_from and batch_id = v_batch;
        v_take := least(v_left, v_avail);
        select unit_cost into v_cost from public.batches where id = v_batch;

        insert into public.stock_moves (move_type, item_id, batch_id, warehouse_from, warehouse_to,
                                        qty, unit_cost, deal_id, production_order_id, created_by, doc_ref)
        values ('issue', r.item_id, v_batch, v_wh_from, v_wh_to, v_take, coalesce(v_cost, 0),
                v_po.deal_id, p_order_id, auth.uid(), v_po.number);

        v_left := v_left - v_take;
      end;
    end loop;

    if v_qty - v_left > 0 then
      update public.production_order_items
         set qty_issued = qty_issued + (v_qty - v_left) where id = r.id;
      v_issued := v_issued || jsonb_build_object('item', r.name, 'qty', v_qty - v_left);
    end if;
  end loop;

  -- Резервы сделки переводим в «израсходован»
  update public.reservations
     set status = 'consumed', released_at = now()
   where deal_id = v_po.deal_id and status = 'active'
     and item_id in (select item_id from public.production_order_items where order_id = p_order_id);

  update public.production_orders
     set materials_issued = not exists (
           select 1 from public.production_order_items
            where order_id = p_order_id and qty_issued < qty_required - 0.001)
   where id = p_order_id;

  return jsonb_build_object('order_id', p_order_id, 'issued', v_issued);
end;
$$;

-- ------------------------- Переход по стадиям (кнопка / скан штрихкода) -------------------------

create or replace function public.rpc_advance_stage(
  p_order_ref text,                       -- id заказа или штрихкод маршрутного листа
  p_to_stage public.prod_stage default null,
  p_comment text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po public.production_orders%rowtype;
  v_next public.prod_stage;
  v_missing text;
  v_dur bigint;
  v_qc_ok boolean;
  v_wh_fin uuid;
  v_wh_prod uuid;
  stages public.prod_stage[] := array['waiting_components','cutting','welding','assembly','qc','painting','ready_to_ship','shipped']::public.prod_stage[];
  v_idx int;
begin
  select * into v_po from public.production_orders
   where barcode = p_order_ref
      or id::text = p_order_ref
      or number = p_order_ref
   for update;
  if not found then raise exception 'Маршрутный лист не найден: %', p_order_ref; end if;

  v_idx := array_position(stages, v_po.stage);
  v_next := coalesce(p_to_stage, stages[v_idx + 1]);
  if v_next is null then raise exception 'Заказ уже на финальной стадии'; end if;
  if v_next = v_po.stage then raise exception 'Заказ уже на стадии %', v_next; end if;

  -- ЖЁСТКОЕ ПРАВИЛО: нельзя запустить работы, если комплектующие не выданы в цех
  if v_po.stage = 'waiting_components' then
    select string_agg(item_name || ' (не хватает ' || round(qty_missing, 3) || ')', '; ')
      into v_missing
      from public.fn_production_readiness(v_po.id)
     where qty_missing > 0.001;

    if v_missing is not null then
      raise exception 'Запуск в производство запрещён — нет комплектующих: %', v_missing
        using errcode = 'check_violation';
    end if;

    if not v_po.materials_issued then
      perform public.rpc_issue_materials(v_po.id);
      select * into v_po from public.production_orders where id = v_po.id;
      if not v_po.materials_issued then
        raise exception 'Материалы не выданы в цех в полном объёме — запуск невозможен'
          using errcode = 'check_violation';
      end if;
    end if;
  end if;

  -- Нельзя пройти ОТК без успешной проверки
  if v_po.stage = 'qc' then
    select exists (select 1 from public.qc_checks
                    where production_order_id = v_po.id and result in ('pass','conditional'))
      into v_qc_ok;
    if not v_qc_ok then
      raise exception 'Нет отметки ОТК — зафиксируйте результат проверки качества'
        using errcode = 'check_violation';
    end if;
  end if;

  v_dur := extract(epoch from (now() - v_po.stage_entered_at))::bigint;

  insert into public.production_stage_log (order_id, from_stage, to_stage, changed_by, duration_seconds, comment)
  values (v_po.id, v_po.stage, v_next, auth.uid(), v_dur, p_comment);

  update public.production_orders
     set stage = v_next,
         stage_entered_at = now(),
         status = case
           when v_next = 'shipped' then 'done'::public.prod_status
           when v_next = 'ready_to_ship' then 'done'::public.prod_status
           else 'in_progress'::public.prod_status end,
         started_at = coalesce(started_at, case when v_next <> 'waiting_components' then now() end),
         finished_at = case when v_next in ('ready_to_ship','shipped') then now() else finished_at end
   where id = v_po.id;

  -- Перемещение на склад готовой продукции + уведомление менеджеру
  if v_next = 'ready_to_ship' then
    select id into v_wh_prod from public.warehouses where kind = 'production' and is_active order by sort_order limit 1;
    select id into v_wh_fin  from public.warehouses where kind = 'finished'   and is_active order by sort_order limit 1;

    insert into public.tasks (type, title, description, assignee_role, assignee_id, entity_type, entity_id, priority)
    select 'general',
           'Заказ ' || v_po.number || ' готов к отгрузке',
           'Изделие «' || v_po.title || '» на складе готовой продукции. Свяжитесь с клиентом для организации доставки.',
           'sales', d.manager_id, 'deal', d.id, 1
      from public.deals d where d.id = v_po.deal_id;

    update public.deals set stage = 'shipment' where id = v_po.deal_id and stage < 'shipment';
  end if;

  if v_next = 'qc' then
    update public.deals set stage = 'qc' where id = v_po.deal_id and stage < 'qc';
  end if;

  return jsonb_build_object('order_id', v_po.id, 'from', v_po.stage, 'to', v_next, 'duration_seconds', v_dur);
end;
$$;

-- ------------------------- Отгрузка -------------------------

create table public.shipments (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  deal_id uuid not null references public.deals(id) on delete cascade,
  production_order_id uuid references public.production_orders(id) on delete set null,
  shipped_at date not null default current_date,
  carrier text,
  waybill_number text,
  receiver text,
  note text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.shipment_items (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  item_id uuid references public.items(id),
  name_snapshot text not null,
  qty numeric(14,3) not null,
  unit_id uuid references public.units(id)
);

create or replace function public.fn_shipment_number()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.number is null or new.number = '' then
    new.number := public.next_doc_number('ОТГ');
  end if;
  return new;
end; $$;

create trigger trg_shipment_number before insert on public.shipments
  for each row execute function public.fn_shipment_number();

-- ------------------------- Аналитика длительности стадий -------------------------

create view public.v_production_stage_stats as
  select
    l.from_stage as stage,
    count(*)                                              as transitions,
    round(avg(l.duration_seconds) / 3600.0, 2)            as avg_hours,
    round(min(l.duration_seconds) / 3600.0, 2)            as min_hours,
    round(max(l.duration_seconds) / 3600.0, 2)            as max_hours,
    round((percentile_cont(0.5) within group (order by l.duration_seconds))::numeric / 3600.0, 2) as median_hours
  from public.production_stage_log l
  where l.from_stage is not null and l.duration_seconds is not null
  group by l.from_stage;

create view public.v_production_board as
  select
    po.id, po.number, po.barcode, po.title, po.stage, po.status, po.priority,
    po.planned_finish, po.stage_entered_at, po.materials_issued,
    round(extract(epoch from (now() - po.stage_entered_at)) / 3600.0, 1) as hours_in_stage,
    d.id as deal_id, d.number as deal_number, d.required_ship_date,
    c.name as client_name,
    p.full_name as master_name,
    (select count(*) from public.fn_production_readiness(po.id) where qty_missing > 0.001) as missing_positions
  from public.production_orders po
  left join public.deals d on d.id = po.deal_id
  left join public.counterparties c on c.id = d.counterparty_id
  left join public.profiles p on p.id = po.master_id
  where po.status not in ('cancelled');
