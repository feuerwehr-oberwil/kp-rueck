/**
 * Aufträge (incident groups), Standard-Aufträge and route-owned resources.
 *
 * One slice of `apiClient` (`lib/api-client.ts` mixes every resource class into
 * the one client object). Methods go through the shared transport in `../http`.
 */

import { request as httpRequest } from '../http'
import type {
  ApiIncidentGroup,
  ApiIncidentGroupCreate,
  ApiIncidentGroupUpdate,
  ApiAuftragTemplate,
  ApiAuftragTemplateCreate,
  ApiAuftragTemplateUpdate,
  ApiGroupAnnouncement,
  ApiGroupAssignment,
  ApiGroupAssignmentCreate,
} from '../types'

export class GroupsApi {
  // --- Aufträge (incident groups) – ordered multi-stop routes over incidents ---

  /** List the Aufträge of an event, each with `stop_ids` + derived `progress`. */
  async getIncidentGroups(eventId: string): Promise<ApiIncidentGroup[]> {
    return httpRequest<ApiIncidentGroup[]>(
      `/api/incident-groups/?event_id=${encodeURIComponent(eventId)}`
    )
  }

  async createIncidentGroup(data: ApiIncidentGroupCreate): Promise<ApiIncidentGroup> {
    return httpRequest<ApiIncidentGroup>('/api/incident-groups/', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async updateIncidentGroup(id: string, data: ApiIncidentGroupUpdate): Promise<ApiIncidentGroup> {
    return httpRequest<ApiIncidentGroup>(`/api/incident-groups/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    })
  }

  /** Soft-delete an Auftrag; its stops stay on the board, ungrouped (204). */
  async deleteIncidentGroup(id: string): Promise<void> {
    return httpRequest<void>(`/api/incident-groups/${id}`, {
      method: 'DELETE',
    })
  }

  /** Persist the order of the Aufträge within an event (204 No Content). */
  async reorderIncidentGroups(eventId: string, orderedIds: string[]): Promise<void> {
    await httpRequest<void>('/api/incident-groups/reorder', {
      method: 'POST',
      body: JSON.stringify({ event_id: eventId, ordered_ids: orderedIds }),
    })
  }

  // --- Standard-Aufträge (Auftrag templates) – station config, not event data ---

  /** List the station's Standard-Aufträge in settings order (any signed-in user). */
  async getAuftragTemplates(): Promise<ApiAuftragTemplate[]> {
    return httpRequest<ApiAuftragTemplate[]>('/api/auftrag-templates/')
  }

  async createAuftragTemplate(data: ApiAuftragTemplateCreate): Promise<ApiAuftragTemplate> {
    return httpRequest<ApiAuftragTemplate>('/api/auftrag-templates/', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async updateAuftragTemplate(
    id: string,
    data: ApiAuftragTemplateUpdate
  ): Promise<ApiAuftragTemplate> {
    return httpRequest<ApiAuftragTemplate>(`/api/auftrag-templates/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    })
  }

  /** Delete a Standard-Auftrag. Aufträge already created from it stay put (204). */
  async deleteAuftragTemplate(id: string): Promise<void> {
    return httpRequest<void>(`/api/auftrag-templates/${id}`, { method: 'DELETE' })
  }

  /** Persist the settings list order of the Standard-Aufträge (204 No Content). */
  async reorderAuftragTemplates(templateIds: string[]): Promise<void> {
    await httpRequest<void>('/api/auftrag-templates/reorder', {
      method: 'POST',
      body: JSON.stringify({ template_ids: templateIds }),
    })
  }

  /** Persist the order of the stops within one Auftrag (204 No Content). */
  /**
   * Persist a stop order. With `expectedIds` the write is conditional: the server
   * applies it only if the route's current order is exactly `expectedIds`, else it
   * answers 409 (`ApiError.isConflict`) and changes nothing.
   */
  async reorderGroupStops(groupId: string, orderedIds: string[], expectedIds?: string[]): Promise<void> {
    await httpRequest<void>(`/api/incident-groups/${groupId}/stops/reorder`, {
      method: 'POST',
      body: JSON.stringify(
        expectedIds ? { ordered_ids: orderedIds, expected_ids: expectedIds } : { ordered_ids: orderedIds },
      ),
    })
  }

  /** Attach existing incidents to an Auftrag as stops (appended to the end). */
  async addStopsToGroup(groupId: string, incidentIds: string[]): Promise<ApiIncidentGroup> {
    return httpRequest<ApiIncidentGroup>(`/api/incident-groups/${groupId}/stops`, {
      method: 'POST',
      body: JSON.stringify({ incident_ids: incidentIds }),
    })
  }

  /** Remember the Funkdurchsage just made for an Auftrag, so the next stop of the
   *  same route gets the short continuation instead of the whole thing again. */
  async recordGroupAnnouncement(groupId: string, data: ApiGroupAnnouncement): Promise<ApiIncidentGroup> {
    return httpRequest<ApiIncidentGroup>(`/api/incident-groups/${groupId}/announce`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  /** Detach a stop from its Auftrag (leaves the incident on the board) (204). */
  async removeStopFromGroup(groupId: string, incidentId: string): Promise<void> {
    return httpRequest<void>(`/api/incident-groups/${groupId}/stops/${incidentId}`, {
      method: 'DELETE',
    })
  }

  // --- Route-owned resources (Auftrag assignments) ---------------------------

  /** List the active resources owned by a route. */
  async getGroupAssignments(groupId: string): Promise<ApiGroupAssignment[]> {
    return httpRequest<ApiGroupAssignment[]>(`/api/incident-groups/${groupId}/assignments`)
  }

  /** Attach a resource to a route (409 on duplicate). */
  async assignGroupResource(groupId: string, data: ApiGroupAssignmentCreate): Promise<ApiGroupAssignment> {
    return httpRequest<ApiGroupAssignment>(`/api/incident-groups/${groupId}/assign`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  /** Release a route-owned resource (204 No Content). */
  async unassignGroupResource(groupId: string, assignmentId: string): Promise<void> {
    return httpRequest<void>(`/api/incident-groups/${groupId}/unassign/${assignmentId}`, {
      method: 'POST',
    })
  }

  /** Promote a route-owned assignment to Einsatzleiter (demotes the previous one). */
  async updateGroupAssignment(
    groupId: string,
    assignmentId: string,
    data: { is_leader?: boolean }
  ): Promise<ApiGroupAssignment> {
    return httpRequest<ApiGroupAssignment>(
      `/api/incident-groups/${groupId}/assignments/${assignmentId}`,
      {
        method: 'PATCH',
        body: JSON.stringify(data),
      }
    )
  }
}
