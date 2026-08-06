'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export async function signIn(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim()
  const password = String(formData.get('password') ?? '')
  const next = String(formData.get('next') ?? '/')

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    redirect(
      `/login?error=${encodeURIComponent(
        'Не заданы переменные окружения NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY'
      )}`
    )
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    // Разделяем «действительно неверный пароль» и технические сбои,
    // иначе любая ошибка сервера выглядит как ошибка пользователя.
    const wrongCredentials =
      error.status === 400 || /invalid login credentials/i.test(error.message)

    const message = wrongCredentials
      ? 'Неверный e-mail или пароль'
      : `Сбой входа (${error.status ?? '—'}): ${error.message}`

    redirect(`/login?error=${encodeURIComponent(message)}`)
  }

  revalidatePath('/', 'layout')
  redirect(next || '/')
}

export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  revalidatePath('/', 'layout')
  redirect('/login')
}
