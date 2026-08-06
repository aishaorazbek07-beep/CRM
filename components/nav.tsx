'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import {
  LayoutDashboard,
  Handshake,
  Users,
  Package,
  Warehouse,
  ShoppingCart,
  Factory,
  BarChart3,
  ListChecks,
  Settings,
  Menu,
  X,
} from 'lucide-react'
import { ROLE_NAV } from '@/lib/labels'
import { cn } from './ui'

const ITEMS = [
  { key: 'dashboard', href: '/', label: 'Дашборд', icon: LayoutDashboard },
  { key: 'deals', href: '/deals', label: 'Сделки', icon: Handshake },
  { key: 'counterparties', href: '/counterparties', label: 'Контрагенты', icon: Users },
  { key: 'catalog', href: '/catalog', label: 'Номенклатура', icon: Package },
  { key: 'warehouse', href: '/warehouse', label: 'Склад', icon: Warehouse },
  { key: 'procurement', href: '/procurement', label: 'Снабжение', icon: ShoppingCart },
  { key: 'production', href: '/production', label: 'Производство', icon: Factory },
  { key: 'reports', href: '/reports', label: 'Отчёты', icon: BarChart3 },
  { key: 'tasks', href: '/tasks', label: 'Задачи', icon: ListChecks },
  { key: 'settings', href: '/settings', label: 'Настройки', icon: Settings },
]

export function Nav({ role, taskCount }: { role: string; taskCount: number }) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const allowed = ROLE_NAV[role] ?? ROLE_NAV.sales

  const items = ITEMS.filter((i) => allowed.includes(i.key))

  return (
    <>
      <button
        onClick={() => setOpen(!open)}
        className="fixed left-3 top-3 z-50 rounded-lg border border-ink-300 bg-white p-2 shadow-sm lg:hidden dark:border-white/15 dark:bg-ink-800"
        aria-label="Меню"
      >
        {open ? <X size={18} /> : <Menu size={18} />}
      </button>

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 w-60 shrink-0 border-r border-ink-200 bg-white transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 dark:border-white/10 dark:bg-[#12161d]',
          open ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex h-14 items-center gap-2 border-b border-ink-200 px-4 dark:border-white/10">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-steel-600 text-xs font-bold text-white">
            CRM
          </div>
          <span className="text-sm font-semibold">Единая база</span>
        </div>

        <nav className="space-y-0.5 p-2">
          {items.map((item) => {
            const active =
              item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={cn(
                  'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition',
                  active
                    ? 'bg-steel-600/10 text-steel-700 dark:bg-steel-500/15 dark:text-steel-500'
                    : 'text-ink-600 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-white/5'
                )}
              >
                <Icon size={17} />
                {item.label}
                {item.key === 'tasks' && taskCount > 0 && (
                  <span className="ml-auto rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                    {taskCount}
                  </span>
                )}
              </Link>
            )
          })}
        </nav>
      </aside>

      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/30 lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}
    </>
  )
}
