/**
 * Incident-assignment + transfer types.
 */

export interface ApiAssignment {
  id: string // UUID
  incident_id: string
  /** 'personnel' | 'vehicle' | 'material' */
  resource_type: string
  resource_id: string
  assigned_at: string
  unassigned_at: string | null
  assigned_by: string
  /** Whether driver+car should stay on scene (vehicle assignments only) */
  driver_stay: boolean
  /** Einsatzleiter for this incident. At most one active assignment carries it. */
  is_leader: boolean
  /** A Reko row's place in its person's order (Reko-Editor); null on every other row. */
  reko_position?: number | null
  /** Why a person is on this Einsatz: a work crew or a Reko (personnel rows). */
  purpose?: AssignmentPurpose
}

export type AssignmentPurpose = 'crew' | 'reko'

export interface ApiAssignmentCreate {
  resource_type: string
  resource_id: string
}

/** «Abgeholt – freigeben» answered: the release time, the undo's token. */
export interface ApiMaterialCollected {
  released_at: string
}

export interface ApiTransferAssignmentsResponse {
  transferred_count: number
  assignment_ids: string[]
  message: string
}

/** A «Danach» (Jetzt / Danach, 24.11.2026): a resource planned for an Einsatz or an Auftrag
 *  after its current work. Exactly one of `incident_id` / `incident_group_id`. */
export interface ApiPlannedAssignment {
  id: string
  event_id: string
  incident_id: string | null
  incident_group_id: string | null
  resource_type: 'personnel' | 'vehicle' | 'material'
  resource_id: string
  planned_at: string
  planned_by: string | null
  /** «Verwerfen» of the «Danach frei» to-do; the plan stays. */
  dismissed_at: string | null
  /** Place in the resource's queue, 1 = next. */
  position: number
  /** The resource is free (Jetzt nowhere) and this is its first Danach. */
  ready: boolean
}

export interface ApiPlannedAssignmentCreate {
  resource_type: 'personnel' | 'vehicle' | 'material'
  resource_id: string
  incident_id?: string
  incident_group_id?: string
}
