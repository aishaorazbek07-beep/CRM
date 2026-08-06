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
