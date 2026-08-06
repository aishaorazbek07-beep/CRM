import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Printer } from 'lucide-react'
import { Card } from '@/components/ui'
import { createClient } from '@/lib/supabase/server'
import { date, money, num } from '@/lib/format'

export const dynamic = 'force-dynamic'

export default async function QuoteDocPage({
  params,
}: {
  params: Promise<{ id: string; quoteId: string }>
}) {
  const { id, quoteId } = await params
  const supabase = await createClient()

  const { data: quote } = await supabase
    .from('quotes')
    .select(
      '*, deal:deal_id(number, title, counterparty:counterparty_id(name, full_name, bin_iin, address)), author:created_by(full_name, phone, position)'
    )
    .eq('id', quoteId)
    .single()

  if (!quote) notFound()

  const [{ data: spec }, { data: lines }, { data: settings }] = await Promise.all([
    supabase.from('specifications').select('*').eq('id', quote.spec_id).single(),
    supabase
      .from('spec_items')
      .select('*, unit:unit_id(name)')
      .eq('spec_id', quote.spec_id)
      .order('section')
      .order('line_no'),
    supabase.from('settings').select('*').single(),
  ])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between no-print">
        <Link
          href={`/deals/${id}/quote`}
          className="inline-flex items-center gap-1.5 text-sm text-ink-500 hover:underline"
        >
          <ArrowLeft size={15} /> К списку КП
        </Link>
        <PrintHint />
      </div>

      <Card className="mx-auto max-w-4xl">
        <div className="space-y-6 p-8 print:p-0">
          <header className="flex items-start justify-between gap-6 border-b border-ink-200 pb-4 dark:border-white/10">
            <div>
              <div className="text-lg font-bold">{settings?.company_name}</div>
              <div className="mt-1 text-xs text-ink-500">
                {settings?.company_address && <div>{settings.company_address}</div>}
                {settings?.company_bin && <div>БИН {settings.company_bin}</div>}
                {settings?.company_phone && <div>тел. {settings.company_phone}</div>}
                {settings?.company_email && <div>{settings.company_email}</div>}
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm font-semibold">Коммерческое предложение</div>
              <div className="text-lg font-bold">{quote.number}</div>
              <div className="text-xs text-ink-500">от {date(quote.issued_at)}</div>
              <div className="text-xs text-ink-500">действительно до {date(quote.valid_until)}</div>
            </div>
          </header>

          <div className="text-sm">
            <div className="text-ink-500">Кому:</div>
            <div className="font-semibold">
              {quote.deal?.counterparty?.full_name || quote.deal?.counterparty?.name}
            </div>
            {quote.deal?.counterparty?.bin_iin && (
              <div className="text-xs text-ink-500">БИН/ИИН {quote.deal.counterparty.bin_iin}</div>
            )}
            <div className="mt-2 text-ink-500">Предмет: {quote.deal?.title}</div>
          </div>

          {quote.intro_text && <p className="text-sm">{quote.intro_text}</p>}

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-ink-300 dark:border-white/20">
                <th className="py-2 text-left text-xs font-semibold uppercase">№</th>
                <th className="py-2 text-left text-xs font-semibold uppercase">Наименование</th>
                <th className="py-2 text-right text-xs font-semibold uppercase">Кол-во</th>
                <th className="py-2 text-left text-xs font-semibold uppercase">Ед.</th>
                <th className="py-2 text-right text-xs font-semibold uppercase">Цена</th>
                <th className="py-2 text-right text-xs font-semibold uppercase">Сумма</th>
                <th className="py-2 text-right text-xs font-semibold uppercase">Срок, дн</th>
              </tr>
            </thead>
            <tbody>
              {(lines ?? []).map((l: any, i: number) => (
                <tr key={l.id} className="border-b border-ink-100 dark:border-white/5">
                  <td className="py-1.5">{i + 1}</td>
                  <td className="py-1.5">
                    {l.name_snapshot}
                    {l.is_substitute && l.substitution_type === 'temporary' && (
                      <div className="text-xs text-amber-700">
                        временная замена: {l.substitution_reason}
                      </div>
                    )}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{num(l.qty)}</td>
                  <td className="py-1.5">{l.unit?.name ?? ''}</td>
                  <td className="py-1.5 text-right tabular-nums">{money(l.sale_price)}</td>
                  <td className="py-1.5 text-right tabular-nums">{money(l.sale_total)}</td>
                  <td className="py-1.5 text-right tabular-nums">{l.lead_time_days}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5} className="pt-3 text-right text-sm">
                  Итого без НДС:
                </td>
                <td className="pt-3 text-right font-semibold tabular-nums">{money(spec?.total_sale)}</td>
                <td></td>
              </tr>
              <tr>
                <td colSpan={5} className="text-right text-sm">
                  НДС {num(spec?.vat_percent, 0)}%:
                </td>
                <td className="text-right tabular-nums">{money(spec?.total_vat)}</td>
                <td></td>
              </tr>
              <tr>
                <td colSpan={5} className="text-right text-base font-bold">
                  Итого к оплате:
                </td>
                <td className="text-right text-base font-bold tabular-nums">
                  {money(spec?.total_with_vat)}
                </td>
                <td></td>
              </tr>
            </tfoot>
          </table>

          <dl className="grid gap-2 border-t border-ink-200 pt-4 text-sm dark:border-white/10">
            <Row label="Срок изготовления / поставки" value={quote.lead_time_text} />
            <Row label="Условия оплаты" value={quote.payment_terms} />
            <Row label="Условия поставки" value={quote.delivery_terms} />
            <Row label="Гарантия" value={quote.warranty_text} />
          </dl>

          <div className="pt-6 text-sm">
            <div>С уважением,</div>
            <div className="font-semibold">{quote.author?.full_name}</div>
            <div className="text-xs text-ink-500">
              {quote.author?.position ?? 'Менеджер по продажам'}
              {quote.author?.phone ? ` · ${quote.author.phone}` : ''}
            </div>
          </div>
        </div>
      </Card>
    </div>
  )
}

function Row({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null
  return (
    <div className="flex gap-3">
      <dt className="w-56 shrink-0 text-ink-500">{label}:</dt>
      <dd>{value}</dd>
    </div>
  )
}

function PrintHint() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg border border-ink-300 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-white/5">
      <Printer size={15} /> Ctrl+P — печать или сохранение в PDF
    </span>
  )
}
