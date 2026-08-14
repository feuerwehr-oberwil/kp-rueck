import { describe, expect, it } from 'vitest'

import type {
  ApiRapportMaterialRow,
  ApiRapportVehicleRow,
  ApiSchadenplatzRapport,
} from '@/lib/api/types'
import {
  EMPTY_RAPPORT_FORM,
  groupMaterialsByLocation,
  hasContent,
  isCorrected,
  mergeDraft,
  mergeMaterialTicks,
  mergeVehicleTicks,
  setExtraMaterialFreeText,
  setExtraMaterialLeftOnSite,
  splitExtraMaterial,
  toFormData,
  toggleExtraMaterial,
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
    used: true,
    left_on_site: false,
    on_board: true,
    ...overrides,
  }
}

function vehicle(overrides: Partial<ApiRapportVehicleRow> = {}): ApiRapportVehicleRow {
  return {
    vehicle_id: 'f1',
    name: 'TLF Oberwil',
    present: true,
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
    materials: [],
    vehicles: [],
    personnel: [],
    extra_personnel: [],
    photos: [],
    extra_materials: [],
    kurzbericht: null,
    handed_over_to: null,
    owner_name: null,
    owner_phone: null,
    personnel_count: 6,
    personnel_count_corrected: false,
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
      melder_phone: '079 111 22 33',
      board_personnel_count: 6,
      material_name_suggestions: ['Nassauger', 'Tauchpumpe TP-4'],
    },
    ...overrides,
  }
}

function form(overrides: Partial<RapportFormData> = {}): RapportFormData {
  return { ...EMPTY_RAPPORT_FORM, ...overrides }
}

describe('hasContent', () => {
  it('is false for a form nobody has typed in', () => {
    // Both lists arrive prefilled from the board, so neither an all-ticked
    // material row nor a dispatched vehicle is content on its own.
    expect(hasContent(form({ personnel_count: 6, vehicles: [vehicle()] }))).toBe(false)
    expect(hasContent(form({ materials: [material()] }))).toBe(false)
  })

  it('counts a tick that CONTRADICTS the prefill, in either list', () => {
    // §18.32/§18.33: an unticked dispatched vehicle, a ticked one nobody sent,
    // and an unticked "gebraucht" are the three shapes of an actual answer.
    expect(hasContent(form({ vehicles: [vehicle({ present: false })] }))).toBe(true)
    expect(hasContent(form({ vehicles: [vehicle({ present: true, on_board: false })] }))).toBe(true)
    expect(hasContent(form({ materials: [material({ used: false })] }))).toBe(true)
    expect(hasContent(form({ materials: [material({ left_on_site: true })] }))).toBe(true)
  })

  it('counts every text field', () => {
    expect(hasContent(form({ kurzbericht: '   ' }))).toBe(false)
    expect(hasContent(form({ kurzbericht: 'Keller ausgepumpt' }))).toBe(true)
    expect(hasContent(form({ owner_name: 'A. Bürgin' }))).toBe(true)
    expect(hasContent(form({ owner_phone: '079 111 22 33' }))).toBe(true)
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
    expect(result.form.materials[1].used).toBe(true)
  })

  it('takes the vehicle list from the server and folds the local ticks onto it', () => {
    const server = rapport({
      vehicles: [vehicle({ vehicle_id: 'f1' }), vehicle({ vehicle_id: 'f2', name: 'MTW' })],
    })
    const result = mergeDraft(server, {
      data: form({ kurzbericht: 'Lokal', vehicles: [vehicle({ vehicle_id: 'f1', present: false })] }),
      timestamp: '2026-08-09T02:00:00Z',
    })

    expect(result.usedLocal).toBe(true)
    expect(result.form.vehicles.map(row => row.vehicle_id)).toEqual(['f1', 'f2'])
    expect(result.form.vehicles[0].present).toBe(false)
    expect(result.form.vehicles[1].present).toBe(true)
  })
})

