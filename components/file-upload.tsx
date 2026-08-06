'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Upload } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Alert, Input } from './ui'

/**
 * Загрузка файла в Supabase Storage + запись в таблицу-реестр.
 * Используется для сертификатов плавок, паспортов изделий и договоров.
 */
export function FileUpload({
  bucket,
  table,
  payload,
  label = 'Загрузить файл',
  extraFields,
}: {
  bucket: 'certificates' | 'documents' | 'photos'
  table: 'certificates' | 'documents'
  payload: Record<string, unknown>
  label?: string
  extraFields?: { name: string; placeholder: string; type?: string }[]
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const fd = new FormData(form)
    const file = fd.get('file') as File
    if (!file || file.size === 0) return

    setBusy(true)
    setError(null)

    const supabase = createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    const safeName = file.name.replace(/[^\w.\-]+/g, '_')
    const path = `${new Date().getFullYear()}/${crypto.randomUUID()}_${safeName}`

    const { error: upErr } = await supabase.storage.from(bucket).upload(path, file)
    if (upErr) {
      setError(upErr.message)
      setBusy(false)
      return
    }

    const extra: Record<string, unknown> = {}
    for (const f of extraFields ?? []) {
      const v = fd.get(f.name)
      if (v) extra[f.name] = v
    }

    const row =
      table === 'certificates'
        ? {
            ...payload,
            ...extra,
            file_path: path,
            file_name: file.name,
            uploaded_by: user?.id,
          }
        : {
            ...payload,
            ...extra,
            file_path: path,
            file_name: file.name,
            mime_type: file.type,
            size_bytes: file.size,
            uploaded_by: user?.id,
          }

    const { error: insErr } = await supabase.from(table).insert(row)
    if (insErr) setError(insErr.message)

    setBusy(false)
    form.reset()
    router.refresh()
  }

  return (
    <form onSubmit={onSubmit} className="space-y-2">
      {error && <Alert tone="error">{error}</Alert>}
      {(extraFields ?? []).map((f) => (
        <Input key={f.name} name={f.name} placeholder={f.placeholder} type={f.type ?? 'text'} />
      ))}
      <input
        name="file"
        type="file"
        required
        className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-ink-100 file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-ink-200 dark:file:bg-white/10"
      />
      <button
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-lg bg-steel-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-steel-700 disabled:opacity-60"
      >
        <Upload size={15} /> {busy ? 'Загрузка…' : label}
      </button>
    </form>
  )
}

export function FileLink({
  bucket,
  path,
  children,
}: {
  bucket: string
  path: string
  children: React.ReactNode
}) {
  const [busy, setBusy] = useState(false)

  async function open() {
    setBusy(true)
    const supabase = createClient()
    const { data } = await supabase.storage.from(bucket).createSignedUrl(path, 300)
    setBusy(false)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  return (
    <button
      type="button"
      onClick={open}
      disabled={busy}
      className="text-steel-700 hover:underline disabled:opacity-50 dark:text-steel-500"
    >
      {children}
    </button>
  )
}
