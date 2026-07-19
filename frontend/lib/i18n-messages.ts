import { createTranslator } from 'next-intl'
import de from '@/messages/de.json'

export const SUPPORTED_LOCALES = ['de'] as const
export const DEFAULT_LOCALE = 'de'

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]

type Messages = typeof de

const catalogs: Record<SupportedLocale, Messages> = { de }

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
