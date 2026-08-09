/**
 * `/feld` — the login-less field surface (plan 25).
 *
 * Phase 0 is the door: the person picker and "meine Einsatzstellen". Every row
 * already names the Einsatzleiter of that Schadenplatz, because the crew has to
 * know who is normally expected to file before any form exists (decision 22).
 */

/** 'none' – no rapport row yet · 'draft' – started · 'submitted' – filed. */
export type ApiFeldRapportState = 'none' | 'draft' | 'submitted'

export interface ApiFeldPersonnel {
  personnel_id: string
  name: string
  role: string | null
  /** Incidents in this event the person is or was assigned to. */
  incident_count: number
  /** Of those, the ones they are still actively assigned to. */
  open_count: number
  /** Of those, the ones without a submitted Schadenplatz-Rapport. */
  missing_rapport_count: number
}

export interface ApiFeldPersonnelListResponse {
  personnel: ApiFeldPersonnel[]
  event_id: string
  event_name: string
}

export interface ApiFeldAssignment {
  incident_id: string
  incident_title: string
  incident_type: string
  incident_status: string
  location_address: string | null
  location_lat: string | null
  location_lng: string | null
  /** False once the board released the person — they may still file. */
  is_active_assignment: boolean
  rapport_state: ApiFeldRapportState
  arrived_at: string | null
  field_complete_reported_at: string | null
  /** "Abholung nötig" — on the row so a returning crew sees its own request. */
  pickup_needed: boolean
  pickup_note: string | null
  pickup_requested_at: string | null
  /** The EL of THIS incident. Both null = "kein EL erfasst", never a blank line. */
  leader_personnel_id: string | null
  leader_name: string | null
}

export interface ApiFeldAssignmentsResponse {
  personnel_id: string
  personnel_name: string
  personnel_role: string | null
  event_id: string
  event_name: string
  assignments: ApiFeldAssignment[]
  /**
   * The station's Freitext-Meldung chips. Station config, NOT i18n
   * (decision 20) — a brigade rewords them without a translation round, the
   * same reasoning that already makes the outbound message bodies settings.
   */
  message_chips: string[]
}

/**
 * The three field reports of one Schadenplatz, returned identically by `/feld`
 * and by the editor twin `/api/incidents/{id}/field-report` — one CRUD module
 * underneath, two thin routers over it.
 *
 * `*_by` is a personnel id and is populated **only** for a field write. A KP
 * write leaves it null and puts the operator in the audit log instead
 * (decision 28: provenance is never faked). `arrived_in_kp` is what tells
 * "im KP erfasst" apart from "nobody has reported it".
 */
export interface ApiFieldReportState {
  incident_id: string
  arrived_at: string | null
  arrived_by_personnel_id: string | null
  arrived_in_kp: boolean
  field_complete_reported_at: string | null
  field_complete_reported_by: string | null
  pickup_needed: boolean
  pickup_note: string | null
  pickup_requested_at: string | null
  pickup_requested_by: string | null
}

/**
 * The KP twin's payload. A key present with a value sets it, present as `null`
 * clears it, **absent leaves it alone** — without that distinction an operator
 * amending the pickup note would silently wipe the arrival time.
 */
export interface ApiFieldReportUpdate {
  arrived_at?: string | null
  field_complete_reported_at?: string | null
  pickup_needed?: boolean
  pickup_note?: string | null
  pickup_requested_at?: string | null
}

// ============================================
// The Schadenplatz-Rapport — one shape, two mounts
// ============================================
//
// `/feld` and the board's detail section render the SAME form component over
// these types (decision 28, §6.1); only the transport and the identity differ.
// A second shape here is how the KP path silently loses a field six months
// later.

/**
 * One material unit on the checklist, keyed on the **assignment** rather than
 * the material: the same pump assigned twice is two units on the slip, and the
 * assignment id is what "Material zurück – freigeben" releases against.
 */
export interface ApiRapportMaterialRow {
  assignment_id: string
  material_id: string | null
  name: string
  /** The depot the unit lives in — the order a crew knows it from. */
  location: string | null
  /** A consumable renders `gebraucht` only: used means gone (decision 26). */
  consumable: boolean
  /** null = the crew did not answer. A third answer, not a false. */
  used: boolean | null
  left_on_site: boolean
  /** False once the board dropped the unit; the row survives because it was answered. */
  on_board: boolean
}

export interface ApiRapportMaterialUpdate {
  assignment_id: string
  used: boolean | null
  left_on_site: boolean
}

/**
 * One vehicle on the confirmation list — the crew ticks off which of the
 * board's vehicles were actually there. Keyed on the **assignment** for the
 * same reason the material rows are: the board's own row is what a later
 * correction is matched against.
 */
export interface ApiRapportVehicleRow {
  assignment_id: string
  vehicle_id: string | null
  name: string
  /** "war dabei". Prefilled true — the board's list is the starting point. */
  present: boolean
  /** False once the board dropped the vehicle; the row survives because it was answered. */
  on_board: boolean
}

