import { de } from 'date-fns/locale'
import type { Locale } from 'date-fns'
import { getActiveLocale, type SupportedLocale } from '@/lib/i18n-messages'

const dateFnsLocales: Record<SupportedLocale, Locale> = { de }

export function getDateFnsLocale(): Locale {
  return dateFnsLocales[getActiveLocale()]
}
