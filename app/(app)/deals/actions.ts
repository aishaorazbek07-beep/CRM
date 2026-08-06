'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

function str(fd: FormData, key: string) {
  const v = fd.get(key)
  const s = v == null ? '' : String(v).trim()
  return s === '' ? null : s
}
function numOf(fd: FormData, key: string, def = 0) {
  const v = Number(String(fd.get(key) ?? '').replace(',', '.'))
  return Number.isFinite(v) ? v : def
}

/* ------------------------------ Сделка ------------------------------ */

export async function createDeal(fd: FormData) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data, error } = await supabase
    .from('deals')
    .insert({
      title: str(fd, 'title'),
      counterparty_id: str(fd, 'counterparty_id'),
      contact_id: str(fd, 'contact_id'),
      source: str(fd, 'source') ?? 'call',
      tz_text: str(fd, 'tz_text'),
      required_ship_date: str(fd, 'required_ship_date'),
      expected_close_date: str(fd, 'expected_close_date'),
      manager_id: user?.id,
      created_by: user?.id,
      number: '',
    })
    .select('id')
    .single()

  if (error) redirect(`/deals/new?error=${encodeURIComponent(error.message)}`)

  // сразу создаём пустую спецификацию v1
  const { data: settings } = await supabase.from('settings').select('*').single()
  await supabase.from('specifications').insert({
    deal_id: data!.id,
    version: 1,
    is_current: true,
    markup_percent: settings?.default_markup_percent ?? 20,
    vat_percent: settings?.vat_percent ?? 12,
    created_by: user?.id,
  })

  revalidatePath('/deals')
  redirect(`/deals/${data!.id}`)
}

export async function updateDeal(fd: FormData) {
  const supabase = await createClient()
  const id = String(fd.get('deal_id'))

  const patch: Record<string, unknown> = {}
  for (const key of [
    'title',
    'stage',
    'status',
    'source',
    'tz_text',
    'contract_number',
    'contract_signed_at',
    'required_ship_date',
    'expected_close_date',
    'lost_reason',
    'manager_id',
    'contact_id',
  ]) {
    if (fd.has(key)) patch[key] = str(fd, key)
  }
  if (fd.has('probability')) patch.probability = numOf(fd, 'probability', 50)
  if (patch.status === 'won' || patch.status === 'lost') patch.closed_at = new Date().toISOString()

  const { error } = await supabase.from('deals').update(patch).eq('id', id)
  if (error) return { error: error.message }

  revalidatePath(`/deals/${id}`, 'layout')
  revalidatePath('/deals')
  return { ok: true }
}

/* Обёртки для нативных <form action={...}> — они требуют возврата void */
export async function updateDealForm(fd: FormData): Promise<void> {
  await updateDeal(fd)
}
export async function updateSpecItemForm(fd: FormData): Promise<void> {
  await updateSpecItem(fd)
}
export async function deleteSpecItemForm(fd: FormData): Promise<void> {
  await deleteSpecItem(fd)
}
export async function revertSubstitutionForm(fd: FormData): Promise<void> {
  await revertSubstitution(fd)
}

export async function addPayment(fd: FormData) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const dealId = String(fd.get('deal_id'))

  const { error } = await supabase.from('deal_payments').insert({
    deal_id: dealId,
    kind: str(fd, 'kind') ?? 'prepayment',
    amount: numOf(fd, 'amount'),
    paid_at: str(fd, 'paid_at') ?? new Date().toISOString().slice(0, 10),
    doc_ref: str(fd, 'doc_ref'),
    note: str(fd, 'note'),
    created_by: user?.id,
  })

  if (error) return { error: error.message }
  revalidatePath(`/deals/${dealId}`, 'layout')
  return { ok: true }
}

