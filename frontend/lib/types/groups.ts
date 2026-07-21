/**
 * Frontend types for Aufträge (incident groups) — an ordered multi-stop route
 * over real incidents. Maps to the backend `incident_group` schema with
 * client-side conveniences (camelCase, dates parsed to `Date`). The route OWNS
 * its resources; the member stops carry none.
 */

import type { GroupResourceType as ApiGroupResourceType } from '@/lib/api-client'

// Re-export API enum for consistency (mirrors lib/types/incidents.ts).
export type GroupResourceType = ApiGroupResourceType

/**
 * Derived checklist roll-up of an Auftrag's member stops.
 * `done` counts stops in `einsatz_beendet` / `abschluss`.
 */
export interface GroupProgress {
  total: number
  done: number
}

/** A single route-owned resource (vehicle / personnel / material), raw ids. */
export interface GroupAssignment {
  id: string // assignment UUID
  resourceType: GroupResourceType
  resourceId: string // UUID of the resolved resource
  driverStay: boolean
}

/** One resolved resource (name looked up against the live resource lists). */
export interface GroupResourceItem {
  /** The group-assignment id — used to unassign. */
  assignmentId: string
  /** UUID of the underlying vehicle / personnel / material. */
  resourceId: string
  /** Display name (falls back to the id if the resource can't be resolved). */
  name: string
  /** Vehicles only: whether the driver stays on site. */
  driverStay?: boolean
}

/** Resolved resources owned by a route, split by kind. */
export interface GroupResources {
  vehicles: GroupResourceItem[]
  personnel: GroupResourceItem[]
  materials: GroupResourceItem[]
}

/**
 * Client representation of an Auftrag. Stops themselves stay first-class
 * incidents in the operations context; this carries the order + owned resources.
 */
export interface IncidentGroup {
  id: string // UUID
  eventId: string // UUID - reference to parent event
  name: string
  /** Hex/token used to tint the route on the board + map. */
  color: string | null
  notes: string | null
  /** Order among the Aufträge in the event (lower = higher). */
  position: number
  createdAt: Date
  updatedAt: Date
  createdBy: string | null // UUID
  /** Member incident ids in group_position order. */
  stopIds: string[]
  /** Active resources owned by this route (raw ids; resolve via getGroupResources). */
  assignments: GroupAssignment[]
  progress: GroupProgress
}
