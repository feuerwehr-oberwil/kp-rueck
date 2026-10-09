/**
 * Incidents (event-scoped): CRUD, order, status, timeline, duplicates and merge.
 *
 * One slice of `apiClient` (`lib/api-client.ts` mixes every resource class into
 * the one client object). Methods go through the shared transport in `../http`.
 */

import { request as httpRequest } from '../http'
import {
  NetworkError,
  type IncidentStatus,
  type ApiIncident,
  type ApiIncidentCreate,
  type ApiDuplicateCandidatesResponse,
  type ApiMergeResponse,
  type ApiUnmergeResponse,
  type ApiIncidentUpdate,
  type ApiStatusTransition,
  type ApiIncidentTimelineResponse,
  type ApiIncidentParticipantsResponse,
} from '../types'

/** The candidate lookup's query string, shared by the board's and `/feld`'s. */
export function duplicateQuery(params: {
  eventId?: string
  lat?: number | null
  lng?: number | null
  address?: string | null
  excludeId?: string | null
}): URLSearchParams {
  const query = new URLSearchParams()
  if (params.eventId) query.set('event_id', params.eventId)
  if (params.lat != null && params.lng != null) {
    query.set('lat', params.lat.toFixed(7))
    query.set('lng', params.lng.toFixed(7))
  }
  if (params.address?.trim()) query.set('address', params.address.trim())
  if (params.excludeId) query.set('exclude_id', params.excludeId)
  return query
}

export class IncidentsApi {
  // Incidents (now event-scoped)
  async getIncidents(eventId: string, params?: {
    status?: IncidentStatus
    skip?: number
    limit?: number
  }): Promise<ApiIncident[]> {
    const queryParams = new URLSearchParams()
    queryParams.append('event_id', eventId)

    if (params) {
      if (params.status) {
        queryParams.append('status', params.status)
      }
      if (params.skip !== undefined) {
        queryParams.append('skip', String(params.skip))
      }
      if (params.limit !== undefined) {
        queryParams.append('limit', String(params.limit))
      }
    }

    const endpoint = `/api/incidents/${queryParams.toString() ? `?${queryParams.toString()}` : ''}`
    return httpRequest<ApiIncident[]>(endpoint)
  }

  /**
   * Same as `getIncidents`, but also reports how many incidents exist in total.
   *
   * The board needs this to tell a complete list from a truncated one. A plain array looks
   * identical either way, which is how 200 incidents could render as an arbitrary 100 with
   * nothing on screen suggesting anything was missing.
   *
   * `total` is null when the header is absent (an older backend, or a proxy that strips it) –
   * callers must treat null as "unknown", never as zero, or the banner would claim a full
   * board is truncated.
   *
   * ⚠️ Rejects with `NetworkError` when the request never got an answer. `request()` lets a
   * GET resolve to nothing on a dead connection, and this used to turn that into `[]` – a
   * failed load and an Ereignis without incidents were the same value, and the board wiped
   * every card on a timed-out poll (2026-09-23).
   */
  async getIncidentsWithTotal(eventId: string, params?: {
    status?: IncidentStatus
    skip?: number
    limit?: number
  }): Promise<{ incidents: ApiIncident[]; total: number | null }> {
    const queryParams = new URLSearchParams()
    queryParams.append('event_id', eventId)
    if (params?.status) queryParams.append('status', params.status)
    if (params?.skip !== undefined) queryParams.append('skip', String(params.skip))
    if (params?.limit !== undefined) queryParams.append('limit', String(params.limit))

    let total: number | null = null
    const incidents = await httpRequest<ApiIncident[]>(
      `/api/incidents/?${queryParams.toString()}`,
      {
        onHeaders: (headers) => {
          const raw = headers.get('X-Total-Count')
          const parsed = raw === null ? Number.NaN : Number(raw)
          total = Number.isFinite(parsed) ? parsed : null
        },
      },
    )
    if (incidents === undefined) throw new NetworkError()
    return { incidents, total }
  }

  async getIncident(id: string): Promise<ApiIncident> {
    return httpRequest<ApiIncident>(`/api/incidents/${id}`)
  }

