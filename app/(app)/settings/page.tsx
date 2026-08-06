import { Badge, Card, Empty, Field, Input, PageHeader, Select, Table, Td, Textarea, Th } from '@/components/ui'
import { ActionForm, SubmitButton } from '@/components/action-form'
import { createClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth'
import { ROLE_LABEL, WAREHOUSE_KIND_LABEL } from '@/lib/labels'
import { createUser, createWarehouse, updateSettings, updateUser } from './actions'

export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  await requireRole('director')
  const supabase = await createClient()

  const [{ data: settings }, { data: users }, { data: warehouses }] = await Promise.all([
    supabase.from('settings').select('*').single(),
    supabase.from('profiles').select('*').order('full_name'),
    supabase.from('warehouses').select('*').order('sort_order'),
  ])

  return (
    <>
      <PageHeader title="Настройки" subtitle="Реквизиты, пользователи и складские зоны" />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Реквизиты компании">
          <ActionForm action={updateSettings} className="grid gap-3 p-4 sm:grid-cols-2">
            <Field label="Название" className="sm:col-span-2">
              <Input name="company_name" defaultValue={settings?.company_name ?? ''} />
            </Field>
            <Field label="БИН">
              <Input name="company_bin" defaultValue={settings?.company_bin ?? ''} />
            </Field>
            <Field label="Телефон">
              <Input name="company_phone" defaultValue={settings?.company_phone ?? ''} />
            </Field>
            <Field label="E-mail">
              <Input name="company_email" defaultValue={settings?.company_email ?? ''} />
            </Field>
            <Field label="Адрес">
              <Input name="company_address" defaultValue={settings?.company_address ?? ''} />
            </Field>
            <Field label="Банковские реквизиты" className="sm:col-span-2">
              <Textarea name="bank_details" rows={2} defaultValue={settings?.bank_details ?? ''} />
            </Field>
            <Field label="Валюта">
              <Input name="currency" defaultValue={settings?.currency ?? 'KZT'} />
            </Field>
            <Field label="НДС, %">
              <Input name="vat_percent" type="number" step="0.1" defaultValue={settings?.vat_percent ?? 12} className="no-spin" />
            </Field>
            <Field label="Наценка по умолчанию, %">
              <Input
                name="default_markup_percent"
                type="number"
                step="0.1"
                defaultValue={settings?.default_markup_percent ?? 20}
                className="no-spin"
              />
            </Field>
            <Field label="Срок действия КП, дней">
              <Input name="quote_valid_days" type="number" defaultValue={settings?.quote_valid_days ?? 14} className="no-spin" />
            </Field>
            <div className="sm:col-span-2">
              <SubmitButton>Сохранить</SubmitButton>
            </div>
          </ActionForm>
        </Card>

        <div className="space-y-4">
          <Card title="Новый пользователь">
            <ActionForm action={createUser} className="grid gap-3 p-4 sm:grid-cols-2">
              <Field label="ФИО" className="sm:col-span-2">
                <Input name="full_name" required />
              </Field>
              <Field label="E-mail">
                <Input name="email" type="email" required />
              </Field>
              <Field label="Пароль" hint="минимум 8 символов">
                <Input name="password" type="text" required minLength={8} />
              </Field>
              <Field label="Роль">
                <Select name="role" defaultValue="sales">
                  {Object.entries(ROLE_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Должность">
                <Input name="position" />
              </Field>
              <div className="sm:col-span-2">
                <SubmitButton>Создать пользователя</SubmitButton>
              </div>
            </ActionForm>
          </Card>

          <Card title="Складские зоны">
            <ActionForm action={createWarehouse} className="grid gap-3 border-b border-ink-100 p-4 sm:grid-cols-4 dark:border-white/5">
              <Field label="Код">
                <Input name="code" required placeholder="MAIN" />
              </Field>
              <Field label="Название" className="sm:col-span-2">
                <Input name="name" required />
              </Field>
              <Field label="Тип">
                <Select name="kind" defaultValue="material">
                  {Object.entries(WAREHOUSE_KIND_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="sm:col-span-4">
                <SubmitButton size="sm" variant="secondary">
                  Добавить склад
                </SubmitButton>
              </div>
            </ActionForm>

            <Table>
              <tbody>
                {(warehouses ?? []).map((w: any) => (
                  <tr key={w.id}>
                    <Td className="font-mono text-xs">{w.code}</Td>
                    <Td>{w.name}</Td>
                    <Td>
                      <Badge tone="slate">{WAREHOUSE_KIND_LABEL[w.kind]}</Badge>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </div>
      </div>

      <div className="mt-4">
        <Card title="Пользователи">
          {(users ?? []).length === 0 ? (
            <Empty>Пользователей нет</Empty>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>ФИО</Th>
                  <Th>Роль</Th>
                  <Th>Должность</Th>
                  <Th>Телефон</Th>
                  <Th>Активен</Th>
                  <Th></Th>
                </tr>
              </thead>
              <tbody>
                {(users ?? []).map((u: any) => (
                  <tr key={u.id}>
                    <td colSpan={6} className="border-b border-ink-100 px-3 py-2 dark:border-white/5">
                      <ActionForm action={updateUser} className="grid items-end gap-2 sm:grid-cols-6">
                        <input type="hidden" name="user_id" value={u.id} />
                        <Input name="full_name" defaultValue={u.full_name} className="sm:col-span-2" />
                        <Select name="role" defaultValue={u.role}>
                          {Object.entries(ROLE_LABEL).map(([k, v]) => (
                            <option key={k} value={k}>
                              {v}
                            </option>
                          ))}
                        </Select>
                        <Input name="position" defaultValue={u.position ?? ''} placeholder="должность" />
                        <Input name="phone" defaultValue={u.phone ?? ''} placeholder="телефон" />
                        <div className="flex items-center gap-3">
                          <label className="flex items-center gap-1.5 text-xs">
                            <input type="checkbox" name="is_active" defaultChecked={u.is_active} /> активен
                          </label>
                          <SubmitButton size="sm" variant="secondary">
                            Сохранить
                          </SubmitButton>
                        </div>
                      </ActionForm>
                    </td>
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
