import { Card, Empty, Field, Input, Select, Table, Td, Textarea, Th, Badge } from '@/components/ui'
import { ActionForm, SubmitButton } from '@/components/action-form'
import { createClient } from '@/lib/supabase/server'
import { DEAL_STAGE_LABEL, DEAL_STATUS_LABEL, SOURCE_LABEL } from '@/lib/labels'
import { date, dateTime, hours, money } from '@/lib/format'
import { addPayment, updateDeal } from '../actions'

export const dynamic = 'force-dynamic'

export default async function DealOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const [{ data: deal }, { data: payments }, { data: history }, { data: managers }] =
    await Promise.all([
      supabase.from('deals').select('*').eq('id', id).single(),
      supabase.from('deal_payments').select('*').eq('deal_id', id).order('paid_at', { ascending: false }),
      supabase
        .from('deal_stage_history')
        .select('*, profile:changed_by(full_name)')
        .eq('deal_id', id)
        .order('changed_at', { ascending: false }),
      supabase.from('profiles').select('id, full_name').in('role', ['sales', 'director']).eq('is_active', true),
    ])

  if (!deal) return null

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card title="Параметры сделки" className="lg:col-span-2">
        <ActionForm action={updateDeal} className="grid gap-4 p-4 sm:grid-cols-2">
          <input type="hidden" name="deal_id" value={id} />

          <Field label="Название" className="sm:col-span-2">
            <Input name="title" defaultValue={deal.title} />
          </Field>

          <Field label="Статус">
            <Select name="status" defaultValue={deal.status}>
              {Object.entries(DEAL_STATUS_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Менеджер">
            <Select name="manager_id" defaultValue={deal.manager_id ?? ''}>
              <option value="">—</option>
              {(managers ?? []).map((m: any) => (
                <option key={m.id} value={m.id}>
                  {m.full_name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Источник">
            <Select name="source" defaultValue={deal.source}>
              {Object.entries(SOURCE_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Вероятность, %">
            <Input name="probability" type="number" min={0} max={100} defaultValue={deal.probability} />
          </Field>

          <Field label="Номер договора">
            <Input name="contract_number" defaultValue={deal.contract_number ?? ''} />
          </Field>

          <Field label="Дата подписания договора" hint="Для ключевых клиентов открывает жёсткий резерв">
            <Input name="contract_signed_at" type="date" defaultValue={deal.contract_signed_at ?? ''} />
          </Field>

          <Field label="Срок отгрузки клиенту">
            <Input name="required_ship_date" type="date" defaultValue={deal.required_ship_date ?? ''} />
          </Field>

          <Field label="Ожидаемое закрытие">
            <Input name="expected_close_date" type="date" defaultValue={deal.expected_close_date ?? ''} />
          </Field>

          <Field label="Техническое задание" className="sm:col-span-2">
            <Textarea name="tz_text" rows={5} defaultValue={deal.tz_text ?? ''} />
          </Field>

          <Field label="Причина проигрыша" className="sm:col-span-2">
            <Input name="lost_reason" defaultValue={deal.lost_reason ?? ''} />
          </Field>

          <div className="sm:col-span-2">
            <SubmitButton>Сохранить</SubmitButton>
          </div>
        </ActionForm>
      </Card>

      <div className="space-y-4">
        <Card title="Оплаты">
          <div className="border-b border-ink-100 p-4 dark:border-white/5">
            <ActionForm action={addPayment} className="grid grid-cols-2 gap-2">
              <input type="hidden" name="deal_id" value={id} />
              <Field label="Тип">
                <Select name="kind" defaultValue="prepayment">
                  <option value="prepayment">Предоплата</option>
                  <option value="payment">Оплата</option>
                  <option value="refund">Возврат</option>
                </Select>
              </Field>
              <Field label="Сумма">
                <Input name="amount" type="number" step="0.01" required />
              </Field>
              <Field label="Дата">
                <Input name="paid_at" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
              </Field>
              <Field label="Документ">
                <Input name="doc_ref" placeholder="п/п №" />
              </Field>
              <div className="col-span-2">
                <SubmitButton size="sm">Добавить оплату</SubmitButton>
              </div>
            </ActionForm>
          </div>

          {(payments ?? []).length === 0 ? (
            <Empty>Оплат не было. Жёсткий резерв недоступен.</Empty>
          ) : (
            <Table>
              <tbody>
                {(payments ?? []).map((p: any) => (
                  <tr key={p.id}>
                    <Td>
                      <div className="text-sm">{date(p.paid_at)}</div>
                      <div className="text-xs text-ink-500">{p.doc_ref ?? '—'}</div>
                    </Td>
                    <Td>
                      <Badge tone={p.kind === 'refund' ? 'red' : 'green'}>
                        {p.kind === 'prepayment' ? 'Предоплата' : p.kind === 'payment' ? 'Оплата' : 'Возврат'}
                      </Badge>
                    </Td>
                    <Td align="right">{money(p.amount)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card title="История этапов">
          {(history ?? []).length === 0 ? (
            <Empty>Пока нет переходов</Empty>
          ) : (
            <ul className="divide-y divide-ink-100 dark:divide-white/5">
              {(history ?? []).map((h: any) => (
                <li key={h.id} className="px-4 py-2.5 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{DEAL_STAGE_LABEL[h.to_stage]}</span>
                    <span className="text-xs text-ink-500">{dateTime(h.changed_at)}</span>
                  </div>
                  <div className="text-xs text-ink-500">
                    {h.from_stage ? `из «${DEAL_STAGE_LABEL[h.from_stage]}»` : 'создание сделки'}
                    {h.duration_seconds ? ` · длилось ${hours(h.duration_seconds)}` : ''}
                    {h.profile?.full_name ? ` · ${h.profile.full_name}` : ''}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}
