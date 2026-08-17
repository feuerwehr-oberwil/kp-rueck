/**
 * Event + special-function + event-stats types.
 */

export interface ApiEvent {
  id: string // UUID
  name: string
  training_flag: boolean
  auto_attach_divera: boolean
  created_at: string
  updated_at: string
  archived_at: string | null
  last_activity_at: string
  incident_count: number
}

export interface ApiEventCreate {
  name: string
  training_flag: boolean
  auto_attach_divera?: boolean
}

export interface ApiEventUpdate {
  name?: string
  training_flag?: boolean
  auto_attach_divera?: boolean
  archived_at?: string | null
}

export interface ApiEventListResponse {
  events: ApiEvent[]
  total: number
}

/**
 * The roles a person can hold for one Ereignis.
 *
 * Backed by the `special_function_types` table since plan 26 — a station can
 * seed a fourth without a migration. This union stays hand-written because the
 * *sections* each role unlocks are code, not data: `driver` needs a vehicle,
 * `magazin` opens the material table, `telefondienst` turns «Melden» into the
 * call form, `kommandoposten` unlocks nothing at all and exists to say the
 * person is busy running the board. A role the UI does not know about is simply
 * a name.
 */
export type FunctionType = 'driver' | 'reko' | 'magazin' | 'telefondienst' | 'kommandoposten'

export interface ApiEventSpecialFunctionCreate {
  personnel_id: string // UUID
  function_type: FunctionType
  vehicle_id?: string | null // Required for driver assignments
}

export interface ApiEventSpecialFunctionDelete {
  personnel_id: string // UUID
  function_type: FunctionType
  vehicle_id?: string | null // Required for driver unassignments
}

export interface ApiEventSpecialFunctionResponse {
  id: string // UUID
  event_id: string // UUID
  personnel_id: string // UUID
  personnel_name: string // Computed field
  function_type: FunctionType
  vehicle_id: string | null // UUID
  vehicle_name: string | null // Computed field for drivers
  assigned_at: string
  assigned_by: string | null // UUID
}

export interface ApiEventStats {
  status_counts: Record<string, number> // Keys are incident statuses as strings
  personnel_available: number
  personnel_total: number
  avg_duration_minutes: number
  resource_utilization_percent: number
}
