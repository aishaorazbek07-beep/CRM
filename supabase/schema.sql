-- ============================================================
-- ФАЙЛ: 20260803090000_01_core.sql
-- ============================================================
-- ============================================================
-- 01. ЯДРО: расширения, роли, пользователи, контрагенты
-- ============================================================

create extension if not exists "pgcrypto";
create extension if not exists "unaccent";

-- ------------------------- Перечисления -------------------------

create type public.user_role as enum (
  'director',      -- Директор: полный доступ, согласования, рентабельность
  'sales',         -- Менеджер по продажам
  'procurement',   -- Снабжение / закуп
  'production',    -- Начальник производства (мастер цеха)
  'warehouse'      -- Кладовщик
);

create type public.counterparty_type as enum ('client', 'supplier', 'both');

create type public.task_type as enum ('min_stock', 'deficit', 'approval', 'purchase_eta', 'general');
create type public.task_status as enum ('open', 'in_progress', 'done', 'cancelled');
create type public.approval_status as enum ('pending', 'approved', 'rejected');

-- ------------------------- Пользователи -------------------------

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  role public.user_role not null default 'sales',
  phone text,
  position text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.profiles is 'Сотрудники и их роли. Связаны 1-к-1 с auth.users.';

-- Автосоздание профиля при регистрации пользователя
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    coalesce((new.raw_user_meta_data->>'role')::public.user_role, 'sales')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Хелперы для RLS
create or replace function public.app_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_director()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select role = 'director' from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.has_role(variadic roles public.user_role[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select role = any(roles) from public.profiles where id = auth.uid()), false)
$$;

-- ------------------------- Настройки компании -------------------------

create table public.settings (
  id boolean primary key default true check (id),
  company_name text not null default 'Наша компания',
  company_bin text,
  company_address text,
  company_phone text,
  company_email text,
  bank_details text,
  currency text not null default 'KZT',
  vat_percent numeric(5,2) not null default 12,
  default_markup_percent numeric(5,2) not null default 20,
  quote_valid_days int not null default 14,
  updated_at timestamptz not null default now()
);

insert into public.settings (id) values (true) on conflict do nothing;

-- ------------------------- Контрагенты -------------------------

create table public.counterparties (
  id uuid primary key default gen_random_uuid(),
  type public.counterparty_type not null default 'client',
  name text not null,
  full_name text,
  bin_iin text,
  phone text,
  email text,
  address text,
  website text,
  payment_terms text,
  is_key_client boolean not null default false,   -- ключевой клиент: жёсткий резерв по договору без предоплаты
  deferral_days int not null default 0,
  rating int check (rating between 1 and 5),
  note text,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on public.counterparties (type);
create index on public.counterparties using gin (to_tsvector('simple', coalesce(name,'') || ' ' || coalesce(bin_iin,'')));

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  counterparty_id uuid not null references public.counterparties(id) on delete cascade,
  full_name text not null,
  position text,
  phone text,
  whatsapp text,
  email text,
  is_primary boolean not null default false,
  note text,
  created_at timestamptz not null default now()
);

create index on public.contacts (counterparty_id);

-- ------------------------- Задачи и уведомления -------------------------

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  type public.task_type not null default 'general',
  title text not null,
  description text,
  assignee_role public.user_role,
  assignee_id uuid references public.profiles(id),
  entity_type text,      -- 'deal' | 'item' | 'purchase_order' | 'production_order' | ...
  entity_id uuid,
  due_date date,
  priority int not null default 2 check (priority between 1 and 3), -- 1 высокий
  status public.task_status not null default 'open',
  dedup_key text unique,  -- защита от дублей автозадач (напр. min_stock:<item_id>)
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  closed_at timestamptz
);

create index on public.tasks (status, assignee_role);
create index on public.tasks (entity_type, entity_id);

-- ------------------------- Документы (ссылки на Storage) -------------------------

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,   -- 'deal' | 'batch' | 'production_order' | 'counterparty' | 'quote'
  entity_id uuid not null,
  doc_type text not null default 'other', -- 'contract' | 'cert_quality' | 'passport' | 'drawing' | 'invoice'
  title text,
  file_path text not null,     -- путь в Supabase Storage
  file_name text,
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index on public.documents (entity_type, entity_id);

-- ------------------------- Журнал действий -------------------------

create table public.audit_log (
  id bigserial primary key,
  table_name text not null,
  record_id uuid,
  action text not null,       -- INSERT | UPDATE | DELETE
  changed_by uuid,
  diff jsonb,
  created_at timestamptz not null default now()
);

create index on public.audit_log (table_name, record_id);

create or replace function public.fn_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  rec_id uuid;
  payload jsonb;
begin
  if tg_op = 'DELETE' then
    rec_id := (to_jsonb(old)->>'id')::uuid;
    payload := to_jsonb(old);
  else
    rec_id := (to_jsonb(new)->>'id')::uuid;
    payload := case when tg_op = 'UPDATE'
      then jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new))
      else to_jsonb(new) end;
  end if;

  insert into public.audit_log (table_name, record_id, action, changed_by, diff)
  values (tg_table_name, rec_id, tg_op, auth.uid(), payload);

  return coalesce(new, old);
end;
$$;

-- ------------------------- updated_at -------------------------

create or replace function public.fn_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_touch_counterparties before update on public.counterparties
  for each row execute function public.fn_touch_updated_at();

-- ------------------------- Генератор номеров документов -------------------------

create table public.doc_counters (
  prefix text not null,
  year int not null,
  last_value int not null default 0,
  primary key (prefix, year)
);

create or replace function public.next_doc_number(p_prefix text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year int := extract(year from now())::int;
  v_val int;
begin
  insert into public.doc_counters (prefix, year, last_value)
  values (p_prefix, v_year, 1)
  on conflict (prefix, year) do update set last_value = public.doc_counters.last_value + 1
  returning last_value into v_val;

  return p_prefix || '-' || substr(v_year::text, 3, 2) || '-' || lpad(v_val::text, 4, '0');
end;
$$;


-- ============================================================
-- ФАЙЛ: 20260803090100_02_catalog.sql
-- ============================================================
-- ============================================================
-- 02. НОМЕНКЛАТУРА: единицы измерения, категории, позиции, аналоги
-- ============================================================

create type public.item_kind as enum (
  'material',    -- металлопрокат, сталь 304/316
  'component',   -- задвижки, электроприводы, фланцы, метизы
  'product',     -- готовое изделие (РВС, узел)
  'service'      -- работы: сварка, покраска, доставка
);

-- ------------------------- Единицы измерения -------------------------

create table public.units (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,        -- 'sht', 't', 'list', 'm', 'm2', 'kompl'
  name text not null,               -- 'шт', 'т', 'лист', 'м'
  full_name text,
  kind text not null default 'piece' check (kind in ('piece','weight','length','area','volume','set','time')),
  precision int not null default 3
);

-- ------------------------- Категории (дерево) -------------------------

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  parent_id uuid references public.categories(id) on delete set null,
  sort_order int not null default 100
);

create index on public.categories (parent_id);

-- ------------------------- Номенклатура -------------------------

