import Link from 'next/link'
import { Factory } from 'lucide-react'
import { Alert, Badge, Card, Empty, Field, Input, Table, Td, Th } from '@/components/ui'
import { ActionForm, SubmitButton } from '@/components/action-form'
import { createClient } from '@/lib/supabase/server'
import { PROD_STAGE_LABEL } from '@/lib/labels'
import { date, num } from '@/lib/format'
import { createProductionOrder } from '../../actions'

export const dynamic = 'force-dynamic'

export default async function DealProductionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const [{ data: deal }, { data: orders }] = await Promise.all([
    supabase.from('deals').select('title, required_ship_date').eq('id', id).single(),
    supabase
      .from('v_production_board')
      .select('*')
      .eq('deal_id', id)
      .order('number', { ascending: false }),
  ])

  return (
    <div className="space-y-4">
      <Card title="Производственные заказы по сделке">
        {(orders ?? []).length === 0 ? (
          <Empty>Заказ в цех ещё не передан</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Маршрутный лист</Th>
                <Th>Изделие</Th>
                <Th>Стадия</Th>
                <Th align="right">В стадии, ч</Th>
                <Th align="right">Не хватает</Th>
                <Th>План. срок</Th>
              </tr>
            </thead>
            <tbody>
              {(orders ?? []).map((o: any) => (
                <tr key={o.id}>
                  <Td>
                    <Link
                      href={`/production/${o.id}`}
                      className="inline-flex items-center gap-1.5 font-medium text-steel-700 hover:underline dark:text-steel-500"
                    >
                      <Factory size={15} />
                      {o.number}
                    </Link>
                    <div className="font-mono text-xs text-ink-500">{o.barcode}</div>
                  </Td>
                  <Td>{o.title}</Td>
                  <Td>
                    <Badge tone={o.stage === 'waiting_components' ? 'amber' : 'blue'}>
                      {PROD_STAGE_LABEL[o.stage]}
                    </Badge>
                  </Td>
                  <Td align="right">{num(o.hours_in_stage, 1)}</Td>
                  <Td align="right">
                    {Number(o.missing_positions) > 0 ? (
                      <Badge tone="red">{o.missing_positions}</Badge>
                    ) : (
                      <Badge tone="green">комплект</Badge>
                    )}
                  </Td>
                  <Td>{date(o.planned_finish)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card title="Передать в производство">
        <ActionForm action={createProductionOrder} className="grid gap-3 p-4 sm:grid-cols-3">
          <input type="hidden" name="deal_id" value={id} />
          <Field label="Наименование изделия" className="sm:col-span-2">
            <Input name="title" defaultValue={deal?.title ?? ''} />
          </Field>
          <Field label="Плановая дата готовности">
            <Input name="planned_finish" type="date" defaultValue={deal?.required_ship_date ?? ''} />
          </Field>
          <div className="sm:col-span-3">
            <SubmitButton>Создать маршрутный лист</SubmitButton>
          </div>
        </ActionForm>
      </Card>

      <Alert tone="info">
        Комплектация заказа формируется из текущей спецификации. Запуск в работу возможен только
        после того, как все материалы физически есть на складе и выданы в цех — система не даст
        перевести маршрутный лист со стадии «Ожидание комплектующих».
      </Alert>
    </div>
  )
}
