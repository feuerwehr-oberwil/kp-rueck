/**
 * Auftrag (incident group) API types — an ordered multi-stop route over incidents.
 *
 * An Auftrag is a lightweight ordered container over real incidents. Each stop
 * stays a first-class incident; the group only carries the order + squad mode.
 */

/** How a squad is copied across an Auftrag's stops (drives the copy-picker default). */
export type IncidentGroupMode = 'squad' | 'vehicle_only'

/** Resource kinds "auf alle Stops übernehmen" can copy down the route. */
export type GroupResourceType = 'vehicle' | 'personnel' | 'material'

/** Derived checklist roll-up of an Auftrag's member stops. */
export interface ApiGroupProgress {
  /** Number of member stops. */
  total: number
  /** Stops in `einsatz_beendet` / `abschluss`. */
  done: number
}

export interface ApiIncidentGroup {
  id: string // UUID
  event_id: string // UUID - reference to parent event
  name: string
  /** Hex/token used to tint the route on the board + map. */
  color: string | null
  /** `squad` = vehicle + crew move together; `vehicle_only` = shuttle (crew per-incident). */
  mode: IncidentGroupMode
  notes: string | null
  /** Order among the Aufträge in the event (lower = higher). */
  position: number
  created_at: string
  updated_at: string
  /** UUID */
  created_by: string | null
  /** Member incident ids in `group_position` order. */
  stop_ids: string[]
  progress: ApiGroupProgress
}

export interface ApiIncidentGroupCreate {
  /** UUID - required */
  event_id: string
  name: string
  color?: string | null
  mode?: IncidentGroupMode
  notes?: string | null
}

/** Partial PATCH payload (name / color / mode / notes). */
export interface ApiIncidentGroupUpdate {
  name?: string
  color?: string | null
  mode?: IncidentGroupMode
  notes?: string | null
}

/** Result of copying a source stop's squad onto its sibling stops. */
export interface ApiCopySquadResult {
  copied: number
  skipped: number
}
