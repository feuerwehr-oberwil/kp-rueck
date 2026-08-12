// Multilingual UI copy. German (de.json) is the source of truth; every other
// catalogue is a DEEP-PARTIAL overlay that is merged over German, so a missing
// key anywhere falls back to the German string – a half-translated locale is
// always complete. To translate a language: fill messages/<locale>.json with
// the (partial) structure of de.json. A locale reaches the language picker only
// once its overlay covers every German key (see AVAILABLE_LOCALES) – the merge
// keeps a partial overlay working, it does not make it shippable.
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

// Every leaf of a catalogue as a dotted path (`kanban.columns.incoming`, and
// `reko.form.summaries.low[0]` for the three arrays). Coverage is compared
// key-for-key, so a leaf that German spells as an object and an overlay spells
// as a string counts as missing rather than silently half-covering.
function leafPaths(node: unknown, prefix = '', out: string[] = []): string[] {
  if (Array.isArray(node)) {
    node.forEach((item, i) => leafPaths(item, `${prefix}[${i}]`, out))
  } else if (node !== null && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      leafPaths(value, prefix ? `${prefix}.${key}` : key, out)
    }
  } else {
    out.push(prefix)
  }
  return out
}

const GERMAN_LEAVES = leafPaths(de)

// Locales the language picker offers: German plus every overlay that covers
// EVERY German leaf. The overlay merge below still fills gaps from German, but
// that is a safety net, not a release criterion – it is what keeps the app
// whole between the commit that adds a German key and the commit that
// translates it. As a picker rule it would put a 3 %-translated «Français» in
// front of an operator and render the other 97 % in German, which is a broken
// promise dressed as a feature. So: complete, or not offered.
function coversGerman(overlay: object): boolean {
  const translated = new Set(leafPaths(overlay))
  return GERMAN_LEAVES.every((path) => translated.has(path))
}

export const AVAILABLE_LOCALES: SupportedLocale[] = SUPPORTED_LOCALES.filter(
  (locale) => locale === DEFAULT_LOCALE || coversGerman(catalogs[locale])
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
