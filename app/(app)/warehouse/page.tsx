import Link from 'next/link'
import { Search } from 'lucide-react'
import { Badge, Card, Empty, Input, PageHeader, Select, StatCard, Table, Td, Th } from '@/components/ui'
import { Tabs } from '@/components/tabs'
import { createClient } from '@/lib/supabase/server'
import { WAREHOUSE_KIND_LABEL } from '@/lib/labels'
import { money, num } from '@/lib/format'

export const dynamic = 'force-dynamic'

export default async function WarehousePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; grade?: string; only?: string }>
}) {
  const sp = await searchParams
  const supabase = await createClient()

  const [{ data: warehouses }, { data: balances }] = await Promise.all([
    supabase.from('warehouses').select('*').order('sort_order'),
    supabase.from('v_stock_balances').select('*'),
  ])

  let q = supabase.from('v_item_availability').select('*').order('name').limit(500)
  if (sp.q) q = q.or(`name.ilike.%${sp.q}%,sku.ilike.%${sp.q}%`)
  if (sp.grade) q = q.eq('steel_grade', sp.grade)
  const { data: avail } = await q

  const rows = (avail ?? []).filter((a: any) => {
    if (sp.only === 'below') return a.below_min
    if (sp.only === 'instock') return Number(a.on_hand) > 0
    if (sp.only === 'reserved') return Number(a.hard_reserved) > 0
    return true
  })

  const byItemWh = new Map<string, Map<string, number>>()
  for (const b of balances ?? []) {
    if (!byItemWh.has(b.item_id)) byItemWh.set(b.item_id, new Map())
    byItemWh.get(b.item_id)!.set(b.warehouse_id, Number(b.qty))
  }

  const totalReserved = (avail ?? []).reduce((s: number, a: any) => s + Number(a.hard_reserved), 0)
  const belowMin = (avail ?? []).filter((a: any) => a.below_min).length

  return (
    <>
      <PageHeader title="Склад" subtitle="Остатки, резервы и партии с сертификатами плавок" />

      <Tabs
        tabs={[
          { href: '/warehouse', label: 'Остатки' },
          { href: '/warehouse/batches', label: 'Партии и сертификаты' },
          { href: '/warehouse/moves', label: 'Движения' },
        ]}
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Позиций с остатком" value={(avail ?? []).filter((a: any) => Number(a.on_hand) > 0).length} />
        <StatCard label="Ниже минимума" value={belowMin} tone={belowMin ? 'warn' : 'good'} href="/procurement" />
        <StatCard label="В жёстком резерве, ед." value={num(totalReserved)} />
        <StatCard label="Складов / зон" value={(warehouses ?? []).length} />
      </div>

      <form className="mb-4 flex flex-wrap items-end gap-2">
        <div className="relative min-w-56 flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
          <Input name="q" defaultValue={sp.q ?? ''} placeholder="Поиск: задвижка, лист, привод" className="pl-9" />
        </div>
        <Select name="grade" defaultValue={sp.grade ?? ''} className="w-40">
          <option value="">Все марки</option>
          <option value="304">AISI 304</option>
          <option value="316">AISI 316</option>
          <option value="316L">AISI 316L</option>
          <option value="09Г2С">09Г2С</option>
        </Select>
        <Select name="only" defaultValue={sp.only ?? ''} className="w-52">
          <option value="">Все позиции</option>
          <option value="instock">Только с остатком</option>
          <option value="below">Ниже неснижаемого остатка</option>
          <option value="reserved">С жёстким резервом</option>
        </Select>
        <button className="rounded-lg bg-steel-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-steel-700">
          Показать
        </button>
      </form>

      <Card>
        {rows.length === 0 ? (
          <Empty>Ничего не найдено</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Позиция</Th>
                <Th>Марка</Th>
                {(warehouses ?? []).map((w: any) => (
                  <Th key={w.id} align="right">
                    {w.name}
                    <div className="font-normal normal-case text-ink-400">
                      {WAREHOUSE_KIND_LABEL[w.kind]}
                    </div>
                  </Th>
                ))}
                <Th align="right">Всего</Th>
                <Th align="right">Резерв</Th>
                <Th align="right">Свободно</Th>
                <Th align="right">Минимум</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a: any) => {
                const wh = byItemWh.get(a.item_id) ?? new Map()
                return (
                  <tr key={a.item_id} className={a.below_min ? 'bg-amber-50/60 dark:bg-amber-500/5' : ''}>
                    <Td>
                      <Link
                        href={`/catalog/${a.item_id}`}
                        className="font-medium text-steel-700 hover:underline dark:text-steel-500"
                      >
                        {a.name}
                      </Link>
                      <div className="font-mono text-xs text-ink-500">{a.sku}</div>
                    </Td>
                    <Td>{a.steel_grade ? <Badge tone="slate">{a.steel_grade}</Badge> : '—'}</Td>
                    {(warehouses ?? []).map((w: any) => (
                      <Td key={w.id} align="right">
                        {wh.get(w.id) ? num(wh.get(w.id)) : <span className="text-ink-300">—</span>}
                      </Td>
                    ))}
                    <Td align="right" className="font-medium">
                      {num(a.on_hand)}
                    </Td>
                    <Td align="right">
                      {Number(a.hard_reserved) > 0 ? (
                        <Badge tone="violet">{num(a.hard_reserved)}</Badge>
                      ) : (
                        '—'
                      )}
                    </Td>
                    <Td align="right">
                      <span className={Number(a.available) <= 0 ? 'text-rose-600' : 'text-emerald-600'}>
                        {num(a.available)}
                      </span>
                    </Td>
                    <Td align="right">
                      {Number(a.min_stock) > 0 ? (
                        <span className={a.below_min ? 'font-medium text-amber-700' : 'text-ink-500'}>
                          {num(a.min_stock)}
                        </span>
                      ) : (
                        '—'
                      )}
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
