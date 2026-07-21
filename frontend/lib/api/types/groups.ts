/**
 * Auftrag (incident group) API types — an ordered multi-stop route over incidents.
 *
 * An Auftrag is a lightweight ordered container over real incidents. Each stop
 * stays a first-class incident; the route OWNS its resources (vehicles, crew,
 * material) via group assignments — the stops themselves carry none.
 */

/** Resource kinds a route can own (drives the assign body `resource_type`). */
export type GroupResourceType = 'vehicle' | 'personnel' | 'material'

/** Derived checklist roll-up of an Auftrag's member stops. */
export interface ApiGroupProgress {
  /** Number of member stops. */
  total: number
  /** Stops in `einsatz_beendet` / `abschluss`. */
  done: number
}

/** A single resource attached to an Auftrag (route-owned, not per-stop). */
export interface ApiGroupAssignment {
  id: string // UUID
  incident_group_id: string // UUID
  resource_type: GroupResourceType
  resource_id: string // UUID of the vehicle / personnel / material
  assigned_at: string
  unassigned_at: string | null
  assigned_by: string | null
  driver_stay: boolean
}

export interface ApiIncidentGroup {
  id: string // UUID
  event_id: string // UUID - reference to parent event
  name: string
  /** Hex/token used to tint the route on the board + map. */
  color: string | null
  notes: string | null
  /** Order among the Aufträge in the event (lower = higher). */
  position: number
  created_at: string
  updated_at: string
  /** UUID */
  created_by: string | null
  /** Member incident ids in `group_position` order. */
  stop_ids: string[]
  /** Active resources owned by this route. */
  assignments: ApiGroupAssignment[]
  progress: ApiGroupProgress
}

export interface ApiIncidentGroupCreate {
  /** UUID - required */
  event_id: string
  name: string
  color?: string | null
  notes?: string | null
}

/** Partial PATCH payload (name / color / notes). */
export interface ApiIncidentGroupUpdate {
  name?: string
  color?: string | null
  notes?: string | null
}

/** Body for attaching a resource to a route. */
export interface ApiGroupAssignmentCreate {
  resource_type: GroupResourceType
  resource_id: string
}
