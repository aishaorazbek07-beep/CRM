'use client'

import { useActionState } from 'react'
import { Alert, Field, Input, Select, Textarea } from '@/components/ui'
import { SubmitButton } from '@/components/action-form'
import { ItemPicker } from '@/components/item-picker'
import { substituteSpecItem } from '../../../actions'

export function FreeSubstituteForm({ dealId, lineId }: { dealId: string; lineId: string }) {
  const [state, formAction] = useActionState(
    async (_prev: any, fd: FormData) => await substituteSpecItem(fd),
    null
  )

  return (
    <form action={formAction} className="grid gap-3 p-4 sm:grid-cols-4">
      {state?.error && (
        <div className="sm:col-span-4">
          <Alert tone="error">{state.error}</Alert>
        </div>
      )}
      <input type="hidden" name="deal_id" value={dealId} />
      <input type="hidden" name="spec_item_id" value={lineId} />

      <Field label="Найти позицию" className="sm:col-span-2">
        <ItemPicker name="new_item_id" placeholder="Введите название или артикул…" />
      </Field>

      <Field label="Характер замены">
        <Select name="substitution_type" defaultValue="temporary">
          <option value="temporary">Временная подмена</option>
          <option value="permanent">Постоянная</option>
        </Select>
      </Field>

      <Field label="Плановый возврат">
        <Input name="return_date" type="date" />
      </Field>

      <Field label="Причина замены" className="sm:col-span-4">
        <Textarea name="reason" rows={2} required />
      </Field>

      <div className="sm:col-span-4">
        <SubmitButton variant="secondary">Заменить на выбранную позицию</SubmitButton>
      </div>
    </form>
  )
}
