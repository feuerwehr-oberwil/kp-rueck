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

/** One line of the briefing's material list: a name and how many of it. */
export interface ApiFeldMaterialLine {
  name: string
  count: number
}

/**
 * What the Reko found here. Only ever a *submitted* report — a draft is
 * somebody still typing, and half a sentence quoted back at the next crew as
 * fact is worse than nothing. `dangers` are `DangersAssessment` keys, rendered
 * with the board's own `reko.reportSection.dangerBadges` labels.
 */
export interface ApiFeldReko {
  summary: string | null
  notes: string | null
  dangers: string[]
  submitted_at: string | null
  submitted_by_name: string | null
}

export interface ApiFeldAssignment {
  incident_id: string
  incident_title: string
  incident_type: string
  incident_status: string
  /**
   * The briefing (§18.22): the Meldung, the Melder, what the board dispatched
   * and what the Reko found. Released crew/vehicles/material stay in the lists
   * for the same reason the row itself survives its own release — completing an
   * incident releases everything while the crew is still at the address filing.
   */
  description: string | null
  contact: string | null
  contact_phone: string | null
  crew: string[]
  vehicles: string[]
  materials: ApiFeldMaterialLine[]
  reko: ApiFeldReko | null
  location_address: string | null
  location_lat: string | null
  location_lng: string | null
  /** False once the board released the person — they may still file. */
  is_active_assignment: boolean
  rapport_state: ApiFeldRapportState
  /**
   * The Schadenplatz was disponiert at least once (§18.27). False means the
   * rapport does not exist for this row — no form, no "kein Rapport" chip: a
   * crew has nothing to file about a Schadenplatz nobody was ever sent to.
   */
  has_been_dispatched?: boolean
  arrived_at: string | null
  /**
   * True when the GPS automation stamped the arrival rather than the crew
   * (§18.24). `/feld` words it as "Angekommen erkannt" instead of letting a
   * crew that never tapped read the report as its own.
   */
  arrived_by_automation: boolean
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
  /** The third provenance: the GPS automation saw an assigned vehicle arrive. */
  arrived_by_automation: boolean
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
  /** Prefilled *true* since §18.29 — the unit was sent here. No third state. */
  used: boolean
  left_on_site: boolean
  /** False once the board dropped the unit; the row survives because the crew contradicted it. */
  on_board: boolean
}

export interface ApiRapportMaterialUpdate {
  assignment_id: string
  used: boolean
  left_on_site: boolean
}

/**
 * One vehicle on the confirmation list — **the whole fleet** since §18.30, with
 * the board's assigned vehicles ticked. A vehicle that came along without ever
 * being dispatched has no assignment, so the row is keyed on the vehicle.
 */
export interface ApiRapportVehicleRow {
  vehicle_id: string
  name: string
  /** "war dabei". Prefilled from the board: ticked when it was assigned. */
  present: boolean
  /** True when the board has (or had) this vehicle on the incident. */
  on_board: boolean
}

export interface ApiRapportVehicleUpdate {
  vehicle_id: string
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
  /** "Melder übernehmen": one tap PREFILLS the two owner inputs with these.
   *  Copies, never equates — Melder ≠ Eigentümer. */
  melder_name: string | null
  melder_phone: string | null
  board_personnel_count: number
  /**
   * Known material names from the catalogue, offered as a multi-select under
   * "Weiteres Material". Names only, deliberately no ids: picking a name is not
   * picking a unit, and `/feld` must not become a writer of assignments
   * (decision 18).
   */
  material_name_suggestions: string[]
}

export interface ApiSchadenplatzRapport {
  incident_id: string
  /** False = nothing filed yet; the GET computed a prefill and wrote nothing. */
  exists: boolean
  is_draft: boolean
  submitted_at: string | null
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
  /** Name + Telefon since §18.28 — the pair the incident carries for the Melder. */
  owner_name: string | null
  owner_phone: string | null
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
  materials?: ApiRapportMaterialUpdate[]
  vehicles?: ApiRapportVehicleUpdate[]
  extra_material_note?: string | null
  kurzbericht?: string | null
  handed_over_to?: string | null
  owner_name?: string | null
  owner_phone?: string | null
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
  used: boolean
  /**
   * Did the crew settle this unit? A row nobody ticked "vor Ort verblieben" on
   * still lands in `returned`, which is right for the release list and wrong
   * for the completion gate — that one prefills from the rapport and has to
   * know what it still needs to ask.
   *
   * Since §18.29 removed the three-state `used`, the verdict comes from the
   * rapport rather than from the row: a **filed** rapport settled every unit on
   * its checklist, a **draft** only the ones where the crew contradicted the
   * prefill.
   */
  answered: boolean
}

export interface ApiMaterialReturnResponse {
  returned: ApiMaterialReturnUnit[]
  /** Listed separately and deliberately NOT in the release set (decision 15). */
  left_on_site: ApiMaterialReturnUnit[]
  /** Who filed the rapport these answers come from; null when there is none. */
  rapport_by: string | null
  rapport_submitted_at: string | null
  /**
   * True when the answers come from a rapport the crew has NOT filed (§18.23).
   * Only ever true for a caller that asked for drafts — the completion gate —
   * and that caller must say so ("Aus dem Rapport-Entwurf von X"): an operator
   * weighing a half-finished answer has to know it is half-finished.
   */
  rapport_is_draft: boolean
}
