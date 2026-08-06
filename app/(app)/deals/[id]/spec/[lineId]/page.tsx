import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { Alert, Badge, Card, Empty, Field, Input, Select, Table, Td, Textarea, Th } from '@/components/ui'
import { ActionForm, SubmitButton } from '@/components/action-form'
import { FreeSubstituteForm } from './free-form'
import { createClient } from '@/lib/supabase/server'
import { money, num } from '@/lib/format'
import { substituteSpecItem } from '../../../actions'

export const dynamic = 'force-dynamic'

export default async function SubstitutePage({
  params,
}: {
  params: Promise<{ id: string; lineId: string }>
}) {
  const { id, lineId } = await params
  const supabase = await createClient()

  const { data: line } = await supabase
    .from('spec_items')
    .select('*, unit:unit_id(name), item:item_id(id, name, sku, steel_grade, lead_time_days)')
    .eq('id', lineId)
    .single()

  if (!line) notFound()

  const { data: analogs } = await supabase
    .from('item_analogs')
    .select(
      'id, compatibility, is_temporary_only, note, analog:analog_item_id(id, name, sku, steel_grade, avg_cost, last_purchase_price, default_price, lead_time_days)'
    )
    .eq('item_id', line.item_id)

  const analogIds = (analogs ?? []).map((a: any) => a.analog?.id).filter(Boolean)
  const { data: avail } = analogIds.length
    ? await supabase.from('v_item_availability').select('*').in('item_id', analogIds)
    : { data: [] as any[] }
  const availMap = new Map((avail ?? []).map((a: any) => [a.item_id, a]))

  const qty = Number(line.qty)

  return (
    <div className="space-y-4">
      <Link
        href={`/deals/${id}/spec`}
        className="inline-flex items-center gap-1.5 text-sm text-ink-500 hover:underline"
      >
        <ArrowLeft size={15} /> К спецификации
      </Link>

      <Card title="Заменяемая позиция">
        <div className="p-4">
          <div className="text-lg font-semibold">{line.name_snapshot}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-500">
            {line.item?.sku && <span className="font-mono">{line.item.sku}</span>}
            {line.item?.steel_grade && <Badge tone="slate">сталь {line.item.steel_grade}</Badge>}
            <span>
              {num(qty)} {line.unit?.name ?? ''} · себестоимость {money(line.cost_price)} за ед. ·
              срок {line.lead_time_days} дн
            </span>
          </div>
          <div className="mt-2 text-sm">
            Текущая сумма строки: <b>{money(line.cost_total)}</b> (себест.) / {money(line.sale_total)} (продажа)
          </div>
        </div>
      </Card>

      <Card title="Аналоги из справочника">
        {(analogs ?? []).length === 0 ? (
          <Empty>
            Для этой позиции аналоги не заданы. Добавьте их в карточке номенклатуры или выберите
            произвольную позицию ниже.
          </Empty>
        ) : (
          <ActionForm action={substituteSpecItem}>
            <input type="hidden" name="deal_id" value={id} />
            <input type="hidden" name="spec_item_id" value={lineId} />

            <Table>
              <thead>
                <tr>
                  <Th></Th>
                  <Th>Аналог</Th>
                  <Th>Совместимость</Th>
                  <Th align="right">Себест. за ед.</Th>
                  <Th align="right">Δ по смете</Th>
                  <Th align="right">Срок, дн</Th>
                  <Th>Наличие</Th>
                </tr>
              </thead>
              <tbody>
                {(analogs ?? []).map((a: any) => {
                  const it = a.analog
                  if (!it) return null
                  const cost = Number(it.avg_cost || it.last_purchase_price || 0)
                  const delta = (cost - Number(line.cost_price)) * qty
                  const av = availMap.get(it.id)
                  const leadDelta = Number(it.lead_time_days) - Number(line.lead_time_days)
                  return (
                    <tr key={a.id}>
                      <Td>
                        <input type="radio" name="new_item_id" value={it.id} required />
                      </Td>
                      <Td>
                        <div className="font-medium">{it.name}</div>
                        <div className="text-xs text-ink-500">
                          {it.sku}
                          {it.steel_grade ? ` · сталь ${it.steel_grade}` : ''}
                        </div>
                        {a.note && (
                          <div className="mt-0.5 max-w-md text-xs text-amber-700 dark:text-amber-400">
                            {a.note}
                          </div>
                        )}
                      </Td>
                      <Td>
                        <Badge
                          tone={
                            a.compatibility === 3 ? 'green' : a.compatibility === 2 ? 'amber' : 'red'
                          }
                        >
                          {a.compatibility === 3
                            ? 'полная'
                            : a.compatibility === 2
                              ? 'с оговорками'
                              : 'только временно'}
                        </Badge>
                      </Td>
                      <Td align="right">{money(cost)}</Td>
                      <Td align="right">
                        <span className={delta > 0 ? 'text-rose-600' : 'text-emerald-600'}>
                          {delta > 0 ? '+' : ''}
                          {money(delta)}
                        </span>
                      </Td>
                      <Td align="right">
                        {it.lead_time_days}
                        <div className="text-xs text-ink-500">
                          {leadDelta > 0 ? `+${leadDelta}` : leadDelta}
                        </div>
                      </Td>
                      <Td>
                        {av ? (
                          <Badge tone={Number(av.available) >= qty ? 'green' : 'red'}>
                            {num(av.available)} своб.
                          </Badge>
                        ) : (
                          <span className="text-xs text-ink-400">нет данных</span>
                        )}
                      </Td>
                    </tr>
                  )
                })}
              </tbody>
            </Table>

            <div className="grid gap-3 border-t border-ink-100 p-4 sm:grid-cols-4 dark:border-white/5">
              <Field label="Характер замены">
                <Select name="substitution_type" defaultValue="temporary">
                  <option value="temporary">Временная подмена</option>
                  <option value="permanent">Постоянная (в спецификацию)</option>
                </Select>
              </Field>
              <Field label="Плановый возврат штатной позиции">
                <Input name="return_date" type="date" />
              </Field>
              <Field label="Себест. за ед. (переопределить)">
                <Input name="cost_price" type="number" step="0.01" placeholder="из справочника" />
              </Field>
              <Field label="Цена продажи (переопределить)">
                <Input name="sale_price" type="number" step="0.01" placeholder="из справочника" />
              </Field>
              <Field label="Причина замены" className="sm:col-span-4">
                <Textarea
                  name="reason"
                  rows={2}
                  required
                  placeholder="Напр.: задержка поставки электропривода AUMA на 45 дней, согласовано с заказчиком"
                />
              </Field>
              <div className="sm:col-span-4">
                <SubmitButton>Зафиксировать замену и пересчитать смету</SubmitButton>
              </div>
            </div>
          </ActionForm>
        )}
      </Card>

      <Card title="Произвольная позиция из номенклатуры">
        <FreeSubstituteForm dealId={id} lineId={lineId} />
      </Card>

      <Alert tone="info">
        Замена фиксируется в журнале сделки: видно, что было, что стало, как изменилась
        себестоимость и срок. Временные подмены попадают в отчёт «Возвраты штатных позиций».
      </Alert>
    </div>
  )
}
