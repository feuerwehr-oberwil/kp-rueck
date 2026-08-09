/**
 * The Schadenplatz-Rapport's pure logic (plan 25, phase 2).
 *
 * Everything here is deliberately free of React and of the API client, for two
 * reasons: the same rules run on `/feld` and in the board's detail section (one
 * form component, two mounts — decision 28), and the draft-merge rule is the
 * kind of thing that is only ever wrong at 02:00 on a phone with a stale tab
 * open. Testable in isolation beats reasoned about in a component.
 */

import type {
  ApiDamageType,
  ApiRapportMaterialRow,
  ApiRapportUpdate,
  ApiSchadenplatzRapport,
} from '@/lib/api/types'

/** The form's own state — flat, all strings where the input is a string. */
export interface RapportFormData {
  damage_type: ApiDamageType | null
  damage_type_other: string
  work_started_at: string | null
  work_ended_at: string | null
  materials: ApiRapportMaterialRow[]
  extra_material_note: string
  kurzbericht: string
  handed_over_to: string
  owner_name: string
  owner_street: string
  owner_city: string
  vehicle_plate: string
  vehicle_model: string
  personnel_count: number | null
  vehicle_count: number | null
}

export const EMPTY_RAPPORT_FORM: RapportFormData = {
  damage_type: null,
  damage_type_other: '',
  work_started_at: null,
  work_ended_at: null,
  materials: [],
  extra_material_note: '',
  kurzbericht: '',
  handed_over_to: '',
  owner_name: '',
  owner_street: '',
  owner_city: '',
  vehicle_plate: '',
  vehicle_model: '',
  personnel_count: null,
  vehicle_count: null,
}

/** The server's answer as the form holds it. */
export function toFormData(rapport: ApiSchadenplatzRapport): RapportFormData {
  return {
    damage_type: rapport.damage_type,
    damage_type_other: rapport.damage_type_other ?? '',
    work_started_at: rapport.work_started_at,
    work_ended_at: rapport.work_ended_at,
    materials: rapport.materials,
    extra_material_note: rapport.extra_material_note ?? '',
    kurzbericht: rapport.kurzbericht ?? '',
    handed_over_to: rapport.handed_over_to ?? '',
    owner_name: rapport.owner_name ?? '',
    owner_street: rapport.owner_street ?? '',
    owner_city: rapport.owner_city ?? '',
    vehicle_plate: rapport.vehicle_plate ?? '',
    vehicle_model: rapport.vehicle_model ?? '',
    personnel_count: rapport.personnel_count,
    vehicle_count: rapport.vehicle_count,
  }
}

/** Has anybody actually typed anything? Ticks count; a prefilled count does not. */
export function hasContent(form: RapportFormData): boolean {
  return Boolean(
    form.damage_type ||
      form.kurzbericht.trim() ||
      form.handed_over_to.trim() ||
      form.extra_material_note.trim() ||
      form.owner_name.trim() ||
      form.owner_street.trim() ||
      form.owner_city.trim() ||
      form.vehicle_plate.trim() ||
      form.vehicle_model.trim() ||
      form.materials.some(row => row.used !== null || row.left_on_site),
  )
}

/**
 * Which of the two versions the form opens with — the whole offline story.
 *
 * The local draft wins **only** when it has content and the server has nothing,
 * or when it is genuinely newer. A stale tab must not overwrite a rapport that
 * somebody else amended (or filed) in the meantime; a crew that typed three
 * sentences in a dead spot must not lose them either. Same rule as the Reko
 * form, which is the one that has actually been through a storm.
 *
 * A **submitted** rapport is never overwritten by a local draft at all: filing
 * is the end of the crew's typing, and re-hydrating a half-finished version
 * over a filed one would silently un-do the submit in the UI.
 */
