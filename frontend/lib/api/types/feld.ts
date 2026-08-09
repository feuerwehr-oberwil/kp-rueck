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
