import Link from 'next/link'
import { Search } from 'lucide-react'
import { Badge, Card, Empty, Field, Input, PageHeader, Select, Table, Td, Th } from '@/components/ui'
import { ActionForm, SubmitButton } from '@/components/action-form'
import { createClient } from '@/lib/supabase/server'
import { createCounterparty } from './actions'

export const dynamic = 'force-dynamic'

const TYPE_LABEL: Record<string, string> = {
  client: 'Клиент',
  supplier: 'Поставщик',
  both: 'Клиент и поставщик',
}

export default async function CounterpartiesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string }>
}) {
  const sp = await searchParams
  const supabase = await createClient()

  let q = supabase.from('counterparties').select('*').order('name').limit(300)
  if (sp.q) q = q.or(`name.ilike.%${sp.q}%,bin_iin.ilike.%${sp.q}%`)
  if (sp.type) q = q.eq('type', sp.type)

  const { data: rows } = await q

  return (
    <>
      <PageHeader title="Контрагенты" subtitle="Клиенты и поставщики" />

      <form className="mb-4 flex flex-wrap items-end gap-2">
        <div className="relative min-w-56 flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
          <Input name="q" defaultValue={sp.q ?? ''} placeholder="Название или БИН" className="pl-9" />
        </div>
        <Select name="type" defaultValue={sp.type ?? ''} className="w-52">
          <option value="">Все</option>
          {Object.entries(TYPE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
        <button className="rounded-lg bg-steel-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-steel-700">
          Найти
        </button>
      </form>

      <div className="grid gap-4 lg:grid-cols-4">
        <Card title="Новый контрагент">
          <ActionForm action={createCounterparty} className="space-y-3 p-4">
            <Field label="Тип">
              <Select name="type" defaultValue="client">
                {Object.entries(TYPE_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Краткое название">
              <Input name="name" required placeholder="ТОО «Пример»" />
            </Field>
            <Field label="Полное название">
              <Input name="full_name" />
            </Field>
            <Field label="БИН / ИИН">
              <Input name="bin_iin" />
            </Field>
            <Field label="Телефон">
              <Input name="phone" />
            </Field>
            <Field label="E-mail">
              <Input name="email" type="email" />
            </Field>
            <Field label="Условия оплаты">
              <Input name="payment_terms" placeholder="Предоплата 50%" />
            </Field>
            <Field label="Отсрочка, дней">
              <Input name="deferral_days" type="number" defaultValue={0} className="no-spin" />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="is_key_client" /> ключевой клиент (жёсткий резерв по договору)
            </label>
            <SubmitButton>Создать</SubmitButton>
          </ActionForm>
        </Card>

        <Card className="lg:col-span-3">
          {(rows ?? []).length === 0 ? (
            <Empty>Ничего не найдено</Empty>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Название</Th>
                  <Th>Тип</Th>
                  <Th>БИН/ИИН</Th>
                  <Th>Контакты</Th>
                  <Th>Условия</Th>
                </tr>
              </thead>
              <tbody>
                {(rows ?? []).map((c: any) => (
                  <tr key={c.id} className={c.is_active ? '' : 'opacity-50'}>
                    <Td>
                      <Link
                        href={`/counterparties/${c.id}`}
                        className="font-medium text-steel-700 hover:underline dark:text-steel-500"
                      >
                        {c.name}
                      </Link>
                      {c.is_key_client && (
                        <Badge tone="amber">
                          <span className="ml-1">ключевой</span>
                        </Badge>
                      )}
                    </Td>
                    <Td>
                      <Badge tone="slate">{TYPE_LABEL[c.type]}</Badge>
                    </Td>
                    <Td className="font-mono text-xs">{c.bin_iin ?? '—'}</Td>
                    <Td className="text-xs">
                      {c.phone ?? '—'}
                      {c.email && <div className="text-ink-500">{c.email}</div>}
                    </Td>
                    <Td className="text-xs">
                      {c.payment_terms ?? '—'}
                      {c.deferral_days > 0 && (
                        <div className="text-ink-500">отсрочка {c.deferral_days} дн</div>
                      )}
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
