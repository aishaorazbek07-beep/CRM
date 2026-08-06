import { redirect } from 'next/navigation'
import { createClient } from './supabase/server'

export type Profile = {
  id: string
  full_name: string
  role: 'director' | 'sales' | 'procurement' | 'production' | 'warehouse'
  position: string | null
  is_active: boolean
}

export async function getProfile(): Promise<Profile | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('profiles')
    .select('id, full_name, role, position, is_active')
    .eq('id', user.id)
    .single()

  return (data as Profile) ?? null
}

export async function requireProfile(): Promise<Profile> {
  const profile = await getProfile()
  if (!profile) redirect('/login')
  return profile
}

export async function requireRole(...roles: Profile['role'][]): Promise<Profile> {
  const profile = await requireProfile()
  if (!roles.includes(profile.role)) redirect('/')
  return profile
}
