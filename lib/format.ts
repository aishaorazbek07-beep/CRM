export function money(value: number | string | null | undefined, currency = '₸') {
  const n = Number(value ?? 0)
  return (
    new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n) + ' ' + currency
  )
}

export function num(value: number | string | null | undefined, digits = 3) {
  const n = Number(value ?? 0)
  return new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  }).format(n)
}

export function pct(value: number | string | null | undefined) {
  return num(value, 1) + '%'
}

export function date(value: string | null | undefined) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

export function dateTime(value: string | null | undefined) {
  if (!value) return '—'
  return new Date(value).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function hours(seconds: number | null | undefined) {
  if (!seconds) return '—'
  const h = seconds / 3600
  if (h < 24) return `${h.toFixed(1)} ч`
  return `${(h / 24).toFixed(1)} дн`
}

export function daysLeft(dateStr: string | null | undefined) {
  if (!dateStr) return null
  const diff = Math.ceil(
    (new Date(dateStr).getTime() - new Date().setHours(0, 0, 0, 0)) / 86400000
  )
  return diff
}
