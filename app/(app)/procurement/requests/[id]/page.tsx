import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { Badge, Card, Empty, Field, Input, PageHeader, Select, Table, Td, Th } from '@/components/ui'
import { ActionForm, SubmitButton } from '@/components/action-form'
import { ItemPicker } from '@/components/item-picker'
import { createClient } from '@/lib/supabase/server'
import { PR_STATUS_LABEL } from '@/lib/labels'
import { date, money, num } from '@/lib/format'
import { addRequestItem, createOrderFromRequest } from '../../actions'

export const dynamic = 'force-dynamic'

export default async function RequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: request } = await supabase
    .from('purchase_requests')
    .select(
      '*, deal:deal_id(id, number, title), items:purchase_request_items(*, item:item_id(name, sku, steel_grade, lead_time_days, last_purchase_price))'
    )
    .eq('id', id)
    .single()

  if (!request) notFound()

  const [{ data: suppliers }, { data: orders }] = await Promise.all([
    supabase
      .from('counterparties')
      .select('id, name')
      .in('type', ['supplier', 'both'])
      .eq('is_active', true)
      .order('name'),
    supabase.from('purchase_orders').select('id, number, status, total').eq('request_id', id),
  ])

  return (
    <>
      <Link
        href="/procurement"
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-ink-500 hover:underline"
      >
        <ArrowLeft size={15} /> К снабжению
      </Link>

      <PageHeader
        title={`Заявка в закуп ${request.number}`}
        subtitle={
          <>
            {request.deal ? (
              <>
                по сделке{' '}
                <Link href={`/deals/${request.deal.id}`} className="hover:underline">
                  {request.deal.number} — {request.deal.title}
                </Link>
              </>
            ) : (
              'пополнение склада'
            )}{' '}
            · нужно к {date(request.required_by)}
          </>
        }
        actions={<Badge tone="amber">{PR_STATUS_LABEL[request.status]}</Badge>}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Позиции заявки" className="lg:col-span-2">
          {(request.items ?? []).length === 0 ? (
            <Empty>Позиций нет</Empty>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Позиция</Th>
                  <Th align="right">Нужно</Th>
                  <Th align="right">Заказано</Th>
                  <Th align="right">Получено</Th>
                  <Th align="right">Ориент. цена</Th>
                  <Th>Срок</Th>
                </tr>
              </thead>
              <tbody>
                {(request.items ?? []).map((i: any) => (
                  <tr key={i.id}>
                    <Td>
                      <div className="font-medium">{i.item?.name}</div>
                      <div className="font-mono text-xs text-ink-500">
                        {i.item?.sku}
                        {i.item?.steel_grade ? ` · ${i.item.steel_grade}` : ''}
                      </div>
                    </Td>
                    <Td align="right">{num(i.qty)}</Td>
                    <Td align="right">{num(i.qty_ordered)}</Td>
                    <Td align="right">
                      {Number(i.qty_received) >= Number(i.qty) ? (
                        <Badge tone="green">{num(i.qty_received)}</Badge>
                      ) : (
                        num(i.qty_received)
                      )}
                    </Td>
                    <Td align="right">{money(i.target_price)}</Td>
                    <Td>{date(i.required_by)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}

          <div className="border-t border-ink-100 p-4 dark:border-white/5">
            <ActionForm action={addRequestItem} className="grid gap-3 sm:grid-cols-4">
              <input type="hidden" name="request_id" value={id} />
              <Field label="Добавить позицию" className="sm:col-span-2">
                <ItemPicker />
              </Field>
              <Field label="Кол-во">
                <Input name="qty" type="number" step="0.001" defaultValue={1} className="no-spin" />
              </Field>
              <div className="flex items-end">
                <SubmitButton variant="secondary">Добавить</SubmitButton>
              </div>
            </ActionForm>
          </div>
        </Card>

        <div className="space-y-4">
          <Card title="Создать заказ поставщику">
            <ActionForm action={createOrderFromRequest} className="space-y-3 p-4">
              <input type="hidden" name="request_id" value={id} />
              <Field label="Поставщик">
                <Select name="supplier_id" required defaultValue="">
                  <option value="">— выберите —</option>
                  {(suppliers ?? []).map((s: any) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Ожидаемая дата прихода">
                <Input name="eta_date" type="date" />
              </Field>
              <Field label="Примечание">
                <Input name="note" />
              </Field>
              <SubmitButton>Сформировать заказ</SubmitButton>
            </ActionForm>
          </Card>

          <Card title="Заказы по заявке">
            {(orders ?? []).length === 0 ? (
              <Empty>Заказов ещё нет</Empty>
            ) : (
              <ul className="divide-y divide-ink-100 dark:divide-white/5">
                {(orders ?? []).map((o: any) => (
                  <li key={o.id} className="flex items-center justify-between gap-2 px-4 py-3">
                    <Link
                      href={`/procurement/orders/${o.id}`}
                      className="font-medium text-steel-700 hover:underline dark:text-steel-500"
                    >
                      {o.number}
                    </Link>
                    <span className="text-sm">{money(o.total)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  )
}
