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
  /** Einsatzleiter for the whole route — a stop takes its leader from here. */
  is_leader: boolean
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
  /** ISO timestamp of the last Funkdurchsage for this route (null = none yet). */
  last_announced_at: string | null
  /** Opaque digest of the route's resources at that moment — compared, never parsed. */
  last_announced_fingerprint: string | null
  /** Which stop that announcement was about (UUID). */
  last_announced_stop_id: string | null
  /** Whether it was the full announcement rather than the short continuation. */
  last_announced_full: boolean
}

/** Body for recording a Funkdurchsage (see `ApiIncidentGroup.last_announced_*`). */
export interface ApiGroupAnnouncement {
  fingerprint: string
  stop_id?: string | null
  full?: boolean
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

// --- Standard-Aufträge (Auftrag templates) --------------------------------
// Station configuration, not event data: a template outlives every Lage and is
// edited in Einstellungen. `auto_create` decides whether a new event opens with
// this Auftrag already on the board.

/**
 * Narrower than `GroupResourceType` on purpose (and CHECK-constrained in the
 * database): a template names equipment, never people — who is on a squad is
 * decided per Lage from who actually turned up.
 */
export type TemplateResourceType = 'vehicle' | 'material'

/** One vehicle or material a template brings along by default. */
export interface ApiAuftragTemplateResource {
  resource_type: TemplateResourceType
  resource_id: string // UUID
}

export interface ApiAuftragTemplate {
  id: string // UUID
  name: string
  /** Hex/token the created Auftrag inherits, so it looks the same at every Lage. */
  color: string | null
  notes: string | null
  /** Open this Auftrag automatically with every new event. */
  auto_create: boolean
  /** Order in the settings list, and the board order of the auto-created Aufträge. */
  position: number
  resources: ApiAuftragTemplateResource[]
  created_at: string
  updated_at: string
}

export interface ApiAuftragTemplateCreate {
  name: string
  color?: string | null
  notes?: string | null
  auto_create?: boolean
  resources?: ApiAuftragTemplateResource[]
}

/** Partial PATCH. A present `resources` list REPLACES the stored one. */
export interface ApiAuftragTemplateUpdate {
  name?: string
  color?: string | null
  notes?: string | null
  auto_create?: boolean
  resources?: ApiAuftragTemplateResource[]
}
