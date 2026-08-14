import { describe, expect, it } from 'vitest'
import type { Operation } from '@/lib/contexts/operations-context'
import {
  isFiledRapport,
  isOpenRapport,
  selectFiledRapports,
  selectOpenRapports,
} from '@/components/kanban/rapport-backlog-sheet'

function operation(overrides: Partial<Operation> = {}): Operation {
  return {
    id: 'incident-1',
    location: 'Hauptstrasse 1',
    vehicle: null,
    vehicles: [],
    incidentType: 'elementarereignis',
    dispatchTime: new Date('2026-08-09T18:00:00Z'),
    crew: [],
    priority: 'low',
    status: 'complete',
    coordinates: [47.1, 7.2],
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
    statusChangedAt: new Date('2026-08-09T20:00:00Z'),
    hasCompletedReko: false,
    rekoArrivedAt: null,
    hasBeenDispatched: true,
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

describe('isOpenRapport', () => {
  it('counts a closed, dispatched incident with no rapport', () => {
    expect(isOpenRapport(operation())).toBe(true)
  })

  it('does not count one whose rapport has been filed', () => {
    expect(isOpenRapport(operation({ hasSchadenplatzRapport: true }))).toBe(false)
  })

  it('counts a started-but-unfiled draft', () => {
    expect(isOpenRapport(operation({ hasSchadenplatzRapportDraft: true }))).toBe(true)
  })

  it('never counts an incident the rapport does not apply to', () => {
    // Never disponiert (§18.27): there is no rapport to be missing.
    expect(isOpenRapport(operation({ hasBeenDispatched: false }))).toBe(false)
  })

  it('does not count an incident that is still running', () => {
    expect(isOpenRapport(operation({ status: 'active' }))).toBe(false)
  })
})

describe('selectOpenRapports', () => {
  it('sorts oldest completion first and marks the drafts', () => {
    const recent = operation({ id: 'recent', statusChangedAt: new Date('2026-08-09T22:00:00Z') })
    const oldest = operation({
      id: 'oldest',
      statusChangedAt: new Date('2026-08-09T12:00:00Z'),
      hasSchadenplatzRapportDraft: true,
    })
    const filed = operation({ id: 'filed', hasSchadenplatzRapport: true })

    const backlog = selectOpenRapports([recent, oldest, filed])

    expect(backlog.map((entry) => entry.operation.id)).toEqual(['oldest', 'recent'])
    expect(backlog.map((entry) => entry.isDraft)).toEqual([true, false])
  })

  it('falls back to the alarm time when the status transition is unknown', () => {
    const [entry] = selectOpenRapports([operation({ statusChangedAt: null })])
    expect(entry.completedAt).toEqual(new Date('2026-08-09T18:00:00Z'))
  })
})

describe('isFiledRapport', () => {
  it('counts a filed rapport', () => {
    expect(isFiledRapport(operation({ hasSchadenplatzRapport: true }))).toBe(true)
  })

  it('does not count a draft — a half-written form is not a rapport', () => {
    expect(isFiledRapport(operation({ hasSchadenplatzRapportDraft: true }))).toBe(false)
  })

  it('counts one filed while the Schadenplatz was still running', () => {
    expect(isFiledRapport(operation({ status: 'active', hasSchadenplatzRapport: true }))).toBe(true)
  })
})

describe('selectFiledRapports', () => {
  it('sorts newest first and never overlaps the backlog', () => {
    const older = operation({
      id: 'older',
      hasSchadenplatzRapport: true,
      statusChangedAt: new Date('2026-08-09T12:00:00Z'),
    })
    const newer = operation({
      id: 'newer',
      hasSchadenplatzRapport: true,
      statusChangedAt: new Date('2026-08-09T22:00:00Z'),
    })
    const stillOpen = operation({ id: 'open' })

    const board = [older, newer, stillOpen]
    const filed = selectFiledRapports(board)

    expect(filed.map((entry) => entry.operation.id)).toEqual(['newer', 'older'])
    // The footer count keeps meaning OFFEN: the two lists are disjoint.
    expect(selectOpenRapports(board).map((entry) => entry.operation.id)).toEqual(['open'])
  })

  it('never marks an archived row as a draft', () => {
    const [entry] = selectFiledRapports([
      operation({ hasSchadenplatzRapport: true, hasSchadenplatzRapportDraft: true }),
    ])
    expect(entry.isDraft).toBe(false)
  })
})
