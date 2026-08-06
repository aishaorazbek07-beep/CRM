import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import { Alert, Badge, Card, Empty, Field, Input, PageHeader, Select, Table, Td, Textarea, Th } from '@/components/ui'
import { ActionForm, SubmitButton } from '@/components/action-form'
import { createClient } from '@/lib/supabase/server'
import { requireProfile } from '@/lib/auth'
import { ROLE_LABEL, TASK_TYPE_LABEL } from '@/lib/labels'
import { date, num } from '@/lib/format'
import { closeTask, createTask, decideRelease } from './actions'

export const dynamic = 'force-dynamic'

export default async function TasksPage() {
  const profile = await requireProfile()
  const supabase = await createClient()

  const [{ data: tasks }, { data: releaseRequests }] = await Promise.all([
    supabase
      .from('tasks')
      .select('*, assignee:assignee_id(full_name)')
      .eq('status', 'open')
      .order('priority')
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('reservation_release_requests')
      .select(
        '*, requester:requested_by(full_name), target_deal:target_deal_id(number, title), reservation:reservation_id(qty, kind, item:item_id(name, sku), deal:deal_id(id, number, title))'
      )
      .eq('status', 'pending')
      .order('created_at', { ascending: false }),
  ])

  const mine = (tasks ?? []).filter(
    (t: any) => t.assignee_id === profile.id || t.assignee_role === profile.role
  )
  const others = (tasks ?? []).filter((t: any) => !mine.includes(t))

  return (
    <>
      <PageHeader title="Задачи и согласования" subtitle="Автозадачи склада и снабжения, согласования резервов" />

      {profile.role === 'director' && (releaseRequests ?? []).length > 0 && (
        <div className="mb-4">
          <Card title="Согласование снятия жёстких резервов">
            <div className="p-4">
              <Alert tone="warn">
                Снятие жёсткого резерва в пользу другой сделки может сорвать сроки по уже
                запущенному проекту. Решение принимаете только вы.
              </Alert>
            </div>
            <Table>
              <thead>
                <tr>
                  <Th>Позиция</Th>
                  <Th align="right">Кол-во</Th>
                  <Th>С какой сделки</Th>
                  <Th>В пользу</Th>
                  <Th>Инициатор / причина</Th>
                  <Th>Решение</Th>
                </tr>
              </thead>
              <tbody>
                {(releaseRequests ?? []).map((r: any) => (
                  <tr key={r.id}>
                    <Td>
                      <div className="font-medium">{r.reservation?.item?.name}</div>
                      <div className="font-mono text-xs text-ink-500">{r.reservation?.item?.sku}</div>
                    </Td>
                    <Td align="right">{num(r.qty)}</Td>
                    <Td>
                      {r.reservation?.deal && (
                        <Link href={`/deals/${r.reservation.deal.id}`} className="hover:underline">
                          {r.reservation.deal.number}
                          <div className="max-w-44 truncate text-xs text-ink-500">
                            {r.reservation.deal.title}
                          </div>
                        </Link>
                      )}
                    </Td>
                    <Td className="text-xs">{r.target_deal?.number ?? '—'}</Td>
                    <Td className="max-w-64 text-xs">
                      <div className="text-ink-500">{r.requester?.full_name}</div>
                      {r.reason}
                    </Td>
                    <Td>
                      <div className="flex gap-1">
                        <ActionForm action={decideRelease} hideErrors>
                          <input type="hidden" name="request_id" value={r.id} />
                          <input type="hidden" name="approve" value="yes" />
                          <SubmitButton size="sm" confirm="Снять жёсткий резерв? Действие изменит доступность материала.">
                            Разрешить
                          </SubmitButton>
                        </ActionForm>
                        <ActionForm action={decideRelease} hideErrors>
                          <input type="hidden" name="request_id" value={r.id} />
                          <input type="hidden" name="approve" value="no" />
                          <SubmitButton size="sm" variant="secondary">
                            Отклонить
                          </SubmitButton>
                        </ActionForm>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-4">
        <Card title="Новая задача">
          <ActionForm action={createTask} className="space-y-3 p-4">
            <Field label="Заголовок">
              <Input name="title" required />
            </Field>
            <Field label="Описание">
              <Textarea name="description" rows={3} />
            </Field>
            <Field label="Кому (роль)">
              <Select name="assignee_role" defaultValue="">
                <option value="">—</option>
                {Object.entries(ROLE_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Срок">
              <Input name="due_date" type="date" />
            </Field>
            <Field label="Приоритет">
              <Select name="priority" defaultValue="2">
                <option value="1">Высокий</option>
                <option value="2">Обычный</option>
                <option value="3">Низкий</option>
              </Select>
            </Field>
            <SubmitButton>Создать</SubmitButton>
          </ActionForm>
        </Card>

        <div className="space-y-4 lg:col-span-3">
          <Card title={`Мои задачи (${mine.length})`}>
            {mine.length === 0 ? (
              <Empty>Задач нет</Empty>
            ) : (
              <TaskList tasks={mine} />
            )}
          </Card>

          <Card title={`Остальные задачи (${others.length})`}>
            {others.length === 0 ? <Empty>Пусто</Empty> : <TaskList tasks={others} />}
          </Card>
        </div>
      </div>
    </>
  )
}

function TaskList({ tasks }: { tasks: any[] }) {
  return (
    <ul className="divide-y divide-ink-100 dark:divide-white/5">
      {tasks.map((t) => (
        <li key={t.id} className="flex items-start gap-3 px-4 py-3">
          {t.priority === 1 && <AlertTriangle size={16} className="mt-0.5 shrink-0 text-rose-500" />}
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">{t.title}</div>
            {t.description && <div className="text-xs text-ink-500">{t.description}</div>}
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
              <Badge tone="slate">{TASK_TYPE_LABEL[t.type]}</Badge>
              {t.assignee_role && <span className="text-ink-500">{ROLE_LABEL[t.assignee_role]}</span>}
              {t.due_date && <span className="text-ink-500">до {date(t.due_date)}</span>}
              {t.entity_type === 'purchase_request' && (
                <Link href={`/procurement/requests/${t.entity_id}`} className="text-steel-700 hover:underline dark:text-steel-500">
                  открыть заявку
                </Link>
              )}
              {t.entity_type === 'item' && (
                <Link href={`/catalog/${t.entity_id}`} className="text-steel-700 hover:underline dark:text-steel-500">
                  открыть позицию
                </Link>
              )}
              {t.entity_type === 'deal' && (
                <Link href={`/deals/${t.entity_id}`} className="text-steel-700 hover:underline dark:text-steel-500">
                  открыть сделку
                </Link>
              )}
            </div>
          </div>
          <ActionForm action={closeTask} hideErrors>
            <input type="hidden" name="task_id" value={t.id} />
            <SubmitButton size="sm" variant="secondary">
              Выполнено
            </SubmitButton>
          </ActionForm>
        </li>
      ))}
    </ul>
  )
}
