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
}

export interface ApiAssignmentCreate {
  resource_type: string
  resource_id: string
}

export interface ApiTransferAssignmentsResponse {
  transferred_count: number
  assignment_ids: string[]
  message: string
}
