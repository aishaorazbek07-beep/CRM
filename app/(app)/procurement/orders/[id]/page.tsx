import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, PackagePlus } from 'lucide-react'
import { Alert, Badge, Card, Empty, Field, Input, PageHeader, Select, Table, Td, Th } from '@/components/ui'
import { ActionForm, SubmitButton } from '@/components/action-form'
import { ItemPicker } from '@/components/item-picker'
import { createClient } from '@/lib/supabase/server'
import { PO_STATUS, PO_STATUS_LABEL } from '@/lib/labels'
import { date, money, num } from '@/lib/format'
import {
  addPoItem,
  receivePoItem,
  setPoStatus,
  updatePoItemForm,
  updatePurchaseOrder,
} from '../../actions'

export const dynamic = 'force-dynamic'

export default async function PurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: order } = await supabase
    .from('purchase_orders')
    .select(
      '*, supplier:supplier_id(id, name, phone, email), deal:deal_id(id, number, title), request:request_id(id, number)'
    )
    .eq('id', id)
    .single()

  if (!order) notFound()

  const [{ data: items }, { data: warehouses }, { data: batches }] = await Promise.all([
    supabase
      .from('purchase_order_items')
      .select('*, item:item_id(id, name, sku, steel_grade, requires_certificate)')
      .eq('order_id', id)
      .order('created_at'),
    supabase.from('warehouses').select('*').eq('is_active', true).order('sort_order'),
    supabase
      .from('batches')
      .select('*, item:item_id(name)')
      .eq('purchase_order_id', id)
      .order('received_at', { ascending: false }),
  ])

  const statusIdx = PO_STATUS.findIndex((s) => s.key === order.status)
  const late = order.eta_date && new Date(order.eta_date) < new Date() && order.status !== 'received'

  return (
    <>
      <Link
        href="/procurement/orders"
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-ink-500 hover:underline"
      >
        <ArrowLeft size={15} /> К заказам
      </Link>

      <PageHeader
        title={`Заказ ${order.number}`}
        subtitle={
          <>
            {order.supplier?.name}
            {order.deal && (
              <>
                {' · сделка '}
                <Link href={`/deals/${order.deal.id}`} className="hover:underline">
                  {order.deal.number}
                </Link>
              </>
            )}
            {order.request && (
              <>
                {' · заявка '}
                <Link href={`/procurement/requests/${order.request.id}`} className="hover:underline">
                  {order.request.number}
                </Link>
              </>
            )}
          </>
        }
        actions={<div className="text-2xl font-semibold tabular-nums">{money(order.total)}</div>}
      />

      {late && (
        <div className="mb-4">
          <Alert tone="error">
            Поставка просрочена: ожидалась {date(order.eta_date)}. Запуск связанного заказа в
            производство заблокирован до прихода материалов.
          </Alert>
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-1.5">
        {PO_STATUS.filter((s) => s.key !== 'cancelled').map((s, i) => (
          <ActionForm key={s.key} action={setPoStatus} hideErrors>
            <input type="hidden" name="order_id" value={id} />
            <input type="hidden" name="status" value={s.key} />
            <button
              className={`rounded-lg border px-3 py-2 text-xs font-medium transition ${
                order.status === s.key
                  ? 'border-steel-600 bg-steel-600 text-white'
                  : i < statusIdx
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300'
                    : 'border-ink-200 bg-white text-ink-500 hover:border-steel-500 dark:border-white/10 dark:bg-white/5'
              }`}
            >
              {s.label}
            </button>
          </ActionForm>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Позиции заказа" className="lg:col-span-2">
          {(items ?? []).length === 0 ? (
            <Empty>Позиций нет</Empty>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Позиция</Th>
                  <Th align="right">Кол-во</Th>
                  <Th align="right">Цена</Th>
                  <Th align="right">Сумма</Th>
                  <Th align="right">Принято</Th>
                  <Th>Приёмка на склад</Th>
                </tr>
              </thead>
              <tbody>
                {(items ?? []).map((i: any) => {
                  const left = Number(i.qty) - Number(i.qty_received)
                  return (
                    <tr key={i.id} className="align-top">
                      <Td>
                        <div className="font-medium">{i.item?.name}</div>
                        <div className="font-mono text-xs text-ink-500">
                          {i.item?.sku}
                          {i.item?.steel_grade ? ` · ${i.item.steel_grade}` : ''}
                        </div>
                        {i.item?.requires_certificate && (
                          <Badge tone="amber">нужен сертификат</Badge>
                        )}
                      </Td>
                      <Td align="right">
                        <form action={updatePoItemForm} className="inline">
                          <input type="hidden" name="order_id" value={id} />
                          <input type="hidden" name="po_item_id" value={i.id} />
                          <input type="hidden" name="price" value={Number(i.price)} />
                          <input
                            name="qty"
                            defaultValue={Number(i.qty)}
                            className="no-spin w-20 rounded border border-ink-200 bg-transparent px-1.5 py-1 text-right text-sm dark:border-white/10"
                          />
                        </form>
                      </Td>
                      <Td align="right">
                        <form action={updatePoItemForm} className="inline">
                          <input type="hidden" name="order_id" value={id} />
                          <input type="hidden" name="po_item_id" value={i.id} />
                          <input type="hidden" name="qty" value={Number(i.qty)} />
                          <input
                            name="price"
                            defaultValue={Number(i.price)}
                            className="no-spin w-24 rounded border border-ink-200 bg-transparent px-1.5 py-1 text-right text-sm dark:border-white/10"
                          />
                        </form>
                      </Td>
                      <Td align="right">{money(i.line_total)}</Td>
                      <Td align="right">
                        {left <= 0.001 ? (
                          <Badge tone="green">{num(i.qty_received)}</Badge>
                        ) : (
                          <>
                            {num(i.qty_received)}
                            <div className="text-xs text-ink-500">осталось {num(left)}</div>
                          </>
                        )}
                      </Td>
                      <Td>
                        {left > 0.001 ? (
                          <ActionForm action={receivePoItem} className="space-y-1.5">
                            <input type="hidden" name="order_id" value={id} />
                            <input type="hidden" name="po_item_id" value={i.id} />
                            <div className="flex gap-1">
                              <input
                                name="qty"
                                defaultValue={left}
                                placeholder="кол-во"
                                className="no-spin w-20 rounded border border-ink-200 bg-transparent px-1.5 py-1 text-sm dark:border-white/10"
                              />
                              <select
                                name="warehouse_id"
                                className="rounded border border-ink-200 bg-transparent px-1.5 py-1 text-xs dark:border-white/10"
                              >
                                {(warehouses ?? []).map((w: any) => (
                                  <option key={w.id} value={w.id}>
                                    {w.code}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="flex gap-1">
                              <input
                                name="heat_number"
                                placeholder="№ плавки"
                                className="w-24 rounded border border-ink-200 bg-transparent px-1.5 py-1 text-xs dark:border-white/10"
                              />
                              <input
                                name="cert_number"
                                placeholder="№ серт."
                                className="w-24 rounded border border-ink-200 bg-transparent px-1.5 py-1 text-xs dark:border-white/10"
                              />
                            </div>
                            <SubmitButton size="sm" variant="secondary">
                              <PackagePlus size={14} /> Принять
                            </SubmitButton>
                          </ActionForm>
                        ) : (
                          <span className="text-xs text-emerald-600">принято полностью</span>
                        )}
                      </Td>
                    </tr>
                  )
                })}
              </tbody>
            </Table>
          )}

          <div className="border-t border-ink-100 p-4 dark:border-white/5">
            <ActionForm action={addPoItem} className="grid gap-3 sm:grid-cols-5">
              <input type="hidden" name="order_id" value={id} />
              <Field label="Добавить позицию" className="sm:col-span-2">
                <ItemPicker />
              </Field>
              <Field label="Кол-во">
                <Input name="qty" type="number" step="0.001" defaultValue={1} className="no-spin" />
              </Field>
              <Field label="Цена">
                <Input name="price" type="number" step="0.01" className="no-spin" />
              </Field>
              <div className="flex items-end">
                <SubmitButton variant="secondary">Добавить</SubmitButton>
              </div>
            </ActionForm>
          </div>
        </Card>

        <div className="space-y-4">
          <Card title="Реквизиты заказа">
            <ActionForm action={updatePurchaseOrder} className="space-y-3 p-4">
              <input type="hidden" name="order_id" value={id} />
              <Field label="Ожидаемая дата прихода">
                <Input name="eta_date" type="date" defaultValue={order.eta_date ?? ''} />
              </Field>
              <Field label="№ счёта">
                <Input name="invoice_number" defaultValue={order.invoice_number ?? ''} />
              </Field>
              <Field label="Отслеживание / логистика">
                <Input name="tracking_info" defaultValue={order.tracking_info ?? ''} />
              </Field>
              <Field label="Примечание">
                <Input name="note" defaultValue={order.note ?? ''} />
              </Field>
              <SubmitButton size="sm" variant="secondary">
                Сохранить
              </SubmitButton>
            </ActionForm>
          </Card>

          <Card title="Хронология статусов">
            <ul className="space-y-2 p-4 text-sm">
              <li className="flex justify-between">
                <span className="text-ink-500">Заказано</span>
                <span>{date(order.ordered_at)}</span>
              </li>
              <li className="flex justify-between">
                <span className="text-ink-500">Оплачено</span>
                <span>{date(order.paid_at)}</span>
              </li>
              <li className="flex justify-between">
                <span className="text-ink-500">В пути</span>
                <span>{date(order.in_transit_at)}</span>
              </li>
              <li className="flex justify-between">
                <span className="text-ink-500">Ожидается</span>
                <span className={late ? 'font-medium text-rose-600' : ''}>{date(order.eta_date)}</span>
              </li>
              <li className="flex justify-between">
                <span className="text-ink-500">На складе</span>
                <span>{date(order.received_at)}</span>
              </li>
            </ul>
          </Card>

          <Card title="Оприходованные партии">
            {(batches ?? []).length === 0 ? (
              <Empty>Приходов не было</Empty>
            ) : (
              <ul className="divide-y divide-ink-100 dark:divide-white/5">
                {(batches ?? []).map((b: any) => (
                  <li key={b.id} className="px-4 py-2.5 text-sm">
                    <div className="font-medium">{b.item?.name}</div>
                    <div className="text-xs text-ink-500">
                      {num(b.qty_received)} · партия {b.batch_number}
                      {b.heat_number ? ` · плавка ${b.heat_number}` : ''}
                    </div>
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
