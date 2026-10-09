/**
 * Divera 24/7, the integration registry and the roster snapshot.
 *
 * One slice of `apiClient` (`lib/api-client.ts` mixes every resource class into
 * the one client object). Methods go through the shared transport in `../http`.
 */

import { request as httpRequest } from '../http'
import type {
  ApiDiveraResponsesSummary,
  ApiIncident,
  ApiDiveraEmergency,
  ApiDiveraEmergencyListResponse,
  ApiDiveraSyncPreview,
  ApiDiveraSyncResult,
  ApiDiveraAlarmResult,
  ApiDiveraMemberPreview,
  ApiDiveraGroup,
  ApiDiveraMessageResult,
  ApiDiveraPollingStatus,
  ApiIntegrations,
  ApiRosterSnapshot,
  SendDiveraAlarmOptions,
  SendDiveraMessageOptions,
} from '../types'

export class DiveraApi {
  // Divera 24/7 Integration
  async getDiveraEmergencies(params?: {
    attached?: boolean
    event_id?: string
    include_archived?: boolean
    skip?: number
    limit?: number
  }): Promise<ApiDiveraEmergencyListResponse> {
    const queryParams = new URLSearchParams()

    if (params) {
      if (params.attached !== undefined) {
        queryParams.append('attached', String(params.attached))
      }
      if (params.event_id) {
        queryParams.append('event_id', params.event_id)
      }
      if (params.include_archived !== undefined) {
        queryParams.append('include_archived', String(params.include_archived))
      }
      if (params.skip !== undefined) {
        queryParams.append('skip', String(params.skip))
      }
      if (params.limit !== undefined) {
        queryParams.append('limit', String(params.limit))
      }
    }

    const endpoint = `/api/divera/emergencies${queryParams.toString() ? `?${queryParams.toString()}` : ''}`
    return httpRequest<ApiDiveraEmergencyListResponse>(endpoint)
  }

  async getDiveraEmergency(emergencyId: string): Promise<ApiDiveraEmergency> {
    return httpRequest<ApiDiveraEmergency>(`/api/divera/emergencies/${emergencyId}`)
  }

  /** `mergeIntoIncidentId`: the operator answered «Zusammenführen» to the
   *  duplicate hint — the alarm becomes a Nachtrag on that card and the
   *  response is that card. */
  async attachEmergencyToEvent(
    emergencyId: string,
    eventId: string,
    mergeIntoIncidentId?: string | null,
  ): Promise<ApiIncident> {
    return httpRequest<ApiIncident>(`/api/divera/emergencies/${emergencyId}/attach`, {
      method: 'POST',
      body: JSON.stringify({
        event_id: eventId,
        ...(mergeIntoIncidentId ? { merge_into_incident_id: mergeIntoIncidentId } : {}),
      }),
    })
  }

  async bulkAttachEmergencies(
    emergencyIds: string[],
    eventId: string,
  ): Promise<{ created: ApiIncident[]; errors: string[] }> {
    return httpRequest<{ created: ApiIncident[]; errors: string[] }>('/api/divera/emergencies/bulk-attach', {
      method: 'POST',
      body: JSON.stringify({
        emergency_ids: emergencyIds,
        event_id: eventId,
      }),
    })
  }

  async archiveDiveraEmergency(emergencyId: string): Promise<void> {
    return httpRequest<void>(`/api/divera/emergencies/${emergencyId}`, {
      method: 'DELETE',
    })
  }

  async getDiveraSyncPreview(): Promise<ApiDiveraSyncPreview> {
    return httpRequest<ApiDiveraSyncPreview>('/api/divera/personnel-sync/preview')
  }

  async executeDiveraSync(options: { remove_stale: boolean }): Promise<ApiDiveraSyncResult> {
    return httpRequest<ApiDiveraSyncResult>('/api/divera/personnel-sync/execute', {
      method: 'POST',
      body: JSON.stringify(options),
    })
  }

  /**
   * Send an outbound Divera alarm to selected personnel assigned to an incident.
   * Returns per-recipient results (sent vs skipped). A 200 with `success: false`
   * means nothing was sent (e.g. no linked recipients); gating failures
   * (disabled / training / demo / no key) reject with a 4xx.
   */
  async sendIncidentDiveraAlarm(
    incidentId: string,
    options: SendDiveraAlarmOptions,
  ): Promise<ApiDiveraAlarmResult> {
    return httpRequest<ApiDiveraAlarmResult>(`/api/divera/incidents/${incidentId}/alarm`, {
      method: 'POST',
      body: JSON.stringify(options),
    })
  }

  /** List Divera members (id + name) – for picking a test-alarm recipient. */
  async getDiveraMembers(): Promise<ApiDiveraMemberPreview[]> {
    return httpRequest<ApiDiveraMemberPreview[]>('/api/divera/members')
  }

  /** Send a setup test alarm (push only) directly to a Divera member. */
  async sendDiveraTestAlarm(diveraUserId: number, name?: string): Promise<ApiDiveraAlarmResult> {
    return httpRequest<ApiDiveraAlarmResult>('/api/divera/test-alarm', {
      method: 'POST',
      body: JSON.stringify({ divera_user_id: diveraUserId, name }),
    })
  }

  /** The unit's Divera groups – the recipient choices for a Mitteilung. */
  async getDiveraGroups(): Promise<ApiDiveraGroup[]> {
    return httpRequest<ApiDiveraGroup[]>('/api/divera/groups')
  }

  /**
   * Post an informational Divera Mitteilung (not an alarm) – the checklist's
   * standby message. Recipients are explicit: named groups, or a deliberate
   * `target: 'all'`.
   */
  async sendDiveraMessage(options: SendDiveraMessageOptions): Promise<ApiDiveraMessageResult> {
    return httpRequest<ApiDiveraMessageResult>('/api/divera/message', {
      method: 'POST',
      body: JSON.stringify(options),
    })
  }

  /** Divera Rückmeldungen («Komme» / «Komme nicht») for every Divera alarm of an Ereignis. */
  async getEventDiveraResponses(eventId: string): Promise<ApiDiveraResponsesSummary> {
    return httpRequest<ApiDiveraResponsesSummary>(`/api/divera/events/${encodeURIComponent(eventId)}/responses`)
  }

  /** Divera polling/connection status – for the Verbindung indicator. */
  async getDiveraPollingStatus(): Promise<ApiDiveraPollingStatus> {
    return httpRequest<ApiDiveraPollingStatus>('/api/divera/polling/status')
  }

  /** Provider capability registry – which integrations are configured, per domain. */
  async getIntegrations(): Promise<ApiIntegrations> {
    return httpRequest<ApiIntegrations>('/api/integrations')
  }

  async getRosterSnapshot(): Promise<ApiRosterSnapshot> {
    return httpRequest<ApiRosterSnapshot>('/api/integrations/roster-snapshot')
  }
}
