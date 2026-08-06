'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export async function advanceStage(fd: FormData) {
  const supabase = await createClient()
  const ref = String(fd.get('order_ref') ?? '').trim()
  const toStage = fd.get('to_stage') ? String(fd.get('to_stage')) : null

  const { data, error } = await supabase.rpc('rpc_advance_stage', {
    p_order_ref: ref,
    p_to_stage: toStage,
    p_comment: fd.get('comment') ? String(fd.get('comment')) : null,
  })

  revalidatePath('/production', 'layout')
  revalidatePath('/deals', 'layout')

  if (error) return { error: error.message }
  return { ok: true, result: data }
}

export async function issueMaterials(fd: FormData) {
  const supabase = await createClient()
  const orderId = String(fd.get('order_id'))

  const { error } = await supabase.rpc('rpc_issue_materials', { p_order_id: orderId })

  revalidatePath(`/production/${orderId}`)
  revalidatePath('/warehouse')
  if (error) return { error: error.message }
  return { ok: true }
}

export async function addQcCheck(fd: FormData) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const orderId = String(fd.get('order_id'))

  const { error } = await supabase.from('qc_checks').insert({
    production_order_id: orderId,
    check_type: String(fd.get('check_type') ?? 'visual'),
    result: String(fd.get('result') ?? 'pass'),
    defects: fd.get('defects') ? String(fd.get('defects')) : null,
    notes: fd.get('notes') ? String(fd.get('notes')) : null,
    checked_by: user?.id,
  })

  revalidatePath(`/production/${orderId}`)
  if (error) return { error: error.message }
  return { ok: true }
}

export async function updateProductionOrder(fd: FormData) {
  const supabase = await createClient()
  const orderId = String(fd.get('order_id'))

  const patch: Record<string, unknown> = {}
  if (fd.has('master_id')) patch.master_id = fd.get('master_id') || null
  if (fd.has('planned_start')) patch.planned_start = fd.get('planned_start') || null
  if (fd.has('planned_finish')) patch.planned_finish = fd.get('planned_finish') || null
  if (fd.has('priority')) patch.priority = Number(fd.get('priority'))
  if (fd.has('note')) patch.note = fd.get('note') || null
  if (fd.has('status')) patch.status = fd.get('status')

  const { error } = await supabase.from('production_orders').update(patch).eq('id', orderId)

  revalidatePath(`/production/${orderId}`)
  if (error) return { error: error.message }
  return { ok: true }
}

export async function createShipment(fd: FormData) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const orderId = String(fd.get('order_id'))
  const dealId = String(fd.get('deal_id'))

  const { data: shipment, error } = await supabase
    .from('shipments')
    .insert({
      number: '',
      deal_id: dealId,
      production_order_id: orderId,
      carrier: fd.get('carrier') ? String(fd.get('carrier')) : null,
      waybill_number: fd.get('waybill_number') ? String(fd.get('waybill_number')) : null,
      receiver: fd.get('receiver') ? String(fd.get('receiver')) : null,
      created_by: user?.id,
    })
    .select('id')
    .single()

  if (error) return { error: error.message }

  const { data: order } = await supabase
    .from('production_orders')
    .select('title, qty')
    .eq('id', orderId)
    .single()

  await supabase.from('shipment_items').insert({
    shipment_id: shipment!.id,
    name_snapshot: order?.title ?? 'Изделие',
    qty: order?.qty ?? 1,
  })

  await supabase.rpc('rpc_advance_stage', {
    p_order_ref: orderId,
    p_to_stage: 'shipped',
    p_comment: 'Отгружено клиенту',
  })

  await supabase.from('deals').update({ stage: 'shipment' }).eq('id', dealId)

  revalidatePath(`/production/${orderId}`)
  revalidatePath(`/deals/${dealId}`, 'layout')
  return { ok: true }
}
