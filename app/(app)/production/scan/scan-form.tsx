'use client'

import { useActionState } from 'react'
import { ScanLine, ArrowRight } from 'lucide-react'
import { Alert } from '@/components/ui'
import { SubmitButton } from '@/components/action-form'
import { PROD_STAGE_LABEL } from '@/lib/labels'
import { advanceStage } from '../actions'

export function ScanForm({ compact = false, barcode }: { compact?: boolean; barcode?: string }) {
  const [state, formAction] = useActionState(
    async (_prev: any, fd: FormData) => await advanceStage(fd),
    null
  )

  if (compact) {
    return (
      <form action={formAction} className="space-y-2">
        <input type="hidden" name="order_ref" value={barcode} />
        {state?.error && <Alert tone="error">{state.error}</Alert>}
        {state?.ok && (
          <Alert tone="success">
            Переведено на «{PROD_STAGE_LABEL[(state as any).result?.to] ?? 'следующую стадию'}»
          </Alert>
        )}
        <SubmitButton className="w-full">
          <ArrowRight size={15} /> Следующая стадия
        </SubmitButton>
      </form>
    )
  }

  return (
    <form action={formAction} className="mx-auto max-w-2xl space-y-3">
      {state?.error && <Alert tone="error">{state.error}</Alert>}
      {state?.ok && (
        <Alert tone="success">
          Готово. Заказ переведён на стадию «
          {PROD_STAGE_LABEL[(state as any).result?.to] ?? '—'}».
        </Alert>
      )}

      <div className="flex gap-2">
        <div className="relative flex-1">
          <ScanLine size={22} className="absolute left-4 top-1/2 -translate-y-1/2 text-ink-400" />
          <input
            name="order_ref"
            required
            autoFocus
            autoComplete="off"
            placeholder="Штрихкод маршрутного листа"
            className="w-full rounded-xl border-2 border-ink-300 bg-white py-5 pl-14 pr-4 font-mono text-xl tracking-widest outline-none focus:border-steel-500 dark:border-white/15 dark:bg-white/5"
          />
        </div>
        <SubmitButton className="px-8 text-base">Далее</SubmitButton>
      </div>

      <input
        name="comment"
        placeholder="Комментарий (необязательно)"
        className="w-full rounded-lg border border-ink-300 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-white/5"
      />
    </form>
  )
}
