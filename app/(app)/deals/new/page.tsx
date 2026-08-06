import { Alert, Card, Field, Input, PageHeader, Select, Textarea } from '@/components/ui'
import { ActionForm, SubmitButton } from '@/components/action-form'
import { createClient } from '@/lib/supabase/server'
import { SOURCE_LABEL } from '@/lib/labels'
import { createDeal } from '../actions'

export const dynamic = 'force-dynamic'

export default async function NewDealPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; counterparty?: string }>
}) {
  const sp = await searchParams
  const supabase = await createClient()

  const { data: clients } = await supabase
    .from('counterparties')
    .select('id, name, is_key_client')
    .in('type', ['client', 'both'])
    .eq('is_active', true)
    .order('name')

  return (
    <>
      <PageHeader title="Новая сделка" subtitle="Заявка от клиента — начало цепочки" />

      {sp.error && (
        <div className="mb-4">
          <Alert tone="error">{sp.error}</Alert>
        </div>
      )}

      <Card className="max-w-3xl p-5">
        <ActionForm action={createDeal} className="grid gap-4 sm:grid-cols-2">
          <Field label="Название сделки" className="sm:col-span-2">
            <Input
              name="title"
              required
              placeholder="Напр.: Поставка задвижек Ду100 AISI 316 и РВС-100"
            />
          </Field>

          <Field label="Клиент">
            <Select name="counterparty_id" required defaultValue={sp.counterparty ?? ''}>
              <option value="">— выберите —</option>
              {(clients ?? []).map((c: any) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.is_key_client ? ' ★' : ''}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Источник заявки">
            <Select name="source" defaultValue="call">
              {Object.entries(SOURCE_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Требуемая дата отгрузки">
            <Input name="required_ship_date" type="date" />
          </Field>

          <Field label="Ожидаемое закрытие">
            <Input name="expected_close_date" type="date" />
          </Field>

          <Field label="Техническое задание клиента" className="sm:col-span-2">
            <Textarea
              name="tz_text"
              rows={5}
              placeholder="Марки стали, диаметры, объёмы, требования к сертификатам и документации…"
            />
          </Field>

          <div className="sm:col-span-2">
            <SubmitButton>Создать сделку</SubmitButton>
          </div>
        </ActionForm>
      </Card>
    </>
  )
}
