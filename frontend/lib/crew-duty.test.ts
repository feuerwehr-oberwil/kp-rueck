import { describe, expect, it } from 'vitest'
import { countPastThreshold, dutyLevel, dutyMinutes, sortByTimeOnDuty } from './crew-duty'

const NOW = Date.parse('2026-10-08T20:00:00Z')
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString()

describe('dutyMinutes', () => {
  it('counts whole minutes since check-in', () => {
    expect(dutyMinutes(ago(220.6), NOW)).toBe(220)
  })
  it('has no answer without a stamp', () => {
    expect(dutyMinutes(null, NOW)).toBeNull()
    expect(dutyMinutes(undefined, NOW)).toBeNull()
    expect(dutyMinutes('not a date', NOW)).toBeNull()
  })
  it('clamps clock skew to zero', () => {
    expect(dutyMinutes(ago(-2), NOW)).toBe(0)
  })
})

describe('dutyLevel', () => {
  it('turns amber AT the threshold, the same minute the bell speaks', () => {
    expect(dutyLevel(239, 4)).toBe('normal')
    expect(dutyLevel(240, 4)).toBe('long')
  })
  it('turns red at 1.5 × the threshold', () => {
    expect(dutyLevel(359, 4)).toBe('long')
    expect(dutyLevel(360, 4)).toBe('over')
    expect(dutyLevel(540, 6)).toBe('over')
  })
  it('stays calm when the setting is off or the stamp missing', () => {
    expect(dutyLevel(900, 0)).toBe('normal')
    expect(dutyLevel(null, 4)).toBe('normal')
  })
})

describe('sortByTimeOnDuty', () => {
  it('puts the longest on duty first, unstamped last, ties by name', () => {
    const people = [
      { name: 'Frisch Eva', checkedInAt: ago(20) },
      { name: 'Ohne Stempel', checkedInAt: null },
      { name: 'Müller Hans', checkedInAt: ago(400) },
      { name: 'Meier Anna', checkedInAt: ago(20) },
    ]
    expect(sortByTimeOnDuty(people).map((p) => p.name)).toEqual([
      'Müller Hans',
      'Frisch Eva',
      'Meier Anna',
      'Ohne Stempel',
    ])
  })
})

describe('countPastThreshold', () => {
  it('counts amber and red alike', () => {
    const people = [{ checkedInAt: ago(500) }, { checkedInAt: ago(250) }, { checkedInAt: ago(30) }, { checkedInAt: null }]
    expect(countPastThreshold(people, 4, NOW)).toBe(2)
    expect(countPastThreshold(people, 0, NOW)).toBe(0)
  })
})
