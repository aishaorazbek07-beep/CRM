'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export async function closeTask(fd: FormData) {
  const supabase = await createClient()
  const { error } = await supabase
    .from('tasks')
    .update({ status: 'done', closed_at: new Date().toISOString() })
    .eq('id', String(fd.get('task_id')))

  revalidatePath('/tasks')
  if (error) return { error: error.message }
  return { ok: true }
}

export async function createTask(fd: FormData) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { error } = await supabase.from('tasks').insert({
    title: String(fd.get('title')),
    description: fd.get('description') ? String(fd.get('description')) : null,
    assignee_role: fd.get('assignee_role') ? String(fd.get('assignee_role')) : null,
    due_date: fd.get('due_date') ? String(fd.get('due_date')) : null,
    priority: Number(fd.get('priority') ?? 2),
    created_by: user?.id,
  })

  revalidatePath('/tasks')
  if (error) return { error: error.message }
  return { ok: true }
}

/** Решение директора по заявке на снятие жёсткого резерва */
export async function decideRelease(fd: FormData) {
  const supabase = await createClient()

  const { error } = await supabase.rpc('rpc_decide_release', {
    p_request_id: String(fd.get('request_id')),
    p_approve: fd.get('approve') === 'yes',
    p_comment: fd.get('comment') ? String(fd.get('comment')) : null,
  })

  revalidatePath('/tasks')
  revalidatePath('/deals', 'layout')
  revalidatePath('/warehouse')
  if (error) return { error: error.message }
  return { ok: true }
}
