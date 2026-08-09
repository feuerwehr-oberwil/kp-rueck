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
  ApiRapportMaterialRow,
  ApiRapportUpdate,
  ApiRapportVehicleRow,
  ApiSchadenplatzRapport,
} from '@/lib/api/types'

/** The form's own state — flat, all strings where the input is a string. */
export interface RapportFormData {
  materials: ApiRapportMaterialRow[]
  vehicles: ApiRapportVehicleRow[]
  extra_material_note: string
  kurzbericht: string
  handed_over_to: string
  owner_note: string
  personnel_count: number | null
}

export const EMPTY_RAPPORT_FORM: RapportFormData = {
  materials: [],
  vehicles: [],
  extra_material_note: '',
  kurzbericht: '',
  handed_over_to: '',
  owner_note: '',
  personnel_count: null,
}

/** The server's answer as the form holds it. */
export function toFormData(rapport: ApiSchadenplatzRapport): RapportFormData {
  return {
    materials: rapport.materials,
    vehicles: rapport.vehicles,
    extra_material_note: rapport.extra_material_note ?? '',
    kurzbericht: rapport.kurzbericht ?? '',
    handed_over_to: rapport.handed_over_to ?? '',
    owner_note: rapport.owner_note ?? '',
    personnel_count: rapport.personnel_count,
  }
}

/** Has anybody actually typed anything? Ticks count; a prefilled list does not. */
export function hasContent(form: RapportFormData): boolean {
  // Every field is read defensively: this also runs against whatever a phone
  // put in localStorage weeks ago, and the form has already lost a Schadensart,
  // a vehicle count and five owner inputs. A draft from an older shape must
  // open as an empty form, never as "Rapport konnte nicht geladen werden".
  const text = (value: string | null | undefined): string => (value ?? '').trim()
  return Boolean(
    text(form.kurzbericht) ||
      text(form.handed_over_to) ||
      text(form.extra_material_note) ||
      text(form.owner_note) ||
      (form.materials ?? []).some(row => row.used !== null || row.left_on_site) ||
      // The vehicle list arrives all-ticked, so only an UNticked row is
      // evidence that somebody answered it.
      (form.vehicles ?? []).some(row => !row.present),
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
  return {
    form: {
      ...EMPTY_RAPPORT_FORM,
      ...local.data,
      materials: mergeMaterialTicks(server.materials, local.data.materials),
      vehicles: mergeVehicleTicks(server.vehicles, local.data.vehicles ?? []),
    },
    usedLocal: true,
  }
}

/** Fold a local draft's ticks onto the server's (re-reconciled) vehicle list. */
export function mergeVehicleTicks(
  serverRows: ApiRapportVehicleRow[],
  localRows: ApiRapportVehicleRow[],
): ApiRapportVehicleRow[] {
  const local = new Map(localRows.map(row => [row.assignment_id, row]))
  return serverRows.map(row => {
    const draft = local.get(row.assignment_id)
    return draft ? { ...row, present: draft.present } : row
  })
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
    materials: form.materials.map(row => ({
      assignment_id: row.assignment_id,
      used: row.used,
      left_on_site: row.left_on_site,
    })),
    vehicles: form.vehicles.map(row => ({
      assignment_id: row.assignment_id,
      present: row.present,
    })),
    extra_material_note: text(form.extra_material_note),
    kurzbericht: text(form.kurzbericht),
    handed_over_to: text(form.handed_over_to),
    owner_note: text(form.owner_note),
    personnel_count: form.personnel_count,
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
