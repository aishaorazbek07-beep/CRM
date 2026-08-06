'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

function s(fd: FormData, k: string) {
  const v = fd.get(k)
  const t = v == null ? '' : String(v).trim()
  return t === '' ? null : t
}
function n(fd: FormData, k: string, def = 0) {
  const v = Number(String(fd.get(k) ?? '').replace(',', '.'))
  return Number.isFinite(v) ? v : def
}

/** Создать заказ поставщику из заявки (все незаказанные позиции) */
export async function createOrderFromRequest(fd: FormData) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const requestId = String(fd.get('request_id'))
  const supplierId = s(fd, 'supplier_id')
  if (!supplierId) return { error: 'Выберите поставщика' }

  const { data: request } = await supabase
    .from('purchase_requests')
    .select('*, items:purchase_request_items(*)')
    .eq('id', requestId)
    .single()
  if (!request) return { error: 'Заявка не найдена' }

  const lines = (request.items ?? []).filter((i: any) => Number(i.qty) - Number(i.qty_ordered) > 0.001)
  if (lines.length === 0) return { error: 'Все позиции заявки уже заказаны' }

  const { data: order, error } = await supabase
    .from('purchase_orders')
    .insert({
      number: '',
      supplier_id: supplierId,
      request_id: requestId,
      deal_id: request.deal_id,
      status: 'draft',
      eta_date: s(fd, 'eta_date'),
      note: s(fd, 'note'),
      created_by: user?.id,
    })
    .select('id')
    .single()

  if (error) return { error: error.message }

  const { data: prices } = await supabase
    .from('item_suppliers')
    .select('item_id, price')
    .eq('supplier_id', supplierId)
    .in(
      'item_id',
      lines.map((l: any) => l.item_id)
    )
  const priceMap = new Map((prices ?? []).map((p: any) => [p.item_id, Number(p.price)]))

  await supabase.from('purchase_order_items').insert(
    lines.map((l: any) => ({
      order_id: order!.id,
      item_id: l.item_id,
      request_item_id: l.id,
      qty: Number(l.qty) - Number(l.qty_ordered),
      price: priceMap.get(l.item_id) ?? Number(l.target_price) ?? 0,
    }))
  )

  for (const l of lines) {
    await supabase
      .from('purchase_request_items')
      .update({ qty_ordered: Number(l.qty) })
      .eq('id', l.id)
  }

  await supabase.from('purchase_requests').update({ status: 'ordered' }).eq('id', requestId)

  revalidatePath('/procurement', 'layout')
  redirect(`/procurement/orders/${order!.id}`)
}

export async function setPoStatus(fd: FormData) {
  const supabase = await createClient()
  const orderId = String(fd.get('order_id'))

  const patch: Record<string, unknown> = { status: String(fd.get('status')) }
  if (fd.get('eta_date')) patch.eta_date = String(fd.get('eta_date'))

  const { error } = await supabase.from('purchase_orders').update(patch).eq('id', orderId)

  revalidatePath('/procurement', 'layout')
  if (error) return { error: error.message }
  return { ok: true }
}

export async function updatePurchaseOrder(fd: FormData) {
  const supabase = await createClient()
  const orderId = String(fd.get('order_id'))

  const { error } = await supabase
    .from('purchase_orders')
    .update({
      eta_date: s(fd, 'eta_date'),
      invoice_number: s(fd, 'invoice_number'),
      tracking_info: s(fd, 'tracking_info'),
      note: s(fd, 'note'),
    })
    .eq('id', orderId)

  revalidatePath(`/procurement/orders/${orderId}`)
  if (error) return { error: error.message }
  return { ok: true }
}

export async function addPoItem(fd: FormData) {
  const supabase = await createClient()
  const orderId = String(fd.get('order_id'))
  const itemId = s(fd, 'item_id')
  if (!itemId) return { error: 'Выберите позицию' }

  const { error } = await supabase.from('purchase_order_items').insert({
    order_id: orderId,
    item_id: itemId,
    qty: n(fd, 'qty', 1),
    price: n(fd, 'price'),
    note: s(fd, 'note'),
  })

  revalidatePath(`/procurement/orders/${orderId}`)
  if (error) return { error: error.message }
  return { ok: true }
}

