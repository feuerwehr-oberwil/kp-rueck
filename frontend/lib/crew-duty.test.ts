import { describe, expect, it } from 'vitest'
import { countPastThreshold, dutyLevel, dutyMinutes, filterCrewDuty, sortCrewDuty, type CrewDutyEntry } from './crew-duty'

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

describe('sortCrewDuty / filterCrewDuty', () => {
  const entry = (name: string, onDuty: number | null, extra: Partial<CrewDutyEntry> = {}): CrewDutyEntry => ({
    id: name,
    name,
    checkedInAt: onDuty === null ? null : ago(onDuty),
    onDuty,
    assigned: null,
    pause: null,
    count: null,
    now: null,
    ...extra,
  })
  const people = [
    entry('Frisch Eva', 20, { assigned: 0, pause: 20, count: 0 }),
    entry('Ohne Stempel', null),
    entry('Müller Hans', 400, { assigned: 300, pause: 100, count: 4, now: 'Langegasse 28' }),
    entry('Meier Anna', 20, { assigned: 15, pause: 5, count: 1, now: 'Hauptstrasse 41' }),
  ]
  const names = (list: CrewDutyEntry[]) => list.map((e) => e.name)

  it('longest on duty first, unknown last, ties by name', () => {
    expect(names(sortCrewDuty(people, 'onDuty', 'desc'))).toEqual(['Müller Hans', 'Frisch Eva', 'Meier Anna', 'Ohne Stempel'])
    // «seit» earliest first is the same question.
    expect(names(sortCrewDuty(people, 'since', 'asc'))).toEqual(['Müller Hans', 'Frisch Eva', 'Meier Anna', 'Ohne Stempel'])
  })

  it('sorts every column both ways, unknown still last', () => {
    expect(names(sortCrewDuty(people, 'count', 'desc'))).toEqual(['Müller Hans', 'Meier Anna', 'Frisch Eva', 'Ohne Stempel'])
    expect(names(sortCrewDuty(people, 'count', 'asc'))).toEqual(['Frisch Eva', 'Meier Anna', 'Müller Hans', 'Ohne Stempel'])
    expect(names(sortCrewDuty(people, 'pause', 'desc'))).toEqual(['Müller Hans', 'Frisch Eva', 'Meier Anna', 'Ohne Stempel'])
    expect(names(sortCrewDuty(people, 'name', 'asc'))).toEqual(['Frisch Eva', 'Meier Anna', 'Müller Hans', 'Ohne Stempel'])
    expect(names(sortCrewDuty(people, 'now', 'asc'))).toEqual(['Meier Anna', 'Müller Hans', 'Frisch Eva', 'Ohne Stempel'])
  })

  it('filters free / on something, and by name or place', () => {
    expect(names(filterCrewDuty(people, 'free', ''))).toEqual(['Frisch Eva', 'Ohne Stempel'])
    expect(names(filterCrewDuty(people, 'busy', ''))).toEqual(['Müller Hans', 'Meier Anna'])
    expect(names(filterCrewDuty(people, 'all', 'langeg'))).toEqual(['Müller Hans'])
    expect(names(filterCrewDuty(people, 'all', 'MEIER'))).toEqual(['Meier Anna'])
  })
})

describe('countPastThreshold', () => {
  it('counts amber and red alike', () => {
    const people = [{ checkedInAt: ago(500) }, { checkedInAt: ago(250) }, { checkedInAt: ago(30) }, { checkedInAt: null }]
    expect(countPastThreshold(people, 4, NOW)).toBe(2)
    expect(countPastThreshold(people, 0, NOW)).toBe(0)
  })
})
