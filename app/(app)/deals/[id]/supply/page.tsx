import Link from 'next/link'
import { Lock, ShieldCheck, ShoppingCart } from 'lucide-react'
import { Alert, Badge, Card, Empty, Field, Input, Table, Td, Th } from '@/components/ui'
import { ActionForm, SubmitButton } from '@/components/action-form'
import { createClient } from '@/lib/supabase/server'
import { PO_STATUS_LABEL, PR_STATUS_LABEL, RESERVE_KIND_LABEL } from '@/lib/labels'
import { date, money, num } from '@/lib/format'
import {
  buildDeficit,
  releaseSoftReservation,
  requestReservationRelease,
  reserveDeal,
} from '../../actions'

export const dynamic = 'force-dynamic'

export default async function SupplyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const [{ data: deal }, { data: canHard }, { data: spec }] = await Promise.all([
    supabase
      .from('deals')
      .select('*, counterparty:counterparty_id(name, is_key_client)')
      .eq('id', id)
      .single(),
    supabase.rpc('fn_can_hard_reserve', { p_deal_id: id }),
    supabase
      .from('specifications')
      .select('id')
      .eq('deal_id', id)
      .eq('is_current', true)
      .maybeSingle(),
  ])

  const [{ data: lines }, { data: reservations }, { data: requests }, { data: orders }] =
    await Promise.all([
      supabase
        .from('spec_items')
        .select('id, item_id, name_snapshot, qty, source, unit:unit_id(name), item:item_id(is_stock_tracked)')
        .eq('spec_id', spec?.id ?? '00000000-0000-0000-0000-000000000000')
        .order('line_no'),
      supabase
        .from('reservations')
        .select('*, item:item_id(name, sku), release_requests:reservation_release_requests(id, status)')
        .eq('deal_id', id)
        .order('created_at', { ascending: false }),
      supabase
        .from('purchase_requests')
        .select('*, items:purchase_request_items(id, qty, qty_ordered, qty_received, item:item_id(name))')
        .eq('deal_id', id)
        .order('created_at', { ascending: false }),
      supabase
        .from('purchase_orders')
        .select('*, supplier:supplier_id(name)')
        .eq('deal_id', id)
        .order('created_at', { ascending: false }),
    ])

  const stockLines = (lines ?? []).filter(
    (l: any) => l.item_id && l.item?.is_stock_tracked && ['stock', 'purchase'].includes(l.source)
  )
  const itemIds = stockLines.map((l: any) => l.item_id)
  const { data: avail } = itemIds.length
    ? await supabase.from('v_item_availability').select('*').in('item_id', itemIds)
    : { data: [] as any[] }
  const availMap = new Map((avail ?? []).map((a: any) => [a.item_id, a]))

  const reservedByItem = new Map<string, number>()
  for (const r of reservations ?? []) {
    if (r.status !== 'active') continue
    reservedByItem.set(r.item_id, (reservedByItem.get(r.item_id) ?? 0) + Number(r.qty))
  }

  const deficit = stockLines
    .map((l: any) => {
      const a = availMap.get(l.item_id)
      const reserved = reservedByItem.get(l.item_id) ?? 0
      const need = Number(l.qty) - reserved
      const free = Number(a?.available ?? 0)
      return { ...l, reserved, need, free, missing: Math.max(need - Math.max(free, 0), 0) }
    })
    .filter((l: any) => l.missing > 0.001)

  const hardAllowed = Boolean(canHard)

  return (
    <div className="space-y-4">
      {!hardAllowed && (
        <Alert tone="warn">
          <b>Жёсткий резерв заблокирован.</b> По правилам он ставится только при получении
          предоплаты либо при подписанном договоре с ключевым клиентом. Сейчас: предоплата{' '}
          {money(deal?.prepaid_amount)}, договор{' '}
          {deal?.contract_signed_at ? `от ${date(deal.contract_signed_at)}` : 'не подписан'},
          клиент {deal?.counterparty?.is_key_client ? 'ключевой' : 'обычный'}. Доступен только
          информационный резерв.
        </Alert>
      )}

      <div className="flex flex-wrap gap-2">
        <ActionForm action={reserveDeal} hideErrors>
          <input type="hidden" name="deal_id" value={id} />
          <input type="hidden" name="kind" value="soft" />
          <SubmitButton variant="secondary">
            <ShieldCheck size={16} /> Информационный резерв
          </SubmitButton>
        </ActionForm>

        <ActionForm action={reserveDeal}>
          <input type="hidden" name="deal_id" value={id} />
          <input type="hidden" name="kind" value="hard" />
          <SubmitButton variant="primary" title={hardAllowed ? '' : 'Нужна предоплата или договор с ключевым клиентом'}>
            <Lock size={16} /> Жёсткий резерв под заказ
          </SubmitButton>
        </ActionForm>

        <ActionForm action={buildDeficit}>
          <input type="hidden" name="deal_id" value={id} />
          <input type="hidden" name="required_by" value={deal?.required_ship_date ?? ''} />
          <SubmitButton variant="secondary">
            <ShoppingCart size={16} /> Сформировать лист дефицита в закуп
          </SubmitButton>
        </ActionForm>
      </div>

      <Card title="Потребность по спецификации">
        {stockLines.length === 0 ? (
          <Empty>В спецификации нет складских позиций</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Позиция</Th>
                <Th align="right">Нужно</Th>
                <Th align="right">Зарезервировано</Th>
                <Th align="right">Свободно на складе</Th>
                <Th align="right">Дефицит</Th>
              </tr>
            </thead>
            <tbody>
              {stockLines.map((l: any) => {
                const a = availMap.get(l.item_id)
                const reserved = reservedByItem.get(l.item_id) ?? 0
                const missing = Math.max(Number(l.qty) - reserved - Math.max(Number(a?.available ?? 0), 0), 0)
                return (
                  <tr key={l.id}>
                    <Td>{l.name_snapshot}</Td>
                    <Td align="right">
                      {num(l.qty)} {l.unit?.name}
                    </Td>
                    <Td align="right">
                      {reserved > 0 ? <Badge tone="blue">{num(reserved)}</Badge> : '—'}
                    </Td>
                    <Td align="right">{num(a?.available ?? 0)}</Td>
                    <Td align="right">
                      {missing > 0.001 ? (
                        <Badge tone="red">{num(missing)}</Badge>
                      ) : (
                        <Badge tone="green">покрыто</Badge>
                      )}
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        )}
      </Card>

      <Card title="Резервы по сделке">
        {(reservations ?? []).length === 0 ? (
          <Empty>Резервов нет</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Позиция</Th>
                <Th align="right">Кол-во</Th>
                <Th>Тип</Th>
                <Th>Статус</Th>
                <Th>Поставлен</Th>
                <Th>Снятие</Th>
              </tr>
            </thead>
            <tbody>
              {(reservations ?? []).map((r: any) => {
                const pending = (r.release_requests ?? []).some((x: any) => x.status === 'pending')
                return (
                  <tr key={r.id}>
                    <Td>
                      <div className="font-medium">{r.item?.name}</div>
                      <div className="text-xs text-ink-500">{r.item?.sku}</div>
                    </Td>
                    <Td align="right">{num(r.qty)}</Td>
                    <Td>
                      <Badge tone={r.kind === 'hard' ? 'violet' : 'slate'}>
                        {RESERVE_KIND_LABEL[r.kind]}
                      </Badge>
                    </Td>
                    <Td>
                      <Badge
                        tone={
                          r.status === 'active' ? 'green' : r.status === 'consumed' ? 'blue' : 'slate'
                        }
                      >
                        {r.status === 'active'
                          ? 'Активен'
                          : r.status === 'consumed'
                            ? 'Израсходован'
                            : 'Снят'}
                      </Badge>
                    </Td>
                    <Td className="text-xs text-ink-500">{date(r.created_at)}</Td>
                    <Td>
                      {r.status !== 'active' ? (
                        <span className="text-xs text-ink-400">—</span>
                      ) : r.kind === 'soft' ? (
                        <ActionForm action={releaseSoftReservation} hideErrors>
                          <input type="hidden" name="deal_id" value={id} />
                          <input type="hidden" name="reservation_id" value={r.id} />
                          <SubmitButton size="sm" variant="ghost">
                            Снять
                          </SubmitButton>
                        </ActionForm>
                      ) : pending ? (
                        <Badge tone="amber">Ждёт согласования директора</Badge>
                      ) : (
                        <ActionForm action={requestReservationRelease} className="flex gap-1">
                          <input type="hidden" name="deal_id" value={id} />
                          <input type="hidden" name="reservation_id" value={r.id} />
                          <input
                            name="reason"
                            required
                            placeholder="Причина снятия"
                            className="w-44 rounded border border-ink-200 bg-transparent px-2 py-1 text-xs dark:border-white/10"
                          />
                          <SubmitButton size="sm" variant="secondary">
                            Запросить снятие
                          </SubmitButton>
                        </ActionForm>
                      )}
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        )}
      </Card>

      {deficit.length > 0 && (
        <Alert tone="warn">
          Не покрыто {deficit.length} позиций. Нажмите «Сформировать лист дефицита», чтобы отдел
          закупа получил задачу.
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Заявки в закуп">
          {(requests ?? []).length === 0 ? (
            <Empty>Заявок нет</Empty>
          ) : (
            <ul className="divide-y divide-ink-100 dark:divide-white/5">
              {(requests ?? []).map((r: any) => (
                <li key={r.id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <Link
                      href={`/procurement/requests/${r.id}`}
                      className="font-medium text-steel-700 hover:underline dark:text-steel-500"
                    >
                      {r.number}
                    </Link>
                    <Badge tone={r.status === 'closed' ? 'green' : 'amber'}>
                      {PR_STATUS_LABEL[r.status]}
                    </Badge>
                  </div>
                  <div className="mt-1 text-xs text-ink-500">
                    {(r.items ?? []).length} позиций · создана {date(r.created_at)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Заказы поставщикам">
          {(orders ?? []).length === 0 ? (
            <Empty>Заказов нет</Empty>
          ) : (
            <ul className="divide-y divide-ink-100 dark:divide-white/5">
              {(orders ?? []).map((o: any) => (
                <li key={o.id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <Link
                      href={`/procurement/orders/${o.id}`}
                      className="font-medium text-steel-700 hover:underline dark:text-steel-500"
                    >
                      {o.number}
                    </Link>
                    <Badge tone={o.status === 'received' ? 'green' : 'blue'}>
                      {PO_STATUS_LABEL[o.status]}
                    </Badge>
                  </div>
                  <div className="mt-1 text-xs text-ink-500">
                    {o.supplier?.name} · {money(o.total)} · ожидается {date(o.eta_date)}
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
