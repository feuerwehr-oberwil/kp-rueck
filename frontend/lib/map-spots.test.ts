import { describe, expect, it } from 'vitest'
import { clusterableSpots, groupSpots, spotNumberText, spotNumbers, type SpotIncident } from './map-spots'

const COOP = { location_lat: 47.5179, location_lng: 7.5545 }

function incident(id: string, number: number | null, extra: Partial<SpotIncident> = {}): SpotIncident {
  return { id, number, priority: 'low', status: 'incoming', ...COOP, ...extra }
}

const keys = (spots: ReturnType<typeof groupSpots>) => spots.map((spot) => spot.incidents.map((i) => i.id))

describe('groupSpots', () => {
  it('makes one spot of the incidents at the same address, listed by number', () => {
    const spots = groupSpots([incident('nine', 9), incident('six', 6), incident('seven', 7)])
    expect(keys(spots)).toEqual([['six', 'seven', 'nine']])
  })

  it('keeps an incident next door its own spot', () => {
    // ~10 m apart: two houses, two pins (the overlap bubble may still join them below zoom 16).
    const spots = groupSpots([incident('a', 1), incident('b', 2, { location_lat: COOP.location_lat + 0.0001 })])
    expect(keys(spots)).toEqual([['a'], ['b']])
  })

  it('treats coordinates equal to 6 decimals as the same address', () => {
    const spots = groupSpots([incident('a', 1), incident('b', 2, { location_lng: COOP.location_lng + 0.00000001 })])
    expect(keys(spots)).toEqual([['a', 'b']])
  })

  it('leaves out incidents without coordinates', () => {
    expect(groupSpots([incident('nowhere', 1, { location_lat: null, location_lng: null })])).toEqual([])
  })

  it('wears the look of the most urgent member: priority first, then the status', () => {
    const [spot] = groupSpots([
      incident('low', 6, { priority: 'low' }),
      incident('high-active', 7, { priority: 'high', status: 'active' }),
      incident('high-open', 9, { priority: 'high', status: 'reko' }),
      incident('medium', 11, { priority: 'medium' }),
    ])
    expect(spot.lead.id).toBe('high-open')
  })
})

describe('clusterableSpots', () => {
  it('keeps a spot with the selected member out of the bubbles, whole', () => {
    const [shared, alone] = groupSpots([incident('a', 1), incident('b', 2), incident('c', 3, { location_lat: 47.6 })])
    const out = clusterableSpots([shared, alone], new Set(['b']))
    expect(out).toEqual([alone])
    // …and the spot itself is not split to free the selected one.
    expect(shared.incidents.map((i) => i.id)).toEqual(['a', 'b'])
  })
})

describe('spotNumbers', () => {
  const many = (n: number) => Array.from({ length: n }, (_, k) => incident(`i${k}`, k + 1))

  it('lists up to four numbers', () => {
    expect(spotNumbers(many(4))).toEqual({ shown: [1, 2, 3, 4], more: 0 })
    expect(spotNumberText(many(3))).toBe('1 · 2 · 3')
  })

  it('caps a longer list and says how many more – never «+1»', () => {
    expect(spotNumbers(many(5))).toEqual({ shown: [1, 2, 3], more: 2 })
    expect(spotNumberText(many(7))).toBe('1 · 2 · 3 +4')
  })

  it('says nothing for incidents without a number', () => {
    expect(spotNumberText([incident('a', null), incident('b', null)])).toBe('')
  })
})
