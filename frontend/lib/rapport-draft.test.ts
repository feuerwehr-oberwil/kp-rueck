import { describe, expect, it } from 'vitest'

import type { ApiRapportMaterialRow, ApiSchadenplatzRapport } from '@/lib/api/types'
import {
  EMPTY_RAPPORT_FORM,
  groupMaterialsByLocation,
  hasContent,
  isCorrected,
  mergeDraft,
  mergeMaterialTicks,
  toFormData,
  toUpdate,
  type RapportFormData,
} from './rapport-draft'

function material(overrides: Partial<ApiRapportMaterialRow> = {}): ApiRapportMaterialRow {
  return {
    assignment_id: 'a1',
    material_id: 'm1',
    name: 'Tauchpumpe TP-4',
    location: 'Magazin A',
    consumable: false,
    used: null,
    left_on_site: false,
    on_board: true,
    ...overrides,
  }
}

function rapport(overrides: Partial<ApiSchadenplatzRapport> = {}): ApiSchadenplatzRapport {
  return {
    incident_id: 'i1',
    exists: true,
    is_draft: true,
    submitted_at: null,
    damage_type: null,
    damage_type_other: null,
    work_started_at: null,
    work_ended_at: null,
    materials: [],
    photos: [],
    extra_material_note: null,
    kurzbericht: null,
    handed_over_to: null,
    owner_name: null,
    owner_street: null,
    owner_city: null,
    vehicle_plate: null,
    vehicle_model: null,
    personnel_count: 6,
    personnel_count_corrected: false,
    vehicle_count: 1,
    vehicle_count_corrected: false,
    cost_snapshot_json: null,
    arrived_at: null,
    created_by_name: null,
    created_in_kp: false,
    updated_by_name: null,
    updated_in_kp: false,
    updated_at: '2026-08-08T22:00:00Z',
    concurrent_editor: null,
    prefill: {
      location_address: 'Hauptstrasse 4, Oberwil',
      incident_ref: 'Keller Wasser',
      leader_personnel_id: null,
      leader_name: 'Frey Marc',
      melder_name: 'A. Bürgin',
      melder_street: 'Hauptstrasse 4, Oberwil',
      melder_city: null,
      board_personnel_count: 6,
      board_vehicle_count: 1,
      default_work_started_at: null,
      default_work_ended_at: null,
    },
    ...overrides,
  }
}

function form(overrides: Partial<RapportFormData> = {}): RapportFormData {
  return { ...EMPTY_RAPPORT_FORM, ...overrides }
}

describe('hasContent', () => {
  it('is false for a form nobody has typed in', () => {
    // A prefilled count is not content: every rapport opens with one.
    expect(hasContent(form({ personnel_count: 6, vehicle_count: 1 }))).toBe(false)
  })

  it('counts a single material tick', () => {
    expect(hasContent(form({ materials: [material({ used: true })] }))).toBe(true)
    expect(hasContent(form({ materials: [material({ left_on_site: true })] }))).toBe(true)
    expect(hasContent(form({ materials: [material()] }))).toBe(false)
  })

  it('counts the damage type and every text field', () => {
    expect(hasContent(form({ damage_type: 'sturmschaden' }))).toBe(true)
    expect(hasContent(form({ kurzbericht: '   ' }))).toBe(false)
    expect(hasContent(form({ kurzbericht: 'Keller ausgepumpt' }))).toBe(true)
    expect(hasContent(form({ owner_name: 'A. Bürgin' }))).toBe(true)
  })
})