export async function addExpense(fd: FormData) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const dealId = String(fd.get('deal_id'))

  const { error } = await supabase.from('deal_expenses').insert({
    deal_id: dealId,
    category: str(fd, 'category') ?? 'other',
    title: str(fd, 'title'),
    amount: numOf(fd, 'amount'),
    spent_at: str(fd, 'spent_at') ?? new Date().toISOString().slice(0, 10),
    note: str(fd, 'note'),
    created_by: user?.id,
  })

  if (error) return { error: error.message }
  revalidatePath(`/deals/${dealId}/costing`)
  return { ok: true }
}

/* --------------------------- Спецификация --------------------------- */

export async function addSpecItem(fd: FormData) {
  const supabase = await createClient()
  const dealId = String(fd.get('deal_id'))
  const specId = String(fd.get('spec_id'))
  const itemId = str(fd, 'item_id')

  let name = str(fd, 'name_snapshot')
  let unitId = str(fd, 'unit_id')
  let cost = numOf(fd, 'cost_price')
  let sale = numOf(fd, 'sale_price')
  let lead = numOf(fd, 'lead_time_days')

  if (itemId) {
    const { data: item } = await supabase
      .from('items')
      .select('name, base_unit_id, last_purchase_price, avg_cost, default_price, lead_time_days')
      .eq('id', itemId)
      .single()
    if (item) {
      name = name ?? item.name
      unitId = unitId ?? item.base_unit_id
      if (!cost) cost = Number(item.avg_cost) || Number(item.last_purchase_price) || 0
      if (!sale) {
        const { data: spec } = await supabase
          .from('specifications')
          .select('markup_percent')
          .eq('id', specId)
          .single()
        const markup = Number(spec?.markup_percent ?? 20)
        sale = Number(item.default_price) || Math.round(cost * (1 + markup / 100))
      }
      if (!lead) lead = Number(item.lead_time_days) || 0
    }
  }

  const { data: last } = await supabase
    .from('spec_items')
    .select('line_no')
    .eq('spec_id', specId)
    .order('line_no', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { error } = await supabase.from('spec_items').insert({
    spec_id: specId,
    line_no: (last?.line_no ?? 0) + 1,
    section: str(fd, 'section') ?? 'Материалы',
    item_id: itemId,
    name_snapshot: name ?? 'Позиция',
    unit_id: unitId,
    qty: numOf(fd, 'qty', 1) || 1,
    cost_price: cost,
    sale_price: sale,
    source: str(fd, 'source') ?? 'purchase',
    lead_time_days: lead,
    note: str(fd, 'note'),
  })

  if (error) return { error: error.message }
  revalidatePath(`/deals/${dealId}/spec`)
  return { ok: true }
}

export async function updateSpecItem(fd: FormData) {
  const supabase = await createClient()
  const dealId = String(fd.get('deal_id'))
  const id = String(fd.get('spec_item_id'))

  const patch: Record<string, unknown> = {}
  if (fd.has('qty')) patch.qty = numOf(fd, 'qty', 1) || 1
  if (fd.has('cost_price')) patch.cost_price = numOf(fd, 'cost_price')
  if (fd.has('sale_price')) patch.sale_price = numOf(fd, 'sale_price')
  if (fd.has('lead_time_days')) patch.lead_time_days = numOf(fd, 'lead_time_days')
  if (fd.has('source')) patch.source = str(fd, 'source')
  if (fd.has('section')) patch.section = str(fd, 'section')
  if (fd.has('name_snapshot')) patch.name_snapshot = str(fd, 'name_snapshot')
  if (fd.has('note')) patch.note = str(fd, 'note')

  const { error } = await supabase.from('spec_items').update(patch).eq('id', id)
  if (error) return { error: error.message }
  revalidatePath(`/deals/${dealId}/spec`)
  return { ok: true }
}

export async function deleteSpecItem(fd: FormData) {
  const supabase = await createClient()
  const dealId = String(fd.get('deal_id'))
  const { error } = await supabase.from('spec_items').delete().eq('id', String(fd.get('spec_item_id')))
  if (error) return { error: error.message }
  revalidatePath(`/deals/${dealId}/spec`)
  return { ok: true }
}

export async function updateSpecHeader(fd: FormData) {
  const supabase = await createClient()
  const dealId = String(fd.get('deal_id'))
  const specId = String(fd.get('spec_id'))

  const patch: Record<string, unknown> = {}
  if (fd.has('name')) patch.name = str(fd, 'name')
  if (fd.has('discount_percent')) patch.discount_percent = numOf(fd, 'discount_percent')
  if (fd.has('vat_percent')) patch.vat_percent = numOf(fd, 'vat_percent')
  if (fd.has('markup_percent')) patch.markup_percent = numOf(fd, 'markup_percent')
  if (fd.has('note')) patch.note = str(fd, 'note')

  const { error } = await supabase.from('specifications').update(patch).eq('id', specId)
  if (error) return { error: error.message }
  revalidatePath(`/deals/${dealId}/spec`)
  return { ok: true }
}

/** Замена позиции на аналог с пересчётом сметы и фиксацией в журнале */
export async function substituteSpecItem(fd: FormData) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const dealId = String(fd.get('deal_id'))
  const specItemId = String(fd.get('spec_item_id'))
  const newItemId = String(fd.get('new_item_id'))
  const type = (str(fd, 'substitution_type') ?? 'temporary') as 'temporary' | 'permanent'

  const { data: line } = await supabase
    .from('spec_items')
    .select('*, items:item_id(name)')
    .eq('id', specItemId)
    .single()
  if (!line) return { error: 'Строка спецификации не найдена' }

  const { data: newItem } = await supabase
    .from('items')
    .select('id, name, base_unit_id, avg_cost, last_purchase_price, default_price, lead_time_days')
    .eq('id', newItemId)
    .single()
  if (!newItem) return { error: 'Позиция-аналог не найдена' }

  const newCost =
    numOf(fd, 'cost_price') || Number(newItem.avg_cost) || Number(newItem.last_purchase_price) || 0
  const newSale = numOf(fd, 'sale_price') || Number(newItem.default_price) || newCost * 1.2
  const newLead = Number(newItem.lead_time_days) || 0
  const qty = Number(line.qty)

  const { error: subErr } = await supabase.from('spec_substitutions').insert({
    spec_item_id: specItemId,
    deal_id: dealId,
    from_item_id: line.item_id,
    to_item_id: newItemId,
    from_name: line.name_snapshot,
    to_name: newItem.name,
    from_price: line.cost_price,
    to_price: newCost,
    qty,
    cost_delta: Math.round((newCost - Number(line.cost_price)) * qty * 100) / 100,
    lead_time_delta: newLead - Number(line.lead_time_days),
    substitution_type: type,
    reason: str(fd, 'reason'),
    return_date: str(fd, 'return_date'),
    created_by: user?.id,
  })
  if (subErr) return { error: subErr.message }

  const { error } = await supabase
    .from('spec_items')
    .update({
      item_id: newItemId,
      name_snapshot: newItem.name,
      unit_id: newItem.base_unit_id,
      cost_price: newCost,
      sale_price: newSale,
      lead_time_days: newLead,
      is_substitute: true,
      original_item_id: line.original_item_id ?? line.item_id,
      substitution_type: type,
      substitution_reason: str(fd, 'reason'),
      substitution_return_date: str(fd, 'return_date'),
    })
    .eq('id', specItemId)

  if (error) return { error: error.message }

  revalidatePath(`/deals/${dealId}/spec`)
  revalidatePath(`/deals/${dealId}/costing`)
  return { ok: true }
}

