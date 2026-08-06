'use server'

import { revalidatePath } from 'next/cache'
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

/** Ручной приход на склад с созданием партии и привязкой сертификата плавки */
export async function receiveStock(fd: FormData) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const itemId = s(fd, 'item_id')
  if (!itemId) return { error: 'Выберите позицию номенклатуры' }

  const qty = n(fd, 'qty')
  if (qty <= 0) return { error: 'Количество должно быть больше нуля' }

  const { data: item } = await supabase
    .from('items')
    .select('name, requires_certificate')
    .eq('id', itemId)
    .single()

  const certNumber = s(fd, 'cert_number')
  if (item?.requires_certificate && !certNumber) {
    return { error: `Для «${item.name}» обязателен сертификат качества (номер)` }
  }

  const { data: batch, error: bErr } = await supabase
    .from('batches')
    .insert({
      item_id: itemId,
      batch_number: s(fd, 'batch_number') ?? `IN-${Date.now()}`,
      heat_number: s(fd, 'heat_number'),
      supplier_id: s(fd, 'supplier_id'),
      qty_received: qty,
      unit_cost: n(fd, 'unit_cost'),
      cert_number: certNumber,
      cert_issued_at: s(fd, 'cert_issued_at'),
      received_at: s(fd, 'received_at') ?? new Date().toISOString().slice(0, 10),
      note: s(fd, 'note'),
      created_by: user?.id,
    })
    .select('id')
    .single()

  if (bErr) return { error: bErr.message }

  const { error } = await supabase.from('stock_moves').insert({
    move_type: 'receipt',
    item_id: itemId,
    batch_id: batch!.id,
    warehouse_to: s(fd, 'warehouse_id'),
    qty,
    unit_cost: n(fd, 'unit_cost'),
    doc_ref: s(fd, 'doc_ref'),
    created_by: user?.id,
  })

  if (error) return { error: error.message }

  revalidatePath('/warehouse', 'layout')
  revalidatePath('/procurement')
  return { ok: true }
}

export async function moveStock(fd: FormData) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const type = String(fd.get('move_type') ?? 'transfer')
  const payload: Record<string, unknown> = {
    move_type: type,
    item_id: s(fd, 'item_id'),
    batch_id: s(fd, 'batch_id'),
    qty: n(fd, 'qty'),
    unit_cost: n(fd, 'unit_cost'),
    note: s(fd, 'note'),
    created_by: user?.id,
  }

  if (type === 'transfer' || type === 'return') {
    payload.warehouse_from = s(fd, 'warehouse_from')
    payload.warehouse_to = s(fd, 'warehouse_to')
  } else if (type === 'writeoff' || type === 'shipment' || type === 'issue') {
    payload.warehouse_from = s(fd, 'warehouse_from')
  } else {
    payload.warehouse_to = s(fd, 'warehouse_to')
  }

  if (!payload.item_id) return { error: 'Выберите позицию' }
  if (Number(payload.qty) <= 0) return { error: 'Количество должно быть больше нуля' }

  const { error } = await supabase.from('stock_moves').insert(payload)
  if (error) return { error: error.message }

  revalidatePath('/warehouse', 'layout')
  return { ok: true }
}

export async function updateItemStockSettings(fd: FormData) {
  const supabase = await createClient()
  const { error } = await supabase
    .from('items')
    .update({
      min_stock: n(fd, 'min_stock'),
      reorder_qty: n(fd, 'reorder_qty'),
    })
    .eq('id', String(fd.get('item_id')))

  revalidatePath('/warehouse')
  revalidatePath('/catalog')
  if (error) return { error: error.message }
  return { ok: true }
}
