import { describe, expect, it } from 'vitest'
import { clockValue, inHours, keepOrdered, leavesSoon, planFact, resolveClock } from './planned-times'

// Local wall-clock instants, so the test reads the same in every TZ the runner has.
const at = (day: number, h: number, m = 0) => new Date(2026, 10, day, h, m).getTime()
const NOW = at(19, 19, 31) // the demo evening, 19:31

describe('resolveClock – a typed «HH:MM» is its one occurrence in [now − 6 h, now + 18 h)', () => {
  it('later today, past midnight, and a little in the past', () => {
    expect(resolveClock('22:00', NOW)?.getTime()).toBe(at(19, 22))
    expect(resolveClock('01:30', NOW)?.getTime()).toBe(at(20, 1, 30))
    // late news, not a 24-hour shift
    expect(resolveClock('19:00', NOW)?.getTime()).toBe(at(19, 19))
    // 7 h back is outside the window → tomorrow
    expect(resolveClock('12:00', NOW)?.getTime()).toBe(at(20, 12))
  })

  it('refuses what is not a clock', () => {
    expect(resolveClock('', NOW)).toBeNull()
    expect(resolveClock('24:00', NOW)).toBeNull()
    expect(resolveClock('9', NOW)).toBeNull()
  })
})

describe('the quick steps and the input value', () => {
  it('«+1 h» lands on the next half hour (KP Front ceilSlot)', () => {
    expect(inHours(NOW, 1).getTime()).toBe(at(19, 21))
    expect(inHours(at(19, 20), 2).getTime()).toBe(at(19, 22))
  })

  it('clockValue is the device clock, 24 h', () => {
    expect(clockValue(new Date(at(20, 1, 5)).toISOString())).toBe('01:05')
    expect(clockValue(null)).toBe('')
  })
})

describe('planFact / leavesSoon – what a tile says', () => {
  const iso = (t: number) => new Date(t).toISOString()

  it('«bis» for somebody here, amber under 60 minutes and once past', () => {
    expect(planFact({ plannedUntil: iso(at(19, 22)) }, NOW)).toEqual({ kind: 'until', at: iso(at(19, 22)), soon: false })
    expect(planFact({ plannedUntil: iso(at(19, 20)) }, NOW)?.soon).toBe(true)
    expect(leavesSoon(iso(at(19, 20, 31)), NOW)).toBe(false) // exactly 60' left
    expect(leavesSoon(iso(at(19, 19)), NOW)).toBe(true) // should have gone
    expect(leavesSoon(null, NOW)).toBe(false)
  })

  it('«ab» while the arrival is ahead; once it passed, the «bis» speaks', () => {
    const plan = { plannedFrom: iso(at(19, 20)), plannedUntil: iso(at(19, 23)) }
    expect(planFact(plan, NOW)?.kind).toBe('from')
    expect(planFact(plan, at(19, 20, 5))?.kind).toBe('until')
    expect(planFact({}, NOW)).toBeNull()
  })
})

describe('keepOrdered – a plan never ends before it starts (KP Front keepEndAfterStart)', () => {
  it('steps a «bis» before its «von» a day forward, a «von» after its «bis» a day back', () => {
    const from = new Date(at(19, 23)).toISOString()
    expect(keepOrdered(new Date(at(19, 22)), 'until', from).getTime()).toBe(at(20, 22))
    expect(keepOrdered(new Date(at(20, 1)), 'until', from).getTime()).toBe(at(20, 1))
    expect(keepOrdered(new Date(at(19, 23)), 'from', new Date(at(19, 22)).toISOString()).getTime()).toBe(at(18, 23))
    expect(keepOrdered(new Date(at(19, 22)), 'until', null).getTime()).toBe(at(19, 22))
  })
})
