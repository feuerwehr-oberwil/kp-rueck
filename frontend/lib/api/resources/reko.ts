/**
 * Reko forms (token and editor doors), photos, summaries and Reko personnel.
 *
 * One slice of `apiClient` (`lib/api-client.ts` mixes every resource class into
 * the one client object). Methods go through the shared transport in `../http`.
 */

import { linkRequest, request as httpRequest } from '../http'
import type {
  ApiAssignment,
  ApiRekoReportUpdate,
  ApiRekoArrivedState,
  ApiRekoReportResponse,
  ApiRekoFormResponse,
  ApiEventRekoSummariesResponse,
  ApiAvailableRekoPersonnelResponse,
} from '../types'
import { uploadPhotoFile, type PhotoUploadProgress } from './upload'

export class RekoApi {
  // Reko Forms
  //
  // Editor-only since plan 26: the field phone mints its own form token through
  // `mintFeldRekoLink`, which runs the /feld two-step first, so neither door had
  // to learn about the other.
  async generateRekoLink(incidentId: string, personnelId?: string): Promise<{ incident_id: string; token: string; link: string; personnel_id?: string; qr_code_url: string }> {
    let url = `/api/reko/generate-link?incident_id=${encodeURIComponent(incidentId)}`
    if (personnelId) {
      url += `&personnel_id=${encodeURIComponent(personnelId)}`
    }
    return httpRequest<{ incident_id: string; token: string; link: string; personnel_id?: string; qr_code_url: string }>(
      url, {
        method: 'POST',
      }
    )
  }

  async getRekoForm(incidentId: string, token: string, personnelId?: string | null): Promise<ApiRekoFormResponse> {
    const params = new URLSearchParams()
    params.append('incident_id', incidentId)
    params.append('token', token)
    if (personnelId) {
      params.append('personnel_id', personnelId)
    }

    // No toast: the form says it itself, once (a dead link gets the /alarm card).
    return linkRequest<ApiRekoFormResponse>(`/api/reko/form?${params.toString()}`, { skipToast: true })
  }

  async saveRekoDraft(incidentId: string, token: string, data: ApiRekoReportUpdate): Promise<ApiRekoReportResponse> {
    return linkRequest<ApiRekoReportResponse>(`/api/reko/?submit=false`, {
      method: 'POST',
      body: JSON.stringify({ ...data, incident_id: incidentId, token }),
    })
  }

  async submitRekoReport(incidentId: string, token: string, data: ApiRekoReportUpdate): Promise<ApiRekoReportResponse> {
    return linkRequest<ApiRekoReportResponse>(`/api/reko/?submit=true`, {
      method: 'POST',
      body: JSON.stringify({ ...data, incident_id: incidentId, token }),
    })
  }

  /** The board's door onto the same route (plan 26 §5.1) – no token, the session
   *  identifies the operator. The report lands in the same table and the same
   *  list as a crew-filed one; only its provenance columns differ. */
  async createRekoReportAsEditor(
    incidentId: string,
    data: ApiRekoReportUpdate,
    submit = true,
  ): Promise<ApiRekoReportResponse> {
    return httpRequest<ApiRekoReportResponse>(`/api/reko/?submit=${submit ? 'true' : 'false'}`, {
      method: 'POST',
      body: JSON.stringify({ ...data, incident_id: incidentId }),
    })
  }

  /** Amend an existing report – a crew's included, without filing a second one.
   *  The endpoint has accepted a session since it was written; it simply never
   *  had a caller. Without `token` this is the KP door and stamps the operator. */
  async updateRekoReport(
    reportId: string,
    data: ApiRekoReportUpdate,
    options?: { submit?: boolean; token?: string },
  ): Promise<ApiRekoReportResponse> {
    return httpRequest<ApiRekoReportResponse>(
      `/api/reko/${reportId}?submit=${options?.submit ? 'true' : 'false'}`,
      {
        method: 'PATCH',
        body: JSON.stringify(data),
        auth: options?.token ? 'link' : 'session',
        headers: options?.token ? { 'X-Reko-Token': options.token } : undefined,
      },
    )
  }

  /** "Reko meldet: vor Ort" as the KP hears it. Omit `arrivedAt` for "now",
   *  pass a time for a message logged late, pass `null` to clear a mis-hear. */
  async setRekoArrived(incidentId: string, arrivedAt?: string | null): Promise<ApiRekoArrivedState> {
    return httpRequest<ApiRekoArrivedState>(`/api/incidents/${incidentId}/reko-arrived`, {
      method: 'POST',
      body: JSON.stringify(arrivedAt === undefined ? {} : { arrived_at: arrivedAt }),
    })
  }