/** Вернуть штатную позицию вместо временной подмены */
export async function revertSubstitution(fd: FormData) {
  const supabase = await createClient()
  const dealId = String(fd.get('deal_id'))
  const specItemId = String(fd.get('spec_item_id'))

  const { data: line } = await supabase.from('spec_items').select('*').eq('id', specItemId).single()
  if (!line?.original_item_id) return { error: 'Нет исходной позиции для возврата' }

  const fd2 = new FormData()
  fd2.set('deal_id', dealId)
  fd2.set('spec_item_id', specItemId)
  fd2.set('new_item_id', line.original_item_id)
  fd2.set('substitution_type', 'permanent')
  fd2.set('reason', 'Возврат штатной позиции')
  const res = await substituteSpecItem(fd2)
  if (res?.error) return res

  await supabase
    .from('spec_items')
    .update({
      is_substitute: false,
      original_item_id: null,
      substitution_type: null,
      substitution_reason: null,
      substitution_return_date: null,
    })
    .eq('id', specItemId)

  revalidatePath(`/deals/${dealId}/spec`)
  return { ok: true }
}

export async function newSpecVersion(fd: FormData) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const dealId = String(fd.get('deal_id'))
  const specId = String(fd.get('spec_id'))

  const { data: src } = await supabase.from('specifications').select('*').eq('id', specId).single()
  if (!src) return { error: 'Спецификация не найдена' }

  const { data: maxV } = await supabase
    .from('specifications')
    .select('version')
    .eq('deal_id', dealId)
    .order('version', { ascending: false })
    .limit(1)
    .single()

  await supabase.from('specifications').update({ is_current: false }).eq('id', specId)

  const { data: created, error } = await supabase
    .from('specifications')
    .insert({
      deal_id: dealId,
      version: (maxV?.version ?? 1) + 1,
      name: src.name,
      is_current: true,
      markup_percent: src.markup_percent,
      discount_percent: src.discount_percent,
      vat_percent: src.vat_percent,
      created_by: user?.id,
    })
    .select('id')
    .single()

  if (error) return { error: error.message }

  const { data: lines } = await supabase.from('spec_items').select('*').eq('spec_id', specId)
  if (lines?.length) {
    await supabase.from('spec_items').insert(
      lines.map((l: any) => ({
        spec_id: created!.id,
        line_no: l.line_no,
        section: l.section,
        item_id: l.item_id,
        name_snapshot: l.name_snapshot,
        unit_id: l.unit_id,
        qty: l.qty,
        cost_price: l.cost_price,
        sale_price: l.sale_price,
        source: l.source,
        lead_time_days: l.lead_time_days,
        is_substitute: l.is_substitute,
        original_item_id: l.original_item_id,
        substitution_type: l.substitution_type,
        substitution_reason: l.substitution_reason,
        note: l.note,
      }))
    )
  }

  revalidatePath(`/deals/${dealId}/spec`)
  return { ok: true }
}

