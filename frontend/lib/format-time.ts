import { getIntlLocale } from '@/lib/date-locale'

type Instant = string | Date | null | undefined

const CLOCK = { hour: '2-digit', minute: '2-digit' } as const
const DATE_TIME = { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' } as const

function toDate(value: Instant): Date | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * A clock time as «14:05» – the ONE hh:mm formatter. Takes an API timestamp or a
 * `Date`; `''` when there is none or it does not parse, so a caller can drop it
 * into a sentence without a guard. Formats in the device's language, Swiss
 * shape (`getIntlLocale`); a component pass `useIntlLocale()` so the server
 * render and the first client render agree.
 */
export function formatTime(value: Instant, locale: string = getIntlLocale()): string {
  return toDate(value)?.toLocaleTimeString(locale, CLOCK) ?? ''
}

/** Date and clock as «17.11.2026, 14:05», same rules as `formatTime`. */
export function formatDateTime(value: Instant, locale: string = getIntlLocale()): string {
  return toDate(value)?.toLocaleString(locale, DATE_TIME) ?? ''
}
