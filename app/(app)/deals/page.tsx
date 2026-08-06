import Link from 'next/link'
import { Plus, Search } from 'lucide-react'
import {
  Badge,
  Card,
  Empty,
  Input,
  LinkButton,
  PageHeader,
  Select,
  Table,
  Td,
  Th,
  cn,
} from '@/components/ui'
import { createClient } from '@/lib/supabase/server'
import { DEAL_STAGES, DEAL_STAGE_LABEL, DEAL_STATUS_LABEL, SOURCE_LABEL } from '@/lib/labels'
import { date, money, pct } from '@/lib/format'
import { requireProfile } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export default async function DealsPage({
  searchParams,
}: {
  searchParams: Promise<{ stage?: string; q?: string; status?: string; mine?: string }>
}) {
  const sp = await searchParams
  const profile = await requireProfile()
  const supabase = await createClient()

  let query = supabase
    .from('deals')
    .select(
      'id, number, title, stage, status, amount, cost_amount, source, required_ship_date, created_at, prepaid_amount, counterparty:counterparty_id(name), manager:manager_id(full_name)'
    )
    .order('created_at', { ascending: false })
    .limit(200)

  if (sp.stage) query = query.eq('stage', sp.stage)
  query = query.eq('status', sp.status ?? 'active')
  if (sp.mine === '1') query = query.eq('manager_id', profile.id)
  if (sp.q) query = query.or(`title.ilike.%${sp.q}%,number.ilike.%${sp.q}%`)

  const { data: deals } = await query

  const { data: pipeline } = await supabase.from('v_pipeline').select('*')
  const counts: Record<string, number> = Object.fromEntries(
    (pipeline ?? []).map((p: any) => [p.stage, Number(p.deals_count)])
  )

  const total = (deals ?? []).reduce((s, d: any) => s + Number(d.amount), 0)

  return (
    <>
      <PageHeader
        title="Сделки"
        subtitle={`${(deals ?? []).length} шт · ${money(total)}`}
        actions={
          <LinkButton href="/deals/new" variant="primary">
            <Plus size={16} /> Новая сделка
          </LinkButton>
        }
      />

      <form className="mb-4 flex flex-wrap items-end gap-2">
        <div className="relative min-w-56 flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
          <Input
            name="q"
            defaultValue={sp.q ?? ''}
            placeholder="Номер или название сделки"
            className="pl-9"
          />
        </div>
        <Select name="status" defaultValue={sp.status ?? 'active'} className="w-44">
          {Object.entries(DEAL_STATUS_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-2 rounded-lg border border-ink-300 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-white/5">
          <input type="checkbox" name="mine" value="1" defaultChecked={sp.mine === '1'} />
          Только мои
        </label>
        <button className="rounded-lg bg-steel-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-steel-700">
          Применить
        </button>
      </form>

      <div className="mb-4 flex flex-wrap gap-1.5">
        <Link
          href="/deals"
          className={cn(
            'rounded-lg border px-2.5 py-1.5 text-xs font-medium transition',
            !sp.stage
              ? 'border-steel-600 bg-steel-600 text-white'
              : 'border-ink-200 bg-white text-ink-600 hover:border-steel-500 dark:border-white/10 dark:bg-white/5 dark:text-ink-300'
          )}
        >
          Все этапы
        </Link>
        {DEAL_STAGES.map((s) => (
          <Link
            key={s.key}
            href={`/deals?stage=${s.key}`}
            className={cn(
              'rounded-lg border px-2.5 py-1.5 text-xs font-medium transition',
              sp.stage === s.key
                ? 'border-steel-600 bg-steel-600 text-white'
                : 'border-ink-200 bg-white text-ink-600 hover:border-steel-500 dark:border-white/10 dark:bg-white/5 dark:text-ink-300'
            )}
          >
            {s.short}
            <span className="ml-1.5 opacity-60">{counts[s.key] ?? 0}</span>
          </Link>
        ))}
      </div>

      <Card>
        {(deals ?? []).length === 0 ? (
          <Empty>Сделок не найдено</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Сделка</Th>
                <Th>Клиент</Th>
                <Th>Этап</Th>
                <Th align="right">Сумма</Th>
                <Th align="right">Маржа</Th>
                <Th align="right">Предоплата</Th>
                <Th>Срок отгрузки</Th>
                <Th>Менеджер</Th>
              </tr>
            </thead>
            <tbody>
              {(deals ?? []).map((d: any) => {
                const margin = Number(d.amount) - Number(d.cost_amount)
                const marginPct = Number(d.amount) > 0 ? (margin / Number(d.amount)) * 100 : 0
                const stageIdx = DEAL_STAGES.findIndex((s) => s.key === d.stage)
                return (
                  <tr key={d.id} className="hover:bg-ink-50/70 dark:hover:bg-white/5">
                    <Td>
                      <Link
                        href={`/deals/${d.id}`}
                        className="font-medium text-steel-700 hover:underline dark:text-steel-500"
                      >
                        {d.number}
                      </Link>
                      <div className="max-w-72 truncate text-xs text-ink-500">{d.title}</div>
                    </Td>
                    <Td>
                      <div className="max-w-52 truncate">{d.counterparty?.name}</div>
                      <div className="text-xs text-ink-500">{SOURCE_LABEL[d.source]}</div>
                    </Td>
                    <Td>
                      <Badge tone={stageIdx >= 5 ? 'violet' : stageIdx >= 3 ? 'blue' : 'slate'}>
                        {DEAL_STAGE_LABEL[d.stage]}
                      </Badge>
                    </Td>
                    <Td align="right">{money(d.amount)}</Td>
                    <Td align="right">
                      <span className={margin < 0 ? 'text-rose-600' : 'text-emerald-600'}>
                        {money(margin)}
                      </span>
                      <div className="text-xs text-ink-500">{pct(marginPct)}</div>
                    </Td>
                    <Td align="right">
                      {Number(d.prepaid_amount) > 0 ? (
                        <Badge tone="green">{money(d.prepaid_amount)}</Badge>
                      ) : (
                        <span className="text-ink-400">—</span>
                      )}
                    </Td>
                    <Td>{date(d.required_ship_date)}</Td>
                    <Td>{d.manager?.full_name ?? '—'}</Td>
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
