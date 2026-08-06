import Link from 'next/link'
import { ArrowLeftRight, Trash2, RotateCcw } from 'lucide-react'
import {
  Alert,
  Badge,
  Card,
  Empty,
  Field,
  Input,
  Select,
  Table,
  Td,
  Th,
} from '@/components/ui'
import { ActionForm, SubmitButton } from '@/components/action-form'
import { AddSpecItemForm } from './add-form'
import { createClient } from '@/lib/supabase/server'
import { SPEC_SOURCE_LABEL } from '@/lib/labels'
import { money, num, pct, date } from '@/lib/format'
import {
  approveSpec,
  deleteSpecItemForm,
  newSpecVersion,
  revertSubstitutionForm,
  updateSpecHeader,
  updateSpecItemForm,
} from '../../actions'

export const dynamic = 'force-dynamic'

const SECTIONS = ['Материалы', 'Оборудование', 'Комплектующие', 'Работы', 'Логистика', 'Прочее']

export default async function SpecPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: specs } = await supabase
    .from('specifications')
    .select('*')
    .eq('deal_id', id)
    .order('version', { ascending: false })

  const spec = (specs ?? []).find((s: any) => s.is_current) ?? specs?.[0]

  if (!spec) {
    return (
      <Alert tone="warn">
        Спецификация не создана. Обновите страницу или создайте сделку заново.
      </Alert>
    )
  }

  const [{ data: lines }, { data: units }, { data: subs }] = await Promise.all([
    supabase
      .from('spec_items')
      .select('*, unit:unit_id(name), item:item_id(id, name, sku, steel_grade, is_stock_tracked)')
      .eq('spec_id', spec.id)
      .order('section')
      .order('line_no'),
    supabase.from('units').select('id, name').order('code'),
    supabase
      .from('spec_substitutions')
      .select('*')
      .eq('deal_id', id)
      .order('created_at', { ascending: false }),
  ])

  const itemIds = (lines ?? []).map((l: any) => l.item_id).filter(Boolean)
  const { data: avail } = itemIds.length
    ? await supabase.from('v_item_availability').select('*').in('item_id', itemIds)
    : { data: [] as any[] }

  const availMap = new Map((avail ?? []).map((a: any) => [a.item_id, a]))
  const grouped = new Map<string, any[]>()
  for (const l of lines ?? []) {
    if (!grouped.has(l.section)) grouped.set(l.section, [])
    grouped.get(l.section)!.push(l)
  }

  return (
    <div className="space-y-4">
      <Card
        title={`${spec.name} · версия ${spec.version}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={spec.status === 'approved' ? 'green' : 'slate'}>
              {spec.status === 'approved' ? 'Утверждена' : 'Черновик'}
            </Badge>
            <ActionForm action={newSpecVersion} hideErrors>
              <input type="hidden" name="deal_id" value={id} />
              <input type="hidden" name="spec_id" value={spec.id} />
              <SubmitButton variant="secondary" size="sm">
                Новая версия
              </SubmitButton>
            </ActionForm>
            {spec.status !== 'approved' && (
              <ActionForm action={approveSpec} hideErrors>
                <input type="hidden" name="deal_id" value={id} />
                <input type="hidden" name="spec_id" value={spec.id} />
                <SubmitButton size="sm">Утвердить</SubmitButton>
              </ActionForm>
            )}
          </div>
        }
      >
        <div className="grid gap-4 p-4 lg:grid-cols-4">
          <ActionForm action={updateSpecHeader} className="grid grid-cols-3 gap-2 lg:col-span-2">
            <input type="hidden" name="deal_id" value={id} />
            <input type="hidden" name="spec_id" value={spec.id} />
            <Field label="Наценка, %">
              <Input name="markup_percent" type="number" step="0.1" defaultValue={spec.markup_percent} />
            </Field>
            <Field label="Скидка, %">
              <Input name="discount_percent" type="number" step="0.1" defaultValue={spec.discount_percent} />
            </Field>
            <Field label="НДС, %">
              <Input name="vat_percent" type="number" step="0.1" defaultValue={spec.vat_percent} />
            </Field>
            <div className="col-span-3">
              <SubmitButton size="sm" variant="secondary">
                Пересчитать
              </SubmitButton>
            </div>
          </ActionForm>

          <div className="grid grid-cols-2 gap-3 lg:col-span-2">
            <Metric label="Себестоимость" value={money(spec.total_cost)} />
            <Metric label="Сумма без НДС" value={money(spec.total_sale)} />
            <Metric
              label="Маржа"
              value={money(spec.margin)}
              hint={pct(spec.margin_percent)}
              tone={Number(spec.margin) > 0 ? 'good' : 'bad'}
            />
            <Metric label="Итого с НДС" value={money(spec.total_with_vat)} hint={`срок ${spec.max_lead_time_days} дн`} />
          </div>
        </div>
      </Card>

      <Card title="Позиции спецификации">
        {(lines ?? []).length === 0 ? (
          <Empty>Позиций пока нет — добавьте первую строку ниже</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>№</Th>
                <Th>Наименование</Th>
                <Th align="right">Кол-во</Th>
                <Th>Ед.</Th>
                <Th align="right">Себест.</Th>
                <Th align="right">Цена</Th>
                <Th align="right">Сумма</Th>
                <Th align="right">Срок</Th>
                <Th>Источник</Th>
                <Th>Склад</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {[...grouped.entries()].map(([section, rows]) => (
                <Section key={section} section={section} rows={rows} dealId={id} availMap={availMap} units={units ?? []} />
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card title="Добавить позицию">
        <AddSpecItemForm dealId={id} specId={spec.id} sections={SECTIONS} units={units ?? []} />
      </Card>

      {(subs ?? []).length > 0 && (
        <Card title="Журнал замен и аналогов">
          <Table>
            <thead>
              <tr>
                <Th>Дата</Th>
                <Th>Было</Th>
                <Th>Стало</Th>
                <Th align="right">Влияние на смету</Th>
                <Th align="right">Срок, дн</Th>
                <Th>Тип</Th>
                <Th>Причина</Th>
              </tr>
            </thead>
            <tbody>
              {(subs ?? []).map((s: any) => (
                <tr key={s.id}>
                  <Td>{date(s.created_at)}</Td>
                  <Td>{s.from_name}</Td>
                  <Td className="font-medium">{s.to_name}</Td>
                  <Td align="right">
                    <span className={Number(s.cost_delta) > 0 ? 'text-rose-600' : 'text-emerald-600'}>
                      {Number(s.cost_delta) > 0 ? '+' : ''}
                      {money(s.cost_delta)}
                    </span>
                  </Td>
                  <Td align="right">
                    {Number(s.lead_time_delta) > 0 ? '+' : ''}
                    {s.lead_time_delta}
                  </Td>
                  <Td>
                    <Badge tone={s.substitution_type === 'temporary' ? 'amber' : 'slate'}>
                      {s.substitution_type === 'temporary' ? 'Временная' : 'Постоянная'}
                    </Badge>
                    {s.return_date && (
                      <div className="mt-0.5 text-xs text-ink-500">возврат к {date(s.return_date)}</div>
                    )}
                  </Td>
                  <Td className="max-w-64 text-xs text-ink-500">{s.reason}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  )
}

function Metric({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string
  value: string
  hint?: string
  tone?: 'default' | 'good' | 'bad'
}) {
  return (
    <div className="rounded-lg border border-ink-200/70 p-3 dark:border-white/10">
      <div className="text-xs uppercase tracking-wide text-ink-500">{label}</div>
      <div
        className={`mt-1 text-lg font-semibold tabular-nums ${
          tone === 'good' ? 'text-emerald-600' : tone === 'bad' ? 'text-rose-600' : ''
        }`}
      >
        {value}
      </div>
      {hint && <div className="text-xs text-ink-500">{hint}</div>}
    </div>
  )
}

function Section({
  section,
  rows,
  dealId,
  availMap,
  units,
}: {
  section: string
  rows: any[]
  dealId: string
  availMap: Map<string, any>
  units: any[]
}) {
  const sum = rows.reduce((s, r) => s + Number(r.sale_total), 0)
  return (
    <>
      <tr className="bg-ink-50 dark:bg-white/5">
        <Td colSpan={6} className="text-xs font-semibold uppercase tracking-wide text-ink-500">
          {section}
        </Td>
        <Td align="right" className="text-xs font-semibold">
          {money(sum)}
        </Td>
        <Td colSpan={4}></Td>
      </tr>
      {rows.map((l) => {
        const a = l.item_id ? availMap.get(l.item_id) : null
        const enough = a ? Number(a.available) >= Number(l.qty) : null
        return (
          <tr key={l.id} className="align-top">
            <Td className="text-xs text-ink-400">{l.line_no}</Td>
            <Td>
              <div className="font-medium">{l.name_snapshot}</div>
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-500">
                {l.item?.sku && <span className="font-mono">{l.item.sku}</span>}
                {l.item?.steel_grade && <Badge tone="slate">сталь {l.item.steel_grade}</Badge>}
                {l.is_substitute && (
                  <Badge tone={l.substitution_type === 'temporary' ? 'amber' : 'violet'}>
                    {l.substitution_type === 'temporary' ? 'временная замена' : 'аналог'}
                  </Badge>
                )}
              </div>
              {l.substitution_reason && (
                <div className="mt-0.5 max-w-md text-xs text-amber-700 dark:text-amber-400">
                  {l.substitution_reason}
                  {l.substitution_return_date ? ` (возврат к ${date(l.substitution_return_date)})` : ''}
                </div>
              )}
            </Td>
            <Td align="right">
              <form action={updateSpecItemForm} className="flex items-center gap-1">
                <input type="hidden" name="deal_id" value={dealId} />
                <input type="hidden" name="spec_item_id" value={l.id} />
                <input
                  name="qty"
                  defaultValue={num(l.qty)}
                  className="no-spin w-20 rounded border border-ink-200 bg-transparent px-1.5 py-1 text-right text-sm tabular-nums focus:border-steel-500 focus:outline-none dark:border-white/10"
                />
              </form>
            </Td>
            <Td className="text-xs text-ink-500">{l.unit?.name ?? '—'}</Td>
            <Td align="right">
              <form action={updateSpecItemForm} className="inline">
                <input type="hidden" name="deal_id" value={dealId} />
                <input type="hidden" name="spec_item_id" value={l.id} />
                <input
                  name="cost_price"
                  defaultValue={Number(l.cost_price)}
                  className="no-spin w-24 rounded border border-ink-200 bg-transparent px-1.5 py-1 text-right text-sm tabular-nums focus:border-steel-500 focus:outline-none dark:border-white/10"
                />
              </form>
            </Td>
            <Td align="right">
              <form action={updateSpecItemForm} className="inline">
                <input type="hidden" name="deal_id" value={dealId} />
                <input type="hidden" name="spec_item_id" value={l.id} />
                <input
                  name="sale_price"
                  defaultValue={Number(l.sale_price)}
                  className="no-spin w-24 rounded border border-ink-200 bg-transparent px-1.5 py-1 text-right text-sm tabular-nums focus:border-steel-500 focus:outline-none dark:border-white/10"
                />
              </form>
            </Td>
            <Td align="right" className="font-medium">
              {money(l.sale_total)}
              <div className="text-xs text-ink-500">себест. {money(l.cost_total)}</div>
            </Td>
            <Td align="right">{l.lead_time_days}</Td>
            <Td className="text-xs">{SPEC_SOURCE_LABEL[l.source]}</Td>
            <Td>
              {a ? (
                <div className="text-xs">
                  <Badge tone={enough ? 'green' : 'red'}>{num(a.available)} своб.</Badge>
                  <div className="mt-0.5 text-ink-500">остаток {num(a.on_hand)}</div>
                </div>
              ) : (
                <span className="text-xs text-ink-400">—</span>
              )}
            </Td>
            <Td>
              <div className="flex items-center gap-1">
                {l.item_id && (
                  <Link
                    href={`/deals/${dealId}/spec/${l.id}`}
                    title="Подобрать аналог / зафиксировать замену"
                    className="rounded p-1.5 text-ink-500 transition hover:bg-ink-100 hover:text-steel-700 dark:hover:bg-white/10"
                  >
                    <ArrowLeftRight size={15} />
                  </Link>
                )}
                {l.is_substitute && l.original_item_id && (
                  <form action={revertSubstitutionForm}>
                    <input type="hidden" name="deal_id" value={dealId} />
                    <input type="hidden" name="spec_item_id" value={l.id} />
                    <button
                      title="Вернуть штатную позицию"
                      className="rounded p-1.5 text-ink-500 transition hover:bg-ink-100 hover:text-emerald-700 dark:hover:bg-white/10"
                    >
                      <RotateCcw size={15} />
                    </button>
                  </form>
                )}
                <form action={deleteSpecItemForm}>
                  <input type="hidden" name="deal_id" value={dealId} />
                  <input type="hidden" name="spec_item_id" value={l.id} />
                  <button
                    title="Удалить строку"
                    className="rounded p-1.5 text-ink-500 transition hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10"
                  >
                    <Trash2 size={15} />
                  </button>
                </form>
              </div>
            </Td>
          </tr>
        )
      })}
    </>
  )
}
