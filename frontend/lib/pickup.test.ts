import { describe, it, expect } from 'vitest'

import { formatPickupSince, formatPickupWaiting, pickupWaitingMinutes } from './pickup'

const NOW = new Date('2026-08-09T02:00:00Z')

function minutesAgo(n: number): Date {
  return new Date(NOW.getTime() - n * 60_000)
}

describe('pickupWaitingMinutes', () => {
  it('is null when no pickup was ever requested', () => {
    expect(pickupWaitingMinutes(null, NOW)).toBeNull()
    expect(pickupWaitingMinutes(undefined, NOW)).toBeNull()
  })

  it('counts whole minutes', () => {
    expect(pickupWaitingMinutes(minutesAgo(42), NOW)).toBe(42)
  })

  it('never goes negative', () => {
    // The server clock can be ahead of this device; «-3'» on a chip an
    // operator scans at 02:00 is worse than «0'».
    expect(pickupWaitingMinutes(new Date(NOW.getTime() + 90_000), NOW)).toBe(0)
  })

  it('rejects invalid dates and drops partial minutes', () => {
    expect(pickupWaitingMinutes(new Date('invalid'), NOW)).toBeNull()
    expect(pickupWaitingMinutes(minutesAgo(1.99), NOW)).toBe(1)
  })
})

describe('formatPickupWaiting', () => {
  it('is empty without a request time', () => {
    expect(formatPickupWaiting(null, NOW)).toBe('')
  })

  it('reads in the board notation', () => {
    expect(formatPickupWaiting(minutesAgo(0), NOW)).toBe("0'")
    expect(formatPickupWaiting(minutesAgo(59), NOW)).toBe("59'")
    expect(formatPickupWaiting(minutesAgo(80), NOW)).toBe("1h 20'")
    expect(formatPickupWaiting(minutesAgo(28 * 60 + 12), NOW)).toBe('1d 4h')
  })
})

describe('formatPickupSince', () => {
  it('is empty without a request time', () => {
    expect(formatPickupSince(null, 'de-CH')).toBe('')
    expect(formatPickupSince(new Date('nonsense'), 'de-CH')).toBe('')
  })

  it('renders a two-digit clock time', () => {
    expect(formatPickupSince(new Date('2026-08-08T21:14:00Z'), 'de-CH')).toMatch(/^\d{2}:\d{2}$/)
  })
})
