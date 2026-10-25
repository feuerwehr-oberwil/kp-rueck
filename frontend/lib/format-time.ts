import { getActiveLocale } from '@/lib/i18n-messages'

/**
 * An API timestamp as «14:05» in the device's language, or `''` when there is
 * none or it does not parse – so a caller can drop it into a sentence without a
 * guard. For a `Date` already in hand, `formatClockTime` in `lib/incident-time`.
 */
export function formatTime(value: string | null | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString(getActiveLocale(), { hour: '2-digit', minute: '2-digit' })
}
