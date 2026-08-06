import Link from 'next/link'
import { AlertTriangle, PackageSearch, Timer } from 'lucide-react'
import { Badge, Card, Empty, PageHeader, StatCard, Table, Td, Th } from '@/components/ui'
import { createClient } from '@/lib/supabase/server'
import { requireProfile } from '@/lib/auth'
import { DEAL_STAGES, PROD_STAGE_LABEL, PO_STATUS_LABEL, TASK_TYPE_LABEL } from '@/lib/labels'
import { date, money, num } from '@/lib/format'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const profile = await requireProfile()
  const supabase = await createClient()

  const [
    { data: pipeline },
    { data: costing },
    { data: deficit },
    { data: watchlist },
    { data: board },
    { data: tasks },
  ] = await Promise.all([
    supabase.from('v_pipeline').select('*'),
    supabase.from('v_deal_costing').select('*').eq('status', 'active'),
    supabase.from('v_deficit_overview').select('*').limit(200),
    supabase.from('v_purchase_watchlist').select('*').order('eta_date', { ascending: true }),
    supabase.from('v_production_board').select('*').neq('stage', 'shipped'),
    supabase
      .from('tasks')
      .select('*')
      .eq('status', 'open')
      .or(`assignee_role.eq.${profile.role},assignee_id.eq.${profile.id}`)
      .order('priority')
      .limit(8),
  ])

  const activeAmount = (pipeline ?? []).reduce((s, r: any) => s + Number(r.amount), 0)
  const activeCount = (pipeline ?? []).reduce((s, r: any) => s + Number(r.deals_count), 0)
  const factMargin = (costing ?? []).reduce((s, r: any) => s + Number(r.fact_margin ?? 0), 0)
  const deviation = (costing ?? []).filter((r: any) => Number(r.cost_deviation) > 0)
  const belowMin = (deficit ?? []).filter((r: any) => Number(r.below_min_qty) > 0)
  const overdue = (watchlist ?? []).filter((r: any) => r.is_overdue)
  const waiting = (board ?? []).filter((r: any) => r.stage === 'waiting_components')

  return (
    <>
      <PageHeader
        title={`Здравствуйте, ${profile.full_name.split(' ')[0]}`}
        subtitle="Оперативная сводка по продажам, снабжению и цеху"
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Активные сделки"
          value={activeCount}
          hint={money(activeAmount)}
          href="/deals"
        />
        <StatCard
          label="Маржа по активным (факт)"
          value={money(factMargin)}
          tone={factMargin >= 0 ? 'good' : 'bad'}
          hint={`Перерасход по ${deviation.length} проектам`}
          href="/reports"
        />
        <StatCard
          label="Позиции ниже минимума"
          value={belowMin.length}
          tone={belowMin.length ? 'warn' : 'good'}
          hint="Неснижаемый остаток"
          href="/procurement"
        />
        <StatCard
          label="Просроченные поставки"
          value={overdue.length}
          tone={overdue.length ? 'bad' : 'good'}
          hint={`${(watchlist ?? []).length} заказов в работе`}
          href="/procurement/orders"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Воронка сделок" className="xl:col-span-2">
          <div className="divide-y divide-ink-100 dark:divide-white/5">
            {DEAL_STAGES.map((stage) => {
              const row: any = (pipeline ?? []).find((p: any) => p.stage === stage.key)
              const count = Number(row?.deals_count ?? 0)
              const amount = Number(row?.amount ?? 0)
              const width = activeAmount > 0 ? Math.round((amount / activeAmount) * 100) : 0
              return (
                <Link
                  key={stage.key}
                  href={`/deals?stage=${stage.key}`}
                  className="flex items-center gap-3 px-4 py-2.5 transition hover:bg-ink-50 dark:hover:bg-white/5"
                >
                  <span className="w-52 shrink-0 text-sm">{stage.label}</span>
                  <span className="w-10 shrink-0 text-sm font-semibold tabular-nums">{count}</span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-ink-100 dark:bg-white/10">
                    <span
                      className="block h-full rounded-full bg-steel-500"
                      style={{ width: `${width}%` }}
                    />
                  </span>
                  <span className="w-32 shrink-0 text-right text-sm tabular-nums text-ink-600 dark:text-ink-300">
                    {money(amount)}
                  </span>
                </Link>
              )
            })}
          </div>
        </Card>

        <Card title="Мои задачи">
          {(tasks ?? []).length === 0 ? (
            <Empty>Открытых задач нет</Empty>
          ) : (
            <ul className="divide-y divide-ink-100 dark:divide-white/5">
              {(tasks ?? []).map((t: any) => (
                <li key={t.id} className="px-4 py-2.5">
                  <div className="flex items-start gap-2">
                    {t.priority === 1 ? (
                      <AlertTriangle size={15} className="mt-0.5 shrink-0 text-rose-500" />
                    ) : (
                      <PackageSearch size={15} className="mt-0.5 shrink-0 text-ink-400" />
                    )}
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{t.title}</div>
                      <div className="text-xs text-ink-500">
                        {TASK_TYPE_LABEL[t.type]} · {date(t.created_at)}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Цех: заказы в работе" className="xl:col-span-2">
          {(board ?? []).length === 0 ? (
            <Empty>Нет активных производственных заказов</Empty>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Заказ</Th>
                  <Th>Стадия</Th>
                  <Th>Клиент</Th>
                  <Th align="right">В стадии, ч</Th>
                  <Th align="right">Срок</Th>
                </tr>
              </thead>
              <tbody>
                {(board ?? []).slice(0, 8).map((r: any) => (
                  <tr key={r.id}>
                    <Td>
                      <Link href={`/production/${r.id}`} className="font-medium text-steel-700 hover:underline dark:text-steel-500">
                        {r.number}
                      </Link>
                      <div className="text-xs text-ink-500">{r.title}</div>
                    </Td>
                    <Td>
                      <Badge tone={r.stage === 'waiting_components' ? 'amber' : 'blue'}>
                        {PROD_STAGE_LABEL[r.stage]}
                      </Badge>
                      {Number(r.missing_positions) > 0 && (
                        <div className="mt-1 text-xs text-rose-600">
                          не хватает позиций: {r.missing_positions}
                        </div>
                      )}
                    </Td>
                    <Td>{r.client_name}</Td>
                    <Td align="right">{num(r.hours_in_stage, 1)}</Td>
                    <Td align="right">{date(r.planned_finish)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card title="Поставки под контролем">
          {(watchlist ?? []).length === 0 ? (
            <Empty>Нет открытых заказов поставщикам</Empty>
          ) : (
            <ul className="divide-y divide-ink-100 dark:divide-white/5">
              {(watchlist ?? []).slice(0, 8).map((r: any) => (
                <li key={r.id} className="flex items-start gap-2 px-4 py-2.5">
                  <Timer
                    size={15}
                    className={`mt-0.5 shrink-0 ${r.is_overdue ? 'text-rose-500' : 'text-ink-400'}`}
                  />
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/procurement/orders/${r.id}`}
                      className="text-sm font-medium hover:underline"
                    >
                      {r.number}
                    </Link>
                    <div className="truncate text-xs text-ink-500">{r.supplier_name}</div>
                  </div>
                  <div className="text-right">
                    <Badge tone={r.is_overdue ? 'red' : 'slate'}>{PO_STATUS_LABEL[r.status]}</Badge>
                    <div className="mt-0.5 text-xs text-ink-500">{date(r.eta_date)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {waiting.length > 0 && (
        <div className="mt-4">
          <Card title="Ожидают комплектующих — запуск в цех заблокирован">
            <Table>
              <thead>
                <tr>
                  <Th>Заказ</Th>
                  <Th>Изделие</Th>
                  <Th>Сделка</Th>
                  <Th align="right">Не хватает позиций</Th>
                </tr>
              </thead>
              <tbody>
                {waiting.map((r: any) => (
                  <tr key={r.id}>
                    <Td>
                      <Link href={`/production/${r.id}`} className="font-medium text-steel-700 hover:underline dark:text-steel-500">
                        {r.number}
                      </Link>
                    </Td>
                    <Td>{r.title}</Td>
                    <Td>{r.deal_number}</Td>
                    <Td align="right">
                      <Badge tone={Number(r.missing_positions) > 0 ? 'red' : 'green'}>
                        {r.missing_positions}
                      </Badge>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </div>
      )}
    </>
  )
}
