import { afterEach, describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { fr } from 'date-fns/locale'

import { getDateFnsLocale, getIntlLocale, intlLocaleFor, useDateFnsLocale, useIntlLocale } from './date-locale'

function setCookieLocale(locale: string | null) {
  document.cookie = locale === null ? 'NEXT_LOCALE=; max-age=0; path=/' : `NEXT_LOCALE=${locale}; path=/`
}

afterEach(() => setCookieLocale(null))

describe('the formatting locale follows the interface language', () => {
  it('maps every supported language to its Swiss variant', () => {
    expect(intlLocaleFor('de')).toBe('de-CH')
    expect(intlLocaleFor('fr')).toBe('fr-CH')
    expect(intlLocaleFor('it')).toBe('it-CH')
  })

  it('falls back to de-CH for anything it does not ship', () => {
    expect(intlLocaleFor('en')).toBe('de-CH')
    expect(intlLocaleFor('')).toBe('de-CH')
  })

  it('reads the per-device cookie outside React', () => {
    expect(getIntlLocale()).toBe('de-CH')
    setCookieLocale('fr')
    expect(getIntlLocale()).toBe('fr-CH')
    expect(getDateFnsLocale()).toBe(fr)
  })

  it('reads next-intl inside React, so server and client render agree', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <NextIntlClientProvider locale="fr" messages={{}} timeZone="Europe/Zurich">
        {children}
      </NextIntlClientProvider>
    )
    expect(renderHook(() => useIntlLocale(), { wrapper }).result.current).toBe('fr-CH')
    expect(renderHook(() => useDateFnsLocale(), { wrapper }).result.current).toBe(fr)
  })

  it('keeps the board clock in 24-hour Swiss shape in French too', () => {
    const at = new Date(2026, 8, 23, 14, 5)
    const opts = { hour: '2-digit', minute: '2-digit' } as const
    expect(at.toLocaleTimeString(intlLocaleFor('fr'), opts)).toBe('14:05')
    expect(at.toLocaleTimeString(intlLocaleFor('de'), opts)).toBe('14:05')
  })
})
