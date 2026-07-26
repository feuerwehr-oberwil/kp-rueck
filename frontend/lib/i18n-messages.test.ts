import { describe, it, expect } from 'vitest'
import {
  AVAILABLE_LOCALES,
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  isSupportedLocale,
  loadMessages,
} from './i18n-messages'
import fr from '@/messages/fr.json'
import itMessages from '@/messages/it.json'

// The i18n contract: German is the source of truth, every other catalogue is a
// deep-partial overlay merged over it. A missing key ANYWHERE must fall back to
// the German string, so a half-translated (or still empty) locale is always a
// complete catalogue. These tests pin that behaviour and the picker gating.
describe('locale catalogues', () => {
  it('supports de, fr and it', () => {
    expect(SUPPORTED_LOCALES).toEqual(['de', 'fr', 'it'])
    expect(isSupportedLocale('fr')).toBe(true)
    expect(isSupportedLocale('en')).toBe(false)
    expect(isSupportedLocale(undefined)).toBe(false)
  })

  it('an empty overlay falls back to German everywhere', () => {
    const de = loadMessages(DEFAULT_LOCALE)
    for (const locale of SUPPORTED_LOCALES) {
      const merged = loadMessages(locale)
      // Every German key must survive the merge — overlays may replace strings,
      // never remove them.
      expect(Object.keys(merged)).toEqual(Object.keys(de))
    }
    // While fr is an empty stub, the merged catalogue IS the German one.
    if (Object.keys(fr).length === 0) {
      expect(loadMessages('fr')).toEqual(de)
    }
  })

  it('offers exactly the locales that have translations in the picker', () => {
    expect(AVAILABLE_LOCALES).toContain(DEFAULT_LOCALE)
    expect(AVAILABLE_LOCALES.includes('fr')).toBe(Object.keys(fr).length > 0)
    expect(AVAILABLE_LOCALES.includes('it')).toBe(Object.keys(itMessages).length > 0)
  })
})
