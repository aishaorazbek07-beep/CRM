import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Plus } from 'lucide-react'
import { Badge, Card, Empty, Field, Input, LinkButton, PageHeader, Select, Table, Td, Textarea, Th } from '@/components/ui'
import { ActionForm, SubmitButton } from '@/components/action-form'
import { createClient } from '@/lib/supabase/server'
import { DEAL_STAGE_LABEL } from '@/lib/labels'
import { date, money } from '@/lib/format'
import { addContact, updateCounterparty } from '../actions'

export const dynamic = 'force-dynamic'

const TYPE_LABEL: Record<string, string> = {
  client: 'Клиент',
  supplier: 'Поставщик',
  both: 'Клиент и поставщик',
}

export default async function CounterpartyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: cp } = await supabase.from('counterparties').select('*').eq('id', id).single()
  if (!cp) notFound()

  const [{ data: contacts }, { data: deals }, { data: orders }] = await Promise.all([
    supabase.from('contacts').select('*').eq('counterparty_id', id).order('created_at'),
    supabase
      .from('deals')
      .select('id, number, title, stage, status, amount, created_at')
      .eq('counterparty_id', id)
      .order('created_at', { ascending: false }),
    supabase
      .from('purchase_orders')
      .select('id, number, status, total, eta_date')
      .eq('supplier_id', id)
      .order('created_at', { ascending: false })
      .limit(20),
  ])

  return (
    <>
      <Link href="/counterparties" className="mb-3 inline-flex items-center gap-1.5 text-sm text-ink-500 hover:underline">
        <ArrowLeft size={15} /> К контрагентам
      </Link>

      <PageHeader
        title={cp.name}
        subtitle={
          <>
            {TYPE_LABEL[cp.type]}
            {cp.bin_iin ? ` · БИН ${cp.bin_iin}` : ''}
            {cp.is_key_client ? ' · ключевой клиент' : ''}
          </>
        }
        actions={
          <LinkButton href={`/deals/new?counterparty=${id}`} variant="primary">
            <Plus size={16} /> Новая сделка
          </LinkButton>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Реквизиты" className="lg:col-span-2">
          <ActionForm action={updateCounterparty} className="grid gap-3 p-4 sm:grid-cols-2">
            <input type="hidden" name="counterparty_id" value={id} />
            <Field label="Тип">
              <Select name="type" defaultValue={cp.type}>
                {Object.entries(TYPE_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Краткое название">
              <Input name="name" defaultValue={cp.name} />
            </Field>
            <Field label="Полное название" className="sm:col-span-2">
              <Input name="full_name" defaultValue={cp.full_name ?? ''} />
            </Field>
            <Field label="БИН / ИИН">
              <Input name="bin_iin" defaultValue={cp.bin_iin ?? ''} />
            </Field>
            <Field label="Телефон">
              <Input name="phone" defaultValue={cp.phone ?? ''} />
            </Field>
            <Field label="E-mail">
              <Input name="email" defaultValue={cp.email ?? ''} />
            </Field>
            <Field label="Адрес">
              <Input name="address" defaultValue={cp.address ?? ''} />
            </Field>
            <Field label="Условия оплаты">
              <Input name="payment_terms" defaultValue={cp.payment_terms ?? ''} />
            </Field>
            <Field label="Отсрочка, дней">
              <Input name="deferral_days" type="number" defaultValue={cp.deferral_days} className="no-spin" />
            </Field>
            <Field label="Примечание" className="sm:col-span-2">
              <Textarea name="note" rows={2} defaultValue={cp.note ?? ''} />
            </Field>
            <div className="flex gap-4 sm:col-span-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="is_key_client" defaultChecked={cp.is_key_client} /> ключевой клиент
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="is_active" defaultChecked={cp.is_active} /> активен
              </label>
            </div>
            <div className="sm:col-span-2">
              <SubmitButton>Сохранить</SubmitButton>
            </div>
          </ActionForm>
        </Card>

        <Card title="Контактные лица">
          <ActionForm action={addContact} className="space-y-2 border-b border-ink-100 p-4 dark:border-white/5">
            <input type="hidden" name="counterparty_id" value={id} />
            <Input name="full_name" required placeholder="ФИО" />
            <Input name="position" placeholder="Должность" />
            <div className="grid grid-cols-2 gap-2">
              <Input name="phone" placeholder="Телефон" />
              <Input name="whatsapp" placeholder="WhatsApp" />
            </div>
            <Input name="email" placeholder="E-mail" />
            <SubmitButton size="sm" variant="secondary">
              Добавить контакт
            </SubmitButton>
          </ActionForm>

          {(contacts ?? []).length === 0 ? (
            <Empty>Контактов нет</Empty>
          ) : (
            <ul className="divide-y divide-ink-100 dark:divide-white/5">
              {(contacts ?? []).map((c: any) => (
                <li key={c.id} className="px-4 py-2.5 text-sm">
                  <div className="font-medium">{c.full_name}</div>
                  <div className="text-xs text-ink-500">
                    {c.position}
                    {c.phone ? ` · ${c.phone}` : ''}
                    {c.whatsapp ? ` · WhatsApp ${c.whatsapp}` : ''}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Сделки">
          {(deals ?? []).length === 0 ? (
            <Empty>Сделок нет</Empty>
          ) : (
            <Table>
              <tbody>
                {(deals ?? []).map((d: any) => (
                  <tr key={d.id}>
                    <Td>
                      <Link href={`/deals/${d.id}`} className="font-medium text-steel-700 hover:underline dark:text-steel-500">
                        {d.number}
                      </Link>
                      <div className="max-w-64 truncate text-xs text-ink-500">{d.title}</div>
                    </Td>
                    <Td>
                      <Badge tone="slate">{DEAL_STAGE_LABEL[d.stage]}</Badge>
                    </Td>
                    <Td align="right">{money(d.amount)}</Td>
                    <Td className="text-xs">{date(d.created_at)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card title="Заказы этому поставщику">
          {(orders ?? []).length === 0 ? (
            <Empty>Заказов нет</Empty>
          ) : (
            <Table>
              <tbody>
                {(orders ?? []).map((o: any) => (
                  <tr key={o.id}>
                    <Td>
                      <Link
                        href={`/procurement/orders/${o.id}`}
                        className="font-medium text-steel-700 hover:underline dark:text-steel-500"
                      >
                        {o.number}
                      </Link>
                    </Td>
                    <Td align="right">{money(o.total)}</Td>
                    <Td className="text-xs">{date(o.eta_date)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  )
}
