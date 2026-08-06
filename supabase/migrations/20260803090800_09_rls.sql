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
