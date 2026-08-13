import { describe, expect, it } from 'vitest'
import { buildSituationData } from '@/lib/viewer-data'
import type { ApiViewerData } from '@/lib/api-client'

/**
 * The share link and the board have to read identically. The danger chips are
 * the case that proves it: this file used to carry its own copy of the
 * derivation, next to the two in operations-context that had already drifted
 * (the poll path had dropped `fire_danger`). It now calls the board's own
 * `rekoDangerTypes` — this asserts the chips arrive on the display's operation,
 * so a copy re-appearing here would have to break the test to get in.
 */

const NO_DANGERS = {
  fire: false,
  fire_danger: false,
  explosion: false,
  collapse: false,
  chemical: false,
  electrical: false,
}

function payload(dangers: typeof NO_DANGERS | null): ApiViewerData {
  return {
    event: {} as ApiViewerData['event'],
    incidents: [
      {
        id: 'inc-1',
        event_id: 'evt-1',
        title: 'Keller',
        type: 'wasserwehr',
        priority: 'medium',
        status: 'active',
        location_address: 'Hauptstrasse 1',
        created_at: '2026-08-13T10:00:00Z',
        updated_at: '2026-08-13T10:00:00Z',
        has_completed_reko: true,
      },
    ] as unknown as ApiViewerData['incidents'],
    personnel: [],
    materials: [],
    vehicles: [],
    vehicle_positions: [],
    reko_summaries: {
      'inc-1': {
        is_relevant: true,
        dangers_json: dangers,
        personnel_count: 4,
        estimated_duration_hours: 2,
        summary_text: 'Wasser steht 20 cm',
        photos_json: ['a.jpg'],
      },
    },
  }
}

describe('buildSituationData — the Reko result on a shared board', () => {
  it('carries Brandgefahr, the flag a copied derivation lost twice', () => {
    const { operations } = buildSituationData(payload({ ...NO_DANGERS, fire_danger: true }))
    expect(operations[0].rekoSummary).toMatchObject({
      hasDangers: true,
      dangerTypes: ['Brandgefahr'],
      personnelCount: 4,
      estimatedDuration: 2,
      photos: ['a.jpg'],
    })
  })

  it('says nothing when the Reko ticked nothing', () => {
    const { operations } = buildSituationData(payload(NO_DANGERS))
    expect(operations[0].rekoSummary).toMatchObject({ hasDangers: false, dangerTypes: [] })
  })

  it('survives a Reko report with no assessment at all', () => {
    const { operations } = buildSituationData(payload(null))
    expect(operations[0].rekoSummary?.dangerTypes).toEqual([])
  })
})

/**
 * The two fields the share payload carries again: the pickup flag (a crew at
 * the kerb is the situation) and `is_leader` (which of the already-shared crew
 * names leads). Both feed display components that had live code and no data.
 */
describe('buildSituationData — pickup and the crew leader', () => {
  function crewPayload(): ApiViewerData {
    const base = payload(NO_DANGERS)
    return {
      ...base,
      incidents: [
        { ...base.incidents[0], pickup_needed: true, pickup_requested_at: '2026-08-13T21:30:00Z' },
      ] as unknown as ApiViewerData['incidents'],
      personnel: [
        { id: 'p-1', name: 'Suter Nina', role: 'Feuerwehrfrau', role_sort_order: 1, tags: null },
        { id: 'p-2', name: 'Frey Marc', role: 'Gruppenführer', role_sort_order: 0, tags: null },
      ] as unknown as ApiViewerData['personnel'],
      assignments: {
        'inc-1': [
          { id: 'a-1', resource_type: 'personnel', resource_id: 'p-1', driver_stay: false, is_leader: false },
          { id: 'a-2', resource_type: 'personnel', resource_id: 'p-2', driver_stay: false, is_leader: true },
        ],
      },
    }
  }

  it('marks the crew member the assignment names as leader', () => {
    const { operations } = buildSituationData(crewPayload())
    expect(operations[0].crew).toEqual(['Suter Nina', 'Frey Marc'])
    expect(operations[0].leaderName).toBe('Frey Marc')
  })

  it('carries the pickup flag and its time, never the note', () => {
    const { operations } = buildSituationData(crewPayload())
    expect(operations[0].pickupNeeded).toBe(true)
    expect(operations[0].pickupRequestedAt).toEqual(new Date('2026-08-13T21:30:00Z'))
    expect(operations[0].pickupNote).toBe('')
  })
})
