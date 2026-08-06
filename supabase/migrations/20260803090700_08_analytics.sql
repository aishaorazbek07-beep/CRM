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
