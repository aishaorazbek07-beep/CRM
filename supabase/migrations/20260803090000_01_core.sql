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
