import { describe, expect, it } from 'vitest'
import { nextPickupId, openPickups } from './map-pickups'

const op = (id: string, pickupNeeded: boolean, at: string | null) => ({
  id,
  pickupNeeded,
  pickupRequestedAt: at ? new Date(at) : null,
})

describe('openPickups', () => {
  it('keeps the waiting ones, the longest wait first and an unknown time last', () => {
    const ops = [op('late', true, '2026-11-24T10:30:00Z'), op('none', false, null), op('unknown', true, null), op('early', true, '2026-11-24T09:00:00Z')]
    expect(openPickups(ops).map((o) => o.id)).toEqual(['early', 'late', 'unknown'])
  })
})

describe('nextPickupId', () => {
  const pickups = [op('a', true, null), op('b', true, null)]

  it('starts at the first one when none is selected', () => {
    expect(nextPickupId(pickups, null)).toBe('a')
    expect(nextPickupId(pickups, 'other')).toBe('a')
  })

  it('walks on from the selected one and wraps', () => {
    expect(nextPickupId(pickups, 'a')).toBe('b')
    expect(nextPickupId(pickups, 'b')).toBe('a')
  })

  it('has nothing to go to without an Abholung', () => {
    expect(nextPickupId([], null)).toBeNull()
  })
})
