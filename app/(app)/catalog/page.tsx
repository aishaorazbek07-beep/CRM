import Link from 'next/link'
import { Search } from 'lucide-react'
import { Badge, Card, Empty, Field, Input, PageHeader, Select, Table, Td, Th } from '@/components/ui'
import { ActionForm, SubmitButton } from '@/components/action-form'
import { createClient } from '@/lib/supabase/server'
import { ITEM_KIND_LABEL } from '@/lib/labels'
import { money, num } from '@/lib/format'
import { createItem } from './actions'

export const dynamic = 'force-dynamic'

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; kind?: string; grade?: string }>
}) {
  const sp = await searchParams
  const supabase = await createClient()

  let q = supabase
    .from('items')
    .select('*, unit:base_unit_id(name), category:category_id(name)')
    .order('name')
    .limit(300)

  if (sp.q) q = q.or(`name.ilike.%${sp.q}%,sku.ilike.%${sp.q}%`)
  if (sp.kind) q = q.eq('kind', sp.kind)
  if (sp.grade) q = q.eq('steel_grade', sp.grade)

  const [{ data: items }, { data: units }, { data: categories }] = await Promise.all([
    q,
    supabase.from('units').select('id, name, code').order('code'),
    supabase.from('categories').select('id, name, parent_id').order('name'),
  ])

  return (
    <>
      <PageHeader
        title="Номенклатура"
        subtitle="Металлопрокат, арматура, приводы, метизы, работы — с аналогами и минимальными остатками"
      />

      <form className="mb-4 flex flex-wrap items-end gap-2">
        <div className="relative min-w-56 flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
          <Input name="q" defaultValue={sp.q ?? ''} placeholder="Название или артикул" className="pl-9" />
        </div>
        <Select name="kind" defaultValue={sp.kind ?? ''} className="w-44">
          <option value="">Все виды</option>
          {Object.entries(ITEM_KIND_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
        <Select name="grade" defaultValue={sp.grade ?? ''} className="w-40">
          <option value="">Все марки</option>
          <option value="304">AISI 304</option>
          <option value="316">AISI 316</option>
          <option value="316L">AISI 316L</option>
          <option value="09Г2С">09Г2С</option>
        </Select>
        <button className="rounded-lg bg-steel-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-steel-700">
          Найти
        </button>
      </form>

      <div className="grid gap-4 lg:grid-cols-4">
        <Card title="Новая позиция">
          <ActionForm action={createItem} className="space-y-3 p-4">
            <Field label="Наименование">
              <Input name="name" required placeholder="Задвижка Ду150 Ру16 AISI 316" />
            </Field>
            <Field label="Артикул">
              <Input name="sku" placeholder="ARM-ZD-316-150" />
            </Field>
            <Field label="Вид">
              <Select name="kind" defaultValue="component">
                {Object.entries(ITEM_KIND_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Категория">
              <Select name="category_id" defaultValue="">
                <option value="">—</option>
                {(categories ?? []).map((c: any) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Единица измерения">
              <Select name="base_unit_id" required defaultValue="">
                <option value="">—</option>
                {(units ?? []).map((u: any) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Марка стали">
                <Input name="steel_grade" placeholder="316" />
              </Field>
              <Field label="ГОСТ">
                <Input name="gost" />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Мин. остаток">
                <Input name="min_stock" type="number" step="0.001" defaultValue={0} className="no-spin" />
              </Field>
              <Field label="Срок поставки, дн">
                <Input name="lead_time_days" type="number" defaultValue={0} className="no-spin" />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Цена закупа">
                <Input name="last_purchase_price" type="number" step="0.01" className="no-spin" />
              </Field>
              <Field label="Цена продажи">
                <Input name="default_price" type="number" step="0.01" className="no-spin" />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="is_stock_tracked" defaultChecked /> складской учёт
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="requires_certificate" /> требуется сертификат
            </label>
            <SubmitButton>Создать</SubmitButton>
          </ActionForm>
        </Card>

        <Card className="lg:col-span-3">
          {(items ?? []).length === 0 ? (
            <Empty>Ничего не найдено</Empty>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Позиция</Th>
                  <Th>Вид</Th>
                  <Th>Марка</Th>
                  <Th>Ед.</Th>
                  <Th align="right">Себест.</Th>
                  <Th align="right">Цена</Th>
                  <Th align="right">Мин. остаток</Th>
                  <Th align="right">Срок, дн</Th>
                </tr>
              </thead>
              <tbody>
                {(items ?? []).map((i: any) => (
                  <tr key={i.id} className={i.is_active ? '' : 'opacity-50'}>
                    <Td>
                      <Link
                        href={`/catalog/${i.id}`}
                        className="font-medium text-steel-700 hover:underline dark:text-steel-500"
                      >
                        {i.name}
                      </Link>
                      <div className="font-mono text-xs text-ink-500">
                        {i.sku ?? '—'}
                        {i.category?.name ? ` · ${i.category.name}` : ''}
                      </div>
                    </Td>
                    <Td>
                      <Badge tone="slate">{ITEM_KIND_LABEL[i.kind]}</Badge>
                    </Td>
                    <Td>{i.steel_grade ?? '—'}</Td>
                    <Td>{i.unit?.name}</Td>
                    <Td align="right">{money(i.avg_cost || i.last_purchase_price)}</Td>
                    <Td align="right">{money(i.default_price)}</Td>
                    <Td align="right">{Number(i.min_stock) > 0 ? num(i.min_stock) : '—'}</Td>
                    <Td align="right">{i.lead_time_days}</Td>
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
