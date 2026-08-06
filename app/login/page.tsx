import { Alert, Button, Field, Input } from '@/components/ui'
import { signIn } from './actions'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>
}) {
  const sp = await searchParams

  return (
    <main className="flex min-h-screen items-center justify-center bg-ink-100 px-4 dark:bg-[#0e1116]">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-steel-600 text-lg font-bold text-white">
            CRM
          </div>
          <h1 className="text-xl font-semibold">Единая база</h1>
          <p className="mt-1 text-sm text-ink-500">Продажи · Склад · Производство</p>
        </div>

        <form
          action={signIn}
          className="space-y-4 rounded-xl border border-ink-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-white/[0.03]"
        >
          {sp.error && <Alert tone="error">{sp.error}</Alert>}

          <Field label="E-mail">
            <Input name="email" type="email" required autoComplete="username" autoFocus />
          </Field>

          <Field label="Пароль">
            <Input name="password" type="password" required autoComplete="current-password" />
          </Field>

          <input type="hidden" name="next" value={sp.next ?? '/'} />

          <Button className="w-full">Войти</Button>
        </form>

        <p className="mt-4 text-center text-xs text-ink-500">
          Пользователей заводит директор в разделе «Настройки»
        </p>
      </div>
    </main>
  )
}
