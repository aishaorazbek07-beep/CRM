import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Badge } from '@/components/ui'
import { Tabs } from '@/components/tabs'
import { createClient } from '@/lib/supabase/server'
import { DEAL_STAGES, DEAL_STATUS_LABEL } from '@/lib/labels'
import { money } from '@/lib/format'
import { StageStepper } from './stage-stepper'

export const dynamic = 'force-dynamic'

export default async function DealLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data: deal } = await supabase
    .from('deals')
    .select('*, counterparty:counterparty_id(id, name, is_key_client, bin_iin)')
    .eq('id', id)
    .single()

  if (!deal) notFound()

  const { data: currentSpec } = await supabase
    .from('specifications')
    .select('id')
    .eq('deal_id', id)
    .eq('is_current', true)
    .maybeSingle()

  const [{ count: specCount }, { count: quoteCount }, { count: resCount }, { count: prodCount }] =
    await Promise.all([
      supabase
        .from('spec_items')
        .select('id', { count: 'exact', head: true })
        .eq('spec_id', currentSpec?.id ?? '00000000-0000-0000-0000-000000000000'),
      supabase.from('quotes').select('id', { count: 'exact', head: true }).eq('deal_id', id),
      supabase
        .from('reservations')
        .select('id', { count: 'exact', head: true })
        .eq('deal_id', id)
        .eq('status', 'active'),
      supabase
        .from('production_orders')
        .select('id', { count: 'exact', head: true })
        .eq('deal_id', id),
    ])

  const base = `/deals/${id}`
  const stageIdx = DEAL_STAGES.findIndex((s) => s.key === deal.stage)

  return (
    <>
      <div className="mb-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Link href="/deals" className="text-sm text-ink-500 hover:underline">
                Сделки
              </Link>
              <span className="text-ink-400">/</span>
              <span className="font-mono text-sm text-ink-600 dark:text-ink-300">{deal.number}</span>
              <Badge
                tone={deal.status === 'active' ? 'blue' : deal.status === 'won' ? 'green' : 'slate'}
              >
                {DEAL_STATUS_LABEL[deal.status]}
              </Badge>
            </div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">{deal.title}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-500">
              <Link href={`/counterparties/${deal.counterparty?.id}`} className="hover:underline">
                {deal.counterparty?.name}
              </Link>
              {deal.counterparty?.is_key_client && <Badge tone="amber">Ключевой клиент</Badge>}
            </div>
          </div>

          <div className="text-right">
            <div className="text-2xl font-semibold tabular-nums">{money(deal.amount)}</div>
            <div className="text-xs text-ink-500">
              себестоимость {money(deal.cost_amount)} · предоплата {money(deal.prepaid_amount)}
            </div>
          </div>
        </div>

        <StageStepper dealId={id} stage={deal.stage} stageIdx={stageIdx} />
      </div>

      <Tabs
        tabs={[
          { href: base, label: 'Обзор' },
          { href: `${base}/spec`, label: 'Спецификация', badge: specCount ?? 0 },
          { href: `${base}/quote`, label: 'КП', badge: quoteCount ?? 0 },
          { href: `${base}/supply`, label: 'Снабжение', badge: resCount ?? 0 },
          { href: `${base}/production`, label: 'Производство', badge: prodCount ?? 0 },
          { href: `${base}/costing`, label: 'Себестоимость' },
        ]}
      />

      {children}
    </>
  )
}