export function mergeDraft(
  server: ApiSchadenplatzRapport,
  local: { data: RapportFormData; timestamp: string | null } | null,
): { form: RapportFormData; usedLocal: boolean } {
  const serverForm = toFormData(server)
  if (!local || !hasContent(local.data) || !server.is_draft) {
    return { form: serverForm, usedLocal: false }
  }

  const localAt = local.timestamp ? new Date(local.timestamp).getTime() : 0
  const serverAt = server.updated_at ? new Date(server.updated_at).getTime() : 0
  if (hasContent(serverForm) && localAt <= serverAt) {
    return { form: serverForm, usedLocal: false }
  }

  // The board can add or remove material while the phone was offline, so the
  // checklist itself always comes from the server — with the local ticks folded
  // back onto the rows that still exist.
  return { form: { ...local.data, materials: mergeMaterialTicks(server.materials, local.data.materials) }, usedLocal: true }
}

/** Fold a local draft's ticks onto the server's (re-reconciled) checklist. */
export function mergeMaterialTicks(
  serverRows: ApiRapportMaterialRow[],
  localRows: ApiRapportMaterialRow[],
): ApiRapportMaterialRow[] {
  const local = new Map(localRows.map(row => [row.assignment_id, row]))
  return serverRows.map(row => {
    const draft = local.get(row.assignment_id)
    if (!draft) return row
    return {
      ...row,
      used: draft.used,
      // A consumable that was used is gone: it can never be left on site, no
      // matter what an older draft says (decision 26).
      left_on_site: row.consumable ? false : draft.left_on_site,
    }
  })
}

/**
 * Is this count a correction of what the board says?
 *
 * The divergence is itself information — it says the board was behind reality —
 * so an agreeing number must NOT carry the marker, or the "korrigiert" flag in
 * the export stops being a signal. The server decides authoritatively; this is
 * the same rule, so the form can show the hint before the round trip.
 */
export function isCorrected(value: number | null, boardValue: number): boolean {
  return value !== null && value !== boardValue
}

/** The form as the PUT payload. */
export function toUpdate(form: RapportFormData, isDraft: boolean): ApiRapportUpdate {
  const text = (value: string): string | null => (value.trim() ? value.trim() : null)
  return {
    is_draft: isDraft,
    damage_type: form.damage_type,
    damage_type_other: form.damage_type === 'anderes' ? text(form.damage_type_other) : null,
    work_started_at: form.work_started_at,
    work_ended_at: form.work_ended_at,
    materials: form.materials.map(row => ({
      assignment_id: row.assignment_id,
      used: row.used,
      left_on_site: row.left_on_site,
    })),
    extra_material_note: text(form.extra_material_note),
    kurzbericht: text(form.kurzbericht),
    handed_over_to: text(form.handed_over_to),
    owner_name: text(form.owner_name),
    owner_street: text(form.owner_street),
    owner_city: text(form.owner_city),
    vehicle_plate: text(form.vehicle_plate),
    vehicle_model: text(form.vehicle_model),
    personnel_count: form.personnel_count,
    vehicle_count: form.vehicle_count,
  }
}

export interface MaterialGroupBlock {
  location: string | null
  /** False for the trailing block of units the board no longer has. */
  onBoard: boolean
  rows: ApiRapportMaterialRow[]
}

/**
 * The checklist grouped by depot, in the order the server sent it.
 *
 * The order is the point: a crew with fourteen units reads them the way they
 * stand on the shelf, not alphabetically. Units the board has dropped keep a
 * block of their own at the end — they are history, not a to-do.
 */
export function groupMaterialsByLocation(rows: ApiRapportMaterialRow[]): MaterialGroupBlock[] {
  const groups: MaterialGroupBlock[] = []
  for (const row of rows) {
    const onBoard = row.on_board
    const location = onBoard ? row.location : null
    const last = groups[groups.length - 1]
    if (last && last.onBoard === onBoard && last.location === location) {
      last.rows.push(row)
    } else {
      groups.push({ location, onBoard, rows: [row] })
    }
  }
  return groups
}
