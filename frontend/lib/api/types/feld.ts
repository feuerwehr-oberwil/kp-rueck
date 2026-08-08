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
}