create table public.items (
  id uuid primary key default gen_random_uuid(),
  sku text unique,
  name text not null,
  category_id uuid references public.categories(id) on delete set null,
  kind public.item_kind not null default 'component',
  base_unit_id uuid not null references public.units(id),

  -- Специфика металлообработки
  steel_grade text,            -- '304', '316', '316L', '09Г2С', 'Ст3'
  gost text,                   -- ГОСТ / стандарт
  spec jsonb not null default '{}'::jsonb,  -- {"du":100,"ru":16,"drive":"электро","thickness_mm":8,...}

  -- Пересчёт единиц
  weight_kg numeric(14,4),     -- вес одной базовой единицы (кг) — для т ↔ шт/лист
  length_m numeric(14,4),

  -- Складской учёт
  is_stock_tracked boolean not null default true,
  requires_certificate boolean not null default false,  -- обязателен сертификат плавки
  min_stock numeric(14,3) not null default 0,           -- неснижаемый остаток
  reorder_qty numeric(14,3) not null default 0,         -- сколько заказывать при пробитии минимума

  -- Цены
  default_price numeric(14,2) not null default 0,       -- цена продажи по умолчанию
  last_purchase_price numeric(14,2) not null default 0,
  avg_cost numeric(14,2) not null default 0,            -- средневзвешенная себестоимость
  lead_time_days int not null default 0,                -- типовой срок поставки

  note text,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on public.items (kind);
create index on public.items (category_id);
create index on public.items (steel_grade);
create index items_search_idx on public.items
  using gin (to_tsvector('simple', coalesce(name,'') || ' ' || coalesce(sku,'') || ' ' || coalesce(steel_grade,'')));

create trigger trg_touch_items before update on public.items
  for each row execute function public.fn_touch_updated_at();

-- Дополнительные единицы: 1 лист = 0.141 т и т.п.
create table public.item_units (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id) on delete cascade,
  unit_id uuid not null references public.units(id),
  factor numeric(16,6) not null check (factor > 0), -- сколько базовых единиц в одной этой
  unique (item_id, unit_id)
);

-- ------------------------- Аналоги / взаимозамены -------------------------

create table public.item_analogs (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id) on delete cascade,
  analog_item_id uuid not null references public.items(id) on delete cascade,
  compatibility int not null default 3 check (compatibility between 1 and 3), -- 3 полный, 2 с оговорками, 1 временный
  is_temporary_only boolean not null default false,  -- только как временная подмена
  note text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  check (item_id <> analog_item_id),
  unique (item_id, analog_item_id)
);

create index on public.item_analogs (item_id);

-- Аналоги двусторонние: при добавлении создаём обратную связь
create or replace function public.fn_analog_mirror()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.item_analogs (item_id, analog_item_id, compatibility, is_temporary_only, note, created_by)
  values (new.analog_item_id, new.item_id, new.compatibility, new.is_temporary_only, new.note, new.created_by)
  on conflict (item_id, analog_item_id) do nothing;
  return new;
end;
$$;

create trigger trg_analog_mirror after insert on public.item_analogs
  for each row execute function public.fn_analog_mirror();

-- ------------------------- Связка поставщик ↔ номенклатура -------------------------

create table public.item_suppliers (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id) on delete cascade,
  supplier_id uuid not null references public.counterparties(id) on delete cascade,
  supplier_sku text,
  price numeric(14,2) not null default 0,
  currency text not null default 'KZT',
  lead_time_days int not null default 0,
  is_preferred boolean not null default false,
  last_quoted_at date,
  note text,
  unique (item_id, supplier_id)
);

create index on public.item_suppliers (supplier_id);


-- ============================================================
-- ФАЙЛ: 20260803090200_03_warehouse.sql
-- ============================================================
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


-- ============================================================
-- ФАЙЛ: 20260803090300_04_sales.sql
-- ============================================================
-- ============================================================
-- 04. ПРОДАЖИ: сделки, этапы, конструктор спецификаций, замены, КП
-- ============================================================

create type public.deal_stage as enum (
  'lead',        -- 1. Первичный контакт / заявка (получение ТЗ)
  'design',      -- 2. Проектирование и расчёт (смета, подбор аналогов)
  'approval',    -- 3. Согласование (отправка КП)
  'contract',    -- 4. Договор и оплата
  'supply',      -- 5. Снабжение (резерв / лист дефицита)
  'production',  -- 6. Производство
  'qc',          -- 7. ОТК
  'shipment'     -- 8. Отгрузка и закрывающие документы
);

create type public.deal_status as enum ('active', 'won', 'lost', 'paused');

create type public.deal_source as enum ('site', 'tender', 'call', 'email', 'whatsapp', 'referral', 'other');

create type public.spec_status as enum ('draft', 'approved', 'archived');

create type public.spec_source as enum ('stock', 'purchase', 'production', 'outsource');

create type public.substitution_type as enum ('temporary', 'permanent');

create type public.quote_status as enum ('draft', 'sent', 'accepted', 'rejected', 'expired');

-- ------------------------- Сделки -------------------------

