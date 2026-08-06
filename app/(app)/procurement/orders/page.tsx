import Link from 'next/link'
import { Badge, Card, Empty, PageHeader, StatCard, Table, Td, Th } from '@/components/ui'
import { Tabs } from '@/components/tabs'
import { createClient } from '@/lib/supabase/server'
import { PO_STATUS, PO_STATUS_LABEL } from '@/lib/labels'
import { date, money } from '@/lib/format'

export const dynamic = 'force-dynamic'

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  const sp = await searchParams
  const supabase = await createClient()

  let q = supabase
    .from('purchase_orders')
    .select('*, supplier:supplier_id(name), deal:deal_id(id, number)')
    .order('created_at', { ascending: false })
    .limit(200)
  if (sp.status) q = q.eq('status', sp.status)

  const [{ data: orders }, { data: watchlist }] = await Promise.all([
    q,
    supabase.from('v_purchase_watchlist').select('*'),
  ])

  const overdue = (watchlist ?? []).filter((w: any) => w.is_overdue)
  const soon = (watchlist ?? []).filter(
    (w: any) => !w.is_overdue && w.days_left != null && Number(w.days_left) <= 7
  )

  return (
    <>
      <PageHeader
        title="Заказы поставщикам"
        subtitle="Заказано → Оплачено → В пути → На складе"
      />

      <Tabs
        tabs={[
          { href: '/procurement', label: 'Дефицит и заявки' },
          { href: '/procurement/orders', label: 'Заказы поставщикам' },
        ]}
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="В работе" value={(watchlist ?? []).length} />
        <StatCard label="Просрочено" value={overdue.length} tone={overdue.length ? 'bad' : 'good'} />
        <StatCard label="Придёт в течение недели" value={soon.length} />
        <StatCard
          label="Сумма в пути"
          value={money((watchlist ?? []).reduce((s: number, w: any) => s + Number(w.total), 0))}
        />
      </div>

      <div className="mb-4 flex flex-wrap gap-1.5">
        <Link
          href="/procurement/orders"
          className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium ${
            !sp.status ? 'border-steel-600 bg-steel-600 text-white' : 'border-ink-200 bg-white dark:border-white/10 dark:bg-white/5'
          }`}
        >
          Все
        </Link>
        {PO_STATUS.map((s) => (
          <Link
            key={s.key}
            href={`/procurement/orders?status=${s.key}`}
            className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium ${
              sp.status === s.key
                ? 'border-steel-600 bg-steel-600 text-white'
                : 'border-ink-200 bg-white dark:border-white/10 dark:bg-white/5'
            }`}
          >
            {s.label}
          </Link>
        ))}
      </div>

      <Card>
        {(orders ?? []).length === 0 ? (
          <Empty>Заказов нет</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Заказ</Th>
                <Th>Поставщик</Th>
                <Th>Сделка</Th>
                <Th align="right">Сумма</Th>
                <Th>Статус</Th>
                <Th>Ожидается</Th>
              </tr>
            </thead>
            <tbody>
              {(orders ?? []).map((o: any) => {
                const late = o.eta_date && new Date(o.eta_date) < new Date() && o.status !== 'received'
                return (
                  <tr key={o.id} className={late ? 'bg-rose-50/60 dark:bg-rose-500/5' : ''}>
                    <Td>
                      <Link
                        href={`/procurement/orders/${o.id}`}
                        className="font-medium text-steel-700 hover:underline dark:text-steel-500"
                      >
                        {o.number}
                      </Link>
                      <div className="text-xs text-ink-500">{date(o.created_at)}</div>
                    </Td>
                    <Td>{o.supplier?.name}</Td>
                    <Td>
                      {o.deal ? (
                        <Link href={`/deals/${o.deal.id}`} className="hover:underline">
                          {o.deal.number}
                        </Link>
                      ) : (
                        <span className="text-ink-400">склад</span>
                      )}
                    </Td>
                    <Td align="right">{money(o.total)}</Td>
                    <Td>
                      <Badge
                        tone={
                          o.status === 'received'
                            ? 'green'
                            : o.status === 'in_transit'
                              ? 'blue'
                              : o.status === 'paid'
                                ? 'violet'
                                : 'slate'
                        }
                      >
                        {PO_STATUS_LABEL[o.status]}
                      </Badge>
                    </Td>
                    <Td>
                      <span className={late ? 'font-medium text-rose-600' : ''}>{date(o.eta_date)}</span>
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  )
}
