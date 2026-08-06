import Link from 'next/link'
import { FileText } from 'lucide-react'
import { Badge, Card, Empty, Field, Input, Table, Td, Textarea, Th } from '@/components/ui'
import { ActionForm, SubmitButton } from '@/components/action-form'
import { createClient } from '@/lib/supabase/server'
import { date, money } from '@/lib/format'
import { createQuote, setQuoteStatus } from '../../actions'

export const dynamic = 'force-dynamic'

const QUOTE_STATUS: Record<string, { label: string; tone: any }> = {
  draft: { label: 'Черновик', tone: 'slate' },
  sent: { label: 'Отправлено', tone: 'blue' },
  accepted: { label: 'Принято', tone: 'green' },
  rejected: { label: 'Отклонено', tone: 'red' },
  expired: { label: 'Истекло', tone: 'amber' },
}

export default async function QuotesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const [{ data: quotes }, { data: spec }] = await Promise.all([
    supabase
      .from('quotes')
      .select('*, spec:spec_id(version)')
      .eq('deal_id', id)
      .order('version', { ascending: false }),
    supabase
      .from('specifications')
      .select('id, version, total_with_vat, max_lead_time_days')
      .eq('deal_id', id)
      .eq('is_current', true)
      .maybeSingle(),
  ])

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card title="Коммерческие предложения" className="lg:col-span-2">
        {(quotes ?? []).length === 0 ? (
          <Empty>КП ещё не формировалось</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Номер</Th>
                <Th>Спецификация</Th>
                <Th align="right">Сумма с НДС</Th>
                <Th>Действует до</Th>
                <Th>Статус</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {(quotes ?? []).map((q: any) => (
                <tr key={q.id}>
                  <Td>
                    <Link
                      href={`/deals/${id}/quote/${q.id}`}
                      className="inline-flex items-center gap-1.5 font-medium text-steel-700 hover:underline dark:text-steel-500"
                    >
                      <FileText size={15} />
                      {q.number}
                    </Link>
                    <div className="text-xs text-ink-500">от {date(q.issued_at)}</div>
                  </Td>
                  <Td>v{q.spec?.version}</Td>
                  <Td align="right">{money(q.total_with_vat)}</Td>
                  <Td>{date(q.valid_until)}</Td>
                  <Td>
                    <Badge tone={QUOTE_STATUS[q.status]?.tone}>{QUOTE_STATUS[q.status]?.label}</Badge>
                  </Td>
                  <Td>
                    <div className="flex gap-1">
                      {q.status === 'draft' && (
                        <ActionForm action={setQuoteStatus} hideErrors>
                          <input type="hidden" name="deal_id" value={id} />
                          <input type="hidden" name="quote_id" value={q.id} />
                          <input type="hidden" name="status" value="sent" />
                          <SubmitButton size="sm" variant="secondary">
                            Отправлено
                          </SubmitButton>
                        </ActionForm>
                      )}
                      {q.status === 'sent' && (
                        <>
                          <ActionForm action={setQuoteStatus} hideErrors>
                            <input type="hidden" name="deal_id" value={id} />
                            <input type="hidden" name="quote_id" value={q.id} />
                            <input type="hidden" name="status" value="accepted" />
                            <SubmitButton size="sm">Принято</SubmitButton>
                          </ActionForm>
                          <ActionForm action={setQuoteStatus} hideErrors>
                            <input type="hidden" name="deal_id" value={id} />
                            <input type="hidden" name="quote_id" value={q.id} />
                            <input type="hidden" name="status" value="rejected" />
                            <SubmitButton size="sm" variant="secondary">
                              Отклонено
                            </SubmitButton>
                          </ActionForm>
                        </>
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card title="Сформировать КП">
        <ActionForm action={createQuote} className="space-y-3 p-4">
          <input type="hidden" name="deal_id" value={id} />

          <div className="rounded-lg border border-ink-200/70 p-3 text-sm dark:border-white/10">
            Текущая спецификация: <b>v{spec?.version ?? '—'}</b>
            <div className="mt-1 text-ink-500">
              Сумма {money(spec?.total_with_vat)} · срок {spec?.max_lead_time_days ?? 0} дн
            </div>
          </div>

          <Field label="Условия оплаты">
            <Input
              name="payment_terms"
              defaultValue="Предоплата 50%, окончательный расчёт по факту готовности"
            />
          </Field>

          <Field label="Условия поставки">
            <Input name="delivery_terms" defaultValue="Самовывоз со склада Поставщика" />
          </Field>

          <Field label="Вступительный текст">
            <Textarea
              name="intro_text"
              rows={3}
              defaultValue="Благодарим за интерес к нашей продукции. Предлагаем к рассмотрению коммерческое предложение:"
            />
          </Field>

          <SubmitButton>Сформировать</SubmitButton>
        </ActionForm>
      </Card>
    </div>
  )
}
