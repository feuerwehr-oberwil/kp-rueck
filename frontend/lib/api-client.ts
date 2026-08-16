/**
 * API Client for KP Rück Backend
 * Handles all HTTP requests to the FastAPI backend
 */

import { getApiUrl } from './env'
import { toast } from 'sonner'
import { translateOutsideReact } from './i18n-messages'
import type { SyncStatusResponse, SyncHistoryEntry, SyncConfig, SyncResult } from '@/types/sync'

// Re-export every API type so existing consumers (`import { type ApiX } from '@/lib/api-client'`)
// keep working unchanged. Source definitions live in lib/api/types/ split by domain.
export * from './api/types'

import {
  ApiError,
  NetworkError,
  type ApiAuditLog,
  type BulkCategorySortOrderUpdate,
  type ApiEvent,
  type ApiEventCreate,
  type ApiEventUpdate,
  type ApiEventListResponse,
  type ApiEventSpecialFunctionCreate,
  type ApiEventSpecialFunctionDelete,
  type ApiEventSpecialFunctionResponse,
  type ApiEventStats,
  type ApiPersonnel,
  type ApiPersonnelListItem,
  type ApiCheckInStats,
  type ApiPersonnelCreate,
  type ApiPersonnelUpdate,
  type ApiVehicle,
  type ApiVehicleCreate,
  type ApiVehicleUpdate,
  type ApiTraccarStatus,
  type ApiVehiclePosition,
  type ApiVehicleTrail,
  type ApiGpsSimDrive,
  type ApiMaterialResource,
  type ApiMaterialCreate,
  type ApiMaterialUpdate,
  type ApiMaterialGroup,
  type ApiAssignment,
  type ApiAssignmentCreate,
  type ApiTransferAssignmentsResponse,
  type IncidentStatus,
  type IncidentType,
  type IncidentPriority,
  type ApiIncident,
  type ApiIncidentCreate,
  type ApiIncidentUpdate,
  type ApiIncidentGroup,
  type ApiIncidentGroupCreate,
  type ApiIncidentGroupUpdate,
  type ApiAuftragTemplate,
  type ApiAuftragTemplateCreate,
  type ApiAuftragTemplateUpdate,
  type ApiGroupAnnouncement,
  type ApiGroupAssignment,
  type ApiGroupAssignmentCreate,
  type ApiStatusTransition,
  type ApiIncidentTimelineResponse,
  type ApiIncidentParticipantsResponse,
  type ApiRekoReportCreate,
  type ApiRekoReportUpdate,
  type ApiRekoArrivedState,
  type ApiRekoReportResponse,
  type ApiRekoFormResponse,
  type ApiEventRekoSummariesResponse,
  type ApiViewerRekoSummary,
  type ApiAlarmWebhookSecret,
  type ApiExcelImportPreview,
  type ApiExcelImportResult,
  type ExcelImportMode,
  type ApiEmergencyTemplate,
  type ApiTrainingLocation,
  type ApiSimulatedRapport,
  type ApiSimulatedRapportBulk,
  type ApiDiveraEmergency,
  type ApiDiveraEmergencyListResponse,
  type ApiDiveraSyncPreview,
  type ApiDiveraSyncResult,
  type ApiDiveraAlarmResult,
  type ApiDiveraMemberPreview,
  type ApiDiveraGroup,
  type ApiDiveraMessageResult,
  type ApiDiveraPollingStatus,
  type ApiIntegrations,
  type ApiDeployment,
  type SendDiveraAlarmOptions,
  type SendDiveraMessageOptions,
  type ApiRekoDashboardPersonnelListResponse,
  type ApiRekoDashboardAssignmentsResponse,
  type ApiAvailableRekoPersonnelResponse,
  type ApiFeldPersonnelListResponse,
  type ApiFeldAssignmentsResponse,
  type ApiFeldAccessState,
  type ApiFeldUnlockResponse,
  type ApiFeldClaimResponse,
  type ApiFeldIncidentCreate,
  type ApiFeldIncidentCreated,
  type ApiFieldReportState,
  type ApiFieldReportUpdate,
  type ApiSchadenplatzRapport,
  type ApiRapportUpdate,
  type ApiMaterialReturnResponse,
  type ApiRapportPhotosResponse,
  type ApiEventRestliste,
} from './api/types'

/**
 * The share-link view of an incident – the situation, never the Melder.
 *
 * Mirrors the backend's `schemas.ViewerIncident`: `contact`, `contact_phone`
 * and `internal_notes` are not in the payload, and neither is the workflow
 * bookkeeping (rapport flags, `pickup_note`, field/user ids). `pickup_needed` /
 * `pickup_requested_at` are the exception and are here on purpose: a crew that
 * cannot get itself back is the situation, and the flag names nobody. Built
 * with `Pick` on purpose – a field is in the share payload only if it is named
 * here, and adding one to `ApiIncident` cannot leak it onto a wall by itself.
 */
export type ApiViewerIncident = Pick<
  ApiIncident,
  | 'id'
  | 'event_id'
  | 'title'
  | 'type'
  | 'priority'
  | 'status'
  | 'location_address'
  | 'location_display'
  | 'location_lat'
  | 'location_lng'
  | 'description'
  | 'source'
  | 'nachbarhilfe'
  | 'nachbarhilfe_note'
  | 'am_warten'
  | 'am_warten_note'
  | 'zu_fuss'
  | 'pickup_needed'
  | 'pickup_requested_at'
  | 'group_id'
  | 'group_position'
  | 'created_at'
  | 'updated_at'
  | 'completed_at'
  | 'status_changed_at'
  | 'assigned_vehicles'
  | 'has_completed_reko'
  | 'reko_arrived_at'
> & {
  /** Never sent – the operator behind a card is not part of a shared situation.
   *  Declared (as absent) so the mappers that read it stay honest and compile. */
  created_by?: null
}

/** Roster row on a shared display: enough to name and sort a person, no more.
 *  Availability is derived from this event's assignments, so the raw status
 *  column and the external account id (`divera_user_id`) stay behind. */
export type ApiViewerPersonnel = Pick<ApiPersonnel, 'id' | 'name' | 'role' | 'role_sort_order' | 'tags'> & {
  divera_user_id?: null
}

/** Material panel row on a shared display. */
export type ApiViewerMaterial = Pick<
  ApiMaterialResource,
  'id' | 'name' | 'type' | 'location' | 'location_sort_order' | 'consumable' | 'group_id'
>

/** Which resource sits on which incident – never who put it there, or when.
 *  `is_leader` rides along: the crew's names are already in the payload, and it
 *  only marks which of them leads (the display sorts the crew leader-first). */
export type ApiViewerAssignment = Pick<
  ApiAssignment,
  'id' | 'resource_type' | 'resource_id' | 'driver_stay' | 'is_leader'
>

/** Reko / driver / Magazin roles for the event. */
export type ApiViewerSpecialFunction = Pick<
  ApiEventSpecialFunctionResponse,
  'personnel_id' | 'function_type' | 'vehicle_id' | 'vehicle_name'
>

/** A resource an Auftrag owns, as the shared board names it. */
export type ApiViewerGroupAssignment = Pick<
  ApiGroupAssignment,
  'id' | 'resource_type' | 'resource_id' | 'unassigned_at' | 'driver_stay' | 'is_leader'
>

/** An Auftrag as a display draws it: name, colour, stops, progress and the
 *  resources it owns. No `created_by`, no `assigned_by` on the rows, and no
 *  Funkdurchsage bookkeeping – a display never makes an announcement. */
export type ApiViewerGroup = Pick<
  ApiIncidentGroup,
  'id' | 'event_id' | 'name' | 'color' | 'notes' | 'position' | 'created_at' | 'updated_at' | 'stop_ids' | 'progress'
> & {
  created_by?: null
  assignments: ApiViewerGroupAssignment[]
}

/** Read-only payload behind a share token (board/map/status displays).
 *
 * Every row is the narrow `ApiViewer*` shape, not the board's own – the token in
 * the URL is the only gate here, so what rides along is an allowlist on both
 * sides of the wire (`backend/app/schemas/viewer.py`). */
export interface ApiViewerData {
  event: ApiEvent
  incidents: ApiViewerIncident[]
  personnel: ApiViewerPersonnel[]
  materials: ApiViewerMaterial[]
  /** Full rows: a vehicle carries no personal data, and the fleet panel is what
   *  a status display is read for. */
  vehicles: ApiVehicle[]
  vehicle_positions: ApiVehiclePosition[]
  /** Present when the public viewer endpoint exposes Auftrag data. */
  groups?: ApiViewerGroup[]
  /** incident_id → assignments; lets the displays derive event-scoped
   *  availability (assigned vs. available) like the logged-in board. */
  assignments?: Record<string, ApiViewerAssignment[]>
  special_functions?: ApiViewerSpecialFunction[]
  /** incident_id → what the Reko reported, for incidents with a submitted
   *  report. Photos are not in there: the photo route needs the login. */
  reko_summaries?: Record<string, ApiViewerRekoSummary>
}

/**
 * Hard ceiling on a single request. Generous on purpose: a command post on a saturated
 * uplink is slow but still worth waiting for, and cutting off a real response is worse
 * than waiting. This exists to bound a connection that will never answer at all, not to
 * enforce latency.
 */
const REQUEST_TIMEOUT_MS = 20_000

class ApiClient {
  // No constructor needed - URL is resolved dynamically per request

  private getBaseUrl(): string {
    // Always call getApiUrl() dynamically to ensure runtime resolution in browser
    return getApiUrl()
  }

  /**
   * Sleep function for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * Calculate exponential backoff delay
   */
  private getBackoffDelay(retryCount: number): number {
    // Exponential backoff: 1s, 2s, 4s, 8s, max 16s
    const baseDelay = 1000
    const maxDelay = 16000
    const delay = Math.min(baseDelay * Math.pow(2, retryCount), maxDelay)
    // Add jitter (±20%) to prevent thundering herd
    const jitter = delay * 0.2 * (Math.random() - 0.5)
    return Math.round(delay + jitter)
  }

