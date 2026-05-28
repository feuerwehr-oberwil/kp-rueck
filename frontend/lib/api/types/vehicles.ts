/**
 * Vehicle + GPS / Traccar types.
 */

export interface ApiVehicle {
  id: string // UUID
  name: string // e.g., "TLF 1", "DLK 2"
  type: string // e.g., "TLF", "DLK", "MTW"
  display_order: number // Order for keyboard shortcuts and display
  status: string // available, assigned, planned, maintenance
  radio_call_sign: string // e.g., "Omega 1", "Omega 2"
  created_at: string
  updated_at: string
}

export interface ApiVehicleCreate {
  name: string
  type: string
  display_order: number
  status: string
  radio_call_sign: string
}

export interface ApiVehicleUpdate {
  name?: string
  type?: string
  display_order?: number
  status?: string
  radio_call_sign?: string
}

export interface ApiAssignedVehicle {
  assignment_id: string // UUID
  vehicle_id: string
  name: string
  type: string
  assigned_at: string
  /** Whether driver+car should stay on scene */
  driver_stay: boolean
}

// Traccar GPS Tracking Types
export interface ApiTraccarStatus {
  configured: boolean
  url: string | null
}

export interface ApiVehiclePosition {
  device_id: number
  device_name: string
  unique_id: string
  status: string // 'online' | 'offline'
  latitude: number
  longitude: number
  /** km/h */
  speed: number | null
  /** heading in degrees */
  course: number | null
  last_update: string
  address: string | null
}

export interface ApiTrailPoint {
  latitude: number
  longitude: number
  speed: number | null
  timestamp: string
}

export interface ApiVehicleTrail {
  device_id: number
  device_name: string
  points: ApiTrailPoint[]
}
