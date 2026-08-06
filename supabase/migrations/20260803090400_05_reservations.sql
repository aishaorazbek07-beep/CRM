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