  /**
   * Main request method with retry logic and error notifications
   */
  private async request<T>(endpoint: string, options?: RequestInit & { skipToast?: boolean; maxRetries?: number; onHeaders?: (headers: Headers) => void }): Promise<T> {
    const baseUrl = this.getBaseUrl()
    const url = `${baseUrl}${endpoint}`
    const method = options?.method || 'GET'
    const isGetRequest = method === 'GET'
    const skipToast = options?.skipToast || false
    const maxRetries = options?.maxRetries ?? (isGetRequest ? 3 : 1) // Retry GET requests by default, not mutations


    let lastError: Error | null = null

    for (let retryCount = 0; retryCount <= maxRetries; retryCount++) {
      try {
        const response = await fetch(url, {
          ...options,
          credentials: 'include', // Send cookies for authentication
          // Without this a request could hang indefinitely – a dead-but-open TCP connection
          // never rejects on its own. One hung GET was enough to wedge the polling loop for
          // good: `startPolling()` cannot re-arm while `isPollingActive` is still true, and
          // only a WebSocket 'connected' transition resets it. The board then sat there
          // quietly not updating. Callers may override for genuinely slow routes (exports,
          // PDF generation) by passing their own signal.
          signal: options?.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          headers: {
            'Content-Type': 'application/json',
            ...options?.headers,
          },
        })

        if (!response.ok) {
          let errorText = ''
          try {
            errorText = await response.text()
          } catch {
            errorText = translateOutsideReact('errors.api.noErrorDetails')
          }

          // Don't log 401 errors for sync config - expected when not authenticated
          const shouldLog = !(response.status === 401 && endpoint === '/api/sync/config')
          if (shouldLog) {
            // Use console.warn to avoid triggering Next.js error overlay
            console.warn(`[API Error] ${method} ${endpoint}: ${response.status} ${response.statusText}`, errorText)
          }

          // Don't throw error for 401 on sync config - it's handled gracefully by the component
          if (response.status === 401 && endpoint === '/api/sync/config') {
            throw new Error('Unauthorized') // Silent error that will be caught
          }

          // Try to parse as JSON for better error messages
          let errorMessage = `${response.status} ${response.statusText}`
          try {
            const errorJson = JSON.parse(errorText)
            if (errorJson.detail) {
              errorMessage = errorJson.detail
            }
          } catch {
            // Not JSON, use text error if available
            if (errorText && errorText.length < 200) {
              errorMessage = errorText
            }
          }

          // Determine if we should retry based on status code
          const isRetryable = response.status >= 500 || response.status === 429 || response.status === 408

          if (isRetryable && retryCount < maxRetries) {
            const delay = this.getBackoffDelay(retryCount)
            await this.sleep(delay)
            continue // Retry
          }

          // Final error - create ApiError with status code for proper error handling
          const isConflict = response.status === 409
          const error = new ApiError(errorMessage, response.status, isConflict)

          // A 401 means the session is gone (auth endpoints don't go through
          // this client). Tell the auth layer so it can clear the user and
          // show "Sitzung abgelaufen" – without this, every mutation after
          // token expiry fails silently and optimistic UI just reverts.
          if (response.status === 401 && typeof window !== 'undefined') {
            window.dispatchEvent(new Event('kp:session-expired'))
          }

          // Don't show toast for 401 Unauthorized - the session-expired event
          // above produces a single, specific message instead
          // Don't show toast for 409 Conflict - let the caller handle it with context-specific message
          if (!skipToast && response.status !== 401 && !isConflict) {
            toast.error(translateOutsideReact('errors.api.title'), {
              description: errorMessage,
            })
          }
          throw error
        }

        // Response metadata the parsed body can't carry (e.g. X-Total-Count, which tells
        // the board whether it is showing everything). Non-breaking on purpose: the return
        // type stays the parsed body, so the ~85 existing call sites are untouched.
        options?.onHeaders?.(response.headers)

        // Handle empty responses (e.g., DELETE operations with 204 No Content)
        const contentType = response.headers.get('content-type')
        if (response.status === 204 || !contentType || contentType.indexOf('application/json') === -1) {
          return undefined as T
        }

        const data = await response.json()
        return data

      } catch (error) {
        lastError = error as Error

        // Network errors are always retryable.
        //
        // The message is deliberately NOT inspected any more. It used to require
        // `.includes('fetch')`, which only matches Chrome's "Failed to fetch" – Safari
        // throws `TypeError: Load failed` and Firefox "NetworkError when attempting to
        // fetch resource". On Safari every offline request therefore fell through to the
        // generic re-throw below: no "Verbindung verloren" toast, and GETs threw instead of
        // degrading softly, so ~85 read call sites silently changed contract per browser.
        // Any TypeError out of `fetch()` is a network-layer failure; that is the check.
        //
        // AbortError is the request timeout below – also a network failure, also retryable.
        const isTimeout = error instanceof DOMException && error.name === 'TimeoutError'
        if (error instanceof TypeError || isTimeout) {
          if (retryCount < maxRetries) {
            const delay = this.getBackoffDelay(retryCount)
            await this.sleep(delay)
            continue // Retry
          }

          // Final network error
          if (!skipToast) {
            toast.error(translateOutsideReact('errors.api.connectionTitle'), {
              description: translateOutsideReact('errors.api.connectionDescription'),
            })
          }
          if (isGetRequest) {
            // Reads degrade softly: polling callers treat undefined as "no
            // fresh data" and keep showing the last known state.
            return undefined as T
          }
          // Mutations must fail loudly so the caller's catch (rollback,
          // toast, refresh) runs – otherwise the optimistic UI state keeps
          // claiming a write succeeded that was never sent.
          throw new NetworkError()
        }

        // Re-throw other errors (like our API errors)
        throw error
      }
    }

    // Should not reach here, but just in case
    if (lastError) {
      throw lastError
    }
    throw new Error(translateOutsideReact('errors.api.unknown'))
  }

