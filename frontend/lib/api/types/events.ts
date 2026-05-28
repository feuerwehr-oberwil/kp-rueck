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

export type FunctionType = 'driver' | 'reko' | 'magazin'

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
