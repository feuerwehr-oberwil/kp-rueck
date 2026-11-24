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
