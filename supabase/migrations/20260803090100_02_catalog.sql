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
