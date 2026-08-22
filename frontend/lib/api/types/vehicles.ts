/**
 * Vehicle + GPS / Traccar types.
 */

export interface ApiVehicle {
  id: string // UUID
  name: string // e.g., "TLF 1", "DLK 2"
  type: string // e.g., "TLF", "DLK", "MTW"
  display_order: number // Order for keyboard shortcuts and display
  /** LEGACY mirror of `out_of_service`, kept in lockstep server-side. Read
   *  `out_of_service` instead — see the note on ApiMaterialResource. */
  status: string // available | unavailable
  radio_call_sign: string // e.g., "Omega 1", "Omega 2"
  /** «Nicht einsatzbereit» — readiness. Beats assigned, which beats available. */
  out_of_service: boolean
  /** Server-stamped moment the flag was set; feeds the «seit 19.08.» line. */
  out_of_service_since: string | null
  /** Lifecycle: non-null means the vehicle left the fleet. */
  archived_at: string | null
  /** How many distinct Einsätze this vehicle ever stood on. Null = not computed. */
  assignment_count: number | null
  /** Whether `DELETE …?permanent=true` would succeed. Null = not computed. */
  can_delete: boolean | null
  created_at: string
  updated_at: string
}

export interface ApiVehicleCreate {
  name: string
  type: string
  display_order: number
  status: string
  radio_call_sign: string
  /** Wins over `status` when both are sent. */
  out_of_service?: boolean
}

export interface ApiVehicleUpdate {
  name?: string
  type?: string
  display_order?: number
  status?: string
  radio_call_sign?: string
  /** The single write path for «Nicht einsatzbereit». */
  out_of_service?: boolean
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

/** Active simulated GPS drive (Übungssteuerung). */
export interface ApiGpsSimDrive {
  vehicle_id: string
  vehicle_name: string
  target_label: string
  kind: 'incident' | 'magazin'
  /** 0..1 along the straight-line route */
  progress: number
  eta_seconds: number
  speed_kmh: number
  started_at: string
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