create table public.deals (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  title text not null,
  counterparty_id uuid not null references public.counterparties(id) on delete restrict,
  contact_id uuid references public.contacts(id) on delete set null,
  manager_id uuid references public.profiles(id),
  stage public.deal_stage not null default 'lead',
  status public.deal_status not null default 'active',
  source public.deal_source not null default 'call',

  tz_text text,                         -- краткое ТЗ от клиента
  amount numeric(16,2) not null default 0,      -- сумма продажи (из текущей спецификации)
  cost_amount numeric(16,2) not null default 0, -- плановая себестоимость
  prepaid_amount numeric(16,2) not null default 0,
  currency text not null default 'KZT',
  probability int not null default 50 check (probability between 0 and 100),

  contract_number text,
  contract_signed_at date,
  expected_close_date date,
  required_ship_date date,              -- срок, обещанный клиенту
  closed_at timestamptz,
  lost_reason text,

  stage_entered_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on public.deals (stage) where status = 'active';
create index on public.deals (manager_id);
create index on public.deals (counterparty_id);

create trigger trg_touch_deals before update on public.deals
  for each row execute function public.fn_touch_updated_at();

-- Автономер сделки
create or replace function public.fn_deal_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.number is null or new.number = '' then
    new.number := public.next_doc_number('D');
  end if;
  return new;
end;
$$;

create trigger trg_deal_number before insert on public.deals
  for each row execute function public.fn_deal_number();

-- История этапов (для аналитики длинных сделок)
create table public.deal_stage_history (
  id bigserial primary key,
  deal_id uuid not null references public.deals(id) on delete cascade,
  from_stage public.deal_stage,
  to_stage public.deal_stage not null,
  changed_by uuid references public.profiles(id),
  changed_at timestamptz not null default now(),
  duration_seconds bigint,          -- сколько сделка провела на предыдущем этапе
  comment text
);

create index on public.deal_stage_history (deal_id, changed_at);

create or replace function public.fn_deal_stage_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.deal_stage_history (deal_id, from_stage, to_stage, changed_by)
    values (new.id, null, new.stage, auth.uid());
    return new;
  end if;

  if new.stage is distinct from old.stage then
    insert into public.deal_stage_history (deal_id, from_stage, to_stage, changed_by, duration_seconds)
    values (new.id, old.stage, new.stage, auth.uid(),
            extract(epoch from (now() - old.stage_entered_at))::bigint);
    new.stage_entered_at := now();
  end if;
  return new;
end;
$$;

create trigger trg_deal_stage_log_ins after insert on public.deals
  for each row execute function public.fn_deal_stage_log();

create trigger trg_deal_stage_log_upd before update of stage on public.deals
  for each row execute function public.fn_deal_stage_log();

-- ------------------------- Оплаты по сделке -------------------------

create table public.deal_payments (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  kind text not null default 'prepayment' check (kind in ('prepayment','payment','refund')),
  amount numeric(16,2) not null check (amount > 0),
  paid_at date not null default current_date,
  doc_ref text,
  note text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index on public.deal_payments (deal_id);

create or replace function public.fn_recalc_deal_paid()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deal uuid := coalesce(new.deal_id, old.deal_id);
begin
  update public.deals d
     set prepaid_amount = coalesce((
           select sum(case when p.kind = 'refund' then -p.amount else p.amount end)
             from public.deal_payments p where p.deal_id = v_deal), 0)
   where d.id = v_deal;
  return coalesce(new, old);
end;
$$;

create trigger trg_recalc_deal_paid after insert or update or delete on public.deal_payments
  for each row execute function public.fn_recalc_deal_paid();

-- ------------------------- Прочие затраты по сделке (для факт. себестоимости) -------------------------

create table public.deal_expenses (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  category text not null default 'other'
    check (category in ('logistics','labor','outsource','tooling','consumables','overhead','other')),
  title text not null,
  amount numeric(16,2) not null,
  spent_at date not null default current_date,
  note text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index on public.deal_expenses (deal_id);

-- ------------------------- Спецификация (смета) -------------------------

create table public.specifications (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  version int not null default 1,
  name text not null default 'Спецификация',
  status public.spec_status not null default 'draft',
  is_current boolean not null default true,
  markup_percent numeric(6,2) not null default 20,
  discount_percent numeric(6,2) not null default 0,
  vat_percent numeric(5,2) not null default 12,

  total_cost numeric(16,2) not null default 0,   -- себестоимость позиций
  total_sale numeric(16,2) not null default 0,   -- сумма продажи без НДС
  total_vat numeric(16,2) not null default 0,
  total_with_vat numeric(16,2) not null default 0,
  margin numeric(16,2) not null default 0,
  margin_percent numeric(8,2) not null default 0,
  max_lead_time_days int not null default 0,

  note text,
  created_by uuid references public.profiles(id),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (deal_id, version)
);

create index on public.specifications (deal_id);
create unique index specifications_one_current_idx on public.specifications (deal_id) where is_current;

create trigger trg_touch_specs before update on public.specifications
  for each row execute function public.fn_touch_updated_at();

-- ------------------------- Строки спецификации -------------------------

create table public.spec_items (
  id uuid primary key default gen_random_uuid(),
  spec_id uuid not null references public.specifications(id) on delete cascade,
  line_no int not null default 1,
  section text not null default 'Материалы',   -- Материалы / Оборудование / Работы / Логистика

  item_id uuid references public.items(id) on delete set null,
  name_snapshot text not null,                 -- наименование на момент расчёта
  unit_id uuid references public.units(id),
  qty numeric(14,3) not null default 1 check (qty > 0),

  cost_price numeric(14,2) not null default 0, -- закупочная / себестоимость за единицу
  sale_price numeric(14,2) not null default 0, -- цена продажи за единицу
  cost_total numeric(16,2) generated always as (round(qty * cost_price, 2)) stored,
  sale_total numeric(16,2) generated always as (round(qty * sale_price, 2)) stored,

  source public.spec_source not null default 'purchase',
  lead_time_days int not null default 0,

  -- Замена / аналог
  is_substitute boolean not null default false,
  original_item_id uuid references public.items(id) on delete set null,
  substitution_type public.substitution_type,
  substitution_reason text,
  substitution_return_date date,               -- когда планируем вернуть штатную позицию
  substitution_approved_by uuid references public.profiles(id),

  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on public.spec_items (spec_id, line_no);
create index on public.spec_items (item_id);

create trigger trg_touch_spec_items before update on public.spec_items
  for each row execute function public.fn_touch_updated_at();

-- Пересчёт итогов спецификации и суммы сделки
create or replace function public.fn_recalc_spec_totals()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_spec uuid := coalesce(new.spec_id, old.spec_id);
  v_cost numeric := 0;
  v_sale numeric := 0;
  v_lead int := 0;
  s public.specifications%rowtype;
  v_sale_disc numeric;
  v_vat numeric;
begin
  select coalesce(sum(cost_total),0), coalesce(sum(sale_total),0), coalesce(max(lead_time_days),0)
    into v_cost, v_sale, v_lead
    from public.spec_items where spec_id = v_spec;

  select * into s from public.specifications where id = v_spec;
  if not found then return coalesce(new, old); end if;

  v_sale_disc := round(v_sale * (1 - coalesce(s.discount_percent,0)/100), 2);
  v_vat := round(v_sale_disc * coalesce(s.vat_percent,0)/100, 2);

  update public.specifications
     set total_cost = v_cost,
         total_sale = v_sale_disc,
         total_vat = v_vat,
         total_with_vat = v_sale_disc + v_vat,
         margin = v_sale_disc - v_cost,
         margin_percent = case when v_sale_disc > 0 then round((v_sale_disc - v_cost) / v_sale_disc * 100, 2) else 0 end,
         max_lead_time_days = v_lead,
         updated_at = now()
   where id = v_spec;

  -- Сумма сделки берётся из текущей спецификации
  update public.deals d
     set amount = v_sale_disc + v_vat,
         cost_amount = v_cost
    from public.specifications sp
   where sp.id = v_spec and sp.is_current and d.id = sp.deal_id;

  return coalesce(new, old);
end;
$$;

create trigger trg_recalc_spec_items after insert or update or delete on public.spec_items
  for each row execute function public.fn_recalc_spec_totals();

create or replace function public.fn_recalc_spec_on_header()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale numeric; v_cost numeric; v_sale_disc numeric; v_vat numeric;
begin
  select coalesce(sum(cost_total),0), coalesce(sum(sale_total),0)
    into v_cost, v_sale from public.spec_items where spec_id = new.id;

  v_sale_disc := round(v_sale * (1 - coalesce(new.discount_percent,0)/100), 2);
  v_vat := round(v_sale_disc * coalesce(new.vat_percent,0)/100, 2);

  new.total_cost := v_cost;
  new.total_sale := v_sale_disc;
  new.total_vat := v_vat;
  new.total_with_vat := v_sale_disc + v_vat;
  new.margin := v_sale_disc - v_cost;
  new.margin_percent := case when v_sale_disc > 0 then round((v_sale_disc - v_cost)/v_sale_disc*100, 2) else 0 end;
  return new;
end;
$$;

create trigger trg_recalc_spec_header before update of discount_percent, vat_percent on public.specifications
  for each row execute function public.fn_recalc_spec_on_header();

-- ------------------------- Журнал замен (аналоги) -------------------------

create table public.spec_substitutions (
  id uuid primary key default gen_random_uuid(),
  spec_item_id uuid not null references public.spec_items(id) on delete cascade,
  deal_id uuid not null references public.deals(id) on delete cascade,
  from_item_id uuid references public.items(id),
  to_item_id uuid references public.items(id),
  from_name text,
  to_name text,
  from_price numeric(14,2) not null default 0,
  to_price numeric(14,2) not null default 0,
  qty numeric(14,3) not null default 0,
  cost_delta numeric(16,2) not null default 0,   -- влияние на смету
  lead_time_delta int not null default 0,
  substitution_type public.substitution_type not null default 'temporary',
  reason text,
  return_date date,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index on public.spec_substitutions (deal_id);
create index on public.spec_substitutions (spec_item_id);

-- ------------------------- Коммерческие предложения -------------------------

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  deal_id uuid not null references public.deals(id) on delete cascade,
  spec_id uuid not null references public.specifications(id) on delete restrict,
  version int not null default 1,
  status public.quote_status not null default 'draft',
  issued_at date not null default current_date,
  valid_until date,
  payment_terms text default 'Предоплата 50%, окончательный расчёт по факту готовности',
  delivery_terms text default 'Самовывоз со склада Поставщика',
  lead_time_text text,
  warranty_text text default 'Гарантия 12 месяцев с даты отгрузки',
  total numeric(16,2) not null default 0,
  total_with_vat numeric(16,2) not null default 0,
  intro_text text,
  note text,
  sent_at timestamptz,
  decided_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index on public.quotes (deal_id);

create or replace function public.fn_quote_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare s public.specifications%rowtype;
begin
  if new.number is null or new.number = '' then
    new.number := public.next_doc_number('КП');
  end if;
  select * into s from public.specifications where id = new.spec_id;
  if found then
    new.total := s.total_sale;
    new.total_with_vat := s.total_with_vat;
    if new.lead_time_text is null then
      new.lead_time_text := s.max_lead_time_days || ' календарных дней с момента предоплаты';
    end if;
  end if;
  if new.valid_until is null then
    new.valid_until := current_date + coalesce((select quote_valid_days from public.settings where id), 14);
  end if;
  return new;
end;
$$;

create trigger trg_quote_number before insert on public.quotes
  for each row execute function public.fn_quote_number();

-- Отложенные внешние ключи из 03
alter table public.stock_moves
  add constraint stock_moves_deal_fk foreign key (deal_id) references public.deals(id) on delete set null;


-- ============================================================
-- ФАЙЛ: 20260803090400_05_reservations.sql
-- ============================================================
-- ============================================================
-- 05. РЕЗЕРВЫ: информационный (КП) и жёсткий (предоплата/договор),
--     снятие жёсткого резерва — только через согласование директора
-- ============================================================

create type public.reserve_kind as enum ('soft', 'hard');
create type public.reserve_status as enum ('active', 'released', 'consumed');

create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  spec_item_id uuid references public.spec_items(id) on delete set null,
  item_id uuid not null references public.items(id) on delete restrict,
  warehouse_id uuid references public.warehouses(id),
  qty numeric(14,3) not null check (qty > 0),
  kind public.reserve_kind not null default 'soft',
  status public.reserve_status not null default 'active',
  note text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  released_at timestamptz,
  released_by uuid references public.profiles(id)
);

create index on public.reservations (item_id, status);
create index on public.reservations (deal_id);

comment on table public.reservations is
  'soft — информационный резерв на этапе КП (показывает плановый расход). hard — жёсткий, ставится по предоплате либо по договору для ключевых клиентов.';

-- ------------------------- Доступность к резерву -------------------------

create view public.v_item_availability as
  with bal as (
    select item_id, sum(qty) as on_hand
    from public.v_stock_ledger
    group by item_id
  ),
  res as (
    select item_id,
           sum(qty) filter (where kind = 'hard') as hard_reserved,
           sum(qty) filter (where kind = 'soft') as soft_reserved
    from public.reservations
    where status = 'active'
    group by item_id
  )
  select
    i.id as item_id,
    i.name,
    i.sku,
    i.steel_grade,
    i.min_stock,
    coalesce(b.on_hand, 0)::numeric(14,3)        as on_hand,
    coalesce(r.hard_reserved, 0)::numeric(14,3)  as hard_reserved,
    coalesce(r.soft_reserved, 0)::numeric(14,3)  as soft_reserved,
    (coalesce(b.on_hand, 0) - coalesce(r.hard_reserved, 0))::numeric(14,3) as available,
    (coalesce(b.on_hand, 0) < i.min_stock)       as below_min
  from public.items i
  left join bal b on b.item_id = i.id
  left join res r on r.item_id = i.id
  where i.is_active;

create or replace function public.fn_available_qty(p_item_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select coalesce(sum(qty),0) from public.v_stock_ledger where item_id = p_item_id) -
    (select coalesce(sum(qty),0) from public.reservations where item_id = p_item_id and kind = 'hard' and status = 'active'),
  0)::numeric
$$;

-- ------------------------- Правило постановки жёсткого резерва -------------------------

create or replace function public.fn_can_hard_reserve(p_deal_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select d.prepaid_amount > 0
        or (d.contract_signed_at is not null and c.is_key_client)
      from public.deals d
      join public.counterparties c on c.id = d.counterparty_id
     where d.id = p_deal_id
  ), false)
$$;

create or replace function public.fn_guard_reservation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Жёсткий резерв возможен только при предоплате или договоре с ключевым клиентом
  if new.kind = 'hard' and new.status = 'active'
     and (tg_op = 'INSERT' or old.kind is distinct from 'hard') then
    if not public.fn_can_hard_reserve(new.deal_id) then
      raise exception 'Жёсткий резерв недоступен: по сделке нет предоплаты и нет договора с ключевым клиентом'
        using errcode = 'check_violation';
    end if;
  end if;

  -- Нельзя зарезервировать больше, чем свободно
  if new.kind = 'hard' and new.status = 'active' then
    if new.qty > public.fn_available_qty(new.item_id)
        + coalesce((select r.qty from public.reservations r
                     where r.id = new.id and r.kind = 'hard' and r.status = 'active'), 0) then
      raise exception 'Недостаточно свободного остатка для жёсткого резерва (позиция %)', new.item_id
        using errcode = 'check_violation';
    end if;
  end if;

  -- Снятие жёсткого резерва — только директор (или через согласованную заявку)
  if tg_op = 'UPDATE'
     and old.kind = 'hard' and old.status = 'active'
     and new.status in ('released')
     and coalesce(current_setting('app.release_approved', true), 'off') <> 'on'
     and not public.is_director() then
    raise exception 'Снятие жёсткого резерва возможно только через согласование руководителя'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

create trigger trg_guard_reservation before insert or update on public.reservations
  for each row execute function public.fn_guard_reservation();

create or replace function public.fn_block_hard_reservation_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.kind = 'hard' and old.status = 'active' and not public.is_director() then
    raise exception 'Удаление активного жёсткого резерва запрещено. Оформите заявку на снятие резерва.'
      using errcode = 'insufficient_privilege';
  end if;
  return old;
end;
$$;

create trigger trg_block_hard_res_delete before delete on public.reservations
  for each row execute function public.fn_block_hard_reservation_delete();

-- ------------------------- Заявка на снятие резерва -------------------------

create table public.reservation_release_requests (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.reservations(id) on delete cascade,
  requested_by uuid references public.profiles(id),
  target_deal_id uuid references public.deals(id) on delete set null, -- в пользу какой сделки
  qty numeric(14,3) not null,
  reason text not null,
  status public.approval_status not null default 'pending',
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  decision_comment text,
  created_at timestamptz not null default now()
);

create index on public.reservation_release_requests (status);

create or replace function public.rpc_request_release(
  p_reservation_id uuid,
  p_reason text,
  p_target_deal_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_res public.reservations%rowtype;
  v_id uuid;
begin
  select * into v_res from public.reservations where id = p_reservation_id;
  if not found then raise exception 'Резерв не найден'; end if;
  if v_res.status <> 'active' then raise exception 'Резерв уже неактивен'; end if;

  insert into public.reservation_release_requests (reservation_id, requested_by, target_deal_id, qty, reason)
  values (p_reservation_id, auth.uid(), p_target_deal_id, v_res.qty, p_reason)
  returning id into v_id;

  insert into public.tasks (type, title, description, assignee_role, entity_type, entity_id, priority, created_by)
  values ('approval', 'Согласовать снятие резерва',
          coalesce(p_reason, '') , 'director', 'reservation_release_request', v_id, 1, auth.uid());

  return v_id;
end;
$$;

create or replace function public.rpc_decide_release(
  p_request_id uuid,
  p_approve boolean,
  p_comment text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.reservation_release_requests%rowtype;
begin
  if not public.is_director() then
    raise exception 'Решение по снятию резерва принимает только руководитель'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_req from public.reservation_release_requests where id = p_request_id for update;
  if not found then raise exception 'Заявка не найдена'; end if;
  if v_req.status <> 'pending' then raise exception 'Заявка уже обработана'; end if;

  update public.reservation_release_requests
     set status = case when p_approve then 'approved' else 'rejected' end::public.approval_status,
         decided_by = auth.uid(), decided_at = now(), decision_comment = p_comment
   where id = p_request_id;

  if p_approve then
    perform set_config('app.release_approved', 'on', true);
    update public.reservations
       set status = 'released', released_at = now(), released_by = auth.uid(),
           note = coalesce(note, '') || ' | снят по заявке ' || p_request_id::text
     where id = v_req.reservation_id;
    perform set_config('app.release_approved', 'off', true);
  end if;

  update public.tasks set status = 'done', closed_at = now()
   where entity_type = 'reservation_release_request' and entity_id = p_request_id;
end;
$$;

-- ------------------------- Массовый резерв по спецификации -------------------------

create or replace function public.rpc_reserve_deal(
  p_deal_id uuid,
  p_kind public.reserve_kind default 'soft'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_spec uuid;
  r record;
  v_need numeric;
  v_already numeric;
  v_free numeric;
  v_take numeric;
  v_reserved jsonb := '[]'::jsonb;
  v_deficit jsonb := '[]'::jsonb;
  v_wh uuid;
begin
  select id into v_spec from public.specifications
   where deal_id = p_deal_id and is_current limit 1;
  if v_spec is null then raise exception 'У сделки нет текущей спецификации'; end if;

  if p_kind = 'hard' and not public.fn_can_hard_reserve(p_deal_id) then
    raise exception 'Жёсткий резерв недоступен: нет предоплаты и нет договора с ключевым клиентом';
  end if;

  select id into v_wh from public.warehouses where kind = 'material' and is_active order by sort_order limit 1;

  for r in
    select si.id as spec_item_id, si.item_id, si.qty, si.name_snapshot
      from public.spec_items si
      join public.items i on i.id = si.item_id
     where si.spec_id = v_spec
       and si.item_id is not null
       and i.is_stock_tracked
       and si.source in ('stock','purchase')
  loop
    v_need := r.qty;

    select coalesce(sum(qty), 0) into v_already
      from public.reservations
     where deal_id = p_deal_id and item_id = r.item_id and status = 'active' and kind = p_kind;

    v_need := v_need - v_already;
    if v_need <= 0 then continue; end if;

    if p_kind = 'hard' then
      v_free := public.fn_available_qty(r.item_id);
    else
      v_free := coalesce((select sum(qty) from public.v_stock_ledger where item_id = r.item_id), 0)
                - coalesce((select sum(qty) from public.reservations
                             where item_id = r.item_id and status = 'active' and deal_id <> p_deal_id), 0);
    end if;

    v_take := least(v_need, greatest(v_free, 0));

    if v_take > 0 then
      insert into public.reservations (deal_id, spec_item_id, item_id, warehouse_id, qty, kind, created_by)
      values (p_deal_id, r.spec_item_id, r.item_id, v_wh, v_take, p_kind, auth.uid());

      v_reserved := v_reserved || jsonb_build_object(
        'item_id', r.item_id, 'name', r.name_snapshot, 'qty', v_take);
    end if;

    if v_need - v_take > 0 then
      v_deficit := v_deficit || jsonb_build_object(
        'item_id', r.item_id, 'spec_item_id', r.spec_item_id,
        'name', r.name_snapshot, 'qty', v_need - v_take);
    end if;
  end loop;

  return jsonb_build_object(
    'deal_id', p_deal_id,
    'kind', p_kind,
    'reserved', v_reserved,
    'deficit', v_deficit,
    'has_deficit', jsonb_array_length(v_deficit) > 0
  );
end;
$$;


-- ============================================================
-- ФАЙЛ: 20260803090500_06_procurement.sql
-- ============================================================
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


-- ============================================================
-- ФАЙЛ: 20260803090600_07_production.sql
-- ============================================================
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


-- ============================================================
-- ФАЙЛ: 20260803090700_08_analytics.sql
-- ============================================================
-- ============================================================
-- 08. АНАЛИТИКА: реальная себестоимость проекта, сроки, воронка
-- ============================================================

-- Плановая и фактическая себестоимость по сделке
create view public.v_deal_costing as
  with spec as (
    select s.deal_id, s.total_cost as plan_cost, s.total_sale as revenue_net,
           s.total_with_vat as revenue_gross, s.margin as plan_margin
      from public.specifications s where s.is_current
  ),
  fact_materials as (
    select sm.deal_id, sum(sm.qty * sm.unit_cost) as material_cost
      from public.stock_moves sm
     where sm.move_type = 'issue' and sm.deal_id is not null
     group by sm.deal_id
  ),
  fact_returns as (
    select sm.deal_id, sum(sm.qty * sm.unit_cost) as returned_cost
      from public.stock_moves sm
     where sm.move_type = 'return' and sm.deal_id is not null
     group by sm.deal_id
  ),
  fact_expenses as (
    select e.deal_id, sum(e.amount) as other_cost
      from public.deal_expenses e group by e.deal_id
  ),
  fact_purchases as (
    select po.deal_id, sum(poi.qty * poi.price) as purchased_cost
      from public.purchase_orders po
      join public.purchase_order_items poi on poi.order_id = po.id
     where po.deal_id is not null and po.status <> 'cancelled'
     group by po.deal_id
  )
  select
    d.id as deal_id,
    d.number,
    d.title,
    d.stage,
    d.status,
    c.name as client_name,
    p.full_name as manager_name,
    coalesce(sp.revenue_net, 0)::numeric(16,2)    as revenue_net,
    coalesce(sp.revenue_gross, d.amount)::numeric(16,2) as revenue_gross,
    coalesce(sp.plan_cost, 0)::numeric(16,2)      as plan_cost,
    coalesce(fm.material_cost, 0)::numeric(16,2)  as fact_material_cost,
    coalesce(fr.returned_cost, 0)::numeric(16,2)  as returned_cost,
    coalesce(fe.other_cost, 0)::numeric(16,2)     as other_cost,
    coalesce(fp.purchased_cost, 0)::numeric(16,2) as purchased_cost,
    (coalesce(fm.material_cost,0) - coalesce(fr.returned_cost,0) + coalesce(fe.other_cost,0))::numeric(16,2)
      as fact_cost,
    (coalesce(sp.revenue_net,0)
      - (coalesce(fm.material_cost,0) - coalesce(fr.returned_cost,0) + coalesce(fe.other_cost,0)))::numeric(16,2)
      as fact_margin,
    case when coalesce(sp.revenue_net,0) > 0 then
      round((coalesce(sp.revenue_net,0)
        - (coalesce(fm.material_cost,0) - coalesce(fr.returned_cost,0) + coalesce(fe.other_cost,0)))
        / sp.revenue_net * 100, 2) else 0 end as fact_margin_percent,
    (coalesce(fm.material_cost,0) - coalesce(fr.returned_cost,0) + coalesce(fe.other_cost,0)
      - coalesce(sp.plan_cost,0))::numeric(16,2) as cost_deviation,
    d.prepaid_amount,
    d.required_ship_date,
    d.created_at
  from public.deals d
  join public.counterparties c on c.id = d.counterparty_id
  left join public.profiles p on p.id = d.manager_id
  left join spec sp on sp.deal_id = d.id
  left join fact_materials fm on fm.deal_id = d.id
  left join fact_returns fr on fr.deal_id = d.id
  left join fact_expenses fe on fe.deal_id = d.id
  left join fact_purchases fp on fp.deal_id = d.id;

-- Длительность этапов сделки
create view public.v_deal_stage_stats as
  select
    h.from_stage as stage,
    count(*) as transitions,
    round(avg(h.duration_seconds) / 86400.0, 1) as avg_days,
    round((percentile_cont(0.5) within group (order by h.duration_seconds))::numeric / 86400.0, 1) as median_days
  from public.deal_stage_history h
  where h.from_stage is not null and h.duration_seconds is not null
  group by h.from_stage;

-- Воронка
create view public.v_pipeline as
  select
    d.stage,
    count(*) as deals_count,
    sum(d.amount)::numeric(16,2) as amount,
    sum(d.cost_amount)::numeric(16,2) as cost_amount
  from public.deals d
  where d.status = 'active'
  group by d.stage;

-- Влияние временных замен на смету
create view public.v_substitution_impact as
  select
    s.id,
    s.created_at,
    d.number as deal_number,
    d.title as deal_title,
    s.from_name,
    s.to_name,
    s.qty,
    s.from_price,
    s.to_price,
    s.cost_delta,
    s.lead_time_delta,
    s.substitution_type,
    s.reason,
    s.return_date,
    (s.substitution_type = 'temporary' and s.return_date is not null and s.return_date < current_date) as return_overdue,
    p.full_name as author
  from public.spec_substitutions s
  join public.deals d on d.id = s.deal_id
  left join public.profiles p on p.id = s.created_by;

-- Дефицит по всей номенклатуре (для дашборда снабжения)
create view public.v_deficit_overview as
  select
    a.item_id,
    a.name,
    a.sku,
    a.steel_grade,
    a.on_hand,
    a.hard_reserved,
    a.available,
    a.min_stock,
    greatest(a.min_stock - a.on_hand, 0)::numeric(14,3) as below_min_qty,
    coalesce(o.on_order, 0)::numeric(14,3) as on_order,
    coalesce(pr.requested, 0)::numeric(14,3) as in_requests
  from public.v_item_availability a
  left join (
    select poi.item_id, sum(poi.qty - poi.qty_received) as on_order
      from public.purchase_order_items poi
      join public.purchase_orders po on po.id = poi.order_id
     where po.status in ('ordered','paid','in_transit')
     group by poi.item_id
  ) o on o.item_id = a.item_id
  left join (
    select pri.item_id, sum(pri.qty - pri.qty_received) as requested
      from public.purchase_request_items pri
      join public.purchase_requests pr2 on pr2.id = pri.request_id
     where pr2.status in ('new','in_work','ordered','partially_received')
     group by pri.item_id
  ) pr on pr.item_id = a.item_id
  where a.available < 0 or a.on_hand < a.min_stock or coalesce(o.on_order,0) > 0 or coalesce(pr.requested,0) > 0;

-- Прослеживаемость: какие плавки ушли в какой заказ
create view public.v_heat_traceability as
  select
    sm.id as move_id,
    sm.moved_at,
    i.name as item_name,
    i.steel_grade,
    b.batch_number,
    b.heat_number,
    b.cert_number,
    cp.name as supplier_name,
    po.number as production_order_number,
    po.title as production_order_title,
    d.number as deal_number,
    sm.qty
  from public.stock_moves sm
  join public.items i on i.id = sm.item_id
  left join public.batches b on b.id = sm.batch_id
  left join public.counterparties cp on cp.id = b.supplier_id
  left join public.production_orders po on po.id = sm.production_order_id
  left join public.deals d on d.id = sm.deal_id
  where sm.move_type in ('issue','shipment');

-- Сводка по менеджерам
create view public.v_manager_stats as
  select
    p.id as manager_id,
    p.full_name,
    count(d.id) filter (where d.status = 'active') as active_deals,
    count(d.id) filter (where d.status = 'won') as won_deals,
    coalesce(sum(d.amount) filter (where d.status = 'active'), 0)::numeric(16,2) as active_amount,
    coalesce(sum(d.amount) filter (where d.status = 'won'), 0)::numeric(16,2) as won_amount
  from public.profiles p
  left join public.deals d on d.manager_id = p.id
  where p.role in ('sales','director')
  group by p.id, p.full_name;


-- ============================================================
-- ФАЙЛ: 20260803090800_09_rls.sql
-- ============================================================
-- ============================================================
-- 09. БЕЗОПАСНОСТЬ: RLS, права по ролям, Storage
-- Принцип «единого окна»: все сотрудники ВИДЯТ общие данные,
-- но ИЗМЕНЯТЬ может только профильная роль.
-- ============================================================

-- Views исполняются от имени вызывающего — RLS базовых таблиц работает
do $$
declare v record;
begin
  for v in select table_name from information_schema.views where table_schema = 'public'
  loop
    execute format('alter view public.%I set (security_invoker = on)', v.table_name);
  end loop;
end $$;

-- Включаем RLS на всех таблицах public
do $$
declare t record;
begin
  for t in
    select tablename from pg_tables
     where schemaname = 'public' and tablename not in ('doc_counters')
  loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

alter table public.doc_counters enable row level security;  -- доступ только через SECURITY DEFINER функции

revoke all on public.doc_counters from anon, authenticated;
revoke all on public.audit_log from anon;

-- ------------------------- Универсальные политики чтения -------------------------

do $$
declare t text;
  readable text[] := array[
    'profiles','settings','counterparties','contacts','tasks','documents',
    'units','categories','items','item_units','item_analogs','item_suppliers',
    'warehouses','batches','certificates','stock_moves',
    'deals','deal_stage_history','deal_payments','deal_expenses',
    'specifications','spec_items','spec_substitutions','quotes',
    'reservations','reservation_release_requests',
    'purchase_requests','purchase_request_items','purchase_orders','purchase_order_items',
    'production_orders','production_order_items','production_stage_log','qc_checks',
    'shipments','shipment_items'
  ];
begin
  foreach t in array readable loop
    execute format($f$
      create policy "read_all_authenticated" on public.%I
        for select to authenticated using (true);
    $f$, t);
  end loop;
end $$;

-- ------------------------- Профили -------------------------

create policy "profile_self_update" on public.profiles
  for update to authenticated
  using (id = auth.uid() or public.is_director())
  with check (id = auth.uid() or public.is_director());

create policy "profile_director_insert" on public.profiles
  for insert to authenticated with check (public.is_director());

create policy "profile_director_delete" on public.profiles
  for delete to authenticated using (public.is_director());

-- Смену собственной роли запрещаем (только директор)
create or replace function public.fn_guard_role_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role and not public.is_director() then
    raise exception 'Изменение роли доступно только руководителю' using errcode = 'insufficient_privilege';
  end if;
  return new;
end; $$;

create trigger trg_guard_role before update on public.profiles
  for each row execute function public.fn_guard_role_change();

-- ------------------------- Настройки -------------------------

create policy "settings_director" on public.settings
  for update to authenticated using (public.is_director()) with check (public.is_director());

-- ------------------------- Хелпер для генерации политик записи -------------------------

do $$
declare
  r record;
  spec jsonb := jsonb_build_array(
    -- таблица, роли с правом записи
    jsonb_build_object('t','counterparties','roles','{director,sales,procurement}'),
    jsonb_build_object('t','contacts',      'roles','{director,sales,procurement}'),
    jsonb_build_object('t','tasks',         'roles','{director,sales,procurement,production,warehouse}'),
    jsonb_build_object('t','documents',     'roles','{director,sales,procurement,production,warehouse}'),

    jsonb_build_object('t','units',         'roles','{director,procurement}'),
    jsonb_build_object('t','categories',    'roles','{director,procurement}'),
    jsonb_build_object('t','items',         'roles','{director,procurement,sales}'),
    jsonb_build_object('t','item_units',    'roles','{director,procurement}'),
    jsonb_build_object('t','item_analogs',  'roles','{director,procurement,sales}'),
    jsonb_build_object('t','item_suppliers','roles','{director,procurement}'),

    jsonb_build_object('t','warehouses',    'roles','{director}'),
    jsonb_build_object('t','batches',       'roles','{director,procurement,warehouse}'),
    jsonb_build_object('t','certificates',  'roles','{director,procurement,warehouse,production}'),
    jsonb_build_object('t','stock_moves',   'roles','{director,procurement,warehouse,production}'),

    jsonb_build_object('t','deals',         'roles','{director,sales}'),
    jsonb_build_object('t','deal_payments', 'roles','{director,sales}'),
    jsonb_build_object('t','deal_expenses', 'roles','{director,sales,procurement}'),
    jsonb_build_object('t','specifications','roles','{director,sales}'),
    jsonb_build_object('t','spec_items',    'roles','{director,sales}'),
    jsonb_build_object('t','spec_substitutions','roles','{director,sales,procurement}'),
    jsonb_build_object('t','quotes',        'roles','{director,sales}'),

    jsonb_build_object('t','reservations',  'roles','{director,sales,procurement}'),

    jsonb_build_object('t','purchase_requests',     'roles','{director,procurement,sales}'),
    jsonb_build_object('t','purchase_request_items','roles','{director,procurement,sales}'),
    jsonb_build_object('t','purchase_orders',       'roles','{director,procurement}'),
    jsonb_build_object('t','purchase_order_items',  'roles','{director,procurement}'),

    jsonb_build_object('t','production_orders',    'roles','{director,production}'),
    jsonb_build_object('t','production_order_items','roles','{director,production}'),
    jsonb_build_object('t','production_stage_log', 'roles','{director,production}'),
    jsonb_build_object('t','qc_checks',            'roles','{director,production}'),

    jsonb_build_object('t','shipments',      'roles','{director,sales,warehouse}'),
    jsonb_build_object('t','shipment_items', 'roles','{director,sales,warehouse}')
  );
begin
  for r in select * from jsonb_array_elements(spec) as e(v) loop
    execute format($f$
      create policy "write_by_role" on public.%I
        for insert to authenticated
        with check (public.has_role(variadic %L::public.user_role[]));
    $f$, r.v->>'t', r.v->>'roles');

    execute format($f$
      create policy "update_by_role" on public.%I
        for update to authenticated
        using (public.has_role(variadic %L::public.user_role[]))
        with check (public.has_role(variadic %L::public.user_role[]));
    $f$, r.v->>'t', r.v->>'roles', r.v->>'roles');

    execute format($f$
      create policy "delete_by_role" on public.%I
        for delete to authenticated
        using (public.has_role(variadic %L::public.user_role[]));
    $f$, r.v->>'t', r.v->>'roles');
  end loop;
end $$;

-- Заявку на снятие резерва может создать любой сотрудник,
-- но решение по ней меняет ТОЛЬКО директор (и только через rpc_decide_release)
create policy "release_request_insert" on public.reservation_release_requests
  for insert to authenticated with check (true);

create policy "release_request_decide" on public.reservation_release_requests
  for update to authenticated
  using (public.is_director()) with check (public.is_director());

-- Историю этапов пишут триггеры (SECURITY DEFINER); прямая запись — только директор
create policy "stage_history_director" on public.deal_stage_history
  for all to authenticated using (public.is_director()) with check (public.is_director());

-- Журнал аудита — только чтение директором
create policy "audit_read_director" on public.audit_log
  for select to authenticated using (public.is_director());

-- ------------------------- Аудит критичных таблиц -------------------------

create trigger trg_audit_reservations after insert or update or delete on public.reservations
  for each row execute function public.fn_audit();
create trigger trg_audit_deals after update or delete on public.deals
  for each row execute function public.fn_audit();
create trigger trg_audit_spec_items after insert or update or delete on public.spec_items
  for each row execute function public.fn_audit();
create trigger trg_audit_stock_moves after insert or delete on public.stock_moves
  for each row execute function public.fn_audit();
create trigger trg_audit_po after update on public.purchase_orders
  for each row execute function public.fn_audit();

-- ------------------------- Storage -------------------------

insert into storage.buckets (id, name, public)
values ('certificates', 'certificates', false),
       ('documents', 'documents', false),
       ('photos', 'photos', false)
on conflict (id) do nothing;

-- Политики Storage: если прав недостаточно (зависит от роли, под которой
-- выполняется миграция) — создайте их в Dashboard → Storage → Policies.
do $$
begin
  begin
    execute $p$
      create policy "storage_read_authenticated" on storage.objects
        for select to authenticated
        using (bucket_id in ('certificates','documents','photos'))
    $p$;
    execute $p$
      create policy "storage_write_authenticated" on storage.objects
        for insert to authenticated
        with check (bucket_id in ('certificates','documents','photos'))
    $p$;
    execute $p$
      create policy "storage_update_authenticated" on storage.objects
        for update to authenticated
        using (bucket_id in ('certificates','documents','photos'))
    $p$;
    execute $p$
      create policy "storage_delete_director" on storage.objects
        for delete to authenticated
        using (bucket_id in ('certificates','documents','photos') and public.is_director())
    $p$;
  exception
    when insufficient_privilege or duplicate_object then
      raise notice 'Политики storage.objects не созданы — настройте их через Dashboard';
  end;
end $$;

-- ------------------------- Права на функции -------------------------

grant execute on function public.rpc_reserve_deal(uuid, public.reserve_kind) to authenticated;
grant execute on function public.rpc_build_deficit(uuid, date) to authenticated;
grant execute on function public.rpc_request_release(uuid, text, uuid) to authenticated;
grant execute on function public.rpc_decide_release(uuid, boolean, text) to authenticated;
grant execute on function public.rpc_receive_po_item(uuid, numeric, uuid, text, text, numeric, text, date) to authenticated;
grant execute on function public.rpc_create_production_order(uuid, text, date) to authenticated;
grant execute on function public.rpc_issue_materials(uuid) to authenticated;
grant execute on function public.rpc_advance_stage(text, public.prod_stage, text) to authenticated;
grant execute on function public.fn_production_readiness(uuid) to authenticated;
grant execute on function public.fn_available_qty(uuid) to authenticated;
grant execute on function public.fn_stock_qty(uuid, uuid) to authenticated;
grant execute on function public.fn_can_hard_reserve(uuid) to authenticated;


-- ============================================================
-- ФАЙЛ: 20260803090900_10_seed_reference.sql
-- ============================================================
-- ============================================================
-- 10. СПРАВОЧНИКИ: единицы, склады, категории, стартовая номенклатура
-- ============================================================

insert into public.units (code, name, full_name, kind, precision) values
  ('sht',   'шт',    'штука',            'piece',  0),
  ('t',     'т',     'тонна',            'weight', 3),
  ('kg',    'кг',    'килограмм',        'weight', 2),
  ('list',  'лист',  'лист',             'piece',  0),
  ('m',     'м',     'метр',             'length', 2),
  ('m2',    'м2',    'квадратный метр',  'area',   2),
  ('kompl', 'компл', 'комплект',         'set',    0),
  ('h',     'ч',     'нормо-час',        'time',   1)
on conflict (code) do nothing;

insert into public.warehouses (code, name, kind, sort_order) values
  ('MAIN', 'Основной склад материалов', 'material',   10),
  ('SHOP', 'Производственный цех',      'production', 20),
  ('FG',   'Склад готовой продукции',   'finished',   30)
on conflict (code) do nothing;

-- Категории
with root as (
  insert into public.categories (name, sort_order) values
    ('Металлопрокат', 10),
    ('Трубопроводная арматура', 20),
    ('Приводы и автоматика', 30),
    ('Соединительные детали', 40),
    ('Метизы', 50),
    ('Кабель и электрика', 60),
    ('Работы и услуги', 70)
  returning id, name
)
insert into public.categories (name, parent_id, sort_order)
select v.name, r.id, v.sort
from root r
join (values
  ('Лист нержавеющий',        'Металлопрокат', 10),
  ('Лист углеродистый',       'Металлопрокат', 20),
  ('Труба нержавеющая',       'Металлопрокат', 30),
  ('Задвижки',                'Трубопроводная арматура', 10),
  ('Затворы дисковые',        'Трубопроводная арматура', 20),
  ('Клапаны',                 'Трубопроводная арматура', 30),
  ('Электроприводы',          'Приводы и автоматика', 10),
  ('Фланцы',                  'Соединительные детали', 10),
  ('Отводы и переходы',       'Соединительные детали', 20)
) as v(name, parent, sort) on v.parent = r.name;

-- Стартовая номенклатура
insert into public.items
  (sku, name, category_id, kind, base_unit_id, steel_grade, gost, spec, weight_kg,
   is_stock_tracked, requires_certificate, min_stock, reorder_qty,
   default_price, last_purchase_price, lead_time_days)
values
  ('MET-304-2X1500', 'Лист нержавеющий 2х1500х6000 AISI 304',
    (select id from public.categories where name = 'Лист нержавеющий'), 'material',
    (select id from public.units where code = 'list'), '304', 'ГОСТ 5582-75',
    '{"thickness_mm":2,"width_mm":1500,"length_mm":6000,"surface":"2B"}'::jsonb, 141.3,
    true, true, 10, 20, 285000, 240000, 21),

  ('MET-316-3X1500', 'Лист нержавеющий 3х1500х6000 AISI 316',
    (select id from public.categories where name = 'Лист нержавеющий'), 'material',
    (select id from public.units where code = 'list'), '316', 'ГОСТ 5582-75',
    '{"thickness_mm":3,"width_mm":1500,"length_mm":6000,"surface":"2B"}'::jsonb, 211.9,
    true, true, 6, 12, 465000, 398000, 30),

  ('MET-09G2S-8', 'Лист 8х1500х6000 09Г2С',
    (select id from public.categories where name = 'Лист углеродистый'), 'material',
    (select id from public.units where code = 'list'), '09Г2С', 'ГОСТ 19281-2014',
    '{"thickness_mm":8,"width_mm":1500,"length_mm":6000}'::jsonb, 565.2,
    true, true, 20, 40, 148000, 121000, 14),

  ('ARM-ZD-304-100', 'Задвижка клиновая Ду100 Ру16 нерж. AISI 304',
    (select id from public.categories where name = 'Задвижки'), 'component',
    (select id from public.units where code = 'sht'), '304', 'ГОСТ 5762-2002',
    '{"du":100,"ru":16,"type":"клиновая","connection":"фланцевое"}'::jsonb, 32,
    true, true, 4, 8, 410000, 335000, 25),

  ('ARM-ZD-316-100', 'Задвижка клиновая Ду100 Ру16 нерж. AISI 316',
    (select id from public.categories where name = 'Задвижки'), 'component',
    (select id from public.units where code = 'sht'), '316', 'ГОСТ 5762-2002',
    '{"du":100,"ru":16,"type":"клиновая","connection":"фланцевое"}'::jsonb, 32,
    true, true, 2, 4, 585000, 476000, 35),

  ('ARM-ZD-316-150', 'Задвижка клиновая Ду150 Ру16 нерж. AISI 316',
    (select id from public.categories where name = 'Задвижки'), 'component',
    (select id from public.units where code = 'sht'), '316', 'ГОСТ 5762-2002',
    '{"du":150,"ru":16,"type":"клиновая","connection":"фланцевое"}'::jsonb, 58,
    true, true, 2, 4, 890000, 735000, 35),

  ('DRV-AUMA-SA07', 'Электропривод AUMA SA 07.2 (штатный)',
    (select id from public.categories where name = 'Электроприводы'), 'component',
    (select id from public.units where code = 'sht'), null, null,
    '{"torque_nm":100,"voltage":"380V","ip":"IP68","brand":"AUMA"}'::jsonb, 28,
    true, false, 0, 0, 1450000, 1180000, 75),

  ('DRV-ROTORK-IQ10', 'Электропривод ROTORK IQ10 (аналог)',
    (select id from public.categories where name = 'Электроприводы'), 'component',
    (select id from public.units where code = 'sht'), null, null,
    '{"torque_nm":110,"voltage":"380V","ip":"IP68","brand":"ROTORK"}'::jsonb, 30,
    true, false, 0, 0, 1520000, 1240000, 60),

  ('DRV-GENEBRE-EL', 'Электропривод GENEBRE 5810 (временная подмена)',
    (select id from public.categories where name = 'Электроприводы'), 'component',
    (select id from public.units where code = 'sht'), null, null,
    '{"torque_nm":90,"voltage":"380V","ip":"IP67","brand":"GENEBRE"}'::jsonb, 22,
    true, false, 1, 2, 720000, 560000, 14),

  ('FLN-304-100', 'Фланец плоский Ду100 Ру16 AISI 304',
    (select id from public.categories where name = 'Фланцы'), 'component',
    (select id from public.units where code = 'sht'), '304', 'ГОСТ 33259-2015',
    '{"du":100,"ru":16}'::jsonb, 6.5,
    true, true, 20, 40, 42000, 33000, 10),

  ('FLN-316-150', 'Фланец плоский Ду150 Ру16 AISI 316',
    (select id from public.categories where name = 'Фланцы'), 'component',
    (select id from public.units where code = 'sht'), '316', 'ГОСТ 33259-2015',
    '{"du":150,"ru":16}'::jsonb, 11,
    true, true, 12, 24, 78000, 61000, 14),

  ('MTZ-M16-A4', 'Болт М16х70 А4 (нерж.)',
    (select id from public.categories where name = 'Метизы'), 'component',
    (select id from public.units where code = 'sht'), '316', 'DIN 933',
    '{"d":16,"l":70,"class":"A4"}'::jsonb, 0.14,
    true, false, 500, 1000, 1250, 890, 7),

  ('CBL-KVVG-4X1.5', 'Кабель КВВГ 4х1.5',
    (select id from public.categories where name = 'Кабель и электрика'), 'material',
    (select id from public.units where code = 'm'), null, 'ГОСТ 1508-78',
    '{"cores":4,"section":1.5}'::jsonb, 0.21,
    true, false, 200, 500, 1450, 1080, 10),

  ('SRV-WELD', 'Работы сварочные (нормо-час)',
    (select id from public.categories where name = 'Работы и услуги'), 'service',
    (select id from public.units where code = 'h'), null, null, '{}'::jsonb, null,
    false, false, 0, 0, 9500, 6000, 0),

  ('SRV-PAINT', 'Антикоррозийная обработка (м2)',
    (select id from public.categories where name = 'Работы и услуги'), 'service',
    (select id from public.units where code = 'm2'), null, null, '{}'::jsonb, null,
    false, false, 0, 0, 7800, 4500, 0),

  ('PRD-RVS-100', 'Резервуар вертикальный стальной РВС-100 м3',
    (select id from public.categories where name = 'Металлопрокат'), 'product',
    (select id from public.units where code = 'sht'), '09Г2С', 'ГОСТ 31385-2016',
    '{"volume_m3":100,"purpose":"обессоленная вода"}'::jsonb, null,
    false, false, 0, 0, 0, 0, 45)
on conflict (sku) do nothing;

-- Пересчёт «лист ↔ тонна» для металлопроката
insert into public.item_units (item_id, unit_id, factor)
select i.id, (select id from public.units where code = 't'), 1 / (i.weight_kg / 1000.0)
from public.items i
where i.sku in ('MET-304-2X1500','MET-316-3X1500','MET-09G2S-8') and i.weight_kg > 0
on conflict do nothing;

-- Аналоги электроприводов (главный кейс временной подмены)
insert into public.item_analogs (item_id, analog_item_id, compatibility, is_temporary_only, note)
select a.id, b.id, 3, false, 'Полная взаимозаменяемость по моменту и присоединению'
from public.items a, public.items b
where a.sku = 'DRV-AUMA-SA07' and b.sku = 'DRV-ROTORK-IQ10'
on conflict do nothing;

insert into public.item_analogs (item_id, analog_item_id, compatibility, is_temporary_only, note)
select a.id, b.id, 1, true, 'Только как ВРЕМЕННАЯ подмена: момент 90 Н·м вместо 100, IP67 вместо IP68'
from public.items a, public.items b
where a.sku = 'DRV-AUMA-SA07' and b.sku = 'DRV-GENEBRE-EL'
on conflict do nothing;

-- Аналоги по маркам стали (304 ↔ 316 с оговоркой)
insert into public.item_analogs (item_id, analog_item_id, compatibility, is_temporary_only, note)
select a.id, b.id, 2, false, 'AISI 316 дороже, но перекрывает требования по 304 (не наоборот)'
from public.items a, public.items b
where a.sku = 'ARM-ZD-304-100' and b.sku = 'ARM-ZD-316-100'
on conflict do nothing;


