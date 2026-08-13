/**
 * Reko (reconnaissance) report + dashboard types.
 */

export interface ApiDangersAssessment {
  fire: boolean
  fire_danger: boolean
  explosion: boolean
  collapse: boolean
  chemical: boolean
  electrical: boolean
  other_notes: string | null
}

export interface ApiEffortEstimation {
  personnel_count: number | null
  vehicles_needed: string[]
  equipment_needed: string[]
  estimated_duration_hours: number | null
}

export interface ApiRekoReportBase {
  is_relevant: boolean | null
  dangers_json: ApiDangersAssessment | null
  effort_json: ApiEffortEstimation | null
  /** 'available' | 'unavailable' | 'emergency_needed' */
  power_supply: string | null
  summary_text: string | null
  additional_notes: string | null
  is_draft: boolean
}

export interface ApiRekoReportCreate extends ApiRekoReportBase {
  incident_id: string
  token: string
}

/** The body of a KP write: the report's fields and nothing else.
 *
 * No token — the session is the identity (plan 26 §5.1) — and no `is_draft`,
 * which only the `submit` query param may change.
 */
export type ApiRekoReportUpdate = Partial<Omit<ApiRekoReportBase, 'is_draft'>>

export interface ApiRekoReportResponse extends ApiRekoReportBase {
  id: string
  incident_id: string
  incident_title?: string | null
  incident_location?: string | null
  incident_type?: string | null
  incident_description?: string | null
  incident_contact?: string | null
  /** When reko personnel arrived on site */
  arrived_at?: string | null
  submitted_at: string
  updated_at: string
  photos_json: string[]
  submitted_by_personnel_id?: string | null
  submitted_by_personnel_name?: string | null
  /** Provenance (plan 26 §5.3): the personnel FK above is the field side, these
   *  three are the KP side, and a mixed report carries both. All null means the
   *  report came in through the form link, which is the normal case. */
  created_by_user_id?: string | null
  updated_by_user_id?: string | null
  arrived_reported_by_user_id?: string | null
}

/** What `POST /api/incidents/{id}/reko-arrived` answers. */
export interface ApiRekoArrivedState {
  incident_id: string
  arrived_at: string | null
  /** Set means an operator logged the radio message; null means the crew tapped it. */
  arrived_reported_by_user_id: string | null
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ApiRekoFormResponse extends ApiRekoReportResponse {
  // Same as ApiRekoReportResponse, backend returns this on GET /form
}

// Bulk Reko Summary Types (performance optimization)
export interface ApiRekoSummary {
  incident_id: string
  has_completed_reko: boolean
  /** When reko personnel arrived on site */
  arrived_at: string | null
  is_relevant: boolean | null
  dangers_json: ApiDangersAssessment | null
  effort_json: ApiEffortEstimation | null
  summary_text: string | null
  /** Filenames of the photos the Reko uploaded; served behind the login at
   *  `/api/photos/{incident_id}/{filename}`. */
  photos_json: string[]
  submitted_at: string | null
  submitted_by_personnel_name: string | null
}

/** The Reko result as the public share link carries it (`/api/viewer/data`).
 *
 *  Narrower than `ApiRekoSummary` on purpose — that endpoint has no session
 *  behind it: no free-text danger note, no submitter. Photo FILENAMES do ride
 *  along; the share token opens `/api/photos` for its own event (`rekoPhotoUrl`).
 *  Mirrors `ViewerRekoSummary` on the backend. */
export interface ApiViewerRekoSummary {
  is_relevant: boolean | null
  dangers_json: Omit<ApiDangersAssessment, 'other_notes'> | null
  summary_text: string | null
  personnel_count: number | null
  estimated_duration_hours: number | null
  photos_json: string[]
}

export interface ApiEventRekoSummariesResponse {
  /** incident_id -> summary */
  summaries: Record<string, ApiRekoSummary>
  total: number
}

// Reko Dashboard
export interface ApiRekoDashboardPersonnel {
  personnel_id: string
  name: string
  role: string | null
  assignment_count: number
  /** Active assignments whose incident still needs a reko (actively open work). */
  open_count: number
  /** Active assignments whose incident already has a completed reko ("Beendet"). */
  done_count: number
}

export interface ApiRekoDashboardPersonnelListResponse {
  personnel: ApiRekoDashboardPersonnel[]
  event_id: string
  event_name: string
}

export interface ApiRekoDashboardAssignment {
  incident_id: string
  incident_title: string
  incident_type: string
  incident_status: string
  location_address: string | null
  location_lat: string | null
  location_lng: string | null
  /** null for historical (submitted but unassigned) */
  assignment_id: string | null
  /** null for historical */
  assigned_at: string | null
  has_completed_reko: boolean
  /** false for previously submitted (greyed out) */
  is_active_assignment: boolean
}

export interface ApiRekoDashboardAssignmentsResponse {
  personnel_id: string
  personnel_name: string
  assignments: ApiRekoDashboardAssignment[]
}

export interface ApiRekoOpenAssignmentInfo {
  incident_id: string
  incident_title: string
  location_address: string | null
}

export interface ApiAvailableRekoPersonnel {
  personnel_id: string
  name: string
  role: string | null
  assignment_count: number
  open_count: number
  done_count: number
  open_assignments: ApiRekoOpenAssignmentInfo[]
  distance_m: number | null
  distance_source: 'open' | 'last' | null
}

export interface ApiAvailableRekoPersonnelResponse {
  personnel: ApiAvailableRekoPersonnel[]
  currently_assigned_id: string | null
}
