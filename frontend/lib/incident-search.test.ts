import { describe, expect, it } from 'vitest'

import type { Material, Operation } from '@/lib/contexts/operations-context'
import { filterIncidents, matchesIncidentQuery } from '@/lib/incident-search'

/** A board-shaped incident with everything empty, so each test names only what it is about. */
function makeOperation(overrides: Partial<Operation> = {}): Operation {
  return {
    id: 'op-1',
    location: 'Hauptstrasse 1',
    vehicle: null,
    vehicles: [],
    incidentType: 'wasser',
    dispatchTime: new Date('2026-08-13T08:00:00Z'),
    crew: [],
    priority: 'low',
    status: 'incoming',
    coordinates: [47.5, 7.6],
    materials: [],
    notes: '',
    contact: '',
    contactPhone: '',
    internalNotes: '',
    nachbarhilfe: false,
    nachbarhilfeNote: '',
    amWarten: false,
    amWartenNote: '',
    zuFuss: false,
    groupId: null,
    groupPosition: 0,
    statusChangedAt: null,
    hasCompletedReko: false,
    rekoArrivedAt: null,
    rekoSummary: null,
    assignedReko: null,
    leaderName: null,
    crewAssignments: new Map(),
    materialAssignments: new Map(),
    vehicleAssignments: new Map(),
    vehicleCallsigns: new Map(),
    vehicleDriverStay: new Map(),
    ...overrides,
  }
}

const NO_MATERIALS: Material[] = []

describe('searching by Auftrag name', () => {
  it('finds a stop by the name of the route it belongs to', () => {
    const stop = makeOperation({ groupId: 'g-1', location: 'Feldweg 3' })

    expect(matchesIncidentQuery(stop, 'Sturm', NO_MATERIALS, 'Sturmtour Nord')).toBe(true)
    // Case-insensitive, like every other field.
    expect(matchesIncidentQuery(stop, 'NORD', NO_MATERIALS, 'Sturmtour Nord')).toBe(true)
  })

  it('does not match an unrelated route name', () => {
    const stop = makeOperation({ groupId: 'g-1' })

    expect(matchesIncidentQuery(stop, 'Sturm', NO_MATERIALS, 'Kellertour Süd')).toBe(false)
  })

  it('still matches the other fields when no route name is given', () => {
    const stop = makeOperation({ location: 'Hauptstrasse 1' })

    expect(matchesIncidentQuery(stop, 'Hauptstrasse', NO_MATERIALS)).toBe(true)
    expect(matchesIncidentQuery(stop, 'Sturm', NO_MATERIALS)).toBe(false)
  })
})

describe('filterIncidents with a route lookup', () => {
  const inRoute = makeOperation({ id: 'a', groupId: 'g-1', location: 'Feldweg 3' })
  const ungrouped = makeOperation({ id: 'b', groupId: null, location: 'Bahnhofplatz 2' })
  const groupNames = new Map([['g-1', 'Sturmtour Nord']])

  it('keeps only the stops of the matching route', () => {
    const result = filterIncidents([inRoute, ungrouped], 'Sturmtour', NO_MATERIALS, groupNames)

    expect(result.map((op) => op.id)).toEqual(['a'])
  })

  it('ignores a groupId that the lookup does not know', () => {
    const orphan = makeOperation({ id: 'c', groupId: 'g-missing' })

    expect(filterIncidents([orphan], 'Sturmtour', NO_MATERIALS, groupNames)).toEqual([])
  })

  it('behaves exactly as before when the lookup is omitted', () => {
    expect(filterIncidents([inRoute, ungrouped], 'Sturmtour', NO_MATERIALS)).toEqual([])
    expect(filterIncidents([inRoute, ungrouped], 'Feldweg', NO_MATERIALS).map((op) => op.id)).toEqual(['a'])
    // An empty query is still the untouched list.
    expect(filterIncidents([inRoute, ungrouped], '  ', NO_MATERIALS)).toHaveLength(2)
  })
})

