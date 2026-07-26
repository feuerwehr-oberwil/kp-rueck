import { de, fr, it } from 'date-fns/locale'
import type { Locale } from 'date-fns'
import { getActiveLocale, type SupportedLocale } from '@/lib/i18n-messages'

const dateFnsLocales: Record<SupportedLocale, Locale> = { de, fr, it }

export function getDateFnsLocale(): Locale {
  return dateFnsLocales[getActiveLocale()]
}
