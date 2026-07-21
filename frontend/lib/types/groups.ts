/**
 * Frontend types for Aufträge (incident groups) — an ordered multi-stop route
 * over real incidents. Maps to the backend `incident_group` schema with
 * client-side conveniences (camelCase, dates parsed to `Date`).
 */

import type {
  IncidentGroupMode as ApiIncidentGroupMode,
  GroupResourceType as ApiGroupResourceType,
} from '@/lib/api-client'

// Re-export API enums for consistency (mirrors lib/types/incidents.ts).
export type IncidentGroupMode = ApiIncidentGroupMode
export type GroupResourceType = ApiGroupResourceType

/**
 * Derived checklist roll-up of an Auftrag's member stops.
 * `done` counts stops in `einsatz_beendet` / `abschluss`.
 */
export interface GroupProgress {
  total: number
  done: number
}

/**
 * Client representation of an Auftrag. Stops themselves stay first-class
 * incidents in the operations context; this only carries order + squad mode.
 */
export interface IncidentGroup {
  id: string // UUID
  eventId: string // UUID - reference to parent event
  name: string
  /** Hex/token used to tint the route on the board + map. */
  color: string | null
  /** `squad` = vehicle + crew move together; `vehicle_only` = shuttle. */
  mode: IncidentGroupMode
  notes: string | null
  /** Order among the Aufträge in the event (lower = higher). */
  position: number
  createdAt: Date
  updatedAt: Date
  createdBy: string | null // UUID
  /** Member incident ids in group_position order. */
  stopIds: string[]
  progress: GroupProgress
}
