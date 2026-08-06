'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth'

function s(fd: FormData, k: string) {
  const v = fd.get(k)
  const t = v == null ? '' : String(v).trim()
  return t === '' ? null : t
}

export async function updateSettings(fd: FormData) {
  await requireRole('director')
  const supabase = await createClient()

  const { error } = await supabase
    .from('settings')
    .update({
      company_name: s(fd, 'company_name'),
      company_bin: s(fd, 'company_bin'),
      company_address: s(fd, 'company_address'),
      company_phone: s(fd, 'company_phone'),
      company_email: s(fd, 'company_email'),
      bank_details: s(fd, 'bank_details'),
      currency: s(fd, 'currency') ?? 'KZT',
      vat_percent: Number(fd.get('vat_percent') ?? 12),
      default_markup_percent: Number(fd.get('default_markup_percent') ?? 20),
      quote_valid_days: Number(fd.get('quote_valid_days') ?? 14),
      updated_at: new Date().toISOString(),
    })
    .eq('id', true)

  revalidatePath('/settings')
  if (error) return { error: error.message }
  return { ok: true }
}

export async function createUser(fd: FormData) {
  await requireRole('director')

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { error: 'Не задан SUPABASE_SERVICE_ROLE_KEY — создание пользователей недоступно' }
  }

  const email = String(fd.get('email') ?? '').trim()
  const password = String(fd.get('password') ?? '')
  const fullName = String(fd.get('full_name') ?? '').trim()
  const role = String(fd.get('role') ?? 'sales')

  if (password.length < 8) return { error: 'Пароль должен быть не короче 8 символов' }

  const admin = createAdminClient()
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, role },
  })

  if (error) return { error: error.message }

  // Профиль создаётся триггером; на всякий случай синхронизируем роль и имя
  await admin
    .from('profiles')
    .update({ full_name: fullName, role, position: s(fd, 'position') })
    .eq('id', data.user!.id)

  revalidatePath('/settings')
  return { ok: true }
}

export async function updateUser(fd: FormData) {
  await requireRole('director')
  const supabase = await createClient()

  const { error } = await supabase
    .from('profiles')
    .update({
      full_name: s(fd, 'full_name'),
      role: s(fd, 'role'),
      position: s(fd, 'position'),
      phone: s(fd, 'phone'),
      is_active: fd.get('is_active') === 'on',
    })
    .eq('id', String(fd.get('user_id')))

  revalidatePath('/settings')
  if (error) return { error: error.message }
  return { ok: true }
}

export async function createWarehouse(fd: FormData) {
  await requireRole('director')
  const supabase = await createClient()

  const { error } = await supabase.from('warehouses').insert({
    code: String(fd.get('code') ?? '').toUpperCase(),
    name: String(fd.get('name')),
    kind: String(fd.get('kind') ?? 'material'),
    address: s(fd, 'address'),
    sort_order: Number(fd.get('sort_order') ?? 100),
  })

  revalidatePath('/settings')
  if (error) return { error: error.message }
  return { ok: true }
}