export interface ApiRapportVehicleUpdate {
  assignment_id: string
  present: boolean
}

/** "Frey Marc bearbeitet diesen Rapport gerade" — visibility, never a lock. */
export interface ApiRapportConcurrentEditor {
  name: string
  at: string
  in_kp: boolean
}

/** What the board knows. Computed on every GET, never written (§4). */
export interface ApiRapportPrefill {
  location_address: string | null
  incident_ref: string
  leader_personnel_id: string | null
  leader_name: string | null
  /** "Melder übernehmen": one tap PREFILLS the owner free text with these,
   *  as lines. Copies, never equates — Melder ≠ Eigentümer. */
  melder_name: string | null
  melder_street: string | null
  melder_city: string | null
  board_personnel_count: number
  default_work_started_at: string | null
  default_work_ended_at: string | null
  /**
   * Known material names from the catalogue, offered as suggestions under
   * "Weiteres Material". Names only, deliberately no ids: this is a spelling
   * aid, and `/feld` must not become a writer of assignments (decision 18).
   */
  material_name_suggestions: string[]
}

export interface ApiSchadenplatzRapport {
  incident_id: string
  /** False = nothing filed yet; the GET computed a prefill and wrote nothing. */
  exists: boolean
  is_draft: boolean
  submitted_at: string | null
  work_started_at: string | null
  work_ended_at: string | null
  materials: ApiRapportMaterialRow[]
  vehicles: ApiRapportVehicleRow[]
  /**
   * Filenames, not URLs — read back through the shared
   * `GET /api/photos/{incidentId}/{filename}`, the same endpoint the Reko form
   * uses. Rendered in BOTH mounts (§6.1).
   */
  photos: string[]
  extra_material_note: string | null
  kurzbericht: string | null
  handed_over_to: string | null
  /** ONE free-text block since §18.10 — see the model for why the five went. */
  owner_note: string | null
  personnel_count: number | null
  personnel_count_corrected: boolean
  /** Frozen at submit; null while the rapport is a draft. */
  cost_snapshot_json: Array<Record<string, string | null>> | null
  arrived_at: string | null
  created_by_name: string | null
  created_in_kp: boolean
  updated_by_name: string | null
  updated_in_kp: boolean
  updated_at: string | null
  concurrent_editor: ApiRapportConcurrentEditor | null
  prefill: ApiRapportPrefill
}

/**
 * The upsert payload. `is_draft: false` files the rapport.
 *
 * Only the keys actually sent are written, the same rule the field-report twin
 * follows: an autosave carrying half the form must not blank the other half.
 */
export interface ApiRapportUpdate {
  is_draft: boolean
  work_started_at?: string | null
  work_ended_at?: string | null
  materials?: ApiRapportMaterialUpdate[]
  vehicles?: ApiRapportVehicleUpdate[]
  extra_material_note?: string | null
  kurzbericht?: string | null
  handed_over_to?: string | null
  owner_note?: string | null
  personnel_count?: number | null
}

/** One Schadenplatz on the Restliste (§6, V-8). */
export interface ApiRestlisteIncident {
  incident_id: string
  title: string
  location_address: string | null
  status: string
  /** Only on the "ohne Rapport" list. 'none' and 'draft' read differently at 02:00. */
  rapport_state: 'none' | 'draft' | 'submitted' | null
  /** Only on the pickup list. */
  pickup_note: string | null
  since: string | null
}

/**
 * One material unit still standing at an address — an Abholliste line.
 *
 * Address · unit · since when: the sheet somebody takes along the next morning
 * (decision 25). A *different day's* job, kept apart from the Trupp-Abholung.
 */
export interface ApiRestlisteUnit {
  incident_id: string
  incident_title: string
  location_address: string | null
  assignment_id: string
  material_id: string
  name: string
  location: string | null
  since: string | null
}

export interface ApiEventRestliste {
  event_id: string
  /** The denominator of "4 von 23 Schadenplätzen ohne Rapport". */
  incident_total: number
  missing_rapport: ApiRestlisteIncident[]
  material_on_site: ApiRestlisteUnit[]
  open_pickups: ApiRestlisteIncident[]
}

/**
 * What both photo doors answer.
 *
 * The whole list rather than just the new filename, so a phone at the edge of
 * coverage that retried an upload re-syncs from the next answer instead of
 * accumulating a duplicate.
 */
export interface ApiRapportPhotosResponse {
  incident_id: string
  photos: string[]
  /** The file just stored; null on a delete. */
  filename: string | null
}

/** One row of "Material zurück – freigeben" (decision 17). */
export interface ApiMaterialReturnUnit {
  assignment_id: string
  material_id: string | null
  name: string
  location: string | null
  used: boolean | null
}

export interface ApiMaterialReturnResponse {
  returned: ApiMaterialReturnUnit[]
  /** Listed separately and deliberately NOT in the release set (decision 15). */
  left_on_site: ApiMaterialReturnUnit[]
}
