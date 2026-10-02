import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SNAIL_HANDOVER_MAX_MS, SNAIL_STANDING_COOKIE, handOverSnailClock, resetSnailClock, snailClockElapsed } from './snail-clock'

const KEY = 'kp-rueck.snail-handover'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'performance'] })
  vi.setSystemTime(new Date('2026-10-02T20:00:00Z'))
  sessionStorage.clear()
  resetSnailClock()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('snail clock', () => {
  it('starts at 0 for the first snail of a launch and keeps running for later ones', () => {
    expect(snailClockElapsed()).toBe(0)
    vi.advanceTimersByTime(1_200)
    expect(snailClockElapsed()).toBe(1_200) // a later stage continues, it does not restart
  })

  it('hands the clock over to the next document of the same start', () => {
    snailClockElapsed() // the callback's snail starts the clock …
    vi.advanceTimersByTime(1_500)
    handOverSnailClock() // … and hands over right before the full page load
    // The next document: a fresh module, the stored handover.
    resetSnailClock()
    vi.advanceTimersByTime(400) // the navigation itself
    expect(snailClockElapsed()).toBe(1_900) // past the 630 ms arrival: it appears standing
    expect(sessionStorage.getItem(KEY)).toBeNull() // one-shot
  })

  it('arrives again on a reload nobody handed over (a new launch)', () => {
    snailClockElapsed()
    vi.advanceTimersByTime(3_000)
    resetSnailClock()
    expect(snailClockElapsed()).toBe(0)
  })

  it('ignores a stale handover', () => {
    snailClockElapsed()
    handOverSnailClock()
    resetSnailClock()
    vi.advanceTimersByTime(SNAIL_HANDOVER_MAX_MS + 1)
    expect(snailClockElapsed()).toBe(0)
  })

  it('does not hand over a clock that never started', () => {
    handOverSnailClock()
    expect(sessionStorage.getItem(KEY)).toBeNull()
  })

  it('survives garbage in storage', () => {
    sessionStorage.setItem(KEY, '{nope')
    expect(snailClockElapsed()).toBe(0)
  })

  it('leaves a short-lived cookie so the server can render the next snail standing', () => {
    snailClockElapsed()
    handOverSnailClock()
    expect(document.cookie).toContain(`${SNAIL_STANDING_COOKIE}=standing`)
    // The next document's first snail consumes it, and drops the attribute the layout set.
    document.documentElement.setAttribute('data-snail', 'standing')
    resetSnailClock()
    snailClockElapsed()
    expect(document.cookie).not.toContain(`${SNAIL_STANDING_COOKIE}=standing`)
    expect(document.documentElement.hasAttribute('data-snail')).toBe(false)
  })
})