export async function updatePoItem(fd: FormData) {
  const supabase = await createClient()
  const orderId = String(fd.get('order_id'))

  const { error } = await supabase
    .from('purchase_order_items')
    .update({ qty: n(fd, 'qty', 1), price: n(fd, 'price') })
    .eq('id', String(fd.get('po_item_id')))

  revalidatePath(`/procurement/orders/${orderId}`)
  if (error) return { error: error.message }
  return { ok: true }
}

/** Обёртка для нативного <form action> (требует возврата void) */
export async function updatePoItemForm(fd: FormData): Promise<void> {
  await updatePoItem(fd)
}

export async function deletePoItem(fd: FormData) {
  const supabase = await createClient()
  const orderId = String(fd.get('order_id'))
  const { error } = await supabase
    .from('purchase_order_items')
    .delete()
    .eq('id', String(fd.get('po_item_id')))

  revalidatePath(`/procurement/orders/${orderId}`)
  if (error) return { error: error.message }
  return { ok: true }
}

/** Приёмка позиции заказа на склад: партия + приход + сертификат */
export async function receivePoItem(fd: FormData) {
  const supabase = await createClient()
  const orderId = String(fd.get('order_id'))

  const { error } = await supabase.rpc('rpc_receive_po_item', {
    p_po_item_id: String(fd.get('po_item_id')),
    p_qty: n(fd, 'qty'),
    p_warehouse_id: String(fd.get('warehouse_id')),
    p_batch_number: s(fd, 'batch_number'),
    p_heat_number: s(fd, 'heat_number'),
    p_unit_cost: fd.get('unit_cost') ? n(fd, 'unit_cost') : null,
    p_cert_number: s(fd, 'cert_number'),
    p_cert_issued_at: s(fd, 'cert_issued_at'),
  })

  revalidatePath(`/procurement/orders/${orderId}`)
  revalidatePath('/warehouse', 'layout')
  if (error) return { error: error.message }
  return { ok: true }
}

export async function createManualRequest(fd: FormData) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data, error } = await supabase
    .from('purchase_requests')
    .insert({
      number: '',
      deal_id: s(fd, 'deal_id'),
      required_by: s(fd, 'required_by'),
      note: s(fd, 'note'),
      priority: Number(fd.get('priority') ?? 2),
      created_by: user?.id,
    })
    .select('id')
    .single()

  if (error) return { error: error.message }

  const itemId = s(fd, 'item_id')
  if (itemId) {
    await supabase.from('purchase_request_items').insert({
      request_id: data!.id,
      item_id: itemId,
      qty: n(fd, 'qty', 1),
      required_by: s(fd, 'required_by'),
    })
  }

  revalidatePath('/procurement')
  redirect(`/procurement/requests/${data!.id}`)
}

export async function addRequestItem(fd: FormData) {
  const supabase = await createClient()
  const requestId = String(fd.get('request_id'))
  const itemId = s(fd, 'item_id')
  if (!itemId) return { error: 'Выберите позицию' }

  const { error } = await supabase.from('purchase_request_items').insert({
    request_id: requestId,
    item_id: itemId,
    qty: n(fd, 'qty', 1),
    required_by: s(fd, 'required_by'),
    note: s(fd, 'note'),
  })

  revalidatePath(`/procurement/requests/${requestId}`)
  if (error) return { error: error.message }
  return { ok: true }
}

export async function closeTask(fd: FormData) {
  const supabase = await createClient()
  const { error } = await supabase
    .from('tasks')
    .update({ status: 'done', closed_at: new Date().toISOString() })
    .eq('id', String(fd.get('task_id')))

  revalidatePath('/procurement')
  revalidatePath('/tasks')
  if (error) return { error: error.message }
  return { ok: true }
}
