import Link from 'next/link'
import { AlertTriangle, ScanLine } from 'lucide-react'
import { Badge, Card, LinkButton, PageHeader, StatCard, cn } from '@/components/ui'
import { createClient } from '@/lib/supabase/server'
import { PROD_STAGES, PROD_STAGE_LABEL } from '@/lib/labels'
import { date, num } from '@/lib/format'

export const dynamic = 'force-dynamic'

export default async function ProductionBoardPage() {
  const supabase = await createClient()

  const [{ data: board }, { data: stats }] = await Promise.all([
    supabase.from('v_production_board').select('*').order('priority').order('planned_finish'),
    supabase.from('v_production_stage_stats').select('*'),
  ])

  const active = (board ?? []).filter((o: any) => o.stage !== 'shipped')
  const blocked = active.filter((o: any) => Number(o.missing_positions) > 0)
  const overdue = active.filter(
    (o: any) => o.planned_finish && new Date(o.planned_finish) < new Date()
  )

  const byStage = new Map<string, any[]>()
  for (const o of active) {
    if (!byStage.has(o.stage)) byStage.set(o.stage, [])
    byStage.get(o.stage)!.push(o)
  }

  return (
    <>
      <PageHeader
        title="Производство"
        subtitle="Маршрутные листы по стадиям · переход фиксирует мастер цеха"
        actions={
          <LinkButton href="/production/scan" variant="primary">
            <ScanLine size={16} /> Режим цеха (планшет)
          </LinkButton>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Заказов в работе" value={active.length} />
        <StatCard
          label="Заблокировано (нет комплектующих)"
          value={blocked.length}
          tone={blocked.length ? 'bad' : 'good'}
        />
        <StatCard label="Просрочено по плану" value={overdue.length} tone={overdue.length ? 'warn' : 'good'} />
        <StatCard
          label="Готово к отгрузке"
          value={(byStage.get('ready_to_ship') ?? []).length}
          tone="good"
        />
      </div>

      <div className="grid gap-3 overflow-x-auto pb-2 xl:grid-cols-4">
        {PROD_STAGES.filter((s) => s.key !== 'shipped').map((stage) => {
          const orders = byStage.get(stage.key) ?? []
          return (
            <div key={stage.key} className="min-w-64">
              <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-sm font-semibold">{stage.label}</span>
                <span className="rounded bg-ink-100 px-1.5 py-0.5 text-xs text-ink-600 dark:bg-white/10 dark:text-ink-300">
                  {orders.length}
                </span>
              </div>
              <div className="space-y-2">
                {orders.length === 0 && (
                  <div className="rounded-lg border border-dashed border-ink-200 px-3 py-6 text-center text-xs text-ink-400 dark:border-white/10">
                    пусто
                  </div>
                )}
                {orders.map((o: any) => (
                  <Link
                    key={o.id}
                    href={`/production/${o.id}`}
                    className={cn(
                      'block rounded-lg border bg-white p-3 shadow-sm transition hover:border-steel-500 dark:bg-white/[0.03]',
                      Number(o.missing_positions) > 0
                        ? 'border-rose-300 dark:border-rose-500/40'
                        : 'border-ink-200 dark:border-white/10'
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs text-ink-500">{o.number}</span>
                      {o.priority === 1 && <Badge tone="red">срочно</Badge>}
                    </div>
                    <div className="mt-1 text-sm font-medium">{o.title}</div>
                    <div className="mt-1 truncate text-xs text-ink-500">{o.client_name}</div>
                    <div className="mt-2 flex items-center justify-between text-xs">
                      <span className="text-ink-500">{num(o.hours_in_stage, 1)} ч в стадии</span>
                      <span
                        className={cn(
                          o.planned_finish && new Date(o.planned_finish) < new Date()
                            ? 'font-medium text-rose-600'
                            : 'text-ink-500'
                        )}
                      >
                        {date(o.planned_finish)}
                      </span>
                    </div>
                    {Number(o.missing_positions) > 0 && (
                      <div className="mt-2 flex items-center gap-1 text-xs font-medium text-rose-600">
                        <AlertTriangle size={13} /> не хватает {o.missing_positions} поз.
                      </div>
                    )}
                  </Link>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      <div className="mt-6">
        <Card title="Средняя длительность стадий (для планирования сроков)">
          <div className="grid gap-px bg-ink-100 sm:grid-cols-2 lg:grid-cols-4 dark:bg-white/10">
            {PROD_STAGES.map((s) => {
              const st: any = (stats ?? []).find((x: any) => x.stage === s.key)
              return (
                <div key={s.key} className="bg-white p-4 dark:bg-[#12161d]">
                  <div className="text-xs text-ink-500">{PROD_STAGE_LABEL[s.key]}</div>
                  <div className="mt-1 text-lg font-semibold tabular-nums">
                    {st ? `${num(st.avg_hours, 1)} ч` : '—'}
                  </div>
                  <div className="text-xs text-ink-500">
                    {st ? `медиана ${num(st.median_hours, 1)} ч · ${st.transitions} переходов` : 'нет данных'}
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      </div>
    </>
  )
}
