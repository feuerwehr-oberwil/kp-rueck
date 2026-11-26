/**
 * Resource assignments on incidents: assign, release, transfer, leader/driver flags – and the
 * «Danach» (planned assignments, `/api/planned-assignments/`).
 *
 * One slice of `apiClient` (`lib/api-client.ts` mixes every resource class into
 * the one client object). Methods go through the shared transport in `../http`.
 */

import { request as httpRequest, requestVoid } from '../http'
import type {
  ApiAssignment,
  ApiAssignmentCreate,
  ApiGroupAssignment,
  ApiMaterialCollected,
  ApiPlannedAssignment,
  ApiPlannedAssignmentCreate,
  ApiTransferAssignmentsResponse,
} from '../types'

export class AssignmentsApi {
  /** `assignmentIds`: «Rückgängig» of a transfer – move back exactly these (the ids the
   *  transfer answered with); refused (409) unless all are still active on the source. */
  async transferAssignments(
    sourceIncidentId: string,
    targetIncidentId: string,
    assignmentIds?: string[],
  ): Promise<ApiTransferAssignmentsResponse> {
    return httpRequest<ApiTransferAssignmentsResponse>(
      `/api/incidents/${sourceIncidentId}/transfer`,
      {
        method: 'POST',
        body: JSON.stringify({
          target_incident_id: targetIncidentId,
          ...(assignmentIds ? { assignment_ids: assignmentIds } : {}),
        }),
        // The caller says a refused undo in its own toast.
        ...(assignmentIds ? { skipToast: true } : {}),
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
    return requestVoid(`/api/incidents/${incidentId}/unassign/${assignmentId}`, {
      method: 'POST',
    })
  }

  /** «Abgeholt – freigeben»: releases this material assignment (a unit left on site) and
   *  records «Abgeholt» in the journal. Answers the release time the undo needs. 409 when it
   *  is already released or the rapport no longer marks it «vor Ort verblieben». */
  async collectMaterial(incidentId: string, assignmentId: string): Promise<ApiMaterialCollected> {
    return httpRequest<ApiMaterialCollected>(`/api/incidents/${incidentId}/material-collected/${assignmentId}`, {
      method: 'POST',
    })
  }

  /** The undo of `collectMaterial`: re-opens the same assignment, but only while its release
   *  is still the one `releasedAt` names. 409 otherwise, or when the unit is archived or
   *  assigned elsewhere by now. */
  async undoCollectMaterial(incidentId: string, assignmentId: string, releasedAt: string): Promise<void> {
    const query = new URLSearchParams({ released_at: releasedAt })
    return requestVoid(`/api/incidents/${incidentId}/material-collected/${assignmentId}?${query}`, {
      method: 'DELETE',
    })
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

  // «Danach» – planned assignments (Jetzt / Danach, 24.11.2026)
  async getPlannedAssignments(eventId: string): Promise<ApiPlannedAssignment[]> {
    return httpRequest<ApiPlannedAssignment[]>(`/api/planned-assignments/?event_id=${encodeURIComponent(eventId)}`)
  }

  async planResource(data: ApiPlannedAssignmentCreate): Promise<ApiPlannedAssignment> {
    return httpRequest<ApiPlannedAssignment>('/api/planned-assignments/', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  /** «Zuteilen»: the Danach becomes Jetzt. 409 `resource_busy` while it is still Jetzt elsewhere. */
  async promotePlanned(plannedId: string): Promise<ApiAssignment | ApiGroupAssignment> {
    return httpRequest<ApiAssignment | ApiGroupAssignment>(`/api/planned-assignments/${plannedId}/promote`, {
      method: 'POST',
    })
  }

  /** «Verwerfen» of the «Danach frei» to-do (true) and its undo (false). The plan stays. */
  async setPlannedDismissed(plannedId: string, dismissed: boolean): Promise<ApiPlannedAssignment> {
    return httpRequest<ApiPlannedAssignment>(`/api/planned-assignments/${plannedId}`, {
      method: 'PATCH',
      body: JSON.stringify({ dismissed }),
    })
  }

  async removePlanned(plannedId: string): Promise<void> {
    return requestVoid(`/api/planned-assignments/${plannedId}`, { method: 'DELETE' })
  }
}