export async function approveSpec(fd: FormData) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const dealId = String(fd.get('deal_id'))

  const { error } = await supabase
    .from('specifications')
    .update({ status: 'approved', approved_by: user?.id, approved_at: new Date().toISOString() })
    .eq('id', String(fd.get('spec_id')))

  if (error) return { error: error.message }
  revalidatePath(`/deals/${dealId}/spec`)
  return { ok: true }
}

/* ------------------------------- КП ------------------------------- */

export async function createQuote(fd: FormData) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const dealId = String(fd.get('deal_id'))

  const { data: spec } = await supabase
    .from('specifications')
    .select('id')
    .eq('deal_id', dealId)
    .eq('is_current', true)
    .single()
  if (!spec) return { error: 'Нет текущей спецификации' }

  const { data: prev } = await supabase
    .from('quotes')
    .select('version')
    .eq('deal_id', dealId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data, error } = await supabase
    .from('quotes')
    .insert({
      deal_id: dealId,
      spec_id: spec.id,
      version: (prev?.version ?? 0) + 1,
      number: '',
      payment_terms: str(fd, 'payment_terms') ?? undefined,
      delivery_terms: str(fd, 'delivery_terms') ?? undefined,
      intro_text: str(fd, 'intro_text'),
      created_by: user?.id,
    })
    .select('id')
    .single()

  if (error) return { error: error.message }

  await supabase.from('deals').update({ stage: 'approval' }).eq('id', dealId).lt('stage', 'approval')

  revalidatePath(`/deals/${dealId}/quote`)
  redirect(`/deals/${dealId}/quote/${data!.id}`)
}

