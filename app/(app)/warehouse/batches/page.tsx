import { Badge, Card, Empty, Field, Input, PageHeader, Select, Table, Td, Th } from '@/components/ui'
import { Tabs } from '@/components/tabs'
import { ActionForm, SubmitButton } from '@/components/action-form'
import { FileUpload, FileLink } from '@/components/file-upload'
import { ItemPicker } from '@/components/item-picker'
import { createClient } from '@/lib/supabase/server'
import { date, money, num } from '@/lib/format'
import { receiveStock } from '../actions'

export const dynamic = 'force-dynamic'

export default async function BatchesPage() {
  const supabase = await createClient()

  const [{ data: batches }, { data: warehouses }, { data: suppliers }, { data: certs }] =
    await Promise.all([
      supabase
        .from('batches')
        .select('*, item:item_id(name, sku, steel_grade, requires_certificate), supplier:supplier_id(name)')
        .order('received_at', { ascending: false })
        .limit(200),
      supabase.from('warehouses').select('*').order('sort_order'),
      supabase
        .from('counterparties')
        .select('id, name')
        .in('type', ['supplier', 'both'])
        .eq('is_active', true)
        .order('name'),
      supabase.from('certificates').select('*').not('batch_id', 'is', null),
    ])

  const certsByBatch = new Map<string, any[]>()
  for (const c of certs ?? []) {
    if (!certsByBatch.has(c.batch_id)) certsByBatch.set(c.batch_id, [])
    certsByBatch.get(c.batch_id)!.push(c)
  }

  return (
    <>
      <PageHeader
        title="Партии и сертификаты"
        subtitle="Каждая партия прихода хранит номер плавки и сертификат качества"
      />

      <Tabs
        tabs={[
          { href: '/warehouse', label: 'Остатки' },
          { href: '/warehouse/batches', label: 'Партии и сертификаты' },
          { href: '/warehouse/moves', label: 'Движения' },
        ]}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Оприходовать партию" className="lg:col-span-1">
          <ActionForm action={receiveStock} className="space-y-3 p-4">
            <Field label="Позиция номенклатуры">
              <ItemPicker />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Количество">
                <Input name="qty" type="number" step="0.001" required className="no-spin" />
              </Field>
              <Field label="Цена за ед.">
                <Input name="unit_cost" type="number" step="0.01" className="no-spin" />
              </Field>
            </div>
            <Field label="Склад">
              <Select name="warehouse_id" required>
                {(warehouses ?? []).map((w: any) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Поставщик">
              <Select name="supplier_id" defaultValue="">
                <option value="">—</option>
                {(suppliers ?? []).map((s: any) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="№ партии">
                <Input name="batch_number" placeholder="авто" />
              </Field>
              <Field label="№ плавки">
                <Input name="heat_number" placeholder="напр. 21458" />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="№ сертификата">
                <Input name="cert_number" />
              </Field>
              <Field label="Дата сертификата">
                <Input name="cert_issued_at" type="date" />
              </Field>
            </div>
            <SubmitButton>Оприходовать</SubmitButton>
          </ActionForm>
        </Card>

        <Card title="Партии на складе" className="lg:col-span-2">
          {(batches ?? []).length === 0 ? (
            <Empty>Приходов ещё не было</Empty>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Партия</Th>
                  <Th>Позиция</Th>
                  <Th align="right">Кол-во</Th>
                  <Th align="right">Цена</Th>
                  <Th>Плавка / сертификат</Th>
                  <Th>Файлы</Th>
                </tr>
              </thead>
              <tbody>
                {(batches ?? []).map((b: any) => {
                  const files = certsByBatch.get(b.id) ?? []
                  const needCert = b.item?.requires_certificate && !b.cert_number
                  return (
                    <tr key={b.id}>
                      <Td>
                        <div className="font-mono text-xs">{b.batch_number}</div>
                        <div className="text-xs text-ink-500">{date(b.received_at)}</div>
                      </Td>
                      <Td>
                        <div className="font-medium">{b.item?.name}</div>
                        <div className="text-xs text-ink-500">
                          {b.item?.steel_grade ? `сталь ${b.item.steel_grade} · ` : ''}
                          {b.supplier?.name ?? 'без поставщика'}
                        </div>
                      </Td>
                      <Td align="right">{num(b.qty_received)}</Td>
                      <Td align="right">{money(b.unit_cost)}</Td>
                      <Td>
                        {b.heat_number ? (
                          <div className="text-xs">
                            плавка <b>{b.heat_number}</b>
                          </div>
                        ) : null}
                        {b.cert_number ? (
                          <Badge tone="green">серт. {b.cert_number}</Badge>
                        ) : needCert ? (
                          <Badge tone="red">нет сертификата</Badge>
                        ) : (
                          <span className="text-xs text-ink-400">—</span>
                        )}
                      </Td>
                      <Td>
                        <div className="space-y-1">
                          {files.map((f: any) => (
                            <div key={f.id} className="text-xs">
                              <FileLink bucket="certificates" path={f.file_path}>
                                {f.file_name}
                              </FileLink>
                            </div>
                          ))}
                          <details>
                            <summary className="cursor-pointer text-xs text-ink-500 hover:text-steel-700">
                              загрузить
                            </summary>
                            <div className="mt-2 w-56">
                              <FileUpload
                                bucket="certificates"
                                table="certificates"
                                label="Загрузить"
                                payload={{ batch_id: b.id, doc_type: 'heat_cert' }}
                                extraFields={[{ name: 'number', placeholder: '№ документа' }]}
                              />
                            </div>
                          </details>
                        </div>
                      </Td>
                    </tr>
                  )
                })}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  )
}
