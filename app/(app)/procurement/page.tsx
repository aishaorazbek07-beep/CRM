import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import { Badge, Card, Empty, Field, Input, PageHeader, Select, StatCard, Table, Td, Th } from '@/components/ui'
import { Tabs } from '@/components/tabs'
import { ActionForm, SubmitButton } from '@/components/action-form'
import { ItemPicker } from '@/components/item-picker'
import { createClient } from '@/lib/supabase/server'
import { PR_STATUS_LABEL, TASK_TYPE_LABEL } from '@/lib/labels'
import { date, num } from '@/lib/format'
import { closeTask, createManualRequest } from './actions'

export const dynamic = 'force-dynamic'

export default async function ProcurementPage() {
  const supabase = await createClient()

  const [{ data: deficit }, { data: requests }, { data: tasks }, { data: deals }] = await Promise.all([
    supabase.from('v_deficit_overview').select('*').order('name'),
    supabase
      .from('purchase_requests')
      .select('*, deal:deal_id(id, number, title), items:purchase_request_items(id)')
      .neq('status', 'closed')
      .order('created_at', { ascending: false }),
    supabase
      .from('tasks')
      .select('*')
      .eq('assignee_role', 'procurement')
      .eq('status', 'open')
      .order('priority')
      .limit(30),
    supabase.from('deals').select('id, number, title').eq('status', 'active').order('created_at', { ascending: false }).limit(50),
  ])

  const belowMin = (deficit ?? []).filter((d: any) => Number(d.below_min_qty) > 0)
  const negative = (deficit ?? []).filter((d: any) => Number(d.available) < 0)

  return (
    <>
      <PageHeader
        title="Снабжение"
        subtitle="Дефицит, заявки в закуп и контроль сроков поставки"
      />

      <Tabs
        tabs={[
          { href: '/procurement', label: 'Дефицит и заявки' },
          { href: '/procurement/orders', label: 'Заказы поставщикам' },
        ]}
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Открытых заявок" value={(requests ?? []).length} />
        <StatCard label="Ниже минимума" value={belowMin.length} tone={belowMin.length ? 'warn' : 'good'} />
        <StatCard label="Отрицательный свободный остаток" value={negative.length} tone={negative.length ? 'bad' : 'good'} />
        <StatCard label="Задач в работе" value={(tasks ?? []).length} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Задачи снабжению" className="lg:col-span-1">
          {(tasks ?? []).length === 0 ? (
            <Empty>Задач нет</Empty>
          ) : (
            <ul className="divide-y divide-ink-100 dark:divide-white/5">
              {(tasks ?? []).map((t: any) => (
                <li key={t.id} className="px-4 py-3">
                  <div className="flex items-start gap-2">
                    {t.priority === 1 && (
                      <AlertTriangle size={15} className="mt-0.5 shrink-0 text-rose-500" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">{t.title}</div>
                      <div className="text-xs text-ink-500">{t.description}</div>
                      <div className="mt-1 flex items-center gap-2">
                        <Badge tone="slate">{TASK_TYPE_LABEL[t.type]}</Badge>
                        {t.entity_type === 'purchase_request' && (
                          <Link
                            href={`/procurement/requests/${t.entity_id}`}
                            className="text-xs text-steel-700 hover:underline dark:text-steel-500"
                          >
                            открыть заявку
                          </Link>
                        )}
                        <ActionForm action={closeTask} hideErrors>
                          <input type="hidden" name="task_id" value={t.id} />
                          <SubmitButton size="sm" variant="ghost">
                            выполнено
                          </SubmitButton>
                        </ActionForm>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Заявки в закуп" className="lg:col-span-2">
          {(requests ?? []).length === 0 ? (
            <Empty>Открытых заявок нет</Empty>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Заявка</Th>
                  <Th>Сделка</Th>
                  <Th align="right">Позиций</Th>
                  <Th>Нужно к</Th>
                  <Th>Статус</Th>
                </tr>
              </thead>
              <tbody>
                {(requests ?? []).map((r: any) => (
                  <tr key={r.id}>
                    <Td>
                      <Link
                        href={`/procurement/requests/${r.id}`}
                        className="font-medium text-steel-700 hover:underline dark:text-steel-500"
                      >
                        {r.number}
                      </Link>
                      <div className="text-xs text-ink-500">{date(r.created_at)}</div>
                    </Td>
                    <Td>
                      {r.deal ? (
                        <Link href={`/deals/${r.deal.id}`} className="hover:underline">
                          {r.deal.number}
                          <div className="max-w-52 truncate text-xs text-ink-500">{r.deal.title}</div>
                        </Link>
                      ) : (
                        <span className="text-ink-400">склад</span>
                      )}
                    </Td>
                    <Td align="right">{(r.items ?? []).length}</Td>
                    <Td>{date(r.required_by)}</Td>
                    <Td>
                      <Badge tone={r.priority === 1 ? 'red' : 'amber'}>{PR_STATUS_LABEL[r.status]}</Badge>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Создать заявку вручную">
          <ActionForm action={createManualRequest} className="space-y-3 p-4">
            <Field label="Позиция">
              <ItemPicker />
            </Field>
            <Field label="Количество">
              <Input name="qty" type="number" step="0.001" defaultValue={1} className="no-spin" />
            </Field>
            <Field label="Под сделку (необязательно)">
              <Select name="deal_id" defaultValue="">
                <option value="">— на склад —</option>
                {(deals ?? []).map((d: any) => (
                  <option key={d.id} value={d.id}>
                    {d.number} — {d.title}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Нужно к дате">
              <Input name="required_by" type="date" />
            </Field>
            <Field label="Приоритет">
              <Select name="priority" defaultValue="2">
                <option value="1">Высокий</option>
                <option value="2">Обычный</option>
                <option value="3">Низкий</option>
              </Select>
            </Field>
            <SubmitButton>Создать заявку</SubmitButton>
          </ActionForm>
        </Card>

        <Card title="Дефицит и неснижаемые остатки" className="lg:col-span-2">
          {(deficit ?? []).length === 0 ? (
            <Empty>Дефицита нет</Empty>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Позиция</Th>
                  <Th align="right">Остаток</Th>
                  <Th align="right">Резерв</Th>
                  <Th align="right">Свободно</Th>
                  <Th align="right">Минимум</Th>
                  <Th align="right">Заказано</Th>
                  <Th align="right">В заявках</Th>
                </tr>
              </thead>
              <tbody>
                {(deficit ?? []).map((d: any) => (
                  <tr key={d.item_id} className={Number(d.below_min_qty) > 0 ? 'bg-amber-50/60 dark:bg-amber-500/5' : ''}>
                    <Td>
                      <Link href={`/catalog/${d.item_id}`} className="font-medium hover:underline">
                        {d.name}
                      </Link>
                      <div className="font-mono text-xs text-ink-500">
                        {d.sku}
                        {d.steel_grade ? ` · ${d.steel_grade}` : ''}
                      </div>
                    </Td>
                    <Td align="right">{num(d.on_hand)}</Td>
                    <Td align="right">{num(d.hard_reserved)}</Td>
                    <Td align="right">
                      <span className={Number(d.available) < 0 ? 'font-medium text-rose-600' : ''}>
                        {num(d.available)}
                      </span>
                    </Td>
                    <Td align="right">
                      {Number(d.below_min_qty) > 0 ? (
                        <Badge tone="amber">не хватает {num(d.below_min_qty)}</Badge>
                      ) : (
                        num(d.min_stock)
                      )}
                    </Td>
                    <Td align="right">{num(d.on_order)}</Td>
                    <Td align="right">{num(d.in_requests)}</Td>
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
