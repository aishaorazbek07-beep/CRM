'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { cn } from './ui'

export type PickedItem = {
  id: string
  name: string
  sku: string | null
  steel_grade: string | null
  base_unit_id: string
  avg_cost: number
  last_purchase_price: number
  default_price: number
  lead_time_days: number
  unit?: { name: string } | null
}

export function ItemPicker({
  name = 'item_id',
  placeholder = 'Найти позицию: задвижка, лист 304, привод…',
  onPick,
  kinds,
  autoFocus,
}: {
  name?: string
  placeholder?: string
  onPick?: (item: PickedItem) => void
  kinds?: string[]
  autoFocus?: boolean
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PickedItem[]>([])
  const [picked, setPicked] = useState<PickedItem | null>(null)
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([])
      return
    }
    const t = setTimeout(async () => {
      const supabase = createClient()
      let q = supabase
        .from('items')
        .select(
          'id, name, sku, steel_grade, base_unit_id, avg_cost, last_purchase_price, default_price, lead_time_days, unit:base_unit_id(name)'
        )
        .eq('is_active', true)
        .or(`name.ilike.%${query}%,sku.ilike.%${query}%,steel_grade.ilike.%${query}%`)
        .limit(12)
      if (kinds?.length) q = q.in('kind', kinds)
      const { data } = await q
      setResults((data as unknown as PickedItem[]) ?? [])
      setOpen(true)
    }, 250)
    return () => clearTimeout(t)
  }, [query, kinds])

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  return (
    <div className="relative" ref={boxRef}>
      <input type="hidden" name={name} value={picked?.id ?? ''} />
      <input
        autoFocus={autoFocus}
        value={picked ? `${picked.name}` : query}
        onChange={(e) => {
          setPicked(null)
          setQuery(e.target.value)
        }}
        onFocus={() => results.length && setOpen(true)}
        placeholder={placeholder}
        className={cn(
          'w-full rounded-lg border border-ink-300 bg-white px-3 py-2 text-sm outline-none transition placeholder:text-ink-400 focus:border-steel-500 focus:ring-2 focus:ring-steel-500/20 dark:border-white/15 dark:bg-white/5 dark:text-ink-100',
          picked && 'border-steel-500/60 bg-steel-600/5'
        )}
      />

      {open && results.length > 0 && (
        <ul className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-ink-200 bg-white shadow-lg dark:border-white/15 dark:bg-[#161b23]">
          {results.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => {
                  setPicked(r)
                  setOpen(false)
                  setQuery('')
                  onPick?.(r)
                }}
                className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-ink-50 dark:hover:bg-white/5"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{r.name}</span>
                  <span className="block text-xs text-ink-500">
                    {r.sku ?? '—'}
                    {r.steel_grade ? ` · сталь ${r.steel_grade}` : ''}
                    {r.lead_time_days ? ` · срок ${r.lead_time_days} дн` : ''}
                  </span>
                </span>
                <span className="shrink-0 text-xs tabular-nums text-ink-500">
                  {Number(r.avg_cost || r.last_purchase_price || 0).toLocaleString('ru-RU')} ₸
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
