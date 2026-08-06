import Link from 'next/link'
import { Download } from 'lucide-react'
import { Alert, Badge, Card, Empty, PageHeader, StatCard, Table, Td, Th } from '@/components/ui'
import { createClient } from '@/lib/supabase/server'
import { DEAL_STAGE_LABEL, PROD_STAGE_LABEL } from '@/lib/labels'
import { date, money, num, pct } from '@/lib/format'

export const dynamic = 'force-dynamic'

export default async function ReportsPage() {
  const supabase = await createClient()

  const [
    { data: costing },
    { data: dealStages },
    { data: prodStages },
    { data: subs },
    { data: managers },
  ] = await Promise.all([
    supabase.from('v_deal_costing').select('*').order('created_at', { ascending: false }).limit(100),
    supabase.from('v_deal_stage_stats').select('*'),
    supabase.from('v_production_stage_stats').select('*'),
    supabase.from('v_substitution_impact').select('*').order('created_at', { ascending: false }).limit(50),
    supabase.from('v_manager_stats').select('*'),
  ])

  const active = (costing ?? []).filter((c: any) => c.status === 'active')
  const totalRevenue = active.reduce((s: number, c: any) => s + Number(c.revenue_net), 0)
  const totalFact = active.reduce((s: number, c: any) => s + Number(c.fact_cost), 0)
  const overruns = (costing ?? []).filter((c: any) => Number(c.cost_deviation) > 0)
  const overdueReturns = (subs ?? []).filter((s: any) => s.return_overdue)

  return (
    <>
      <PageHeader
        title="Отчёты"
        subtitle="Реальная себестоимость проектов, сроки этапов и влияние замен"
        actions={
          <a
            href="/api/v1/export/deals?format=csv"
            className="inline-flex items-center gap-1.5 rounded-lg border border-ink-300 bg-white px-3.5 py-2 text-sm font-medium dark:border-white/15 dark:bg-white/5"
          >
            <Download size={16} /> Выгрузить сделки (CSV)
          </a>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Выручка по активным" value={money(totalRevenue)} />
        <StatCard label="Факт. себестоимость" value={money(totalFact)} />
        <StatCard
          label="Валовая маржа"
          value={money(totalRevenue - totalFact)}
          tone={totalRevenue - totalFact >= 0 ? 'good' : 'bad'}
          hint={pct(totalRevenue > 0 ? ((totalRevenue - totalFact) / totalRevenue) * 100 : 0)}
        />
        <StatCard
          label="Проектов с перерасходом"
          value={overruns.length}
          tone={overruns.length ? 'warn' : 'good'}
        />
      </div>

      <div className="space-y-4">
        <Card title="Себестоимость и маржа по проектам">
          {(costing ?? []).length === 0 ? (
            <Empty>Нет данных</Empty>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Сделка</Th>
                  <Th>Клиент</Th>
                  <Th>Этап</Th>
                  <Th align="right">Выручка</Th>
                  <Th align="right">План себест.</Th>
                  <Th align="right">Факт себест.</Th>
                  <Th align="right">Отклонение</Th>
                  <Th align="right">Маржа факт</Th>
                </tr>
              </thead>
              <tbody>
                {(costing ?? []).map((c: any) => (
                  <tr key={c.deal_id}>
                    <Td>
                      <Link
                        href={`/deals/${c.deal_id}/costing`}
                        className="font-medium text-steel-700 hover:underline dark:text-steel-500"
                      >
                        {c.number}
                      </Link>
                      <div className="max-w-56 truncate text-xs text-ink-500">{c.title}</div>
                    </Td>
                    <Td className="max-w-40 truncate">{c.client_name}</Td>
                    <Td>
                      <Badge tone="slate">{DEAL_STAGE_LABEL[c.stage]}</Badge>
                    </Td>
                    <Td align="right">{money(c.revenue_net)}</Td>
                    <Td align="right">{money(c.plan_cost)}</Td>
                    <Td align="right">{money(c.fact_cost)}</Td>
                    <Td align="right">
                      <span className={Number(c.cost_deviation) > 0 ? 'text-rose-600' : 'text-emerald-600'}>
                        {Number(c.cost_deviation) > 0 ? '+' : ''}
                        {money(c.cost_deviation)}
                      </span>
                    </Td>
                    <Td align="right">
                      <span className={Number(c.fact_margin) >= 0 ? 'text-emerald-600' : 'text-rose-600'}>
                        {money(c.fact_margin)}
                      </span>
                      <div className="text-xs text-ink-500">{pct(c.fact_margin_percent)}</div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Средняя длительность этапов сделки">
            {(dealStages ?? []).length === 0 ? (
              <Empty>Пока нет статистики</Empty>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Этап</Th>
                    <Th align="right">Переходов</Th>
                    <Th align="right">Среднее, дн</Th>
                    <Th align="right">Медиана, дн</Th>
                  </tr>
                </thead>
                <tbody>
                  {(dealStages ?? []).map((s: any) => (
                    <tr key={s.stage}>
                      <Td>{DEAL_STAGE_LABEL[s.stage]}</Td>
                      <Td align="right">{s.transitions}</Td>
                      <Td align="right">{num(s.avg_days, 1)}</Td>
                      <Td align="right">{num(s.median_days, 1)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          <Card title="Средняя длительность стадий производства">
            {(prodStages ?? []).length === 0 ? (
              <Empty>Пока нет статистики</Empty>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Стадия</Th>
                    <Th align="right">Переходов</Th>
                    <Th align="right">Среднее, ч</Th>
                    <Th align="right">Медиана, ч</Th>
                    <Th align="right">Макс, ч</Th>
                  </tr>
                </thead>
                <tbody>
                  {(prodStages ?? []).map((s: any) => (
                    <tr key={s.stage}>
                      <Td>{PROD_STAGE_LABEL[s.stage]}</Td>
                      <Td align="right">{s.transitions}</Td>
                      <Td align="right">{num(s.avg_hours, 1)}</Td>
                      <Td align="right">{num(s.median_hours, 1)}</Td>
                      <Td align="right">{num(s.max_hours, 1)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>

        {overdueReturns.length > 0 && (
          <Alert tone="warn">
            {overdueReturns.length} временных подмен просрочили плановую дату возврата штатной
            позиции — проверьте раздел ниже.
          </Alert>
        )}

        <Card title="Замены и подмены: влияние на смету">
          {(subs ?? []).length === 0 ? (
            <Empty>Замен не было</Empty>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Дата</Th>
                  <Th>Сделка</Th>
                  <Th>Было → стало</Th>
                  <Th align="right">Δ себестоимости</Th>
                  <Th align="right">Δ срока, дн</Th>
                  <Th>Тип</Th>
                  <Th>Возврат</Th>
                </tr>
              </thead>
              <tbody>
                {(subs ?? []).map((s: any) => (
                  <tr key={s.id}>
                    <Td className="text-xs">{date(s.created_at)}</Td>
                    <Td>
                      {s.deal_number}
                      <div className="max-w-44 truncate text-xs text-ink-500">{s.deal_title}</div>
                    </Td>
                    <Td className="max-w-72 text-xs">
                      <div className="text-ink-500 line-through">{s.from_name}</div>
                      <div className="font-medium">{s.to_name}</div>
                    </Td>
                    <Td align="right">
                      <span className={Number(s.cost_delta) > 0 ? 'text-rose-600' : 'text-emerald-600'}>
                        {Number(s.cost_delta) > 0 ? '+' : ''}
                        {money(s.cost_delta)}
                      </span>
                    </Td>
                    <Td align="right">{s.lead_time_delta}</Td>
                    <Td>
                      <Badge tone={s.substitution_type === 'temporary' ? 'amber' : 'slate'}>
                        {s.substitution_type === 'temporary' ? 'временная' : 'постоянная'}
                      </Badge>
                    </Td>
                    <Td>
                      {s.return_date ? (
                        <span className={s.return_overdue ? 'font-medium text-rose-600' : ''}>
                          {date(s.return_date)}
                        </span>
                      ) : (
                        '—'
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card title="Менеджеры">
          <Table>
            <thead>
              <tr>
                <Th>Менеджер</Th>
                <Th align="right">Активных сделок</Th>
                <Th align="right">Сумма активных</Th>
                <Th align="right">Выиграно</Th>
                <Th align="right">Сумма выигранных</Th>
              </tr>
            </thead>
            <tbody>
              {(managers ?? []).map((m: any) => (
                <tr key={m.manager_id}>
                  <Td>{m.full_name}</Td>
                  <Td align="right">{m.active_deals}</Td>
                  <Td align="right">{money(m.active_amount)}</Td>
                  <Td align="right">{m.won_deals}</Td>
                  <Td align="right">{money(m.won_amount)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>

        <Card title="Выгрузка данных для внешней аналитики (Grok / Gemini / BI)">
          <div className="space-y-2 p-4 text-sm">
            <p className="text-ink-600 dark:text-ink-300">
              Открытый REST-API отдаёт данные в JSON или CSV. Ключ передаётся заголовком{' '}
              <code className="rounded bg-ink-100 px-1 dark:bg-white/10">x-api-key</code> или
              параметром <code className="rounded bg-ink-100 px-1 dark:bg-white/10">?key=</code>.
            </p>
            <ul className="space-y-1 font-mono text-xs">
              <li>GET /api/v1/export/deals — сделки с планом и фактом себестоимости</li>
              <li>GET /api/v1/export/specifications — строки спецификаций</li>
              <li>GET /api/v1/export/substitutions — замены и подмены</li>
              <li>GET /api/v1/export/stock — остатки, резервы, дефицит</li>
              <li>GET /api/v1/export/purchases — заказы поставщикам и сроки</li>
              <li>GET /api/v1/export/production — производственные заказы и стадии</li>
              <li>GET /api/v1/export/stage-durations — длительность этапов</li>
            </ul>
            <p className="text-xs text-ink-500">
              Параметры: <code>?format=csv|json</code>, <code>?from=YYYY-MM-DD</code>,{' '}
              <code>?to=YYYY-MM-DD</code>, <code>?limit=1000</code>
            </p>
          </div>
        </Card>
      </div>
    </>
  )
}
