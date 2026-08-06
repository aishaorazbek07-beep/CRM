import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

type Source = {
  from: string
  select: string
  dateField?: string
  order?: string
}

const SOURCES: Record<string, Source> = {
  deals: {
    from: 'v_deal_costing',
    select: '*',
    dateField: 'created_at',
    order: 'created_at',
  },
  specifications: {
    from: 'spec_items',
    select:
      'id, spec_id, line_no, section, name_snapshot, qty, cost_price, sale_price, cost_total, sale_total, source, lead_time_days, is_substitute, substitution_type, substitution_reason, created_at, spec:spec_id(version, deal_id, total_cost, total_sale, margin_percent)',
    dateField: 'created_at',
    order: 'created_at',
  },
  substitutions: {
    from: 'v_substitution_impact',
    select: '*',
    dateField: 'created_at',
    order: 'created_at',
  },
  stock: {
    from: 'v_deficit_overview',
    select: '*',
    order: 'name',
  },
  balances: {
    from: 'v_item_availability',
    select: '*',
    order: 'name',
  },
  purchases: {
    from: 'purchase_orders',
    select:
      '*, supplier:supplier_id(name, bin_iin), items:purchase_order_items(item_id, qty, price, qty_received, item:item_id(name, sku, steel_grade))',
    dateField: 'created_at',
    order: 'created_at',
  },
  production: {
    from: 'production_orders',
    select:
      '*, deal:deal_id(number, title), stages:production_stage_log(from_stage, to_stage, changed_at, duration_seconds)',
    dateField: 'created_at',
    order: 'created_at',
  },
  'stage-durations': {
    from: 'v_production_stage_stats',
    select: '*',
  },
  'deal-stage-durations': {
    from: 'v_deal_stage_stats',
    select: '*',
  },
  moves: {
    from: 'stock_moves',
    select:
      '*, item:item_id(name, sku, steel_grade), batch:batch_id(batch_number, heat_number, cert_number)',
    dateField: 'moved_at',
    order: 'moved_at',
  },
  counterparties: {
    from: 'counterparties',
    select: '*',
    dateField: 'created_at',
    order: 'name',
  },
  items: {
    from: 'items',
    select: '*',
    order: 'name',
  },
}

function toCsv(rows: Record<string, unknown>[]) {
  if (rows.length === 0) return ''
  const flat = rows.map((r) => {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(r)) {
      out[k] = v !== null && typeof v === 'object' ? JSON.stringify(v) : v
    }
    return out
  })
  const headers = Array.from(new Set(flat.flatMap((r) => Object.keys(r))))
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v)
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [
    headers.join(';'),
    ...flat.map((r) => headers.map((h) => esc(r[h])).join(';')),
  ].join('\n')
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ resource: string }> }
) {
  const { resource } = await params
  const url = new URL(request.url)

  const key = request.headers.get('x-api-key') ?? url.searchParams.get('key')
  const expected = process.env.CRM_API_KEY

  if (!expected) {
    return NextResponse.json({ error: 'CRM_API_KEY не настроен на сервере' }, { status: 500 })
  }
  if (key !== expected) {
    return NextResponse.json({ error: 'Неверный ключ доступа' }, { status: 401 })
  }

  const source = SOURCES[resource]
  if (!source) {
    return NextResponse.json(
      { error: 'Неизвестный ресурс', available: Object.keys(SOURCES) },
      { status: 404 }
    )
  }

  const supabase = createAdminClient()
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 5000), 50000)

  let query = supabase.from(source.from).select(source.select).limit(limit)

  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to')
  if (source.dateField && from) query = query.gte(source.dateField, from)
  if (source.dateField && to) query = query.lte(source.dateField, to)
  if (source.order) query = query.order(source.order, { ascending: false })

  const { data, error } = await query
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const format = (url.searchParams.get('format') ?? 'json').toLowerCase()

  if (format === 'csv') {
    const csv = toCsv((data ?? []) as unknown as Record<string, unknown>[])
    return new NextResponse('﻿' + csv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${resource}-${new Date()
          .toISOString()
          .slice(0, 10)}.csv"`,
      },
    })
  }

  return NextResponse.json({
    resource,
    generated_at: new Date().toISOString(),
    count: data?.length ?? 0,
    data,
  })
}