  async createIncident(data: ApiIncidentCreate): Promise<ApiIncident> {
    return httpRequest<ApiIncident>('/api/incidents/', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async updateIncident(
    id: string,
    data: ApiIncidentUpdate,
    expectedUpdatedAt?: string
  ): Promise<ApiIncident> {
    const queryParams = expectedUpdatedAt
      ? `?expected_updated_at=${encodeURIComponent(expectedUpdatedAt)}`
      : ''

    return httpRequest<ApiIncident>(`/api/incidents/${id}${queryParams}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
      // Survive page hide/unload: debounced board edits are flushed from a
      // pagehide handler and must outlive the document (payloads are tiny).
      keepalive: true,
    })
  }

  /**
   * Persist the manual top-to-bottom order of one status column.
   * `orderedIds` is the column's cards in their new order (204 No Content).
   */
  async reorderIncidents(eventId: string, orderedIds: string[]): Promise<void> {
    await httpRequest<void>('/api/incidents/reorder', {
      method: 'POST',
      body: JSON.stringify({ event_id: eventId, ordered_ids: orderedIds }),
    })
  }

  async updateIncidentStatus(
    id: string,
    fromStatus: IncidentStatus,
    toStatus: IncidentStatus,
    notes?: string
  ): Promise<ApiIncident> {
    return httpRequest<ApiIncident>(`/api/incidents/${id}/status`, {
      method: 'POST',
      body: JSON.stringify({
        from_status: fromStatus,
        to_status: toStatus,
        notes,
      }),
    })
  }

  async getIncidentStatusHistory(id: string): Promise<ApiStatusTransition[]> {
    return httpRequest<ApiStatusTransition[]>(`/api/incidents/${id}/history`)
  }

  async getIncidentTimeline(id: string): Promise<ApiIncidentTimelineResponse> {
    return httpRequest<ApiIncidentTimelineResponse>(`/api/incidents/${id}/timeline`)
  }

  async deleteIncident(id: string): Promise<void> {
    return httpRequest<void>(`/api/incidents/${id}`, {
      method: 'DELETE',
    })
  }

  // --- Duplicate reports (services/duplicates.py) ---

  /** Open incidents of the Ereignis within 50 m or at the same address. */
  async getDuplicateCandidates(params: {
    eventId: string
    lat?: number | null
    lng?: number | null
    address?: string | null
    excludeId?: string | null
  }): Promise<ApiDuplicateCandidatesResponse> {
    // Advice, never a failure the operator has to read: no transport toast, no retries.
    return httpRequest<ApiDuplicateCandidatesResponse>(
      `/api/incidents/duplicate-candidates?${duplicateQuery(params).toString()}`,
      { skipToast: true, maxRetries: 0 },
    )
  }

  /** «Zusammenführen» before a card exists: the report becomes a Nachtrag on `targetId`. */
  async mergeReport(targetId: string, incident: ApiIncidentCreate): Promise<ApiMergeResponse> {
    return httpRequest<ApiMergeResponse>('/api/incidents/merge-report', {
      method: 'POST',
      body: JSON.stringify({ target_id: targetId, incident }),
    })
  }

  /** «Zusammenführen» on a flagged card: fold `incidentId` into `targetId`. */
  async mergeIncidentInto(incidentId: string, targetId: string): Promise<ApiMergeResponse> {
    return httpRequest<ApiMergeResponse>(`/api/incidents/${incidentId}/merge`, {
      method: 'POST',
      body: JSON.stringify({ target_id: targetId }),
    })
  }

  /** «Trennen» / «Rückgängig»: the merged report is its own card again (409 when it is not merged). */
  async unmergeIncident(mergedIncidentId: string): Promise<ApiUnmergeResponse> {
    return httpRequest<ApiUnmergeResponse>(`/api/incidents/${mergedIncidentId}/unmerge`, { method: 'POST' })
  }

  /** «Kein Duplikat»: the flag goes, the card stays. */
  async dismissDuplicate(incidentId: string): Promise<ApiIncident> {
    return httpRequest<ApiIncident>(`/api/incidents/${incidentId}/not-duplicate`, { method: 'POST' })
  }

  async restoreIncident(id: string): Promise<ApiIncident> {
    return httpRequest<ApiIncident>(`/api/incidents/${id}/restore`, {
      method: 'POST',
    })
  }

  /**
   * Everyone and everything that was on this incident, including resources
   * already released. Completing an incident empties its crew list, so this is
   * the only thing that still answers "who was there" afterwards.
   */
  async getIncidentParticipants(id: string): Promise<ApiIncidentParticipantsResponse> {
    return httpRequest<ApiIncidentParticipantsResponse>(`/api/incidents/${id}/participants`)
  }
}
