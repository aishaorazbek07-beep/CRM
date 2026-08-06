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
function b(fd: FormData, k: string) {
  return fd.get(k) === 'on' || fd.get(k) === 'true'
}

function specFromForm(fd: FormData) {
  const raw = s(fd, 'spec_json')
  if (raw) {
    try {
      return JSON.parse(raw)
    } catch {
      return {}
    }
  }
  const spec: Record<string, unknown> = {}
  const du = s(fd, 'spec_du')
  const ru = s(fd, 'spec_ru')
  const th = s(fd, 'spec_thickness')
  if (du) spec.du = Number(du)
  if (ru) spec.ru = Number(ru)
  if (th) spec.thickness_mm = Number(th)
  return spec
}

export async function createItem(fd: FormData) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data, error } = await supabase
    .from('items')
    .insert({
      sku: s(fd, 'sku'),
      name: s(fd, 'name'),
      kind: s(fd, 'kind') ?? 'component',
      category_id: s(fd, 'category_id'),
      base_unit_id: s(fd, 'base_unit_id'),
      steel_grade: s(fd, 'steel_grade'),
      gost: s(fd, 'gost'),
      spec: specFromForm(fd),
      weight_kg: fd.get('weight_kg') ? n(fd, 'weight_kg') : null,
      is_stock_tracked: b(fd, 'is_stock_tracked'),
      requires_certificate: b(fd, 'requires_certificate'),
      min_stock: n(fd, 'min_stock'),
      reorder_qty: n(fd, 'reorder_qty'),
      default_price: n(fd, 'default_price'),
      last_purchase_price: n(fd, 'last_purchase_price'),
      lead_time_days: n(fd, 'lead_time_days'),
      note: s(fd, 'note'),
      created_by: user?.id,
    })
    .select('id')
    .single()

  if (error) return { error: error.message }

  revalidatePath('/catalog')
  redirect(`/catalog/${data!.id}`)
}

export async function updateItem(fd: FormData) {
  const supabase = await createClient()
  const id = String(fd.get('item_id'))

  const { error } = await supabase
    .from('items')
    .update({
      sku: s(fd, 'sku'),
      name: s(fd, 'name'),
      kind: s(fd, 'kind'),
      category_id: s(fd, 'category_id'),
      base_unit_id: s(fd, 'base_unit_id'),
      steel_grade: s(fd, 'steel_grade'),
      gost: s(fd, 'gost'),
      spec: specFromForm(fd),
      weight_kg: fd.get('weight_kg') ? n(fd, 'weight_kg') : null,
      is_stock_tracked: b(fd, 'is_stock_tracked'),
      requires_certificate: b(fd, 'requires_certificate'),
      min_stock: n(fd, 'min_stock'),
      reorder_qty: n(fd, 'reorder_qty'),
      default_price: n(fd, 'default_price'),
      lead_time_days: n(fd, 'lead_time_days'),
      is_active: b(fd, 'is_active'),
      note: s(fd, 'note'),
    })
    .eq('id', id)

  revalidatePath(`/catalog/${id}`)
  revalidatePath('/catalog')
  if (error) return { error: error.message }
  return { ok: true }
}

export async function addAnalog(fd: FormData) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const itemId = String(fd.get('item_id'))
  const analogId = s(fd, 'analog_item_id')
  if (!analogId) return { error: 'Выберите позицию-аналог' }
  if (analogId === itemId) return { error: 'Нельзя указать позицию аналогом самой себе' }

  const { error } = await supabase.from('item_analogs').insert({
    item_id: itemId,
    analog_item_id: analogId,
    compatibility: Number(fd.get('compatibility') ?? 3),
    is_temporary_only: b(fd, 'is_temporary_only'),
    note: s(fd, 'note'),
    created_by: user?.id,
  })

  revalidatePath(`/catalog/${itemId}`)
  if (error) return { error: error.message }
  return { ok: true }
}

export async function removeAnalog(fd: FormData) {
  const supabase = await createClient()
  const itemId = String(fd.get('item_id'))
  const { error } = await supabase.from('item_analogs').delete().eq('id', String(fd.get('analog_id')))
  revalidatePath(`/catalog/${itemId}`)
  if (error) return { error: error.message }
  return { ok: true }
}

export async function addSupplierPrice(fd: FormData) {
  const supabase = await createClient()
  const itemId = String(fd.get('item_id'))
  const supplierId = s(fd, 'supplier_id')
  if (!supplierId) return { error: 'Выберите поставщика' }

  const { error } = await supabase.from('item_suppliers').upsert(
    {
      item_id: itemId,
      supplier_id: supplierId,
      supplier_sku: s(fd, 'supplier_sku'),
      price: n(fd, 'price'),
      lead_time_days: n(fd, 'lead_time_days'),
      is_preferred: b(fd, 'is_preferred'),
      last_quoted_at: new Date().toISOString().slice(0, 10),
    },
    { onConflict: 'item_id,supplier_id' }
  )

  revalidatePath(`/catalog/${itemId}`)
  if (error) return { error: error.message }
  return { ok: true }
}
