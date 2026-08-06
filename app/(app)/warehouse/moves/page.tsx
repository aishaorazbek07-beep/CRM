import Link from 'next/link'
import { Badge, Card, Empty, Field, Input, PageHeader, Select, Table, Td, Th } from '@/components/ui'
import { Tabs } from '@/components/tabs'
import { ActionForm, SubmitButton } from '@/components/action-form'
import { ItemPicker } from '@/components/item-picker'
import { createClient } from '@/lib/supabase/server'
import { MOVE_TYPE_LABEL } from '@/lib/labels'
import { dateTime, money, num } from '@/lib/format'
import { moveStock } from '../actions'

export const dynamic = 'force-dynamic'

export default async function MovesPage() {
  const supabase = await createClient()

  const [{ data: moves }, { data: warehouses }] = await Promise.all([
    supabase
      .from('stock_moves')
      .select(
        '*, item:item_id(name, sku), batch:batch_id(batch_number, heat_number), from_wh:warehouse_from(name), to_wh:warehouse_to(name), deal:deal_id(id, number), po:production_order_id(id, number)'
      )
      .order('moved_at', { ascending: false })
      .limit(200),
    supabase.from('warehouses').select('*').order('sort_order'),
  ])

  return (
    <>
      <PageHeader title="Движения по складу" subtitle="Приход, выдача в цех, перемещения, списания" />

      <Tabs
        tabs={[
          { href: '/warehouse', label: 'Остатки' },
          { href: '/warehouse/batches', label: 'Партии и сертификаты' },
          { href: '/warehouse/moves', label: 'Движения' },
        ]}
      />

      <div className="grid gap-4 lg:grid-cols-4">
        <Card title="Новое движение">
          <ActionForm action={moveStock} className="space-y-3 p-4">
            <Field label="Тип операции">
              <Select name="move_type" defaultValue="transfer">
                <option value="transfer">Перемещение</option>
                <option value="return">Возврат из цеха</option>
                <option value="writeoff">Списание</option>
                <option value="adjustment">Корректировка (инвентаризация)</option>
              </Select>
            </Field>
            <Field label="Позиция">
              <ItemPicker />
            </Field>
            <Field label="Количество">
              <Input name="qty" type="number" step="0.001" required className="no-spin" />
            </Field>
            <Field label="Откуда">
              <Select name="warehouse_from" defaultValue="">
                <option value="">—</option>
                {(warehouses ?? []).map((w: any) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Куда">
              <Select name="warehouse_to" defaultValue="">
                <option value="">—</option>
                {(warehouses ?? []).map((w: any) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Примечание">
              <Input name="note" />
            </Field>
            <SubmitButton>Провести</SubmitButton>
          </ActionForm>
        </Card>

        <Card title="Журнал" className="lg:col-span-3">
          {(moves ?? []).length === 0 ? (
            <Empty>Движений не было</Empty>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Дата</Th>
                  <Th>Операция</Th>
                  <Th>Позиция</Th>
                  <Th>Партия</Th>
                  <Th align="right">Кол-во</Th>
                  <Th>Откуда → Куда</Th>
                  <Th>Документ</Th>
                </tr>
              </thead>
              <tbody>
                {(moves ?? []).map((m: any) => (
                  <tr key={m.id}>
                    <Td className="whitespace-nowrap text-xs">{dateTime(m.moved_at)}</Td>
                    <Td>
                      <Badge
                        tone={
                          m.move_type === 'receipt'
                            ? 'green'
                            : m.move_type === 'issue'
                              ? 'blue'
                              : m.move_type === 'writeoff'
                                ? 'red'
                                : 'slate'
                        }
                      >
                        {MOVE_TYPE_LABEL[m.move_type]}
                      </Badge>
                    </Td>
                    <Td>
                      <div>{m.item?.name}</div>
                      <div className="font-mono text-xs text-ink-500">{m.item?.sku}</div>
                    </Td>
                    <Td className="text-xs">
                      {m.batch?.batch_number ?? '—'}
                      {m.batch?.heat_number && (
                        <div className="text-ink-500">плавка {m.batch.heat_number}</div>
                      )}
                    </Td>
                    <Td align="right">
                      {num(m.qty)}
                      {Number(m.unit_cost) > 0 && (
                        <div className="text-xs text-ink-500">{money(m.unit_cost)}</div>
                      )}
                    </Td>
                    <Td className="text-xs">
                      {m.from_wh?.name ?? '—'} → {m.to_wh?.name ?? '—'}
                    </Td>
                    <Td className="text-xs">
                      {m.deal && (
                        <Link href={`/deals/${m.deal.id}`} className="text-steel-700 hover:underline dark:text-steel-500">
                          {m.deal.number}
                        </Link>
                      )}
                      {m.po && (
                        <div>
                          <Link
                            href={`/production/${m.po.id}`}
                            className="text-steel-700 hover:underline dark:text-steel-500"
                          >
                            {m.po.number}
                          </Link>
                        </div>
                      )}
                      {!m.deal && !m.po && (m.doc_ref ?? '—')}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  )
}
