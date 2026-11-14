import { describe, expect, it } from 'vitest'

import { formatEventDay } from '@/components/feld/feld-identity-bar'

describe('formatEventDay', () => {
  // Midday UTC: the same calendar day in any test machine's zone.
  const saturday = '2026-11-14T12:00:00Z'

  it('reads «Sa 14.11.» in German and drops the weekday dot in French', () => {
    expect(formatEventDay(saturday, 'de-CH')).toBe('Sa 14.11.')
    expect(formatEventDay(saturday, 'fr-CH')).toBe('sam 14.11')
  })

  it('says nothing when there is no date or it does not parse', () => {
    expect(formatEventDay(null, 'de-CH')).toBe('')
    expect(formatEventDay('gestern', 'de-CH')).toBe('')
  })
})
