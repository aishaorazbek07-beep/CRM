import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Trash2 } from 'lucide-react'
import { Badge, Card, Empty, Field, Input, PageHeader, Select, StatCard, Table, Td, Textarea, Th } from '@/components/ui'
import { ActionForm, SubmitButton } from '@/components/action-form'
import { ItemPicker } from '@/components/item-picker'
import { createClient } from '@/lib/supabase/server'
import { ITEM_KIND_LABEL, MOVE_TYPE_LABEL } from '@/lib/labels'
import { date, money, num } from '@/lib/format'
import { addAnalog, addSupplierPrice, removeAnalog, updateItem } from '../actions'

export const dynamic = 'force-dynamic'

export default async function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: item } = await supabase
    .from('items')
    .select('*, unit:base_unit_id(name), category:category_id(name)')
    .eq('id', id)
    .single()

  if (!item) notFound()

  const [
    { data: units },
    { data: categories },
    { data: analogs },
    { data: suppliers },
    { data: prices },
    { data: avail },
    { data: balances },
    { data: moves },
  ] = await Promise.all([
    supabase.from('units').select('id, name').order('code'),
    supabase.from('categories').select('id, name').order('name'),
    supabase
      .from('item_analogs')
      .select('*, analog:analog_item_id(id, name, sku, steel_grade, lead_time_days, avg_cost, last_purchase_price)')
      .eq('item_id', id),
    supabase
      .from('counterparties')
      .select('id, name')
      .in('type', ['supplier', 'both'])
      .eq('is_active', true)
      .order('name'),
    supabase.from('item_suppliers').select('*, supplier:supplier_id(name)').eq('item_id', id),
    supabase.from('v_item_availability').select('*').eq('item_id', id).maybeSingle(),
    supabase.from('v_stock_balances').select('*, warehouse:warehouse_id(name)').eq('item_id', id),
    supabase
      .from('stock_moves')
      .select('*, batch:batch_id(batch_number, heat_number)')
      .eq('item_id', id)
      .order('moved_at', { ascending: false })
      .limit(20),
  ])

  return (
    <>
      <Link href="/catalog" className="mb-3 inline-flex items-center gap-1.5 text-sm text-ink-500 hover:underline">
        <ArrowLeft size={15} /> К номенклатуре
      </Link>

      <PageHeader
        title={item.name}
        subtitle={
          <>
            <span className="font-mono">{item.sku ?? '—'}</span>
            {item.steel_grade ? ` · сталь ${item.steel_grade}` : ''}
            {item.gost ? ` · ${item.gost}` : ''} · {ITEM_KIND_LABEL[item.kind]}
          </>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Остаток" value={num(avail?.on_hand ?? 0)} hint={item.unit?.name} />
        <StatCard label="Жёсткий резерв" value={num(avail?.hard_reserved ?? 0)} />
        <StatCard
          label="Свободно"
          value={num(avail?.available ?? 0)}
          tone={Number(avail?.available ?? 0) > 0 ? 'good' : 'bad'}
        />
        <StatCard
          label="Средняя себестоимость"
          value={money(item.avg_cost)}
          hint={`последний закуп ${money(item.last_purchase_price)}`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Карточка позиции" className="lg:col-span-2">
          <ActionForm action={updateItem} className="grid gap-3 p-4 sm:grid-cols-3">
            <input type="hidden" name="item_id" value={id} />
            <Field label="Наименование" className="sm:col-span-2">
              <Input name="name" defaultValue={item.name} />
            </Field>
            <Field label="Артикул">
              <Input name="sku" defaultValue={item.sku ?? ''} />
            </Field>
            <Field label="Вид">
              <Select name="kind" defaultValue={item.kind}>
                {Object.entries(ITEM_KIND_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Категория">
              <Select name="category_id" defaultValue={item.category_id ?? ''}>
                <option value="">—</option>
                {(categories ?? []).map((c: any) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Единица">
              <Select name="base_unit_id" defaultValue={item.base_unit_id}>
                {(units ?? []).map((u: any) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Марка стали">
              <Input name="steel_grade" defaultValue={item.steel_grade ?? ''} />
            </Field>
            <Field label="ГОСТ / стандарт">
              <Input name="gost" defaultValue={item.gost ?? ''} />
            </Field>
            <Field label="Вес ед., кг">
              <Input name="weight_kg" type="number" step="0.001" defaultValue={item.weight_kg ?? ''} className="no-spin" />
            </Field>
            <Field label="Мин. остаток">
              <Input name="min_stock" type="number" step="0.001" defaultValue={item.min_stock} className="no-spin" />
            </Field>
            <Field label="Объём дозаказа">
              <Input name="reorder_qty" type="number" step="0.001" defaultValue={item.reorder_qty} className="no-spin" />
            </Field>
            <Field label="Срок поставки, дн">
              <Input name="lead_time_days" type="number" defaultValue={item.lead_time_days} className="no-spin" />
            </Field>
            <Field label="Цена продажи">
              <Input name="default_price" type="number" step="0.01" defaultValue={item.default_price} className="no-spin" />
            </Field>
            <Field label="Тех. характеристики (JSON)" className="sm:col-span-3">
              <Textarea name="spec_json" rows={2} defaultValue={JSON.stringify(item.spec ?? {})} />
            </Field>
            <Field label="Примечание" className="sm:col-span-3">
              <Input name="note" defaultValue={item.note ?? ''} />
            </Field>
            <div className="flex flex-wrap gap-4 sm:col-span-3">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="is_stock_tracked" defaultChecked={item.is_stock_tracked} /> складской учёт
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="requires_certificate" defaultChecked={item.requires_certificate} /> требуется
                сертификат
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="is_active" defaultChecked={item.is_active} /> активна
              </label>
            </div>
            <div className="sm:col-span-3">
              <SubmitButton>Сохранить</SubmitButton>
            </div>
          </ActionForm>
        </Card>

        <div className="space-y-4">
          <Card title="Остатки по складам">
            {(balances ?? []).length === 0 ? (
              <Empty>Нет на складах</Empty>
            ) : (
              <ul className="divide-y divide-ink-100 dark:divide-white/5">
                {(balances ?? []).map((b: any) => (
                  <li key={b.warehouse_id} className="flex justify-between px-4 py-2.5 text-sm">
                    <span>{b.warehouse?.name}</span>
                    <span className="font-medium tabular-nums">{num(b.qty)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Цены поставщиков">
            <ActionForm action={addSupplierPrice} className="space-y-2 border-b border-ink-100 p-4 dark:border-white/5">
              <input type="hidden" name="item_id" value={id} />
              <Select name="supplier_id" required defaultValue="">
                <option value="">— поставщик —</option>
                {(suppliers ?? []).map((s: any) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
              <div className="grid grid-cols-2 gap-2">
                <Input name="price" type="number" step="0.01" placeholder="цена" className="no-spin" />
                <Input name="lead_time_days" type="number" placeholder="срок, дн" className="no-spin" />
              </div>
              <SubmitButton size="sm" variant="secondary">
                Сохранить цену
              </SubmitButton>
            </ActionForm>

            {(prices ?? []).length === 0 ? (
              <Empty>Цен нет</Empty>
            ) : (
              <ul className="divide-y divide-ink-100 dark:divide-white/5">
                {(prices ?? []).map((p: any) => (
                  <li key={p.id} className="flex justify-between px-4 py-2.5 text-sm">
                    <span>
                      {p.supplier?.name}
                      <span className="block text-xs text-ink-500">срок {p.lead_time_days} дн</span>
                    </span>
                    <span className="font-medium tabular-nums">{money(p.price)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Аналоги и взаимозамены">
          <ActionForm action={addAnalog} className="grid gap-3 border-b border-ink-100 p-4 sm:grid-cols-2 dark:border-white/5">
            <input type="hidden" name="item_id" value={id} />
            <Field label="Позиция-аналог" className="sm:col-span-2">
              <ItemPicker name="analog_item_id" />
            </Field>
            <Field label="Совместимость">
              <Select name="compatibility" defaultValue="3">
                <option value="3">Полная</option>
                <option value="2">С оговорками</option>
                <option value="1">Только временная подмена</option>
              </Select>
            </Field>
            <Field label="Комментарий">
              <Input name="note" placeholder="Напр.: момент 90 Н·м вместо 100" />
            </Field>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" name="is_temporary_only" /> использовать только как временную подмену
            </label>
            <div className="sm:col-span-2">
              <SubmitButton size="sm">Добавить аналог</SubmitButton>
            </div>
          </ActionForm>

          {(analogs ?? []).length === 0 ? (
            <Empty>Аналогов нет</Empty>
          ) : (
            <Table>
              <tbody>
                {(analogs ?? []).map((a: any) => (
                  <tr key={a.id}>
                    <Td>
                      <Link href={`/catalog/${a.analog?.id}`} className="font-medium hover:underline">
                        {a.analog?.name}
                      </Link>
                      <div className="text-xs text-ink-500">
                        {a.analog?.sku}
                        {a.note ? ` · ${a.note}` : ''}
                      </div>
                    </Td>
                    <Td>
                      <Badge tone={a.compatibility === 3 ? 'green' : a.compatibility === 2 ? 'amber' : 'red'}>
                        {a.compatibility === 3 ? 'полная' : a.compatibility === 2 ? 'с оговорками' : 'временно'}
                      </Badge>
                    </Td>
                    <Td align="right">{money(a.analog?.avg_cost || a.analog?.last_purchase_price)}</Td>
                    <Td align="right">{a.analog?.lead_time_days} дн</Td>
                    <Td>
                      <ActionForm action={removeAnalog} hideErrors>
                        <input type="hidden" name="item_id" value={id} />
                        <input type="hidden" name="analog_id" value={a.id} />
                        <button className="rounded p-1.5 text-ink-500 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10">
                          <Trash2 size={15} />
                        </button>
                      </ActionForm>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card title="Последние движения">
          {(moves ?? []).length === 0 ? (
            <Empty>Движений не было</Empty>
          ) : (
            <Table>
              <tbody>
                {(moves ?? []).map((m: any) => (
                  <tr key={m.id}>
                    <Td className="text-xs">{date(m.moved_at)}</Td>
                    <Td>
                      <Badge tone={m.move_type === 'receipt' ? 'green' : 'slate'}>
                        {MOVE_TYPE_LABEL[m.move_type]}
                      </Badge>
                    </Td>
                    <Td className="text-xs">
                      {m.batch?.batch_number}
                      {m.batch?.heat_number ? ` / плавка ${m.batch.heat_number}` : ''}
                    </Td>
                    <Td align="right">{num(m.qty)}</Td>
                    <Td align="right">{money(m.unit_cost)}</Td>
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