describe('mergeDraft', () => {
  it('uses the server when there is no local draft', () => {
    const result = mergeDraft(rapport({ kurzbericht: 'Vom Server' }), null)
    expect(result.usedLocal).toBe(false)
    expect(result.form.kurzbericht).toBe('Vom Server')
  })

  it('uses a local draft when the server has nothing yet', () => {
    // The crew typed three sentences in a dead spot. Losing them is the one
    // failure the whole localStorage dance exists to prevent.
    const result = mergeDraft(rapport(), {
      data: form({ kurzbericht: 'Im Funkloch getippt' }),
      timestamp: '2026-08-08T21:00:00Z',
    })
    expect(result.usedLocal).toBe(true)
    expect(result.form.kurzbericht).toBe('Im Funkloch getippt')
  })

  it('does NOT let a stale local draft overwrite a newer server version', () => {
    // A tab left open on a phone must not undo what somebody else amended.
    const result = mergeDraft(
      rapport({ kurzbericht: 'Neuer, von jemand anderem', updated_at: '2026-08-08T23:00:00Z' }),
      { data: form({ kurzbericht: 'Alt, aus einem offenen Tab' }), timestamp: '2026-08-08T22:00:00Z' },
    )
    expect(result.usedLocal).toBe(false)
    expect(result.form.kurzbericht).toBe('Neuer, von jemand anderem')
  })

  it('uses a local draft that is genuinely newer than the server version', () => {
    const result = mergeDraft(
      rapport({ kurzbericht: 'Server', updated_at: '2026-08-08T22:00:00Z' }),
      { data: form({ kurzbericht: 'Lokal, danach getippt' }), timestamp: '2026-08-08T23:00:00Z' },
    )
    expect(result.usedLocal).toBe(true)
    expect(result.form.kurzbericht).toBe('Lokal, danach getippt')
  })

  it('never rehydrates a local draft over a SUBMITTED rapport', () => {
    // Filing is the end of the crew's typing. Restoring a half-finished
    // version over a filed one would silently un-do the submit in the UI.
    const result = mergeDraft(
      rapport({ is_draft: false, kurzbericht: 'Abgeschlossen', updated_at: '2026-08-08T22:00:00Z' }),
      { data: form({ kurzbericht: 'Halbfertig' }), timestamp: '2026-08-09T02:00:00Z' },
    )
    expect(result.usedLocal).toBe(false)
    expect(result.form.kurzbericht).toBe('Abgeschlossen')
  })

  it('takes the checklist from the server and folds the local ticks onto it', () => {
    // The board can add or remove material while the phone is offline, so the
    // ROWS are always the server's; only the answers come from the draft.
    const server = rapport({
      materials: [material({ assignment_id: 'a1' }), material({ assignment_id: 'a2', name: 'Nassauger' })],
    })
    const result = mergeDraft(server, {
      data: form({
        kurzbericht: 'Lokal',
        materials: [material({ assignment_id: 'a1', used: true, left_on_site: true })],
      }),
      timestamp: '2026-08-09T02:00:00Z',
    })

    expect(result.usedLocal).toBe(true)
    expect(result.form.materials.map(row => row.assignment_id)).toEqual(['a1', 'a2'])
    expect(result.form.materials[0].used).toBe(true)
    expect(result.form.materials[0].left_on_site).toBe(true)
    expect(result.form.materials[1].used).toBeNull()
  })
})

describe('mergeMaterialTicks', () => {
  it('never lets an older draft mark a consumable as left on site', () => {
    const merged = mergeMaterialTicks(
      [material({ assignment_id: 'a1', consumable: true, name: 'Ölbindemittel' })],
      [material({ assignment_id: 'a1', consumable: false, used: true, left_on_site: true })],
    )
    expect(merged[0].used).toBe(true)
    expect(merged[0].left_on_site).toBe(false)
  })

  it('leaves rows the draft knows nothing about untouched', () => {
    const merged = mergeMaterialTicks([material({ assignment_id: 'neu' })], [])
    expect(merged[0].used).toBeNull()
  })
})

describe('isCorrected', () => {
  it('marks a value that disagrees with the board', () => {
    // The divergence is itself information: it says the board was behind.
    expect(isCorrected(8, 6)).toBe(true)
  })

  it('does not mark an agreeing value', () => {
    // Otherwise the "korrigiert" flag in the export stops being a signal.
    expect(isCorrected(6, 6)).toBe(false)
  })

  it('does not mark an empty field', () => {
    expect(isCorrected(null, 6)).toBe(false)
  })

  it('marks a zero that disagrees', () => {
    expect(isCorrected(0, 2)).toBe(true)
  })
})

describe('toFormData / toUpdate', () => {
  it('round-trips the checklist as assignment ids and two ticks', () => {
    const data = toFormData(rapport({ materials: [material({ used: true, left_on_site: true })] }))
    const update = toUpdate(data, true)
    expect(update.materials).toEqual([{ assignment_id: 'a1', used: true, left_on_site: true }])
    expect(update.is_draft).toBe(true)
  })

  it('sends blank text as null, not as an empty string', () => {
    const update = toUpdate(form({ kurzbericht: '   ', owner_name: 'A. Bürgin' }), false)
    expect(update.kurzbericht).toBeNull()
    expect(update.owner_name).toBe('A. Bürgin')
    expect(update.is_draft).toBe(false)
  })

  it('drops the "Anderes" text when another damage type was picked', () => {
    const update = toUpdate(form({ damage_type: 'sturmschaden', damage_type_other: 'Blitzschlag' }), true)
    expect(update.damage_type_other).toBeNull()
  })
})

describe('groupMaterialsByLocation', () => {
  it('keeps the depot order the server sent', () => {
    const groups = groupMaterialsByLocation([
      material({ assignment_id: 'a1', location: 'Magazin A' }),
      material({ assignment_id: 'a2', location: 'Magazin A', name: 'Nassauger' }),
      material({ assignment_id: 'a3', location: 'Magazin B', name: 'Motorsäge' }),
    ])
    expect(groups.map(group => group.location)).toEqual(['Magazin A', 'Magazin B'])
    expect(groups[0].rows).toHaveLength(2)
  })

  it('puts units the board dropped in a block of their own, at the end', () => {
    const groups = groupMaterialsByLocation([
      material({ assignment_id: 'a1', location: 'Magazin A' }),
      material({ assignment_id: 'a2', location: null, on_board: false, name: 'Schlauch', used: true }),
    ])
    expect(groups).toHaveLength(2)
    expect(groups[1].onBoard).toBe(false)
  })
})
