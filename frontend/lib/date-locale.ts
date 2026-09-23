import { de, fr, it } from 'date-fns/locale'
import type { Locale } from 'date-fns'
import { useLocale } from 'next-intl'
import { getActiveLocale, isSupportedLocale, DEFAULT_LOCALE, type SupportedLocale } from '@/lib/i18n-messages'

const dateFnsLocales: Record<SupportedLocale, Locale> = { de, fr, it }

/**
 * The BCP 47 tag every `Intl` / `toLocale*String` call formats with.
 *
 * Swiss variants on purpose: the board's German always was `de-CH` (24 h clock,
 * `23.09.2026`), and `fr-CH` / `it-CH` keep that same shape instead of drifting
 * to France's or Italy's conventions. Until 2026-09-23 some 20 call sites
 * hard-coded `de-CH` (and three hard-coded date-fns `de`), so a board switched
 * to French still formatted German — «vor 3 Minuten» on the stale-data banner.
 *
 * ⚠️ Collation is NOT routed through here: names, ranks and material types are
 * roster data and sort in `de-CH` whatever the interface language (see
 * `lib/roster-order.ts`). Those call sites say so where they sort.
 */
const intlLocales: Record<SupportedLocale, string> = { de: 'de-CH', fr: 'fr-CH', it: 'it-CH' }

export function intlLocaleFor(locale: string): string {
  return intlLocales[isSupportedLocale(locale) ? locale : DEFAULT_LOCALE]
}

/** For code outside React (and module-level formatters called after mount). */
export function getIntlLocale(): string {
  return intlLocaleFor(getActiveLocale())
}

/** For components: next-intl's locale, so the server render and the first client
 *  render agree (the cookie is only readable on the client). */
export function useIntlLocale(): string {
  return intlLocaleFor(useLocale())
}

export function getDateFnsLocale(): Locale {
  return dateFnsLocales[getActiveLocale()]
}

/** `getDateFnsLocale` for components — same reasoning as `useIntlLocale`. */
export function useDateFnsLocale(): Locale {
  const locale = useLocale()
  return dateFnsLocales[isSupportedLocale(locale) ? locale : DEFAULT_LOCALE]
}
