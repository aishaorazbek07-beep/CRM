'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { Alert, Button, cn } from './ui'

type Result = { ok?: boolean; error?: string } | void | null | undefined

export function ActionForm({
  action,
  children,
  className,
  hideErrors = false,
}: {
  action: (fd: FormData) => Promise<Result>
  children: React.ReactNode
  className?: string
  hideErrors?: boolean
}) {
  const [state, formAction] = useActionState(
    async (_prev: Result, fd: FormData) => await action(fd),
    null
  )

  const error =
    state && typeof state === 'object' && 'error' in state ? (state as { error?: string }).error : null

  return (
    <form action={formAction} className={className}>
      {!hideErrors && error ? (
        <div className="mb-3">
          <Alert tone="error">{error}</Alert>
        </div>
      ) : null}
      {children}
    </form>
  )
}

export function SubmitButton({
  children,
  variant = 'primary',
  size = 'md',
  className,
  confirm,
  title,
}: {
  children: React.ReactNode
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
  className?: string
  confirm?: string
  title?: string
}) {
  const { pending } = useFormStatus()
  return (
    <Button
      variant={variant}
      size={size}
      className={cn(className)}
      disabled={pending}
      title={title}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault()
      }}
    >
      {pending ? '…' : children}
    </Button>
  )
}
