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
  ApiRapportExtraMaterial,
  ApiRapportMaterialRow,
  ApiRapportUpdate,
  ApiRapportVehicleRow,
  ApiSchadenplatzRapport,
} from '@/lib/api/types'

/** The form's own state — flat, all strings where the input is a string. */
export interface RapportFormData {
  materials: ApiRapportMaterialRow[]
  vehicles: ApiRapportVehicleRow[]
  extra_materials: ApiRapportExtraMaterial[]
  kurzbericht: string
  handed_over_to: string
  owner_name: string
  owner_phone: string
  personnel_count: number | null
}

export const EMPTY_RAPPORT_FORM: RapportFormData = {
  materials: [],
  vehicles: [],
  extra_materials: [],
  kurzbericht: '',
  handed_over_to: '',
  owner_name: '',
  owner_phone: '',
  personnel_count: null,
}

/** The server's answer as the form holds it. */
export function toFormData(rapport: ApiSchadenplatzRapport): RapportFormData {
  return {
    materials: rapport.materials,
    vehicles: rapport.vehicles,
    extra_materials: rapport.extra_materials ?? [],
    kurzbericht: rapport.kurzbericht ?? '',
    handed_over_to: rapport.handed_over_to ?? '',
    owner_name: rapport.owner_name ?? '',
    owner_phone: rapport.owner_phone ?? '',
    personnel_count: rapport.personnel_count,
  }
}

/** Has anybody actually typed anything? Ticks count; a prefilled list does not. */
export function hasContent(form: RapportFormData): boolean {
  // Every field is read defensively: this also runs against whatever a phone
  // put in localStorage weeks ago, and the form has already lost a Schadensart,
  // a vehicle count, five owner inputs and a free-text owner box. A draft from
  // an older shape must open as an empty form, never as "Rapport konnte nicht
  // geladen werden".
  const text = (value: string | null | undefined): string => (value ?? '').trim()
  return Boolean(
    text(form.kurzbericht) ||
      text(form.handed_over_to) ||
      (form.extra_materials ?? []).length > 0 ||
      text(form.owner_name) ||
      text(form.owner_phone) ||
      // Both lists arrive prefilled from the board, so only a tick that
      // CONTRADICTS the prefill is evidence that somebody answered.
      (form.materials ?? []).some(row => row.used === false || row.left_on_site) ||
      (form.vehicles ?? []).some(row => row.present !== row.on_board),
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
  const local = new Map(localRows.map(row => [row.vehicle_id, row]))
  return serverRows.map(row => {
    const draft = local.get(row.vehicle_id)
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
      vehicle_id: row.vehicle_id,
      present: row.present,
    })),
    // Names and one tick each, never ids (decision 18). Sent whole: there is
    // nothing to patch against, so an empty list is a deletion.
    extra_materials: (form.extra_materials ?? []).map(entry => ({
      name: entry.name,
      left_on_site: entry.left_on_site,
    })),
    kurzbericht: text(form.kurzbericht),
    handed_over_to: text(form.handed_over_to),
    owner_name: text(form.owner_name),
    owner_phone: text(form.owner_phone),
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

/**
 * "Weiteres gebrauchtes Material" — a list of entries, three controls (§18.35).
 *
 * The field is still **names and nothing else**: no id travels with a pick, and
 * `/feld` still never writes an assignment (decision 18). What changed is that
 * it stopped being one comma-separated string. *Vor Ort verblieben* is a
 * question per item — one borrowed pump stays in the cellar while the shovels
 * go home — and a string can only ever answer it once.
 *
 * So the stored value is `{name, left_on_site}[]`, and three controls are
 * derived from it: the catalogue multi-select, the free-text line for anything
 * in no catalogue, and one on-site tick per entry. The derivation lives here
 * rather than in the component because it has to round-trip: whatever the three
 * controls produce must come apart into the same three when the form reloads on
 * another phone.
 *
 * There is deliberately **no `gebraucht` tick** on these rows. Listing a thing
 * here already says it was used; a second tick would only ever be ticked.
 */
export interface ExtraMaterialSelection {
  /** Entries whose name matches the catalogue, in the catalogue's spelling. */
  picked: ApiRapportExtraMaterial[]
  /** Everything else, comma-joined and left exactly as it was typed. */
  freeText: string
}

/** Case-insensitive lookup of the catalogue's own spelling. */
function canonicalNames(catalogue: string[]): Map<string, string> {
  return new Map(catalogue.map(name => [name.trim().toLowerCase(), name]))
}

export function splitExtraMaterial(
  entries: ApiRapportExtraMaterial[],
  catalogue: string[],
): ExtraMaterialSelection {
  const canonical = canonicalNames(catalogue)
  const picked: ApiRapportExtraMaterial[] = []
  const free: string[] = []
  for (const entry of entries ?? []) {
    const name = (entry?.name ?? '').trim()
    if (!name) continue
    const match = canonical.get(name.toLowerCase())
    if (match) picked.push({ ...entry, name: match })
    else free.push(name)
  }
  return { picked, freeText: free.join(', ') }
}

/** Add or remove one catalogue name, keeping every other entry untouched. */
export function toggleExtraMaterial(
  entries: ApiRapportExtraMaterial[],
  name: string,
): ApiRapportExtraMaterial[] {
  const needle = name.trim().toLowerCase()
  const existing = (entries ?? []).some(entry => entry.name.trim().toLowerCase() === needle)
  if (existing) return (entries ?? []).filter(entry => entry.name.trim().toLowerCase() !== needle)
  return [...(entries ?? []), { name, left_on_site: false }]
}

/**
 * The free-text line, re-split into entries.
 *
 * Matched **by name**, so an entry that already carries *vor Ort verblieben*
 * keeps it while the crew edits the rest of the line: losing the answer that
 * sends somebody driving to a keystroke would be the worst kind of quiet bug.
 * Catalogue picks keep their order in front, exactly as the old single string
 * joined them.
 */
export function setExtraMaterialFreeText(
  entries: ApiRapportExtraMaterial[],
  freeText: string,
  catalogue: string[],
): ApiRapportExtraMaterial[] {
  const { picked } = splitExtraMaterial(entries ?? [], catalogue)
  const previous = new Map((entries ?? []).map(entry => [entry.name.trim().toLowerCase(), entry]))
  const canonical = canonicalNames(catalogue)
  const seen = new Set(picked.map(entry => entry.name.trim().toLowerCase()))
  const free: ApiRapportExtraMaterial[] = []
  for (const raw of freeText.split(',')) {
    const name = raw.trim()
    const key = name.toLowerCase()
    // A typed name that IS in the catalogue belongs to the multi-select, not
    // twice into the list.
    if (!name || seen.has(key) || canonical.has(key)) continue
    seen.add(key)
    free.push({ name, left_on_site: previous.get(key)?.left_on_site ?? false })
  }
  return [...picked, ...free]
}

/** Flip one entry's "vor Ort verblieben", by name. */
export function setExtraMaterialLeftOnSite(
  entries: ApiRapportExtraMaterial[],
  name: string,
  leftOnSite: boolean,
): ApiRapportExtraMaterial[] {
  const needle = name.trim().toLowerCase()
  return (entries ?? []).map(entry =>
    entry.name.trim().toLowerCase() === needle ? { ...entry, left_on_site: leftOnSite } : entry,
  )
}