  async uploadRekoPhoto(
    incidentId: string,
    token: string,
    file: File,
    onProgress?: PhotoUploadProgress,
  ): Promise<{ filename: string }> {
    return uploadPhotoFile<{ filename: string }>(
      `/api/reko/${incidentId}/photos`,
      file,
      { 'X-Reko-Token': token },
      onProgress,
    )
  }

  /** The board's door onto the same upload – the WhatsApp-photo case. No token:
   *  the session identifies the operator. The photo lands on the Einsatz's one
   *  report (created as a draft when there is none yet). */
  async uploadRekoPhotoAsEditor(incidentId: string, file: File): Promise<{ filename: string }> {
    return uploadPhotoFile<{ filename: string }>(`/api/reko/${incidentId}/photos`, file)
  }

  async deleteRekoPhoto(incidentId: string, token: string, filename: string): Promise<void> {
    await linkRequest(`/api/reko/${incidentId}/photos/${filename}`, {
      method: 'DELETE',
      headers: { 'X-Reko-Token': token },
    })
  }

  /** Board door, see `uploadRekoPhotoAsEditor`. */
  async deleteRekoPhotoAsEditor(incidentId: string, filename: string): Promise<void> {
    await httpRequest(`/api/reko/${incidentId}/photos/${filename}`, { method: 'DELETE' })
  }

  /** The Einsatz's Reko report as a list: empty, or THE one (one per Einsatz since 23.11.2026). */
  async getIncidentRekoReports(incidentId: string): Promise<ApiRekoReportResponse[]> {
    return httpRequest<ApiRekoReportResponse[]>(`/api/reko/incident/${incidentId}/reports`)
  }

  async markRekoArrived(incidentId: string, token: string): Promise<ApiRekoReportResponse> {
    return httpRequest<ApiRekoReportResponse>(
      `/api/reko/${incidentId}/arrived?token=${encodeURIComponent(token)}`,
      {
        method: 'POST',
      }
    )
  }

  /**
   * Get reko summaries for all incidents in an event (bulk load).
   * This eliminates N+1 queries when loading the kanban board.
   */
  async getEventRekoSummaries(eventId: string): Promise<ApiEventRekoSummariesResponse> {
    return httpRequest<ApiEventRekoSummariesResponse>(`/api/reko/event/${eventId}/summaries`)
  }

  async getAvailableRekoPersonnel(incidentId: string): Promise<ApiAvailableRekoPersonnelResponse> {
    return httpRequest<ApiAvailableRekoPersonnelResponse>(
      `/api/reko/incidents/${incidentId}/available-reko`
    )
  }

  async assignRekoPersonnel(incidentId: string, personnelId: string): Promise<ApiAssignment> {
    return httpRequest<ApiAssignment>(
      `/api/reko/incidents/${incidentId}/assign-reko`,
      {
        method: 'POST',
        body: JSON.stringify({ personnel_id: personnelId }),
      }
    )
  }

  /**
   * Put a Reko person's Rekos (Einsatz ids, all they hold) in order. With `expectedIds` the
   * server applies it only while the person still holds exactly those Rekos, else 409
   * (`ApiError.isConflict`) and nothing changes.
   */
  async reorderRekoAssignments(personnelId: string, eventId: string, orderedIds: string[], expectedIds?: string[]): Promise<void> {
    await httpRequest<void>(`/api/reko/personnel/${personnelId}/order`, {
      method: 'POST',
      body: JSON.stringify({ event_id: eventId, ordered_ids: orderedIds, expected_ids: expectedIds ?? null }),
    })
  }

  async unassignRekoPersonnel(incidentId: string, personnelId: string): Promise<void> {
    return httpRequest<void>(
      `/api/reko/incidents/${incidentId}/unassign-reko/${personnelId}`,
      {
        method: 'DELETE',
      }
    )
  }

  async transferRekoAssignments(
    fromPersonnelId: string,
    toPersonnelId: string,
    eventId: string,
  ): Promise<{ transferred_count: number; incident_ids: string[] }> {
    return httpRequest<{ transferred_count: number; incident_ids: string[] }>(
      `/api/reko/transfer-rekos?from_personnel_id=${encodeURIComponent(fromPersonnelId)}&to_personnel_id=${encodeURIComponent(toPersonnelId)}&event_id=${encodeURIComponent(eventId)}`,
      {
        method: 'POST',
      }
    )
  }
}