describe('searching by the words a card shows', () => {
  it('finds a priority by its German label, not only by the API code', () => {
    const high = makeOperation({ priority: 'high' })

    expect(matchesIncidentQuery(high, 'hoch', NO_MATERIALS, undefined, 'de')).toBe(true)
    expect(matchesIncidentQuery(high, 'Hoch', NO_MATERIALS, undefined, 'de')).toBe(true)
    expect(matchesIncidentQuery(makeOperation({ priority: 'low' }), 'hoch', NO_MATERIALS, undefined, 'de')).toBe(false)
  })

  it('finds a status by its column label', () => {
    const active = makeOperation({ status: 'active' })

    expect(matchesIncidentQuery(active, 'einsatz', NO_MATERIALS, undefined, 'de')).toBe(true)
    expect(matchesIncidentQuery(active, 'im einsatz', NO_MATERIALS, undefined, 'de')).toBe(true)
    expect(matchesIncidentQuery(makeOperation({ status: 'enroute' }), 'anfahrt', NO_MATERIALS, undefined, 'de')).toBe(true)
    expect(matchesIncidentQuery(makeOperation({ status: 'incoming' }), 'einsatz', NO_MATERIALS, undefined, 'de')).toBe(false)
  })

  it('uses the French labels on a French device', () => {
    expect(matchesIncidentQuery(makeOperation({ priority: 'high' }), 'haute', NO_MATERIALS, undefined, 'fr')).toBe(true)
    expect(matchesIncidentQuery(makeOperation({ status: 'active' }), 'intervention', NO_MATERIALS, undefined, 'fr')).toBe(true)
    expect(filterIncidents([makeOperation({ status: 'active' })], 'intervention', NO_MATERIALS, undefined, 'fr')).toHaveLength(1)
  })

  it('still takes the English code, but only as the whole word', () => {
    expect(matchesIncidentQuery(makeOperation({ priority: 'high' }), 'high', NO_MATERIALS, undefined, 'de')).toBe(true)
    expect(matchesIncidentQuery(makeOperation({ status: 'active' }), 'active', NO_MATERIALS, undefined, 'de')).toBe(true)
    // A fragment of a code nobody sees no longer matches: «com» found every
    // closed card (`complete`), «medi» every medium one (`medium`, shown «Mittel»).
    expect(matchesIncidentQuery(makeOperation({ status: 'complete' }), 'com', NO_MATERIALS, undefined, 'de')).toBe(false)
    expect(matchesIncidentQuery(makeOperation({ priority: 'medium' }), 'medi', NO_MATERIALS, undefined, 'de')).toBe(false)
  })
})

describe('the finished-Reko keyword', () => {
  const withReko = makeOperation({ status: 'enroute', hasCompletedReko: true })

  it('matches «reko» as a whole word', () => {
    expect(matchesIncidentQuery(withReko, 'reko', NO_MATERIALS, undefined, 'de')).toBe(true)
    expect(matchesIncidentQuery(withReko, ' REKO ', NO_MATERIALS, undefined, 'de')).toBe(true)
  })

  it('does not match a query that is merely a piece of «reko»', () => {
    // The finished Reko adds nothing for a fragment: the card matches exactly
    // when its twin without a Reko does (the address and status text still count).
    const withoutReko = { ...withReko, hasCompletedReko: false }
    for (const fragment of ['r', 'e', 'k', 'o', 're', 'ek', 'ko', 'rek']) {
      expect(matchesIncidentQuery(withReko, fragment, NO_MATERIALS, undefined, 'de'))
        .toBe(matchesIncidentQuery(withoutReko, fragment, NO_MATERIALS, undefined, 'de'))
    }
    // And on a card with nothing else containing it, «rek» finds nothing.
    const bare = makeOperation({ location: 'Gut 9', incidentType: 'x', status: 'incoming', hasCompletedReko: true })
    expect(matchesIncidentQuery(bare, 'rek', NO_MATERIALS, undefined, 'de')).toBe(false)
    expect(matchesIncidentQuery(bare, 'k', NO_MATERIALS, undefined, 'de')).toBe(false)
  })

  it('takes the French column word as well as «reko» on a French device', () => {
    expect(matchesIncidentQuery(withReko, 'reconnaissance', NO_MATERIALS, undefined, 'fr')).toBe(true)
    expect(matchesIncidentQuery(withReko, 'reko', NO_MATERIALS, undefined, 'fr')).toBe(true)
  })

  it('needs a finished Reko', () => {
    expect(matchesIncidentQuery(makeOperation({ status: 'enroute' }), 'reko', NO_MATERIALS, undefined, 'de')).toBe(false)
  })
})