describe('mergeVehicleTicks', () => {
  it('takes the fleet from the server and folds the local ticks onto it', () => {
    const merged = mergeVehicleTicks(
      [vehicle({ vehicle_id: 'f1' }), vehicle({ vehicle_id: 'f2', name: 'MTW' })],
      [vehicle({ vehicle_id: 'f1', present: false })],
    )
    expect(merged.map(row => row.vehicle_id)).toEqual(['f1', 'f2'])
    expect(merged[0].present).toBe(false)
    // A vehicle the draft knows nothing about keeps the server's prefill.
    expect(merged[1].present).toBe(true)
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
    expect(merged[0].used).toBe(true)
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
    const update = toUpdate(form({ kurzbericht: '   ', owner_name: 'A. Bürgin', owner_phone: '  ' }), false)
    expect(update.kurzbericht).toBeNull()
    expect(update.owner_name).toBe('A. Bürgin')
    expect(update.owner_phone).toBeNull()
    expect(update.is_draft).toBe(false)
  })

  it('round-trips the vehicle list as vehicle ids and one tick', () => {
    const data = toFormData(
      rapport({ vehicles: [vehicle({ vehicle_id: 'f1', present: false }), vehicle({ vehicle_id: 'f2' })] }),
    )
    const update = toUpdate(data, true)
    expect(update.vehicles).toEqual([
      { vehicle_id: 'f1', present: false },
      { vehicle_id: 'f2', present: true },
    ])
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

describe('Weiteres Material — entries, not one string (§18.35)', () => {
  const catalogue = ['Nassauger', 'Tauchpumpe TP-4']
  const entry = (name: string, leftOnSite = false) => ({ name, left_on_site: leftOnSite })

  it('splits the stored list into catalogue picks and free text', () => {
    // The split has to round-trip, or a draft written on one phone comes back
    // apart wrongly on the next.
    const { picked, freeText } = splitExtraMaterial(
      [entry('Nassauger', true), entry('Pumpe vom Nachbarzug')],
      catalogue,
    )
    expect(picked).toEqual([entry('Nassauger', true)])
    expect(freeText).toBe('Pumpe vom Nachbarzug')
  })

  it('matches case-insensitively and keeps the catalogue’s own spelling', () => {
    expect(splitExtraMaterial([entry('tauchpumpe tp-4')], catalogue).picked).toEqual([entry('Tauchpumpe TP-4')])
  })

  it('leaves free text alone when there is no catalogue at all', () => {
    const { picked, freeText } = splitExtraMaterial([entry('Pumpe vom Nachbarzug')], [])
    expect(picked).toEqual([])
    expect(freeText).toBe('Pumpe vom Nachbarzug')
  })

  it('toggles a catalogue name on and off without touching the rest', () => {
    const entries = [entry('Pumpe vom Nachbarzug', true)]
    const added = toggleExtraMaterial(entries, 'Nassauger')
    expect(added).toEqual([entry('Pumpe vom Nachbarzug', true), entry('Nassauger')])
    expect(toggleExtraMaterial(added, 'Nassauger')).toEqual([entry('Pumpe vom Nachbarzug', true)])
  })

  it('adds an entry unticked: nobody has been asked the question yet', () => {
    expect(toggleExtraMaterial([], 'Nassauger')).toEqual([entry('Nassauger', false)])
  })

  it('keeps a free entry’s "vor Ort verblieben" while the line is edited', () => {
    // Losing the answer that sends somebody driving to one keystroke would be
    // the worst kind of quiet bug.
    const entries = [entry('Nassauger'), entry('Pumpe vom Nachbarzug', true)]
    const next = setExtraMaterialFreeText(entries, 'Pumpe vom Nachbarzug, Schaufel', catalogue)
    expect(next).toEqual([entry('Nassauger'), entry('Pumpe vom Nachbarzug', true), entry('Schaufel')])
  })

  it('never lets one name into the list twice', () => {
    const next = setExtraMaterialFreeText([entry('Nassauger')], 'Nassauger, Schaufel, schaufel', catalogue)
    expect(next).toEqual([entry('Nassauger'), entry('Schaufel')])
  })

  it('drops a free entry when its name is typed away', () => {
    const entries = [entry('Nassauger'), entry('Pumpe vom Nachbarzug', true)]
    expect(setExtraMaterialFreeText(entries, '', catalogue)).toEqual([entry('Nassauger')])
  })

  it('flips one entry’s on-site answer, by name', () => {
    const entries = [entry('Nassauger'), entry('Pumpe vom Nachbarzug')]
    expect(setExtraMaterialLeftOnSite(entries, 'Pumpe vom Nachbarzug', true)).toEqual([
      entry('Nassauger'),
      entry('Pumpe vom Nachbarzug', true),
    ])
  })

  it('round-trips whatever the three controls produced', () => {
    const entries = setExtraMaterialFreeText(
      toggleExtraMaterial(toggleExtraMaterial([], 'Nassauger'), 'Tauchpumpe TP-4'),
      'Pumpe vom Nachbarzug',
      catalogue,
    )
    const { picked, freeText } = splitExtraMaterial(entries, catalogue)
    expect(picked.map(row => row.name)).toEqual(['Nassauger', 'Tauchpumpe TP-4'])
    expect(freeText).toBe('Pumpe vom Nachbarzug')
  })
})
