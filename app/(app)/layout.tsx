import { LogOut } from 'lucide-react'
import { Nav } from '@/components/nav'
import { requireProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { ROLE_LABEL } from '@/lib/labels'
import { signOut } from '../login/actions'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile()
  const supabase = await createClient()

  const { count } = await supabase
    .from('tasks')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'open')
    .or(`assignee_role.eq.${profile.role},assignee_id.eq.${profile.id}`)

  return (
    <div className="flex min-h-screen">
      <Nav role={profile.role} taskCount={count ?? 0} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-end gap-3 border-b border-ink-200 bg-white/90 px-4 backdrop-blur dark:border-white/10 dark:bg-[#12161d]/90">
          <div className="text-right leading-tight">
            <div className="text-sm font-medium">{profile.full_name}</div>
            <div className="text-xs text-ink-500">{ROLE_LABEL[profile.role]}</div>
          </div>
          <form action={signOut}>
            <button
              className="rounded-lg p-2 text-ink-500 transition hover:bg-ink-100 hover:text-ink-800 dark:hover:bg-white/10"
              title="Выйти"
            >
              <LogOut size={17} />
            </button>
          </form>
        </header>

        <main className="min-w-0 flex-1 p-4 lg:p-6">{children}</main>
      </div>
    </div>
  )
}
