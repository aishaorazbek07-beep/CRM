'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

function s(fd: FormData, k: string) {
  const v = fd.get(k)
  const t = v == null ? '' : String(v).trim()
  return t === '' ? null : t
}

export async function createCounterparty(fd: FormData) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data, error } = await supabase
    .from('counterparties')
    .insert({
      type: s(fd, 'type') ?? 'client',
      name: s(fd, 'name'),
      full_name: s(fd, 'full_name'),
      bin_iin: s(fd, 'bin_iin'),
      phone: s(fd, 'phone'),
      email: s(fd, 'email'),
      address: s(fd, 'address'),
      payment_terms: s(fd, 'payment_terms'),
      is_key_client: fd.get('is_key_client') === 'on',
      deferral_days: Number(fd.get('deferral_days') ?? 0),
      note: s(fd, 'note'),
      created_by: user?.id,
    })
    .select('id')
    .single()

  if (error) return { error: error.message }
  revalidatePath('/counterparties')
  redirect(`/counterparties/${data!.id}`)
}

export async function updateCounterparty(fd: FormData) {
  const supabase = await createClient()
  const id = String(fd.get('counterparty_id'))

  const { error } = await supabase
    .from('counterparties')
    .update({
      type: s(fd, 'type'),
      name: s(fd, 'name'),
      full_name: s(fd, 'full_name'),
      bin_iin: s(fd, 'bin_iin'),
      phone: s(fd, 'phone'),
      email: s(fd, 'email'),
      address: s(fd, 'address'),
      payment_terms: s(fd, 'payment_terms'),
      is_key_client: fd.get('is_key_client') === 'on',
      deferral_days: Number(fd.get('deferral_days') ?? 0),
      is_active: fd.get('is_active') === 'on',
      note: s(fd, 'note'),
    })
    .eq('id', id)

  revalidatePath(`/counterparties/${id}`)
  if (error) return { error: error.message }
  return { ok: true }
}

export async function addContact(fd: FormData) {
  const supabase = await createClient()
  const id = String(fd.get('counterparty_id'))

  const { error } = await supabase.from('contacts').insert({
    counterparty_id: id,
    full_name: s(fd, 'full_name'),
    position: s(fd, 'position'),
    phone: s(fd, 'phone'),
    whatsapp: s(fd, 'whatsapp'),
    email: s(fd, 'email'),
    note: s(fd, 'note'),
  })

  revalidatePath(`/counterparties/${id}`)
  if (error) return { error: error.message }
  return { ok: true }
}
