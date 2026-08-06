import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, ArrowRight, CheckCircle2, PackageCheck, Truck } from 'lucide-react'
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
  Textarea,
  Th,
} from '@/components/ui'
import { ActionForm, SubmitButton } from '@/components/action-form'
import { FileUpload, FileLink } from '@/components/file-upload'
import { createClient } from '@/lib/supabase/server'
import { PROD_STAGES, PROD_STAGE_LABEL } from '@/lib/labels'
import { date, dateTime, hours, num } from '@/lib/format'
import { addQcCheck, advanceStage, createShipment, issueMaterials, updateProductionOrder } from '../actions'

export const dynamic = 'force-dynamic'

export default async function ProductionOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: order } = await supabase
    .from('production_orders')
    .select('*, deal:deal_id(id, number, title, counterparty:counterparty_id(name)), master:master_id(full_name)')
    .eq('id', id)
    .single()

  if (!order) notFound()

  const [{ data: readiness }, { data: log }, { data: qc }, { data: masters }, { data: certs }] =
    await Promise.all([
      supabase.rpc('fn_production_readiness', { p_order_id: id }),
      supabase
        .from('production_stage_log')
        .select('*, profile:changed_by(full_name)')
        .eq('order_id', id)
        .order('changed_at', { ascending: false }),
      supabase
        .from('qc_checks')
        .select('*, profile:checked_by(full_name)')
        .eq('production_order_id', id)
        .order('checked_at', { ascending: false }),
      supabase.from('profiles').select('id, full_name').in('role', ['production', 'director']),
      supabase.from('certificates').select('*').eq('production_order_id', id),
    ])

  const missing = (readiness ?? []).filter((r: any) => Number(r.qty_missing) > 0.001)
  const stageIdx = PROD_STAGES.findIndex((s) => s.key === order.stage)
  const nextStage = PROD_STAGES[stageIdx + 1]
  const canStart = order.stage !== 'waiting_components' || missing.length === 0

  return (
    <div className="space-y-4">
      <Link
        href="/production"
        className="inline-flex items-center gap-1.5 text-sm text-ink-500 hover:underline"
      >
        <ArrowLeft size={15} /> К доске производства
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-ink-500">{order.number}</span>
            <Badge tone={order.stage === 'waiting_components' ? 'amber' : 'blue'}>
              {PROD_STAGE_LABEL[order.stage]}
            </Badge>
            {order.priority === 1 && <Badge tone="red">срочно</Badge>}
          </div>
          <h1 className="mt-1 text-2xl font-semibold">{order.title}</h1>
          <div className="mt-1 text-sm text-ink-500">
            {order.deal && (
              <>
                Сделка{' '}
                <Link href={`/deals/${order.deal.id}`} className="hover:underline">
                  {order.deal.number}
                </Link>{' '}
                · {order.deal.counterparty?.name}
              </>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-ink-200 bg-white px-4 py-3 text-center dark:border-white/10 dark:bg-white/[0.03]">
          <div className="text-xs text-ink-500">Штрихкод маршрутного листа</div>
          <div className="font-mono text-lg font-semibold tracking-widest">{order.barcode}</div>
          <div className="mt-1 text-xs text-ink-500">план: {date(order.planned_finish)}</div>
        </div>
      </div>

      {order.stage === 'waiting_components' && missing.length > 0 && (
        <Alert tone="error">
          <b>Запуск в цех заблокирован.</b> Не хватает {missing.length} позиций — система не
          позволит перевести маршрутный лист на заготовительный участок, пока склад не закроет
          комплектацию.
        </Alert>
      )}

      <div className="flex flex-wrap gap-2">
        {!order.materials_issued && (
          <ActionForm action={issueMaterials}>
            <input type="hidden" name="order_id" value={id} />
            <SubmitButton variant="secondary">
              <PackageCheck size={16} /> Выдать материалы в цех
            </SubmitButton>
          </ActionForm>
        )}

        {nextStage && (
          <ActionForm action={advanceStage} className="flex items-end gap-2">
            <input type="hidden" name="order_ref" value={id} />
            <input type="hidden" name="to_stage" value={nextStage.key} />
            <input
              name="comment"
              placeholder="Комментарий мастера (необязательно)"
              className="w-64 rounded-lg border border-ink-300 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-white/5"
            />
            <SubmitButton variant="primary" title={canStart ? '' : 'Нет комплектующих'}>
              <ArrowRight size={16} /> {nextStage.label}
            </SubmitButton>
          </ActionForm>
        )}

        {order.stage === 'ready_to_ship' && order.deal && (
          <ActionForm action={createShipment} className="flex items-end gap-2">
            <input type="hidden" name="order_id" value={id} />
            <input type="hidden" name="deal_id" value={order.deal.id} />
            <input
              name="waybill_number"
              placeholder="№ накладной"
              className="w-40 rounded-lg border border-ink-300 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-white/5"
            />
            <SubmitButton>
              <Truck size={16} /> Оформить отгрузку
            </SubmitButton>
          </ActionForm>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Комплектация по спецификации" className="lg:col-span-2">
          {(readiness ?? []).length === 0 ? (
            <Empty>Комплектующие не заданы</Empty>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Позиция</Th>
                  <Th align="right">Требуется</Th>
                  <Th align="right">Резерв</Th>
                  <Th align="right">На складе</Th>
                  <Th align="right">Не хватает</Th>
                </tr>
              </thead>
              <tbody>
                {(readiness ?? []).map((r: any) => (
                  <tr key={r.item_id}>
                    <Td>{r.item_name}</Td>
                    <Td align="right">{num(r.qty_required)}</Td>
                    <Td align="right">{num(r.qty_reserved)}</Td>
                    <Td align="right">{num(r.qty_available)}</Td>
                    <Td align="right">
                      {Number(r.qty_missing) > 0.001 ? (
                        <Badge tone="red">{num(r.qty_missing)}</Badge>
                      ) : (
                        <Badge tone="green">ok</Badge>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <div className="space-y-4">
          <Card title="Параметры заказа">
            <ActionForm action={updateProductionOrder} className="space-y-3 p-4">
              <input type="hidden" name="order_id" value={id} />
              <Field label="Мастер цеха">
                <Select name="master_id" defaultValue={order.master_id ?? ''}>
                  <option value="">—</option>
                  {(masters ?? []).map((m: any) => (
                    <option key={m.id} value={m.id}>
                      {m.full_name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Приоритет">
                <Select name="priority" defaultValue={String(order.priority)}>
                  <option value="1">Срочный</option>
                  <option value="2">Обычный</option>
                  <option value="3">Низкий</option>
                </Select>
              </Field>
              <Field label="Плановая готовность">
                <Input name="planned_finish" type="date" defaultValue={order.planned_finish ?? ''} />
              </Field>
              <Field label="Примечание">
                <Textarea name="note" rows={2} defaultValue={order.note ?? ''} />
              </Field>
              <SubmitButton size="sm" variant="secondary">
                Сохранить
              </SubmitButton>
            </ActionForm>
          </Card>

          <Card title="Паспорта и сертификаты изделия">
            <div className="space-y-3 p-4">
              <FileUpload
                bucket="certificates"
                table="certificates"
                label="Загрузить паспорт"
                payload={{ production_order_id: id, doc_type: 'passport' }}
                extraFields={[{ name: 'number', placeholder: 'Номер документа' }]}
              />
              {(certs ?? []).length > 0 && (
                <ul className="space-y-1 text-sm">
                  {(certs ?? []).map((c: any) => (
                    <li key={c.id}>
                      <FileLink bucket="certificates" path={c.file_path}>
                        {c.number ? `${c.number} — ` : ''}
                        {c.file_name}
                      </FileLink>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="ОТК — проверки качества">
          <div className="border-b border-ink-100 p-4 dark:border-white/5">
            <ActionForm action={addQcCheck} className="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="order_id" value={id} />
              <Field label="Вид контроля">
                <Select name="check_type" defaultValue="weld_seam">
                  <option value="visual">Визуальный осмотр</option>
                  <option value="weld_seam">Контроль сварных швов</option>
                  <option value="pressure_test">Опрессовка</option>
                  <option value="geometry">Геометрия</option>
                  <option value="valve_test">Проверка работы задвижек</option>
                  <option value="coating">Покрытие</option>
                  <option value="other">Другое</option>
                </Select>
              </Field>
              <Field label="Результат">
                <Select name="result" defaultValue="pass">
                  <option value="pass">Годен</option>
                  <option value="conditional">Годен с замечаниями</option>
                  <option value="fail">Брак / доработка</option>
                </Select>
              </Field>
              <Field label="Замечания" className="sm:col-span-2">
                <Input name="defects" placeholder="Напр.: подрез шва на обечайке №2" />
              </Field>
              <div className="sm:col-span-2">
                <SubmitButton size="sm">
                  <CheckCircle2 size={15} /> Зафиксировать проверку
                </SubmitButton>
              </div>
            </ActionForm>
          </div>

          {(qc ?? []).length === 0 ? (
            <Empty>Проверок не было</Empty>
          ) : (
            <ul className="divide-y divide-ink-100 dark:divide-white/5">
              {(qc ?? []).map((c: any) => (
                <li key={c.id} className="flex items-start justify-between gap-3 px-4 py-2.5 text-sm">
                  <div>
                    <div className="font-medium">{c.check_type}</div>
                    <div className="text-xs text-ink-500">
                      {dateTime(c.checked_at)} · {c.profile?.full_name ?? '—'}
                    </div>
                    {c.defects && <div className="text-xs text-amber-700">{c.defects}</div>}
                  </div>
                  <Badge
                    tone={c.result === 'pass' ? 'green' : c.result === 'conditional' ? 'amber' : 'red'}
                  >
                    {c.result === 'pass' ? 'Годен' : c.result === 'conditional' ? 'С замечаниями' : 'Брак'}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Хронология стадий">
          {(log ?? []).length === 0 ? (
            <Empty>Переходов не было</Empty>
          ) : (
            <ul className="divide-y divide-ink-100 dark:divide-white/5">
              {(log ?? []).map((l: any) => (
                <li key={l.id} className="px-4 py-2.5 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{PROD_STAGE_LABEL[l.to_stage]}</span>
                    <span className="text-xs text-ink-500">{dateTime(l.changed_at)}</span>
                  </div>
                  <div className="text-xs text-ink-500">
                    {l.from_stage ? `из «${PROD_STAGE_LABEL[l.from_stage]}»` : ''}
                    {l.duration_seconds ? ` · ${hours(l.duration_seconds)}` : ''}
                    {l.profile?.full_name ? ` · ${l.profile.full_name}` : ''}
                  </div>
                  {l.comment && <div className="mt-0.5 text-xs">{l.comment}</div>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}
