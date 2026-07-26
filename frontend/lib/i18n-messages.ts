// Multilingual UI copy. German (de.json) is the source of truth; every other
// catalogue is a DEEP-PARTIAL overlay that is merged over German, so a missing
// key anywhere falls back to the German string – a half-translated locale is
// always complete. To translate a language: fill messages/<locale>.json with
// the (partial) structure of de.json. As long as an overlay is empty, its
// locale is not offered in the language picker (see AVAILABLE_LOCALES).
import { createTranslator } from 'next-intl'
import de from '@/messages/de.json'
import fr from '@/messages/fr.json'
import it from '@/messages/it.json'

export const SUPPORTED_LOCALES = ['de', 'fr', 'it'] as const
export const DEFAULT_LOCALE = 'de'

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]

type Messages = typeof de

// Overlays are deep partials of the German catalogue, hence `object`.
const catalogs: Record<SupportedLocale, object> = { de, fr, it }

// Locales the language picker offers: German plus every overlay that actually
// contains translations. An empty stub stays invisible – a «Français» option
// that renders German would be a broken promise.
export const AVAILABLE_LOCALES: SupportedLocale[] = SUPPORTED_LOCALES.filter(
  (locale) => locale === DEFAULT_LOCALE || Object.keys(catalogs[locale]).length > 0
)

// Native names, deliberately untranslated – each language names itself.
export const LOCALE_NAMES: Record<SupportedLocale, string> = {
  de: 'Deutsch',
  fr: 'Français',
  it: 'Italiano',
}

export function isSupportedLocale(value: string | undefined): value is SupportedLocale {
  return value !== undefined && (SUPPORTED_LOCALES as readonly string[]).includes(value)
}

// German is the source of truth: keys missing in another catalog fall back to de.
export function loadMessages(locale: SupportedLocale): Messages {
  if (locale === DEFAULT_LOCALE) return de
  return deepMerge(de, catalogs[locale]) as Messages
}

function deepMerge(base: unknown, override: unknown): unknown {
  if (
    typeof base !== 'object' || base === null || Array.isArray(base) ||
    typeof override !== 'object' || override === null || Array.isArray(override)
  ) {
    return override ?? base
  }
  const result: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [key, value] of Object.entries(override as Record<string, unknown>)) {
    result[key] = key in result ? deepMerge(result[key], value) : value
  }
  return result
}

export function getActiveLocale(): SupportedLocale {
  if (typeof document !== 'undefined') {
    const match = document.cookie.match(/(?:^|;\s*)NEXT_LOCALE=([a-z-]+)/i)
    if (match && isSupportedLocale(match[1])) return match[1]
  }
  return DEFAULT_LOCALE
}

// Per-device choice, like the theme. Server (i18n/request.ts) and client
// (getActiveLocale) both read this cookie; callers reload after setting it so
// server components and out-of-React translators pick the change up together.
export function setActiveLocale(locale: SupportedLocale) {
  document.cookie = `NEXT_LOCALE=${locale}; path=/; max-age=31536000; SameSite=Lax`
}

// For code that runs outside React (toasts in contexts, api-client errors).
export function translateOutsideReact(
  key: string,
  values?: Record<string, string | number | Date>
): string {
  const locale = getActiveLocale()
  const t = createTranslator({ locale, messages: loadMessages(locale) }) as (
    key: string,
    values?: Record<string, string | number | Date>
  ) => string
  return t(key, values)
}
