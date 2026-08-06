'use client'

import { useActionState, useState } from 'react'
import { Alert, Field, Input, Select } from '@/components/ui'
import { SubmitButton } from '@/components/action-form'
import { ItemPicker, type PickedItem } from '@/components/item-picker'
import { SPEC_SOURCE_LABEL } from '@/lib/labels'
import { addSpecItem } from '../../actions'

export function AddSpecItemForm({
  dealId,
  specId,
  sections,
  units,
}: {
  dealId: string
  specId: string
  sections: string[]
  units: { id: string; name: string }[]
}) {
  const [picked, setPicked] = useState<PickedItem | null>(null)
  const [free, setFree] = useState(false)
  const [state, formAction] = useActionState(
    async (_prev: any, fd: FormData) => await addSpecItem(fd),
    null
  )

  return (
    <form action={formAction} className="space-y-3 p-4">
      {state?.error && <Alert tone="error">{state.error}</Alert>}
      <input type="hidden" name="deal_id" value={dealId} />
      <input type="hidden" name="spec_id" value={specId} />

      <div className="grid gap-3 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <Field label={free ? 'Наименование (произвольное)' : 'Позиция из номенклатуры'}>
            {free ? (
              <Input name="name_snapshot" required placeholder="Напр.: Изготовление обечайки" />
            ) : (
              <ItemPicker
                key="picker"
                onPick={(i) => setPicked(i)}
                placeholder="Задвижка, лист 304, электропривод…"
              />
            )}
          </Field>
          <button
            type="button"
            onClick={() => {
              setFree(!free)
              setPicked(null)
            }}
            className="mt-1 text-xs text-steel-700 hover:underline dark:text-steel-500"
          >
            {free ? '← выбрать из номенклатуры' : '+ произвольная строка'}
          </button>
        </div>

        <Field label="Раздел" className="lg:col-span-2">
          <Select name="section" defaultValue="Материалы">
            {sections.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Кол-во" className="lg:col-span-1">
          <Input name="qty" type="number" step="0.001" defaultValue={1} required className="no-spin" />
        </Field>

        <Field label="Ед." className="lg:col-span-1">
          <Select name="unit_id" key={`u-${picked?.id ?? 'x'}`} defaultValue={picked?.base_unit_id ?? ''}>
            <option value="">—</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Себест." className="lg:col-span-1">
          <Input
            name="cost_price"
            type="number"
            step="0.01"
            key={`c-${picked?.id ?? 'x'}`}
            defaultValue={picked ? Number(picked.avg_cost || picked.last_purchase_price || 0) : 0}
            className="no-spin"
          />
        </Field>

        <Field label="Цена" className="lg:col-span-1">
          <Input
            name="sale_price"
            type="number"
            step="0.01"
            key={`s-${picked?.id ?? 'x'}`}
            defaultValue={picked ? Number(picked.default_price || 0) : 0}
            className="no-spin"
          />
        </Field>

        <Field label="Источник" className="lg:col-span-1">
          <Select name="source" defaultValue="purchase">
            {Object.entries(SPEC_SOURCE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="flex items-center gap-3">
        <SubmitButton>Добавить в спецификацию</SubmitButton>
        {picked && (
          <span className="text-xs text-ink-500">
            {picked.name} · срок поставки {picked.lead_time_days} дн
          </span>
        )}
      </div>
    </form>
  )
}
