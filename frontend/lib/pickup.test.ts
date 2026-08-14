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
    // The server clock can be ahead of this device; "-3 Min" on a chip an
    // operator scans at 02:00 is worse than "0 Min".
    expect(pickupWaitingMinutes(new Date(NOW.getTime() + 90_000), NOW)).toBe(0)
  })
})

describe('formatPickupWaiting', () => {
  it('is empty without a request time', () => {
    expect(formatPickupWaiting(null, NOW)).toBe('')
  })

  it('stays in minutes below an hour', () => {
    expect(formatPickupWaiting(minutesAgo(0), NOW)).toBe('0 Min')
    expect(formatPickupWaiting(minutesAgo(59), NOW)).toBe('59 Min')
  })

  it('switches to hours at 60 minutes', () => {
    expect(formatPickupWaiting(minutesAgo(60), NOW)).toBe('1 h')
    expect(formatPickupWaiting(minutesAgo(80), NOW)).toBe('1 h 20')
    expect(formatPickupWaiting(minutesAgo(185), NOW)).toBe('3 h 05')
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
