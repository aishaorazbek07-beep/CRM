'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from './ui'

export function Tabs({
  tabs,
}: {
  tabs: { href: string; label: string; badge?: React.ReactNode }[]
}) {
  const pathname = usePathname()

  return (
    <nav className="mb-5 flex flex-wrap gap-1 overflow-x-auto border-b border-ink-200/70 dark:border-white/10">
      {tabs.map((t) => {
        const active = pathname === t.href || pathname.startsWith(t.href + '/')
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              '-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-medium transition',
              active
                ? 'border-steel-600 text-steel-700 dark:text-steel-500'
                : 'border-transparent text-ink-500 hover:text-ink-800 dark:hover:text-ink-200'
            )}
          >
            {t.label}
            {t.badge != null && t.badge !== 0 && (
              <span className="ml-1.5 rounded bg-ink-100 px-1.5 py-0.5 text-xs text-ink-600 dark:bg-white/10 dark:text-ink-300">
                {t.badge}
              </span>
            )}
          </Link>
        )
      })}
    </nav>
  )
}