  // Audit Logs
  async getAuditLogs(params?: {
    resource_type?: string
    resource_id?: string
    user_id?: string
    action_type?: string
    start_date?: string
    end_date?: string
    limit?: number
    offset?: number
  }): Promise<ApiAuditLog[]> {
    const queryParams = new URLSearchParams()

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          queryParams.append(key, value.toString())
        }
      })
    }

    const endpoint = `/api/audit${queryParams.toString() ? `?${queryParams.toString()}` : ''}`
    return this.request<ApiAuditLog[]>(endpoint)
  }

  async getResourceHistory(resourceType: string, resourceId: string): Promise<ApiAuditLog[]> {
    return this.request<ApiAuditLog[]>(`/api/audit/resource/${resourceType}/${resourceId}`)
  }

  // Settings
  async getAllSettings(): Promise<Record<string, string>> {
    return this.request<Record<string, string>>('/api/settings/')
  }

  async getSetting(key: string): Promise<{ key: string; value: string }> {
    return this.request<{ key: string; value: string }>(`/api/settings/${key}`)
  }

  async updateSetting(key: string, value: string): Promise<{ key: string; value: string }> {
    return this.request<{ key: string; value: string }>(`/api/settings/${key}`, {
      method: 'PATCH',
      body: JSON.stringify({ value }),
    })
  }

  /**
   * Reveal the alarm-webhook secret (admin only, rate-limited, and written to the
   * audit trail as a `read` – the value never is). Deliberately NOT part of
   * `getAllSettings()`: credential-valued keys are masked there and refused by
   * `GET /api/settings/{key}`, so this is the only way to see it.
   *
   * Resolves to `undefined` when the request never reached the backend: `request()`
   * lets a failed GET degrade softly so polling callers keep their last known state
   * (see the network-error branch above), and `skipToast` means it does so without a
   * word. That is right for a poll and wrong for a button, so the type says it out
   * loud – the caller has to decide what "no answer" looks like. HTTP failures
   * (401/403/404) still reject with an `ApiError` carrying the backend's detail.
   */
  async getAlarmWebhookSecret(): Promise<ApiAlarmWebhookSecret | undefined> {
    return this.request<ApiAlarmWebhookSecret | undefined>('/api/settings/alarm-webhook-secret', {
      skipToast: true,
    })
  }

  /**
   * Generate a new secret. Rejects with a 409 `ApiError` when `source` is `env`
   * – the caller shows that message, it names the file to edit.
   *
   * Unlike the GET above this never resolves to nothing on a dead connection:
   * `request()` throws `NetworkError` for mutations, precisely so a write that
   * was never sent cannot be mistaken for one that succeeded.
   */
  async rotateAlarmWebhookSecret(): Promise<ApiAlarmWebhookSecret> {
    return this.request<ApiAlarmWebhookSecret>('/api/settings/alarm-webhook-secret/rotate', {
      method: 'POST',
      skipToast: true,
    })
  }

  /**
   * URL of the station logo used on printed exports – an <img src>, not a fetch:
   * the backend answers with image bytes, and 404 (no logo set) is a normal answer
   * the <img> reports through onError rather than an exception nobody asked for.
   *
   * The cache-buster is what makes a replaced logo visible immediately; the browser
   * would otherwise keep showing the old one from the in-memory image cache.
   */
  getReportLogoUrl(cacheBuster?: string | number): string {
    const suffix = cacheBuster === undefined ? '' : `?v=${cacheBuster}`
    return `${this.getBaseUrl()}/api/settings/branding/logo${suffix}`
  }

  async uploadReportLogo(file: File): Promise<{ size: number }> {
    const formData = new FormData()
    formData.append('file', file)
    const response = await fetch(this.getReportLogoUrl(), {
      method: 'PUT',
      credentials: 'include',
      body: formData,
      signal: AbortSignal.timeout(60000),
    })
    if (!response.ok) {
      const detail = await response.json().catch(() => null)
      throw new Error(detail?.detail || `Upload fehlgeschlagen (${response.status})`)
    }
    return response.json()
  }

  async deleteReportLogo(): Promise<void> {
    await this.request<void>('/api/settings/branding/logo', { method: 'DELETE' })
  }

  // Event endpoints
  async getEvents(includeArchived: boolean = false): Promise<ApiEventListResponse> {
    const params = new URLSearchParams()
    if (includeArchived) {
      params.append('include_archived', 'true')
    }
    const endpoint = `/api/events/${params.toString() ? `?${params.toString()}` : ''}`
    return this.request<ApiEventListResponse>(endpoint)
  }

  async getEvent(eventId: string, options?: { skipToast?: boolean }): Promise<ApiEvent> {
    return this.request<ApiEvent>(`/api/events/${eventId}`, options)
  }

  /**
   * The Restliste (§6, V-8): what is still open in this Ereignis.
   *
   * Three counts, each carrying the incidents behind it – the count is only the
   * way in, because nobody clicks twenty-three cards individually.
   */
  async getEventRestliste(eventId: string): Promise<ApiEventRestliste> {
    return this.request<ApiEventRestliste>(`/api/events/${eventId}/restliste`)
  }

  async createEvent(data: ApiEventCreate): Promise<ApiEvent> {
    return this.request<ApiEvent>('/api/events/', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async updateEvent(eventId: string, data: ApiEventUpdate): Promise<ApiEvent> {
    return this.request<ApiEvent>(`/api/events/${eventId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  async archiveEvent(eventId: string): Promise<ApiEvent> {
    return this.request<ApiEvent>(`/api/events/${eventId}/archive`, {
      method: 'POST',
    })
  }

  async unarchiveEvent(eventId: string): Promise<ApiEvent> {
    return this.request<ApiEvent>(`/api/events/${eventId}/unarchive`, {
      method: 'POST',
    })
  }

  async deleteEvent(eventId: string): Promise<void> {
    return this.request<void>(`/api/events/${eventId}`, {
      method: 'DELETE',
    })
  }

  // Special Functions (event-scoped)
  async getEventSpecialFunctions(eventId: string): Promise<ApiEventSpecialFunctionResponse[]> {
    return this.request<ApiEventSpecialFunctionResponse[]>(`/api/events/${eventId}/special-functions/`)
  }

  async getPersonnelSpecialFunctions(eventId: string, personnelId: string): Promise<ApiEventSpecialFunctionResponse[]> {
    return this.request<ApiEventSpecialFunctionResponse[]>(`/api/events/${eventId}/special-functions/personnel/${personnelId}`)
  }

  async assignSpecialFunction(eventId: string, data: ApiEventSpecialFunctionCreate): Promise<ApiEventSpecialFunctionResponse> {
    return this.request<ApiEventSpecialFunctionResponse>(`/api/events/${eventId}/special-functions/`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async unassignSpecialFunction(eventId: string, data: ApiEventSpecialFunctionDelete): Promise<void> {
    return this.request<void>(`/api/events/${eventId}/special-functions/`, {
      method: 'DELETE',
      body: JSON.stringify(data),
    })
  }

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
    return this.request<ApiIncident[]>(endpoint)
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
    const incidents = await this.request<ApiIncident[]>(
      `/api/incidents/?${queryParams.toString()}`,
      {
        onHeaders: (headers) => {
          const raw = headers.get('X-Total-Count')
          const parsed = raw === null ? Number.NaN : Number(raw)
          total = Number.isFinite(parsed) ? parsed : null
        },
      },
    )
    return { incidents: incidents ?? [], total }
  }

  async getIncident(id: string): Promise<ApiIncident> {
    return this.request<ApiIncident>(`/api/incidents/${id}`)
  }

  async createIncident(data: ApiIncidentCreate): Promise<ApiIncident> {
    return this.request<ApiIncident>('/api/incidents/', {
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

    return this.request<ApiIncident>(`/api/incidents/${id}${queryParams}`, {
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
    await this.request<void>('/api/incidents/reorder', {
      method: 'POST',
      body: JSON.stringify({ event_id: eventId, ordered_ids: orderedIds }),
    })
  }

  // --- Aufträge (incident groups) – ordered multi-stop routes over incidents ---

  /** List the Aufträge of an event, each with `stop_ids` + derived `progress`. */
  async getIncidentGroups(eventId: string): Promise<ApiIncidentGroup[]> {
    return this.request<ApiIncidentGroup[]>(
      `/api/incident-groups/?event_id=${encodeURIComponent(eventId)}`
    )
  }

  async createIncidentGroup(data: ApiIncidentGroupCreate): Promise<ApiIncidentGroup> {
    return this.request<ApiIncidentGroup>('/api/incident-groups/', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async updateIncidentGroup(id: string, data: ApiIncidentGroupUpdate): Promise<ApiIncidentGroup> {
    return this.request<ApiIncidentGroup>(`/api/incident-groups/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    })
  }

  /** Soft-delete an Auftrag; its stops stay on the board, ungrouped (204). */
  async deleteIncidentGroup(id: string): Promise<void> {
    return this.request<void>(`/api/incident-groups/${id}`, {
      method: 'DELETE',
    })
  }

  /** Persist the order of the Aufträge within an event (204 No Content). */
  async reorderIncidentGroups(eventId: string, orderedIds: string[]): Promise<void> {
    await this.request<void>('/api/incident-groups/reorder', {
      method: 'POST',
      body: JSON.stringify({ event_id: eventId, ordered_ids: orderedIds }),
    })
  }

  // --- Standard-Aufträge (Auftrag templates) – station config, not event data ---

  /** List the station's Standard-Aufträge in settings order (any signed-in user). */
  async getAuftragTemplates(): Promise<ApiAuftragTemplate[]> {
    return this.request<ApiAuftragTemplate[]>('/api/auftrag-templates/')
  }

  async createAuftragTemplate(data: ApiAuftragTemplateCreate): Promise<ApiAuftragTemplate> {
    return this.request<ApiAuftragTemplate>('/api/auftrag-templates/', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async updateAuftragTemplate(
    id: string,
    data: ApiAuftragTemplateUpdate
  ): Promise<ApiAuftragTemplate> {
    return this.request<ApiAuftragTemplate>(`/api/auftrag-templates/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    })
  }

  /** Delete a Standard-Auftrag. Aufträge already created from it stay put (204). */
  async deleteAuftragTemplate(id: string): Promise<void> {
    return this.request<void>(`/api/auftrag-templates/${id}`, { method: 'DELETE' })
  }

  /** Persist the settings list order of the Standard-Aufträge (204 No Content). */
  async reorderAuftragTemplates(templateIds: string[]): Promise<void> {
    await this.request<void>('/api/auftrag-templates/reorder', {
      method: 'POST',
      body: JSON.stringify({ template_ids: templateIds }),
    })
  }

  /** Persist the order of the stops within one Auftrag (204 No Content). */
  async reorderGroupStops(groupId: string, orderedIds: string[]): Promise<void> {
    await this.request<void>(`/api/incident-groups/${groupId}/stops/reorder`, {
      method: 'POST',
      body: JSON.stringify({ ordered_ids: orderedIds }),
    })
  }

  /** Attach existing incidents to an Auftrag as stops (appended to the end). */
  async addStopsToGroup(groupId: string, incidentIds: string[]): Promise<ApiIncidentGroup> {
    return this.request<ApiIncidentGroup>(`/api/incident-groups/${groupId}/stops`, {
      method: 'POST',
      body: JSON.stringify({ incident_ids: incidentIds }),
    })
  }

  /** Remember the Funkdurchsage just made for an Auftrag, so the next stop of the
   *  same route gets the short continuation instead of the whole thing again. */
  async recordGroupAnnouncement(groupId: string, data: ApiGroupAnnouncement): Promise<ApiIncidentGroup> {
    return this.request<ApiIncidentGroup>(`/api/incident-groups/${groupId}/announce`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  /** Detach a stop from its Auftrag (leaves the incident on the board) (204). */
  async removeStopFromGroup(groupId: string, incidentId: string): Promise<void> {
    return this.request<void>(`/api/incident-groups/${groupId}/stops/${incidentId}`, {
      method: 'DELETE',
    })
  }

  // --- Route-owned resources (Auftrag assignments) ---------------------------

  /** List the active resources owned by a route. */
  async getGroupAssignments(groupId: string): Promise<ApiGroupAssignment[]> {
    return this.request<ApiGroupAssignment[]>(`/api/incident-groups/${groupId}/assignments`)
  }

  /** Attach a resource to a route (409 on duplicate). */
  async assignGroupResource(groupId: string, data: ApiGroupAssignmentCreate): Promise<ApiGroupAssignment> {
    return this.request<ApiGroupAssignment>(`/api/incident-groups/${groupId}/assign`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  /** Release a route-owned resource (204 No Content). */
  async unassignGroupResource(groupId: string, assignmentId: string): Promise<void> {
    return this.request<void>(`/api/incident-groups/${groupId}/unassign/${assignmentId}`, {
      method: 'POST',
    })
  }

  async updateIncidentStatus(
    id: string,
    fromStatus: IncidentStatus,
    toStatus: IncidentStatus,
    notes?: string
  ): Promise<ApiIncident> {
    return this.request<ApiIncident>(`/api/incidents/${id}/status`, {
      method: 'POST',
      body: JSON.stringify({
        from_status: fromStatus,
        to_status: toStatus,
        notes,
      }),
    })
  }

  async getIncidentStatusHistory(id: string): Promise<ApiStatusTransition[]> {
    return this.request<ApiStatusTransition[]>(`/api/incidents/${id}/history`)
  }

  async getIncidentTimeline(id: string): Promise<ApiIncidentTimelineResponse> {
    return this.request<ApiIncidentTimelineResponse>(`/api/incidents/${id}/timeline`)
  }

  async deleteIncident(id: string): Promise<void> {
    return this.request<void>(`/api/incidents/${id}`, {
      method: 'DELETE',
    })
  }

  async restoreIncident(id: string): Promise<ApiIncident> {
    return this.request<ApiIncident>(`/api/incidents/${id}/restore`, {
      method: 'POST',
    })
  }

  async transferAssignments(
    sourceIncidentId: string,
    targetIncidentId: string
  ): Promise<ApiTransferAssignmentsResponse> {
    return this.request<ApiTransferAssignmentsResponse>(
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
    return this.request<ApiAssignment>(
      `/api/incidents/${incidentId}/assignments/${assignmentId}`,
      {
        method: 'PATCH',
        body: JSON.stringify(data),
      }
    )
  }

  /** Promote a route-owned assignment to Einsatzleiter (demotes the previous one). */
  async updateGroupAssignment(
    groupId: string,
    assignmentId: string,
    data: { is_leader?: boolean }
  ): Promise<ApiGroupAssignment> {
    return this.request<ApiGroupAssignment>(
      `/api/incident-groups/${groupId}/assignments/${assignmentId}`,
      {
        method: 'PATCH',
        body: JSON.stringify(data),
      }
    )
  }

  /**
   * Everyone and everything that was on this incident, including resources
   * already released. Completing an incident empties its crew list, so this is
   * the only thing that still answers "who was there" afterwards.
   */
  async getIncidentParticipants(id: string): Promise<ApiIncidentParticipantsResponse> {
    return this.request<ApiIncidentParticipantsResponse>(`/api/incidents/${id}/participants`)
  }

  // Resource Management - Personnel
  async getAllPersonnel(params?: { checked_in_only?: boolean; event_id?: string }): Promise<ApiPersonnel[]> {
    const queryParams = new URLSearchParams()
    if (params?.checked_in_only) {
      queryParams.append('checked_in_only', 'true')
    }
    if (params?.event_id) {
      queryParams.append('event_id', params.event_id)
    }
    const query = queryParams.toString() ? `?${queryParams.toString()}` : ''
    return this.request<ApiPersonnel[]>(`/api/personnel/${query}`)
  }

  async getPersonnelById(id: string): Promise<ApiPersonnel> {
    return this.request<ApiPersonnel>(`/api/personnel/${id}`)
  }

  async createPersonnel(data: ApiPersonnelCreate): Promise<ApiPersonnel> {
    return this.request<ApiPersonnel>('/api/personnel/', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async updatePersonnel(id: string, data: ApiPersonnelUpdate): Promise<ApiPersonnel> {
    return this.request<ApiPersonnel>(`/api/personnel/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  async deletePersonnel(id: string): Promise<void> {
    return this.request<void>(`/api/personnel/${id}`, {
      method: 'DELETE',
    })
  }

  async updatePersonnelCategorySortOrder(data: BulkCategorySortOrderUpdate): Promise<{ status: string; updated_categories: number }> {
    return this.request<{ status: string; updated_categories: number }>('/api/personnel/categories/sort-order', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  // Resource Management - Vehicles
  async getVehicles(): Promise<ApiVehicle[]> {
    return this.request<ApiVehicle[]>('/api/vehicles/')
  }

  async getVehicleById(id: string): Promise<ApiVehicle> {
    return this.request<ApiVehicle>(`/api/vehicles/${id}`)
  }

  async createVehicle(data: ApiVehicleCreate): Promise<ApiVehicle> {
    return this.request<ApiVehicle>('/api/vehicles/', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async updateVehicle(id: string, data: ApiVehicleUpdate): Promise<ApiVehicle> {
    return this.request<ApiVehicle>(`/api/vehicles/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  async deleteVehicle(id: string): Promise<void> {
    return this.request<void>(`/api/vehicles/${id}`, {
      method: 'DELETE',
    })
  }

  async getVehicleStatus(vehicleId: string, eventId: string): Promise<{
    id: string
    name: string
    type: string
    status: string
    radio_call_sign: string
    driver_id: string | null
    driver_name: string | null
    driver_assigned_at: string | null
    incident_id: string | null
    incident_title: string | null
    incident_location_address: string | null
    /** Server-computed short label for the deployment (home city stripped,
     *  falls back to the incident title). Null when the vehicle is idle. */
    incident_location_display?: string | null
    incident_status: string | null
    incident_assigned_at: string | null
    assignment_duration_minutes: number | null
  }> {
    return this.request(`/api/vehicles/${vehicleId}/status?event_id=${encodeURIComponent(eventId)}`)
  }

  // Resource Management - Materials
  async getAllMaterials(): Promise<ApiMaterialResource[]> {
    return this.request<ApiMaterialResource[]>('/api/materials/')
  }

  async getMaterialById(id: string): Promise<ApiMaterialResource> {
    return this.request<ApiMaterialResource>(`/api/materials/${id}`)
  }

  async createMaterialResource(data: ApiMaterialCreate): Promise<ApiMaterialResource> {
    return this.request<ApiMaterialResource>('/api/materials/', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async updateMaterialResource(id: string, data: ApiMaterialUpdate): Promise<ApiMaterialResource> {
    return this.request<ApiMaterialResource>(`/api/materials/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  async deleteMaterialResource(id: string): Promise<void> {
    return this.request<void>(`/api/materials/${id}`, {
      method: 'DELETE',
    })
  }

  async updateMaterialCategorySortOrder(data: BulkCategorySortOrderUpdate): Promise<{ status: string; updated_categories: number }> {
    return this.request<{ status: string; updated_categories: number }>('/api/materials/categories/sort-order', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  // Material Groups
  async getMaterialGroups(): Promise<ApiMaterialGroup[]> {
    return this.request<ApiMaterialGroup[]>('/api/material-groups/')
  }

  async createMaterialGroup(data: { name: string; description?: string; location?: string; location_sort_order?: number; material_ids?: string[] }): Promise<ApiMaterialGroup> {
    return this.request<ApiMaterialGroup>('/api/material-groups/', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async updateMaterialGroup(id: string, data: { name?: string; description?: string; location?: string; location_sort_order?: number; material_ids?: string[] }): Promise<ApiMaterialGroup> {
    return this.request<ApiMaterialGroup>(`/api/material-groups/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  async deleteMaterialGroup(id: string): Promise<void> {
    return this.request<void>(`/api/material-groups/${id}`, {
      method: 'DELETE',
    })
  }

  // Assignments
  async assignResource(incidentId: string, data: ApiAssignmentCreate): Promise<ApiAssignment> {
    return this.request<ApiAssignment>(`/api/incidents/${incidentId}/assign`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async unassignResource(incidentId: string, assignmentId: string): Promise<void> {
    return this.request<void>(`/api/incidents/${incidentId}/unassign/${assignmentId}`, {
      method: 'POST',
    })
  }

  async getIncidentAssignments(incidentId: string): Promise<ApiAssignment[]> {
    return this.request<ApiAssignment[]>(`/api/incidents/${incidentId}/assignments`)
  }

  /**
   * Get all assignments for all incidents in an event (bulk endpoint).
   * Optimizes performance by fetching all assignments in one request instead of N requests.
   *
   * @param eventId - Event ID
   * @returns Dictionary mapping incident_id to array of assignments
   */
  async getAssignmentsByEvent(eventId: string): Promise<Record<string, ApiAssignment[]>> {
    return this.request<Record<string, ApiAssignment[]>>(`/api/assignments/by-event/${eventId}`)
  }

  async releaseAllResources(incidentId: string): Promise<void> {
    return this.request<void>(`/api/incidents/${incidentId}/release-all`, {
      method: 'POST',
    })
  }

  // Personnel Check-In
  async generateCheckInLink(eventId: string): Promise<{ token: string; link: string; full_url: string; qr_code_data: string }> {
    return this.request<{ token: string; link: string; full_url: string; qr_code_data: string }>(`/api/personnel/check-in/generate-link?event_id=${encodeURIComponent(eventId)}`, {
      method: 'POST',
    })
  }

  async getCheckInList(token: string, checkedInOnly: boolean = false): Promise<{ personnel: ApiPersonnelListItem[]; event_id: string; event_name: string }> {
    return this.request<{ personnel: ApiPersonnelListItem[]; event_id: string; event_name: string }>(
      `/api/personnel/check-in/list?token=${encodeURIComponent(token)}&checked_in_only=${checkedInOnly}`
    )
  }

  async checkInPersonnel(personnelId: string, token: string): Promise<ApiPersonnel> {
    return this.request<ApiPersonnel>(
      `/api/personnel/check-in/${personnelId}/in?token=${encodeURIComponent(token)}`,
      {
        method: 'POST',
      }
    )
  }

  async checkOutPersonnel(personnelId: string, token: string): Promise<ApiPersonnel> {
    return this.request<ApiPersonnel>(
      `/api/personnel/check-in/${personnelId}/out?token=${encodeURIComponent(token)}`,
      {
        method: 'POST',
      }
    )
  }

  // --- The same three routes through the board's door -----------------------
  // Same endpoints, same rows; the difference is that these carry the editor's
  // cookie and name the Ereignis explicitly, because only the token knows it
  // otherwise. Kept as separate methods rather than an optional argument so a
  // call site cannot accidentally send neither (which the backend refuses).

  /** Roll-call list for the board: the whole roster, including unavailable people. */
  async getEventCheckInList(eventId: string): Promise<{ personnel: ApiPersonnelListItem[]; event_id: string; event_name: string }> {
    return this.request<{ personnel: ApiPersonnelListItem[]; event_id: string; event_name: string }>(
      `/api/personnel/check-in/list?event_id=${encodeURIComponent(eventId)}&include_unavailable=true`
    )
  }

  async checkInPersonnelForEvent(personnelId: string, eventId: string): Promise<ApiPersonnel> {
    return this.request<ApiPersonnel>(
      `/api/personnel/check-in/${personnelId}/in?event_id=${encodeURIComponent(eventId)}`,
      { method: 'POST' }
    )
  }

  async checkOutPersonnelForEvent(personnelId: string, eventId: string): Promise<ApiPersonnel> {
    return this.request<ApiPersonnel>(
      `/api/personnel/check-in/${personnelId}/out?event_id=${encodeURIComponent(eventId)}`,
      { method: 'POST' }
    )
  }

  /**
   * Back to «nicht anwesend» – removes the attendance row entirely. Board only;
   * this is a correction of the record, not something a crew reports about itself.
   */
  async clearPersonnelAttendance(personnelId: string, eventId: string): Promise<ApiPersonnel> {
    return this.request<ApiPersonnel>(
      `/api/personnel/check-in/${personnelId}?event_id=${encodeURIComponent(eventId)}`,
      { method: 'DELETE' }
    )
  }

  /** "Alle abmelden" – everyone still present goes to `gegangen`. Board only. */
  async checkOutAllPersonnel(eventId: string): Promise<ApiPersonnel[]> {
    return this.request<ApiPersonnel[]>(
      `/api/personnel/check-in/event/${encodeURIComponent(eventId)}/out-all`,
      { method: 'POST' }
    )
  }

  async getCheckInStats(token: string): Promise<ApiCheckInStats> {
    return this.request<ApiCheckInStats>(
      `/api/personnel/check-in/stats?token=${encodeURIComponent(token)}`
    )
  }

  async getEventCheckInStats(eventId: string): Promise<ApiCheckInStats> {
    return this.request<ApiCheckInStats>(
      `/api/personnel/check-in/stats?event_id=${encodeURIComponent(eventId)}`
    )
  }

  /**
   * Get attendance for an event (all personnel with their check-in status)
   * This is an alias for getAllPersonnel with event filtering
   */
  async getEventAttendance(eventId: string): Promise<ApiPersonnel[]> {
    return this.getAllPersonnel({ event_id: eventId })
  }

  // Reko Forms
  // `dashboardToken` authorizes the call from the public reko-dashboard page
  // (field phones without a login); the board UI relies on cookie auth instead.
  async generateRekoLink(incidentId: string, personnelId?: string, dashboardToken?: string): Promise<{ incident_id: string; token: string; link: string; personnel_id?: string; qr_code_url: string }> {
    let url = `/api/reko/generate-link?incident_id=${encodeURIComponent(incidentId)}`
    if (personnelId) {
      url += `&personnel_id=${encodeURIComponent(personnelId)}`
    }
    if (dashboardToken) {
      url += `&dashboard_token=${encodeURIComponent(dashboardToken)}`
    }
    return this.request<{ incident_id: string; token: string; link: string; personnel_id?: string; qr_code_url: string }>(
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

    return this.request<ApiRekoFormResponse>(`/api/reko/form?${params.toString()}`)
  }

  async saveRekoDraft(incidentId: string, token: string, data: ApiRekoReportCreate): Promise<ApiRekoReportResponse> {
    return this.request<ApiRekoReportResponse>(`/api/reko/?submit=false`, {
      method: 'POST',
      body: JSON.stringify({ ...data, incident_id: incidentId, token }),
    })
  }

  async submitRekoReport(incidentId: string, token: string, data: ApiRekoReportCreate): Promise<ApiRekoReportResponse> {
    return this.request<ApiRekoReportResponse>(`/api/reko/?submit=true`, {
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
    return this.request<ApiRekoReportResponse>(`/api/reko/?submit=${submit ? 'true' : 'false'}`, {
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
    return this.request<ApiRekoReportResponse>(
      `/api/reko/${reportId}?submit=${options?.submit ? 'true' : 'false'}`,
      {
        method: 'PATCH',
        body: JSON.stringify(data),
        headers: options?.token ? { 'X-Reko-Token': options.token } : undefined,
      },
    )
  }

  /** "Reko meldet: vor Ort" as the KP hears it. Omit `arrivedAt` for "now",
   *  pass a time for a message logged late, pass `null` to clear a mis-hear. */
  async setRekoArrived(incidentId: string, arrivedAt?: string | null): Promise<ApiRekoArrivedState> {
    return this.request<ApiRekoArrivedState>(`/api/incidents/${incidentId}/reko-arrived`, {
      method: 'POST',
      body: JSON.stringify(arrivedAt === undefined ? {} : { arrived_at: arrivedAt }),
    })
  }

  async uploadRekoPhoto(incidentId: string, token: string, file: File): Promise<{ filename: string }> {
    return this.uploadPhotoFile<{ filename: string }>(`/api/reko/${incidentId}/photos`, file, {
      'X-Reko-Token': token,
    })
  }

  /** The board's door onto the same upload – the WhatsApp-photo case. No token:
   *  the session identifies the operator. `reportId` when amending an existing
   *  report, omitted while creating one (the photo then lands in the draft the
   *  save submits). */
  async uploadRekoPhotoAsEditor(
    incidentId: string,
    file: File,
    reportId?: string,
  ): Promise<{ filename: string }> {
    const query = reportId ? `?report_id=${encodeURIComponent(reportId)}` : ''
    return this.uploadPhotoFile<{ filename: string }>(`/api/reko/${incidentId}/photos${query}`, file)
  }

  /**
   * The multipart photo POST, shared by every photo door.
   *
   * `request()` is JSON-only, and a phone photo needs its own timeout and its
   * own error unwrapping (file size, quota, invalid type all come back as a
   * German `detail` the user has to see). One copy of that, not one per door.
   */
  private async uploadPhotoFile<T>(path: string, file: File, headers: Record<string, string> = {}): Promise<T> {
    const formData = new FormData()
    formData.append('file', file)

    const url = `${this.getBaseUrl()}${path}`

    // Create AbortController for timeout
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 60000) // 60 second timeout for large files

    try {
      const response = await fetch(url, {
        method: 'POST',
        credentials: 'include',  // Include auth cookies
        headers,
        body: formData,
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        // Parse backend error message for specific errors (file size, quota, invalid type)
        let errorMessage = translateOutsideReact('errors.api.photoUploadFailed')
        try {
          const errorData = await response.json()
          if (errorData.detail) {
            errorMessage = typeof errorData.detail === 'string' ? errorData.detail : JSON.stringify(errorData.detail)
          }
        } catch {
          // Ignore JSON parse errors
        }
        throw new Error(errorMessage)
      }

      return response.json()
    } catch (error) {
      clearTimeout(timeoutId)
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(translateOutsideReact('errors.api.uploadTimeout'))
      }
      throw error
    }
  }

  async deleteRekoPhoto(incidentId: string, token: string, filename: string): Promise<void> {
    await this.request(`/api/reko/${incidentId}/photos/${filename}`, {
      method: 'DELETE',
      headers: { 'X-Reko-Token': token },
    })
  }

  /** Board door, see `uploadRekoPhotoAsEditor`. */
  async deleteRekoPhotoAsEditor(incidentId: string, filename: string, reportId?: string): Promise<void> {
    const query = reportId ? `?report_id=${encodeURIComponent(reportId)}` : ''
    await this.request(`/api/reko/${incidentId}/photos/${filename}${query}`, { method: 'DELETE' })
  }

  async getIncidentRekoReports(incidentId: string): Promise<ApiRekoReportResponse[]> {
    return this.request<ApiRekoReportResponse[]>(`/api/reko/incident/${incidentId}/reports`)
  }

  async markRekoArrived(incidentId: string, token: string): Promise<ApiRekoReportResponse> {
    return this.request<ApiRekoReportResponse>(
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
    return this.request<ApiEventRekoSummariesResponse>(`/api/reko/event/${eventId}/summaries`)
  }

  // Sync version check (lightweight polling optimization)
  async getSyncVersion(eventId: string): Promise<{ version: string }> {
    return this.request<{ version: string }>(`/api/incidents/sync-version?event_id=${encodeURIComponent(eventId)}`)
  }

  // Excel Import/Export
  async downloadImportTemplate(): Promise<Blob> {
    const url = `${this.getBaseUrl()}/api/admin/import/template`
    const response = await fetch(url, {
      credentials: 'include',
    })

    if (!response.ok) {
      throw new Error(`Failed to download template: ${response.statusText}`)
    }

    return response.blob()
  }

  /** The mode is not cosmetic here: the preview reports what the chosen mode would
   *  DELETE, so previewing 'replace' and importing 'append' (or the reverse) shows the
   *  operator the wrong number. Pass the mode the UI has selected. */
  async previewExcelImport(file: File, mode: ExcelImportMode = 'replace'): Promise<ApiExcelImportPreview> {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('mode', mode)

    const url = `${this.getBaseUrl()}/api/admin/import/preview`
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Preview failed: ${errorText}`)
    }

    return response.json()
  }

  /** `mode` is required on the wire – the backend refuses a request without it rather
   *  than defaulting to the destructive one. The default here only keeps the call sites
   *  compiling; it is always sent. */
  async executeExcelImport(file: File, mode: ExcelImportMode = 'replace'): Promise<ApiExcelImportResult> {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('mode', mode)

    const url = `${this.getBaseUrl()}/api/admin/import/execute`
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Import failed: ${errorText}`)
    }

    return response.json()
  }

  async exportAllData(): Promise<Blob> {
    const url = `${this.getBaseUrl()}/api/admin/export/data`
    const response = await fetch(url, {
      credentials: 'include',
    })

    if (!response.ok) {
      throw new Error(`Export failed: ${response.statusText}`)
    }

    return response.blob()
  }

  // Event Audit Export (for payment processing)
  async exportEventAudit(eventId: string): Promise<Blob> {
    const url = `${this.getBaseUrl()}/api/exports/events/${eventId}/audit`
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
    })

    if (!response.ok) {
      throw new Error(`Audit export failed: ${response.statusText}`)
    }

    return response.blob()
  }

  // Event After-Action Report (PDF)
  async exportEventReport(eventId: string): Promise<Blob> {
    const url = `${this.getBaseUrl()}/api/exports/events/${eventId}/report`
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'include',
    })

    if (!response.ok) {
      throw new Error(`Report export failed: ${response.statusText}`)
    }

    return response.blob()
  }

  // Einsätze – one wide row per Schadenplatz (XLSX, plan 25 §7). Somebody
  // still retypes it into the billing system by hand; it just does not need
  // that name on it.
  async exportEventEinsaetze(eventId: string): Promise<Blob> {
    const url = `${this.getBaseUrl()}/api/exports/events/${eventId}/einsaetze.xlsx`
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'include',
    })

    if (!response.ok) {
      throw new Error(`Einsaetze export failed: ${response.statusText}`)
    }

    return response.blob()
  }

  // Lageblatt – paper-fallback board snapshot (PDF, Führungsformular layout)
  async exportEventLageblatt(eventId: string): Promise<Blob> {
    const url = `${this.getBaseUrl()}/api/exports/events/${eventId}/lageblatt`
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'include',
    })

    if (!response.ok) {
      throw new Error(`Lageblatt export failed: ${response.statusText}`)
    }

    return response.blob()
  }

  // Event Stats
  async getEventStats(eventId: string): Promise<ApiEventStats> {
    return this.request<ApiEventStats>(`/api/events/${eventId}/stats`)
  }

  // Training Automation
  async generateTrainingEmergency(
    eventId: string,
    request: { category?: 'normal' | 'critical' | null; count?: number; source?: 'operator' | 'intake' }
  ): Promise<ApiIncident[]> {
    return this.request<ApiIncident[]>(`/api/training/events/${eventId}/generate/`, {
      method: 'POST',
      body: JSON.stringify(request),
    })
  }

  async getEmergencyTemplates(category?: string): Promise<ApiEmergencyTemplate[]> {
    const params = category ? `?category=${encodeURIComponent(category)}` : ''
    return this.request<ApiEmergencyTemplate[]>(`/api/training/templates/${params}`)
  }

  async getTrainingLocations(): Promise<ApiTrainingLocation[]> {
    return this.request<ApiTrainingLocation[]>('/api/training/locations/')
  }

  async manualDispatch(
    eventId: string,
    templateId: string,
    location:
      | { kind: 'seeded'; locationId: string }
      | { kind: 'pin'; latitude: number; longitude: number; address: string },
  ): Promise<ApiIncident> {
    const body: Record<string, unknown> = { template_id: templateId }
    if (location.kind === 'seeded') {
      body.location_id = location.locationId
    } else {
      body.latitude = location.latitude
      body.longitude = location.longitude
      body.address = location.address
    }
    return this.request<ApiIncident>(`/api/training/events/${eventId}/dispatch/`, {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  async simulateCheckin(
    eventId: string,
    count: number,
    overMinutes: number = 0
  ): Promise<{
    checked_in: string[]
    total_checked_in: number
    total_available: number
    scheduled?: string[]
    trickle_minutes?: number
  }> {
    return this.request(`/api/training/events/${eventId}/simulate/checkin`, {
      method: 'POST',
      body: JSON.stringify({ count, over_minutes: overMinutes }),
    })
  }

  /** Inject a simulated Divera alarm into the pool (training intake exercise).
   *
   * No caller since 2026-07-28 – the Übungssteuerung buttons were removed while
   * the recipient model is unresolved. Endpoint and generator still exist, so
   * restoring the UI is a small change once that model lands.
   */
  async simulateDiveraAlarm(
    eventId: string,
    category?: 'normal' | 'critical' | null
  ): Promise<ApiDiveraEmergency> {
    return this.request<ApiDiveraEmergency>(`/api/training/events/${eventId}/simulate/divera`, {
      method: 'POST',
      body: JSON.stringify({ category: category ?? null }),
    })
  }

  /** Inject "Lage verschärft sich": priority up + Lagemeldung + critical bell. */
  async simulateEscalation(eventId: string, incidentId: string): Promise<ApiIncident> {
    return this.request<ApiIncident>(`/api/training/events/${eventId}/simulate/escalate/${incidentId}`, {
      method: 'POST',
    })
  }

  /** Inject "Feld fordert Verstärkung": bell notification only. */
  async simulateReinforcement(eventId: string, incidentId: string): Promise<{ message: string }> {
    return this.request<{ message: string }>(
      `/api/training/events/${eventId}/simulate/reinforcement/${incidentId}`,
      { method: 'POST' }
    )
  }

  /** Inject "Fahrzeug fällt aus": random assigned vehicle becomes unavailable. */
  async simulateVehicleBreakdown(
    eventId: string,
    incidentId: string
  ): Promise<{ vehicle_name: string; message: string }> {
    return this.request<{ vehicle_name: string; message: string }>(
      `/api/training/events/${eventId}/simulate/vehicle-breakdown/${incidentId}`,
      { method: 'POST' }
    )
  }

  async simulateReko(
    eventId: string,
    incidentId: string
  ): Promise<ApiRekoReportResponse> {
    return this.request<ApiRekoReportResponse>(`/api/training/events/${eventId}/simulate/reko/${incidentId}`, {
      method: 'POST',
    })
  }

  /** Mark the Reko crew as "vor Ort" (arrived) without submitting a report –
   *  the first of the two Reko conductor steps. */
  async simulateRekoArrived(
    eventId: string,
    incidentId: string
  ): Promise<ApiIncident> {
    return this.request<ApiIncident>(`/api/training/events/${eventId}/simulate/reko-arrived/${incidentId}`, {
      method: 'POST',
    })
  }

  // GPS drive simulation (Übungssteuerung) – simulated positions feed the same
  // pipeline as real Traccar data (map, distances, arrival/return prompts).
  async getGpsSimulations(): Promise<ApiGpsSimDrive[]> {
    return this.request<ApiGpsSimDrive[]>('/api/training/gps-sim/')
  }

  async startGpsSimulation(body: {
    vehicle_id: string
    target: 'incident' | 'magazin'
    incident_id?: string
    speed_kmh?: number
  }): Promise<ApiGpsSimDrive> {
    return this.request<ApiGpsSimDrive>('/api/training/gps-sim/start', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  async setGpsSimulationSpeed(vehicleId: string, speedKmh: number): Promise<ApiGpsSimDrive> {
    return this.request<ApiGpsSimDrive>('/api/training/gps-sim/speed', {
      method: 'POST',
      body: JSON.stringify({ vehicle_id: vehicleId, speed_kmh: speedKmh }),
    })
  }

  async stopGpsSimulation(vehicleId?: string): Promise<{ stopped: number }> {
    return this.request<{ stopped: number }>('/api/training/gps-sim/stop', {
      method: 'POST',
      body: JSON.stringify({ vehicle_id: vehicleId ?? null }),
    })
  }

  /** Field crew reports the incident finished ("Einsatz beendet") – sets an
   *  informational badge for the operator; does NOT change status.
   *
   *  `pickupNeeded` is the follow-up the field gets ("Kommt ihr selbst
   *  zurück?"): omit it and the backend preselects it from the situation – a
   *  crew that walked there or whose vehicle drove on is usually stranded. */
  async simulateFieldComplete(
    eventId: string,
    incidentId: string,
    options?: { pickupNeeded?: boolean; pickupNote?: string }
  ): Promise<ApiIncident> {
    return this.request<ApiIncident>(`/api/training/events/${eventId}/simulate/field-complete/${incidentId}`, {
      method: 'POST',
      body: JSON.stringify({
        pickup_needed: options?.pickupNeeded ?? null,
        pickup_note: options?.pickupNote ?? null,
      }),
    })
  }

  /** Inject "Rapport eingetroffen": one filled and submitted Schadenplatz-Rapport. */
  async simulateRapport(eventId: string, incidentId: string): Promise<ApiSimulatedRapport> {
    return this.request<ApiSimulatedRapport>(
      `/api/training/events/${eventId}/simulate/rapport/${incidentId}`,
      { method: 'POST' }
    )
  }

  /** Inject "Rapporte eingetroffen": 80 % of the missing ones arrive at once.
   *  The remaining fifth stays missing on purpose – those gaps are the
   *  Restliste, and finding them is the exercise. */
  async simulateRapportsBulk(eventId: string): Promise<ApiSimulatedRapportBulk> {
    return this.request<ApiSimulatedRapportBulk>(`/api/training/events/${eventId}/simulate/rapport`, {
      method: 'POST',
    })
  }

  /** Inject "Meldung vom Feld": a chip or a typed sentence reaches the KP. */
  async simulateFieldMessage(eventId: string, incidentId: string): Promise<{ message: string }> {
    return this.request<{ message: string }>(
      `/api/training/events/${eventId}/simulate/field-message/${incidentId}`,
      { method: 'POST' }
    )
  }

  /** Inject "Angekommen": the crew reports it is on the Schadenplatz. Stamps
   *  `arrived_at` on the Schadenplatz-Rapport through the same CRUD the `/feld`
   *  button uses. A second call never moves an arrival that is already
   *  reported – the message says so instead. */
  async simulateFieldArrived(eventId: string, incidentId: string): Promise<{ message: string }> {
    return this.request<{ message: string }>(
      `/api/training/events/${eventId}/simulate/arrived/${incidentId}`,
      { method: 'POST' }
    )
  }

  /** Inject "Abholung nötig" / "Abholung erledigt" on its own – the crew that
   *  asks for a lift an hour after "Einsatz beendet", or reports the bus has
   *  been. Omit `note` and the backend derives one from the situation. */
  async simulatePickup(
    eventId: string,
    incidentId: string,
    options?: { needed?: boolean; note?: string }
  ): Promise<{ message: string }> {
    return this.request<{ message: string }>(
      `/api/training/events/${eventId}/simulate/pickup/${incidentId}`,
      {
        method: 'POST',
        body: JSON.stringify({ needed: options?.needed ?? true, note: options?.note ?? null }),
      }
    )
  }

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
    return this.request<ApiDiveraEmergencyListResponse>(endpoint)
  }

  async getDiveraEmergency(emergencyId: string): Promise<ApiDiveraEmergency> {
    return this.request<ApiDiveraEmergency>(`/api/divera/emergencies/${emergencyId}`)
  }

  async attachEmergencyToEvent(emergencyId: string, eventId: string): Promise<ApiIncident> {
    return this.request<ApiIncident>(`/api/divera/emergencies/${emergencyId}/attach`, {
      method: 'POST',
      body: JSON.stringify({ event_id: eventId }),
    })
  }

  async bulkAttachEmergencies(
    emergencyIds: string[],
    eventId: string,
  ): Promise<{ created: ApiIncident[]; errors: string[] }> {
    return this.request<{ created: ApiIncident[]; errors: string[] }>('/api/divera/emergencies/bulk-attach', {
      method: 'POST',
      body: JSON.stringify({
        emergency_ids: emergencyIds,
        event_id: eventId,
      }),
    })
  }

  async archiveDiveraEmergency(emergencyId: string): Promise<void> {
    return this.request<void>(`/api/divera/emergencies/${emergencyId}`, {
      method: 'DELETE',
    })
  }

  async getDiveraSyncPreview(): Promise<ApiDiveraSyncPreview> {
    return this.request<ApiDiveraSyncPreview>('/api/divera/personnel-sync/preview')
  }

  async executeDiveraSync(options: { remove_stale: boolean }): Promise<ApiDiveraSyncResult> {
    return this.request<ApiDiveraSyncResult>('/api/divera/personnel-sync/execute', {
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
    return this.request<ApiDiveraAlarmResult>(`/api/divera/incidents/${incidentId}/alarm`, {
      method: 'POST',
      body: JSON.stringify(options),
    })
  }

  /** List Divera members (id + name) – for picking a test-alarm recipient. */
  async getDiveraMembers(): Promise<ApiDiveraMemberPreview[]> {
    return this.request<ApiDiveraMemberPreview[]>('/api/divera/members')
  }

  /** Send a setup test alarm (push only) directly to a Divera member. */
  async sendDiveraTestAlarm(diveraUserId: number, name?: string): Promise<ApiDiveraAlarmResult> {
    return this.request<ApiDiveraAlarmResult>('/api/divera/test-alarm', {
      method: 'POST',
      body: JSON.stringify({ divera_user_id: diveraUserId, name }),
    })
  }

  /** The unit's Divera groups – the recipient choices for a Mitteilung. */
  async getDiveraGroups(): Promise<ApiDiveraGroup[]> {
    return this.request<ApiDiveraGroup[]>('/api/divera/groups')
  }

  /**
   * Post an informational Divera Mitteilung (not an alarm) – the checklist's
   * standby message. Recipients are explicit: named groups, or a deliberate
   * `target: 'all'`.
   */
  async sendDiveraMessage(options: SendDiveraMessageOptions): Promise<ApiDiveraMessageResult> {
    return this.request<ApiDiveraMessageResult>('/api/divera/message', {
      method: 'POST',
      body: JSON.stringify(options),
    })
  }

  /** Divera polling/connection status – for the Verbindung indicator. */
  async getDiveraPollingStatus(): Promise<ApiDiveraPollingStatus> {
    return this.request<ApiDiveraPollingStatus>('/api/divera/polling/status')
  }

  /** Provider capability registry – which integrations are configured, per domain. */
  async getIntegrations(): Promise<ApiIntegrations> {
    return this.request<ApiIntegrations>('/api/integrations')
  }

  // Sync endpoints
  async getSyncStatus(): Promise<SyncStatusResponse> {
    return this.request<SyncStatusResponse>('/api/sync/status')
  }

  async getSyncHistory(limit?: number): Promise<SyncHistoryEntry[]> {
    const params = limit ? `?limit=${limit}` : ''
    return this.request<SyncHistoryEntry[]>(`/api/sync/history${params}`)
  }

  async getSyncConfig(): Promise<SyncConfig> {
    // Admin-only endpoint, but also probed by the user menu for every user –
    // suppress the generic error toast and let callers handle 401/403.
    return this.request<SyncConfig>('/api/sync/config', { skipToast: true })
  }

  async updateSyncConfig(config: SyncConfig): Promise<SyncConfig> {
    return this.request<SyncConfig>('/api/sync/config', {
      method: 'PUT',
      body: JSON.stringify(config),
    })
  }

  async triggerSyncFromRailway(): Promise<SyncResult> {
    return this.request<SyncResult>('/api/sync/from-railway', {
      method: 'POST',
    })
  }

  async triggerSyncToRailway(): Promise<SyncResult> {
    return this.request<SyncResult>('/api/sync/to-railway', {
      method: 'POST',
    })
  }

  async triggerImmediateSync(): Promise<SyncResult> {
    return this.request<SyncResult>('/api/sync/trigger-immediate', {
      method: 'POST',
    })
  }

  // Traccar GPS Tracking
  async getTraccarStatus(): Promise<ApiTraccarStatus> {
    return this.request<ApiTraccarStatus>('/api/traccar/status')
  }

  async getVehiclePositions(): Promise<ApiVehiclePosition[]> {
    return this.request<ApiVehiclePosition[]>('/api/traccar/positions', {
      skipToast: true,
    })
  }

  async getVehicleTrails(minutes: number = 30): Promise<ApiVehicleTrail[]> {
    return this.request<ApiVehicleTrail[]>(`/api/traccar/trails?minutes=${minutes}`, {
      skipToast: true,
    })
  }

  // Reko Dashboard
  async generateRekoDashboardLink(eventId: string): Promise<{ token: string; link: string; full_url: string; qr_code_data: string }> {
    return this.request<{ token: string; link: string; full_url: string; qr_code_data: string }>(
      `/api/reko-dashboard/generate-link?event_id=${encodeURIComponent(eventId)}`,
      {
        method: 'POST',
      }
    )
  }

  async getRekoDashboardPersonnel(token: string): Promise<ApiRekoDashboardPersonnelListResponse> {
    return this.request<ApiRekoDashboardPersonnelListResponse>(
      `/api/reko-dashboard/personnel?token=${encodeURIComponent(token)}`
    )
  }

  async getRekoDashboardAssignments(personnelId: string, token: string): Promise<ApiRekoDashboardAssignmentsResponse> {
    return this.request<ApiRekoDashboardAssignmentsResponse>(
      `/api/reko-dashboard/assignments/${personnelId}?token=${encodeURIComponent(token)}`
    )
  }

  // Feld (/feld) – the login-less field surface. One global link per Ereignis.
  //
  // Since plan 26 the link alone opens nothing: it is exchanged for an unlocked
  // token via the Feld-Code (`unlockFeld`), and that for a person-bound one when
  // somebody names themselves (`claimFeldPerson`). The phone stores the bound
  // token and stops using the link.
  async generateFeldLink(eventId: string): Promise<{ token: string; link: string; full_url: string; qr_code_data: string }> {
    return this.request<{ token: string; link: string; full_url: string; qr_code_data: string }>(
      `/api/feld/generate-link?event_id=${encodeURIComponent(eventId)}`,
      {
        method: 'POST',
      }
    )
  }

  /** The Feld-Code, and how many devices redeemed it. Editor only. */
  async getFeldAccess(eventId: string): Promise<ApiFeldAccessState> {
    return this.request<ApiFeldAccessState>(`/api/feld/access?event_id=${encodeURIComponent(eventId)}`)
  }

  /** A new code. Logs nobody out — see `revokeFeldDevices` for that. */
  async regenerateFeldCode(eventId: string): Promise<ApiFeldAccessState> {
    return this.request<ApiFeldAccessState>(
      `/api/feld/access/regenerate?event_id=${encodeURIComponent(eventId)}`,
      { method: 'POST' }
    )
  }

  /** The emergency brake: every bound device for this Ereignis is logged out. */
  async revokeFeldDevices(eventId: string): Promise<ApiFeldAccessState> {
    return this.request<ApiFeldAccessState>(
      `/api/feld/access/revoke-devices?event_id=${encodeURIComponent(eventId)}`,
      { method: 'POST' }
    )
  }

  /** Step 2 of the door: the code buys an unlocked token *and* the picker.
   *
   *  `skipToast` because a wrong code is not an error to be announced — it is
   *  the expected answer to a typo, and the page already turns the field red.
   *  A toast on top of that shouts "Fehler" across a phone screen for a
   *  mistyped digit, and does it again on every retry. */
  async unlockFeld(token: string, code: string): Promise<ApiFeldUnlockResponse> {
    return this.request<ApiFeldUnlockResponse>(`/api/feld/unlock?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      body: JSON.stringify({ code }),
      skipToast: true,
    })
  }

  /** Step 3: this device is that person from now on. */
  async claimFeldPerson(token: string, personnelId: string): Promise<ApiFeldClaimResponse> {
    return this.request<ApiFeldClaimResponse>(`/api/feld/claim?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      body: JSON.stringify({ personnel_id: personnelId }),
    })
  }

  /**
   * «Neue Meldung» — a Schadenplatz reported by somebody standing in front of it.
   *
   * `take_over` is the crew saying they will do it now; the response says which
   * of the three shapes that took (a stop on their Auftrag, a new Auftrag, or
   * just them), so the confirmation can be specific instead of "gespeichert".
   */
  async createFeldIncident(
    personnelId: string,
    token: string,
    payload: ApiFeldIncidentCreate,
  ): Promise<ApiFeldIncidentCreated> {
    return this.request<ApiFeldIncidentCreated>(
      `/api/feld/incidents?token=${encodeURIComponent(token)}&personnel_id=${personnelId}`,
      { method: 'POST', body: JSON.stringify(payload) },
    )
  }

  /**
   * Check yourself in or out of the Ereignis from the field (decision 10).
   *
   * The individual half of `/check-in`, which stays a page for the shared
   * tablet at the door. Same attendance row either way — one roll call.
   */
  async setFeldAttendance(personnelId: string, token: string, present: boolean): Promise<void> {
    await this.request<unknown>(
      `/api/feld/attendance/${personnelId}?token=${encodeURIComponent(token)}&present=${present}`,
      { method: 'POST' },
    )
  }

  /** A short-lived form token so the Reko form can mount inside `/feld`. */
  async mintFeldRekoLink(
    incidentId: string,
    personnelId: string,
    token: string
  ): Promise<{ incident_id: string; token: string; link: string }> {
    return this.request<{ incident_id: string; token: string; link: string }>(
      this.feldQuery(incidentId, 'reko-link', personnelId, token),
      { method: 'POST' }
    )
  }

  async getFeldPersonnel(token: string): Promise<ApiFeldPersonnelListResponse> {
    return this.request<ApiFeldPersonnelListResponse>(
      `/api/feld/personnel?token=${encodeURIComponent(token)}`
    )
  }

  async getFeldAssignments(personnelId: string, token: string): Promise<ApiFeldAssignmentsResponse> {
    return this.request<ApiFeldAssignmentsResponse>(
      `/api/feld/assignments/${personnelId}?token=${encodeURIComponent(token)}`
    )
  }

  // The four field actions. Every one is token + assignment gated server-side;
  // none of them writes an assignment, which is what keeps /feld out of the
  // board's conflict model.
  private feldQuery(incidentId: string, action: string, personnelId: string, token: string): string {
    return (
      `/api/feld/incidents/${incidentId}/${action}` +
      `?token=${encodeURIComponent(token)}&personnel_id=${encodeURIComponent(personnelId)}`
    )
  }

  /** "Angekommen". Idempotent – a second tap does not move the timestamp. */
  async feldReportArrived(incidentId: string, personnelId: string, token: string): Promise<ApiFieldReportState> {
    return this.request<ApiFieldReportState>(this.feldQuery(incidentId, 'arrived', personnelId, token), {
      method: 'POST',
    })
  }

  /** "Einsatz beendet". Does NOT close the card – that stays the KP's call. */
  async feldReportComplete(incidentId: string, personnelId: string, token: string): Promise<ApiFieldReportState> {
    return this.request<ApiFieldReportState>(this.feldQuery(incidentId, 'complete', personnelId, token), {
      method: 'POST',
    })
  }

  /** "Abholung nötig" / "abgeholt" – also the answer to the beendet follow-up. */
  async feldReportPickup(
    incidentId: string,
    personnelId: string,
    token: string,
    needed: boolean,
    note?: string | null
  ): Promise<ApiFieldReportState> {
    return this.request<ApiFieldReportState>(this.feldQuery(incidentId, 'pickup', personnelId, token), {
      method: 'POST',
      body: JSON.stringify({ needed, note: note ?? null }),
    })
  }

  /** Freitext-Meldung an den KP – a chip or a typed sentence. */
  async feldSendMessage(incidentId: string, personnelId: string, token: string, message: string): Promise<void> {
    await this.request<void>(this.feldQuery(incidentId, 'message', personnelId, token), {
      method: 'POST',
      body: JSON.stringify({ message }),
    })
  }

  /** The KP twin (decision 28): the same three reports, dictated over the radio. */
  async setIncidentFieldReport(incidentId: string, update: ApiFieldReportUpdate): Promise<ApiFieldReportState> {
    return this.request<ApiFieldReportState>(`/api/incidents/${incidentId}/field-report`, {
      method: 'POST',
      body: JSON.stringify(update),
    })
  }

  // The Schadenplatz-Rapport, from both doors. Same CRUD module underneath, so
  // the four calls below are two pairs of the same thing with a different
  // identity – which is exactly what lets one form component mount twice.

  /** The Rapport as the crew sees it. Prefilled when nothing has been filed yet. */
  async getFeldRapport(incidentId: string, personnelId: string, token: string): Promise<ApiSchadenplatzRapport> {
    return this.request<ApiSchadenplatzRapport>(this.feldQuery(incidentId, 'rapport', personnelId, token))
  }

  /** Autosave (`is_draft: true`) or file it (`false`). */
  async saveFeldRapport(
    incidentId: string,
    personnelId: string,
    token: string,
    update: ApiRapportUpdate
  ): Promise<ApiSchadenplatzRapport> {
    return this.request<ApiSchadenplatzRapport>(this.feldQuery(incidentId, 'rapport', personnelId, token), {
      method: 'PUT',
      body: JSON.stringify(update),
    })
  }

  /** The same Rapport from the board – the radio-message case. */
  async getIncidentRapport(incidentId: string): Promise<ApiSchadenplatzRapport> {
    return this.request<ApiSchadenplatzRapport>(`/api/incidents/${incidentId}/rapport`)
  }

  async saveIncidentRapport(incidentId: string, update: ApiRapportUpdate): Promise<ApiSchadenplatzRapport> {
    return this.request<ApiSchadenplatzRapport>(`/api/incidents/${incidentId}/rapport`, {
      method: 'PUT',
      body: JSON.stringify(update),
    })
  }

  // Rapport photos, from both doors (§6.1). The crew photographs the cellar; the
  // KP attaches the photo that arrived by WhatsApp. Same storage, same files –
  // but a feld token never opens the Reko photo endpoints and vice versa.

  async uploadFeldPhoto(
    incidentId: string,
    personnelId: string,
    token: string,
    file: File
  ): Promise<ApiRapportPhotosResponse> {
    return this.uploadPhotoFile<ApiRapportPhotosResponse>(
      this.feldQuery(incidentId, 'photos', personnelId, token),
      file
    )
  }

  async deleteFeldPhoto(
    incidentId: string,
    personnelId: string,
    token: string,
    filename: string
  ): Promise<ApiRapportPhotosResponse> {
    return this.request<ApiRapportPhotosResponse>(
      this.feldQuery(incidentId, `photos/${encodeURIComponent(filename)}`, personnelId, token),
      { method: 'DELETE' }
    )
  }

  /**
   * The `<img src>` for a rapport photo on `/feld` – an absolute URL, because it
   * goes into markup rather than through `request()`.
   *
   * The board's `GET /api/photos/...` needs a session cookie and `/feld` has
   * none, so it answered every field photo with a 401. This is the same
   * two-step (event token + assigned personnel) as every other feld call.
   */
  feldPhotoUrl(incidentId: string, personnelId: string, token: string, filename: string): string {
    return (
      this.getBaseUrl() +
      this.feldQuery(incidentId, `photos/${encodeURIComponent(filename)}`, personnelId, token)
    )
  }

  async uploadRapportPhoto(incidentId: string, file: File): Promise<ApiRapportPhotosResponse> {
    return this.uploadPhotoFile<ApiRapportPhotosResponse>(`/api/incidents/${incidentId}/rapport/photos`, file)
  }

  async deleteRapportPhoto(incidentId: string, filename: string): Promise<ApiRapportPhotosResponse> {
    return this.request<ApiRapportPhotosResponse>(
      `/api/incidents/${incidentId}/rapport/photos/${encodeURIComponent(filename)}`,
      { method: 'DELETE' }
    )
  }

  /**
   * "Material zurück – freigeben" (decision 17): what the board MAY release.
   *
   * A read. The releasing itself goes through `unassignResource`, one unit at a
   * time – a field form must not silently write assignments, and the decision
   * stays with the operator.
   */
  async getRapportMaterialReturn(
    incidentId: string,
    options: { includeDraft?: boolean } = {},
  ): Promise<ApiMaterialReturnResponse> {
    // `includeDraft` is the completion gate's flag and nobody else's (§18.23):
    // that dialog only PREFILLS and the operator still confirms, while this
    // endpoint's other caller releases assignments on one click and must not
    // reach a half-typed checklist by accident. Server-side default is strict.
    const query = options.includeDraft ? '?include_draft=true' : ''
    return this.request<ApiMaterialReturnResponse>(`/api/incidents/${incidentId}/rapport/material-return${query}`)
  }

  async getAvailableRekoPersonnel(incidentId: string): Promise<ApiAvailableRekoPersonnelResponse> {
    return this.request<ApiAvailableRekoPersonnelResponse>(
      `/api/reko-dashboard/incidents/${incidentId}/available-reko`
    )
  }

  async assignRekoPersonnel(incidentId: string, personnelId: string): Promise<ApiAssignment> {
    return this.request<ApiAssignment>(
      `/api/reko-dashboard/incidents/${incidentId}/assign-reko`,
      {
        method: 'POST',
        body: JSON.stringify({ personnel_id: personnelId }),
      }
    )
  }

  async unassignRekoPersonnel(incidentId: string, personnelId: string): Promise<void> {
    return this.request<void>(
      `/api/reko-dashboard/incidents/${incidentId}/unassign-reko/${personnelId}`,
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
    return this.request<{ transferred_count: number; incident_ids: string[] }>(
      `/api/reko-dashboard/transfer-rekos?from_personnel_id=${encodeURIComponent(fromPersonnelId)}&to_personnel_id=${encodeURIComponent(toPersonnelId)}&event_id=${encodeURIComponent(eventId)}`,
      {
        method: 'POST',
      }
    )
  }

  // Viewer (read-only access)
  async generateViewerLink(eventId: string): Promise<{ token: string; link: string; full_url: string; qr_code_data: string }> {
    return this.request<{ token: string; link: string; full_url: string; qr_code_data: string }>(
      `/api/viewer/generate-link?event_id=${encodeURIComponent(eventId)}`,
      {
        method: 'POST',
      }
    )
  }

  async getViewerData(token: string): Promise<ApiViewerData> {
    return this.request<ApiViewerData>(
      `/api/viewer/data?token=${encodeURIComponent(token)}`
    )
  }

  // Alarm intake (public token-gated alarm creation)
  async generateAlarmLink(eventId: string): Promise<{ token: string; link: string; full_url: string; qr_code_data: string }> {
    return this.request<{ token: string; link: string; full_url: string; qr_code_data: string }>(
      `/api/intake/generate-link?event_id=${encodeURIComponent(eventId)}`,
      {
        method: 'POST',
      }
    )
  }

  async getIntakeContext(token: string): Promise<{ event: { id: string; name: string; training_flag: boolean } }> {
    return this.request<{ event: { id: string; name: string; training_flag: boolean } }>(
      `/api/intake/context?token=${encodeURIComponent(token)}`,
      { skipToast: true }
    )
  }

  async createIntakeAlarm(token: string, data: {
    title: string
    type: IncidentType
    priority: IncidentPriority
    location_address?: string | null
    location_lat?: string | null
    location_lng?: string | null
    description?: string | null
    contact?: string | null
    contact_phone?: string | null
  }): Promise<{ id: string }> {
    return this.request<{ id: string }>(
      `/api/intake/alarm?token=${encodeURIComponent(token)}`,
      {
        method: 'POST',
        body: JSON.stringify(data),
        skipToast: true,
      }
    )
  }

  // Print Jobs (Thermal Printer)
  async getPrinterStatus(): Promise<ApiPrinterStatus> {
    return this.request<ApiPrinterStatus>('/api/print/status/')
  }

  async queueAssignmentPrint(incidentId: string): Promise<ApiPrintJob> {
    return this.request<ApiPrintJob>(`/api/print/assignment/${incidentId}/`, {
      method: 'POST',
    })
  }

  async queueBoardPrint(eventId: string, options?: {
    include_incidents?: boolean
    include_completed?: boolean
    include_vehicles?: boolean
    include_personnel?: boolean
  }): Promise<ApiPrintJob> {
    return this.request<ApiPrintJob>('/api/print/board/', {
      method: 'POST',
      body: JSON.stringify({ event_id: eventId, ...options }),
    })
  }

  /**
   * The Abholliste (decision 25): the material half of the Restliste on paper.
   *
   * The existing print-job path on purpose – it is a driving list, not a fourth
   * document format.
   */
  async queueAbhollistePrint(eventId: string): Promise<ApiPrintJob> {
    return this.request<ApiPrintJob>(`/api/print/abholliste/${eventId}/`, { method: 'POST' })
  }

  async queueTestPrint(): Promise<ApiPrintJob> {
    return this.request<ApiPrintJob>('/api/print/test/', {
      method: 'POST',
    })
  }

  async queueQRCodePrint(payload: ApiQRCodePrintRequest): Promise<ApiPrintJob> {
    return this.request<ApiPrintJob>('/api/print/qr-code/', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  }

  async getPrintJob(jobId: string): Promise<ApiPrintJob> {
    return this.request<ApiPrintJob>(`/api/print/jobs/${jobId}/`)
  }

  async getPendingPrintJobs(): Promise<ApiPrintJob[]> {
    return this.request<ApiPrintJob[]>('/api/print/jobs/pending/')
  }

  async deletePrintJob(jobId: string): Promise<void> {
    return this.request<void>(`/api/print/jobs/${jobId}/`, {
      method: 'DELETE',
    })
  }

  // User Management (Admin only)
  async getUsers(): Promise<ApiUser[]> {
    return this.request<ApiUser[]>('/api/users/')
  }

  async getUser(userId: string): Promise<ApiUser> {
    return this.request<ApiUser>(`/api/users/${userId}`)
  }

  async createUser(user: ApiUserCreate): Promise<ApiUser> {
    return this.request<ApiUser>('/api/users/', {
      method: 'POST',
      body: JSON.stringify(user),
    })
  }

  async updateUser(userId: string, user: ApiUserUpdate): Promise<ApiUser> {
    return this.request<ApiUser>(`/api/users/${userId}`, {
      method: 'PUT',
      body: JSON.stringify(user),
    })
  }

  async resetUserPassword(userId: string, newPassword: string): Promise<void> {
    return this.request<void>(`/api/users/${userId}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ new_password: newPassword }),
    })
  }

  async deleteUser(userId: string, permanent: boolean = false): Promise<void> {
    const url = permanent ? `/api/users/${userId}?permanent=true` : `/api/users/${userId}`
    return this.request<void>(url, {
      method: 'DELETE',
    })
  }

  /**
   * What this deployment is allowed to do to the outside world.
   *
   * Public, and read at runtime rather than baked in at build time: the same image runs in
   * production and on staging, so the role can only come from the server it is talking to.
   * Returns null when the backend cannot be reached – the caller then assumes production,
   * which changes nothing on screen.
   */
  async getDeployment(): Promise<ApiDeployment | null> {
    try {
      return await this.request<ApiDeployment>('/api/deployment', { skipToast: true })
    } catch {
      return null
    }
  }

  // Demo Mode
  async getDemoStatus(): Promise<DemoStatus | null> {
    try {
      const result = await this.request<DemoStatus>('/api/demo/status', { skipToast: true })
      return result.demo ? result : null
    } catch {
      return null
    }
  }

  async createDemoSandbox(): Promise<{ event_id: string; name: string; reused: boolean }> {
    return this.request<{ event_id: string; name: string; reused: boolean }>('/api/demo/sandbox', {
      method: 'POST',
      skipToast: true,
    })
  }
}

// User Management Types
export interface ApiUser {
  id: string
  username: string
  role: 'admin' | 'editor' | 'viewer'
  display_name: string
  is_active: boolean
  created_at: string
  last_login: string | null
}

export interface ApiUserCreate {
  username: string
  password: string
  role: 'admin' | 'editor' | 'viewer'
  display_name?: string
}

export interface ApiUserUpdate {
  username?: string
  role?: 'admin' | 'editor' | 'viewer'
  display_name?: string
  is_active?: boolean
}

// Print Job Types
export interface ApiPrinterStatus {
  enabled: boolean
  ip: string
  port: number
  auto_anfahrt: boolean
  pending_jobs: number
  last_job_at: string | null
  last_error: string | null
  agent_online: boolean
  agent_last_seen: string | null
}

export interface ApiQRCodePrintRequest {
  qr_content: string
  title: string
  subtitle?: string
  event_id?: string
}

export interface ApiPrintJob {
  id: string
  job_type: 'assignment' | 'board' | 'test' | 'qr_code'
  status: 'pending' | 'printing' | 'completed' | 'failed'
  payload: Record<string, unknown>
  incident_id?: string
  event_id?: string
  created_at: string
  claimed_at?: string
  completed_at?: string
  error_message?: string
  retry_count: number
}

// Demo Mode Types
export interface DemoStatus {
  demo: boolean
  next_reset: string | null
  seconds_until_reset: number
  reset_interval_hours: number
}

// Create API client instance
// URL resolution is now done dynamically per-request via getBaseUrl()
export const apiClient = new ApiClient()