export async function setQuoteStatus(fd: FormData) {
  const supabase = await createClient()
  const dealId = String(fd.get('deal_id'))
  const status = String(fd.get('status'))

  const patch: Record<string, unknown> = { status }
  if (status === 'sent') patch.sent_at = new Date().toISOString()
  if (status === 'accepted' || status === 'rejected') patch.decided_at = new Date().toISOString()

  const { error } = await supabase.from('quotes').update(patch).eq('id', String(fd.get('quote_id')))
  if (error) return { error: error.message }

  if (status === 'accepted') {
    await supabase.from('deals').update({ stage: 'contract' }).eq('id', dealId)
  }

  revalidatePath(`/deals/${dealId}/quote`, 'layout')
  return { ok: true }
}

/* --------------------- Резервы / дефицит / цех --------------------- */

export async function reserveDeal(fd: FormData) {
  const supabase = await createClient()
  const dealId = String(fd.get('deal_id'))
  const kind = String(fd.get('kind') ?? 'soft')

  const { data, error } = await supabase.rpc('rpc_reserve_deal', {
    p_deal_id: dealId,
    p_kind: kind,
  })

  revalidatePath(`/deals/${dealId}/supply`)
  revalidatePath('/warehouse')
  if (error) return { error: error.message }
  return { ok: true, result: data }
}

export async function buildDeficit(fd: FormData) {
  const supabase = await createClient()
  const dealId = String(fd.get('deal_id'))

  const { data, error } = await supabase.rpc('rpc_build_deficit', {
    p_deal_id: dealId,
    p_required_by: fd.get('required_by') ? String(fd.get('required_by')) : null,
  })

  revalidatePath(`/deals/${dealId}/supply`)
  revalidatePath('/procurement')
  if (error) return { error: error.message }

  await supabase.from('deals').update({ stage: 'supply' }).eq('id', dealId).lt('stage', 'supply')
  return { ok: true, result: data }
}

export async function requestReservationRelease(fd: FormData) {
  const supabase = await createClient()
  const dealId = String(fd.get('deal_id'))

  const { error } = await supabase.rpc('rpc_request_release', {
    p_reservation_id: String(fd.get('reservation_id')),
    p_reason: String(fd.get('reason') ?? ''),
    p_target_deal_id: fd.get('target_deal_id') ? String(fd.get('target_deal_id')) : null,
  })

  revalidatePath(`/deals/${dealId}/supply`)
  if (error) return { error: error.message }
  return { ok: true }
}

export async function releaseSoftReservation(fd: FormData) {
  const supabase = await createClient()
  const dealId = String(fd.get('deal_id'))
  const { error } = await supabase
    .from('reservations')
    .update({ status: 'released', released_at: new Date().toISOString() })
    .eq('id', String(fd.get('reservation_id')))
    .eq('kind', 'soft')

  revalidatePath(`/deals/${dealId}/supply`)
  if (error) return { error: error.message }
  return { ok: true }
}

export async function createProductionOrder(fd: FormData) {
  const supabase = await createClient()
  const dealId = String(fd.get('deal_id'))

  const { data, error } = await supabase.rpc('rpc_create_production_order', {
    p_deal_id: dealId,
    p_title: fd.get('title') ? String(fd.get('title')) : null,
    p_planned_finish: fd.get('planned_finish') ? String(fd.get('planned_finish')) : null,
  })

  revalidatePath(`/deals/${dealId}/production`)
  revalidatePath('/production')
  if (error) return { error: error.message }
  return { ok: true, id: data }
}
