import { Badge, Card, Empty, Field, Input, Select, StatCard, Table, Td, Th } from '@/components/ui'
import { ActionForm, SubmitButton } from '@/components/action-form'
import { createClient } from '@/lib/supabase/server'
import { MOVE_TYPE_LABEL } from '@/lib/labels'
import { date, money, num, pct } from '@/lib/format'
import { addExpense } from '../../actions'

export const dynamic = 'force-dynamic'

const EXPENSE_CATEGORIES: Record<string, string> = {
  logistics: 'Логистика / доставка',
  labor: 'Оплата труда',
  outsource: 'Подрядные работы',
  tooling: 'Оснастка и инструмент',
  consumables: 'Расходные материалы',
  overhead: 'Накладные',
  other: 'Прочее',
}

export default async function CostingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const [{ data: costing }, { data: expenses }, { data: moves }, { data: subs }] = await Promise.all([
    supabase.from('v_deal_costing').select('*').eq('deal_id', id).maybeSingle(),
    supabase.from('deal_expenses').select('*').eq('deal_id', id).order('spent_at', { ascending: false }),
    supabase
      .from('stock_moves')
      .select('*, item:item_id(name, sku), batch:batch_id(batch_number, heat_number)')
      .eq('deal_id', id)
      .order('moved_at', { ascending: false })
      .limit(100),
    supabase.from('spec_substitutions').select('cost_delta').eq('deal_id', id),
  ])

  const subImpact = (subs ?? []).reduce((s: number, x: any) => s + Number(x.cost_delta), 0)
  const deviation = Number(costing?.cost_deviation ?? 0)

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Выручка без НДС" value={money(costing?.revenue_net)} />
        <StatCard
          label="Плановая себестоимость"
          value={money(costing?.plan_cost)}
          hint="из спецификации"
        />
        <StatCard
          label="Фактическая себестоимость"
          value={money(costing?.fact_cost)}
          hint={`материалы ${money(costing?.fact_material_cost)} + прочее ${money(costing?.other_cost)}`}
          tone={deviation > 0 ? 'warn' : 'default'}
        />
        <StatCard
          label="Фактическая маржа"
          value={money(costing?.fact_margin)}
          hint={pct(costing?.fact_margin_percent)}
          tone={Number(costing?.fact_margin) >= 0 ? 'good' : 'bad'}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Отклонение факт/план"
          value={`${deviation > 0 ? '+' : ''}${money(deviation)}`}
          tone={deviation > 0 ? 'bad' : 'good'}
          hint={deviation > 0 ? 'перерасход по проекту' : 'экономия'}
        />
        <StatCard
          label="Влияние замен на смету"
          value={`${subImpact > 0 ? '+' : ''}${money(subImpact)}`}
          tone={subImpact > 0 ? 'warn' : 'good'}
          hint={`${(subs ?? []).length} замен`}
        />
        <StatCard label="Закуплено под сделку" value={money(costing?.purchased_cost)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Дополнительные затраты" className="lg:col-span-2">
          {(expenses ?? []).length === 0 ? (
            <Empty>Затрат не зафиксировано</Empty>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Дата</Th>
                  <Th>Категория</Th>
                  <Th>Описание</Th>
                  <Th align="right">Сумма</Th>
                </tr>
              </thead>
              <tbody>
                {(expenses ?? []).map((e: any) => (
                  <tr key={e.id}>
                    <Td>{date(e.spent_at)}</Td>
                    <Td>
                      <Badge tone="slate">{EXPENSE_CATEGORIES[e.category] ?? e.category}</Badge>
                    </Td>
                    <Td>{e.title}</Td>
                    <Td align="right">{money(e.amount)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card title="Добавить затрату">
          <ActionForm action={addExpense} className="space-y-3 p-4">
            <input type="hidden" name="deal_id" value={id} />
            <Field label="Категория">
              <Select name="category" defaultValue="logistics">
                {Object.entries(EXPENSE_CATEGORIES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Описание">
              <Input name="title" required placeholder="Напр.: доставка до объекта" />
            </Field>
            <Field label="Сумма">
              <Input name="amount" type="number" step="0.01" required />
            </Field>
            <Field label="Дата">
              <Input name="spent_at" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
            </Field>
            <SubmitButton size="sm">Добавить</SubmitButton>
          </ActionForm>
        </Card>
      </div>

      <Card title="Движение материалов по сделке (прослеживаемость плавок)">
        {(moves ?? []).length === 0 ? (
          <Empty>Движений не было</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Дата</Th>
                <Th>Операция</Th>
                <Th>Позиция</Th>
                <Th>Партия / плавка</Th>
                <Th align="right">Кол-во</Th>
                <Th align="right">Себест. за ед.</Th>
                <Th align="right">Сумма</Th>
              </tr>
            </thead>
            <tbody>
              {(moves ?? []).map((m: any) => (
                <tr key={m.id}>
                  <Td>{date(m.moved_at)}</Td>
                  <Td>
                    <Badge tone={m.move_type === 'issue' ? 'blue' : 'slate'}>
                      {MOVE_TYPE_LABEL[m.move_type]}
                    </Badge>
                  </Td>
                  <Td>
                    <div>{m.item?.name}</div>
                    <div className="text-xs text-ink-500">{m.item?.sku}</div>
                  </Td>
                  <Td className="text-xs">
                    {m.batch?.batch_number ?? '—'}
                    {m.batch?.heat_number && (
                      <div className="text-ink-500">плавка {m.batch.heat_number}</div>
                    )}
                  </Td>
                  <Td align="right">{num(m.qty)}</Td>
                  <Td align="right">{money(m.unit_cost)}</Td>
                  <Td align="right">{money(Number(m.qty) * Number(m.unit_cost))}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  )
}
