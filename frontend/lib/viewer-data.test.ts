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
