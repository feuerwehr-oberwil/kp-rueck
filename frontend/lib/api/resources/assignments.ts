/**
 * Resource assignments on incidents: assign, release, transfer, leader/driver flags.
 *
 * One slice of `apiClient` (`lib/api-client.ts` mixes every resource class into
 * the one client object). Methods go through the shared transport in `../http`.
 */

import { request as httpRequest } from '../http'
import type { ApiAssignment, ApiAssignmentCreate, ApiTransferAssignmentsResponse } from '../types'

export class AssignmentsApi {
  async transferAssignments(
    sourceIncidentId: string,
    targetIncidentId: string
  ): Promise<ApiTransferAssignmentsResponse> {
    return httpRequest<ApiTransferAssignmentsResponse>(
      `/api/incidents/${sourceIncidentId}/transfer`,
      {
        method: 'POST',
        body: JSON.stringify({ target_incident_id: targetIncidentId }),
      }
    )
  }

  async updateAssignment(
    incidentId: string,
    assignmentId: string,
    data: { driver_stay?: boolean; is_leader?: boolean }
  ): Promise<ApiAssignment> {
    return httpRequest<ApiAssignment>(
      `/api/incidents/${incidentId}/assignments/${assignmentId}`,
      {
        method: 'PATCH',
        body: JSON.stringify(data),
      }
    )
  }

  // Assignments
  async assignResource(incidentId: string, data: ApiAssignmentCreate): Promise<ApiAssignment> {
    return httpRequest<ApiAssignment>(`/api/incidents/${incidentId}/assign`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async unassignResource(incidentId: string, assignmentId: string): Promise<void> {
    return httpRequest<void>(`/api/incidents/${incidentId}/unassign/${assignmentId}`, {
      method: 'POST',
    })
  }

  async getIncidentAssignments(incidentId: string): Promise<ApiAssignment[]> {
    return httpRequest<ApiAssignment[]>(`/api/incidents/${incidentId}/assignments`)
  }

  /**
   * Get all assignments for all incidents in an event (bulk endpoint).
   * Optimizes performance by fetching all assignments in one request instead of N requests.
   *
   * @param eventId - Event ID
   * @returns Dictionary mapping incident_id to array of assignments
   */
  async getAssignmentsByEvent(eventId: string): Promise<Record<string, ApiAssignment[]>> {
    return httpRequest<Record<string, ApiAssignment[]>>(`/api/assignments/by-event/${eventId}`)
  }

  async releaseAllResources(incidentId: string): Promise<void> {
    return httpRequest<void>(`/api/incidents/${incidentId}/release-all`, {
      method: 'POST',
    })
  }
}
