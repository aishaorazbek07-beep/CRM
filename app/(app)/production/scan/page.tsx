import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { Badge, Card, PageHeader } from '@/components/ui'
import { createClient } from '@/lib/supabase/server'
import { PROD_STAGE_LABEL } from '@/lib/labels'
import { num } from '@/lib/format'
import { ScanForm } from './scan-form'

export const dynamic = 'force-dynamic'

export default async function ScanPage() {
  const supabase = await createClient()

  const { data: board } = await supabase
    .from('v_production_board')
    .select('*')
    .neq('stage', 'shipped')
    .order('priority')

  return (
    <>
      <Link
        href="/production"
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-ink-500 hover:underline"
      >
        <ArrowLeft size={15} /> К доске
      </Link>

      <PageHeader
        title="Режим цеха"
        subtitle="Отсканируйте штрихкод маршрутного листа или нажмите кнопку у заказа"
      />

      <div className="mb-6">
        <ScanForm />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {(board ?? []).map((o: any) => (
          <Card key={o.id}>
            <div className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-mono text-xs text-ink-500">{o.number}</div>
                  <div className="text-base font-semibold">{o.title}</div>
                  <div className="text-xs text-ink-500">{o.client_name}</div>
                </div>
                <Badge tone={o.stage === 'waiting_components' ? 'amber' : 'blue'}>
                  {PROD_STAGE_LABEL[o.stage]}
                </Badge>
              </div>

              <div className="mt-2 text-xs text-ink-500">
                {num(o.hours_in_stage, 1)} ч в текущей стадии
                {Number(o.missing_positions) > 0 && (
                  <span className="ml-2 font-medium text-rose-600">
                    нет {o.missing_positions} поз.
                  </span>
                )}
              </div>

              <div className="mt-3">
                <ScanForm compact barcode={o.barcode} />
              </div>
            </div>
          </Card>
        ))}
      </div>
    </>
  )
}
