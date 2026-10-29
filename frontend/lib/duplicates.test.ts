import { describe, expect, it } from 'vitest'

import { candidateAge, candidateDistance, candidateLabel, duplicateQueryKey, offsetMetres } from './duplicates'

describe('duplicate hint helpers', () => {
  it('names the card by its short address, the title only as a fallback', () => {
    expect(candidateLabel({ location_display: 'Hauptstrasse 6', title: 'Hauptstrasse 6, 4104 Oberwil' })).toBe(
      'Hauptstrasse 6',
    )
    expect(candidateLabel({ location_display: '', title: 'Baum auf Strasse' })).toBe('Baum auf Strasse')
  })

  it('has no distance for an address-only match', () => {
    expect(candidateDistance({ distance_m: 40, match: 'distance' })).toBe(40)
    expect(candidateDistance({ distance_m: 40, match: 'both' })).toBe(40)
    expect(candidateDistance({ distance_m: null, match: 'address' })).toBeNull()
  })

  it("says the card's age in board notation", () => {
    const now = Date.parse('2026-10-08T14:38:00Z')
    expect(candidateAge('2026-10-08T14:32:00Z', now)).toBe("6'")
  })

  it('places a pin 40 m north of the report 40 m up', () => {
    const offset = offsetMetres({ lat: 47.515, lng: 7.556 }, { lat: String(47.515 + 40 / 111_195), lng: '7.556' })
    expect(offset!.north).toBeCloseTo(40, 3)
    expect(offset!.east).toBeCloseTo(0, 3)
    expect(offsetMetres(null, { lat: '47', lng: '7' })).toBeNull()
    expect(offsetMetres({ lat: 47, lng: 7 }, { lat: null, lng: null })).toBeNull()
  })

  it('asks only once there is something the server can compare', () => {
    expect(duplicateQueryKey(null)).toBeNull()
    // A street without a number never matches — no round trip for it.
    expect(duplicateQueryKey({ lat: null, lng: null, address: 'Hauptstrasse' })).toBeNull()
    expect(duplicateQueryKey({ lat: null, lng: null, address: 'Hauptstrasse 6' })).not.toBeNull()
    expect(duplicateQueryKey({ lat: 47.5, lng: 7.5, address: null })).not.toBeNull()
    // Same question, same key: a re-render does not ask again.
    expect(duplicateQueryKey({ eventId: 'e', lat: 47.5, lng: 7.5, address: 'x 1' })).toBe(
      duplicateQueryKey({ eventId: 'e', lat: 47.5000000001, lng: 7.5, address: 'x 1 ' }),
    )
  })

  it('separates events, excluded incidents and independently changed coordinates', () => {
    const query = { eventId: 'e1', lat: 47.1234567, lng: 7.1234567, address: ' Hauptstrasse 6 ', excludeId: 'inc-1' }
    expect(JSON.parse(duplicateQueryKey(query)!)).toEqual(['e1', '47.123457', '7.123457', 'Hauptstrasse 6', 'inc-1'])
    for (const changed of [{ eventId: 'e2' }, { excludeId: 'inc-2' }, { lat: 47.2 }, { lng: 7.2 }, { address: 'Hauptstrasse 7' }]) {
      expect(duplicateQueryKey({ ...query, ...changed })).not.toBe(duplicateQueryKey(query))
    }
    expect(JSON.parse(duplicateQueryKey({ lat: null, lng: null, address: 'Hauptstrasse 6' })!))
      .toEqual(['', '', '', 'Hauptstrasse 6', ''])
  })

  it('does not use a partial pin or mistake zero coordinates for a missing pin', () => {
    expect(duplicateQueryKey({ lat: 47, lng: null, address: null })).toBeNull()
    expect(duplicateQueryKey({ lat: null, lng: 7, address: null })).toBeNull()
    expect(duplicateQueryKey({ lat: 0, lng: 0, address: null })).not.toBeNull()
  })

  it('accounts for longitude scale and the direction south and west', () => {
    const offset = offsetMetres({ lat: 60, lng: 10 }, { lat: 59.999, lng: 9.999 })!
    expect(offset.north).toBeCloseTo(-111.195, 3)
    expect(offset.east).toBeCloseTo(-55.5975, 3)
  })

  it.each([
    { lat: '', lng: '7' }, { lat: '47', lng: '' }, { lat: null, lng: '7' },
    { lat: '47', lng: null }, { lat: 'bad', lng: '7' }, { lat: '47', lng: 'bad' },
    { lat: Infinity, lng: 7 }, { lat: 47, lng: NaN },
  ])('rejects a missing or non-finite coordinate: %s', (point) => {
    expect(offsetMetres({ lat: 47, lng: 7 }, point)).toBeNull()
  })

  it('trims labels and clamps a future report age to zero', () => {
    expect(candidateLabel({ location_display: '  Hauptstrasse 6  ', title: 'Fire' })).toBe('Hauptstrasse 6')
    expect(candidateLabel({ location_display: '  ', title: 'Fire' })).toBe('Fire')
    expect(candidateDistance({ distance_m: 40, match: 'address' })).toBeNull()
    expect(candidateAge('2026-10-08T15:00:00Z', Date.parse('2026-10-08T14:00:00Z'))).toBe("0'")
  })
})
