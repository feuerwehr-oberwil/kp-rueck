/**
 * API Client for KP Rück Backend
 * Handles all HTTP requests to the FastAPI backend
 */

import { getApiUrl } from './env'
import { toast } from '@/hooks/use-toast'
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
  type ApiStatusTransition,
  type ApiIncidentTimelineResponse,
  type ApiRekoReportCreate,
  type ApiRekoReportResponse,
  type ApiRekoFormResponse,
  type ApiEventRekoSummariesResponse,
  type ApiExcelImportPreview,
  type ApiExcelImportResult,
  type ApiEmergencyTemplate,
  type ApiTrainingLocation,
  type ApiDiveraEmergency,
  type ApiDiveraEmergencyListResponse,
  type ApiDiveraSyncPreview,
  type ApiDiveraSyncResult,
  type ApiDiveraAlarmResult,
  type ApiDiveraMemberPreview,
  type ApiDiveraPollingStatus,
  type SendDiveraAlarmOptions,
  type ApiRekoDashboardPersonnelListResponse,
  type ApiRekoDashboardAssignmentsResponse,
  type ApiAvailableRekoPersonnelResponse,
} from './api/types'

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
  private async request<T>(endpoint: string, options?: RequestInit & { skipToast?: boolean; maxRetries?: number }): Promise<T> {
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
          headers: {
            'Content-Type': 'application/json',
            ...options?.headers,
          },
        })

        if (!response.ok) {
          let errorText = ''
          try {
            errorText = await response.text()
          } catch (e) {
            errorText = 'Keine Fehlerdetails verfügbar'
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
          } catch (e) {
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
          // show "Sitzung abgelaufen" — without this, every mutation after
          // token expiry fails silently and optimistic UI just reverts.
          if (response.status === 401 && typeof window !== 'undefined') {
            window.dispatchEvent(new Event('kp:session-expired'))
          }

          // Don't show toast for 401 Unauthorized - the session-expired event
          // above produces a single, specific message instead
          // Don't show toast for 409 Conflict - let the caller handle it with context-specific message
          if (!skipToast && response.status !== 401 && !isConflict) {
            toast({
              variant: "destructive",
              title: "API Fehler",
              description: errorMessage,
            })
          }
          throw error
        }

        // Handle empty responses (e.g., DELETE operations with 204 No Content)
        const contentType = response.headers.get('content-type')
        if (response.status === 204 || !contentType || contentType.indexOf('application/json') === -1) {
          return undefined as T
        }

        const data = await response.json()
        return data

      } catch (error) {
        lastError = error as Error

        // Network errors are always retryable
        if (error instanceof TypeError && error.message.includes('fetch')) {
          if (retryCount < maxRetries) {
            const delay = this.getBackoffDelay(retryCount)
            await this.sleep(delay)
            continue // Retry
          }

          // Final network error
          if (!skipToast) {
            toast({
              variant: "destructive",
              title: "Verbindungsfehler",
              description: "Keine Verbindung zum Server. Bitte prüfen Sie Ihre Internetverbindung.",
            })
          }
          if (isGetRequest) {
            // Reads degrade softly: polling callers treat undefined as "no
            // fresh data" and keep showing the last known state.
            return undefined as T
          }
          // Mutations must fail loudly so the caller's catch (rollback,
          // toast, refresh) runs — otherwise the optimistic UI state keeps
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
    throw new Error('Unbekannter Fehler')
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
    data: { driver_stay?: boolean }
  ): Promise<ApiAssignment> {
    return this.request<ApiAssignment>(
      `/api/incidents/${incidentId}/assignments/${assignmentId}`,
      {
        method: 'PATCH',
        body: JSON.stringify(data),
      }
    )
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

  async getCheckInStats(token: string): Promise<{ total_available: number; checked_in: number; checked_out: number }> {
    return this.request<{ total_available: number; checked_in: number; checked_out: number }>(
      `/api/personnel/check-in/stats?token=${encodeURIComponent(token)}`
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

  async uploadRekoPhoto(incidentId: string, token: string, file: File): Promise<{ filename: string }> {
    const formData = new FormData()
    formData.append('file', file)

    const url = `${this.getBaseUrl()}/api/reko/${incidentId}/photos`

    // Create AbortController for timeout
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 60000) // 60 second timeout for large files

    try {
      const response = await fetch(url, {
        method: 'POST',
        credentials: 'include',  // Include auth cookies
        headers: {
          'X-Reko-Token': token
        },
        body: formData,
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        // Parse backend error message for specific errors (file size, quota, invalid type)
        let errorMessage = 'Foto-Upload fehlgeschlagen'
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
        throw new Error('Upload-Zeitüberschreitung - bitte erneut versuchen')
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

  async previewExcelImport(file: File): Promise<ApiExcelImportPreview> {
    const formData = new FormData()
    formData.append('file', file)

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

  async executeExcelImport(file: File, mode: 'replace' | 'append' = 'replace'): Promise<ApiExcelImportResult> {
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

  /** Inject a simulated Divera alarm into the pool (training intake exercise). */
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

  /** Mark the Reko crew as "vor Ort" (arrived) without submitting a report —
   *  the first of the two Reko conductor steps. */
  async simulateRekoArrived(
    eventId: string,
    incidentId: string
  ): Promise<ApiIncident> {
    return this.request<ApiIncident>(`/api/training/events/${eventId}/simulate/reko-arrived/${incidentId}`, {
      method: 'POST',
    })
  }

  // GPS drive simulation (Übungssteuerung) — simulated positions feed the same
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

  /** Field crew reports the incident finished ("Einsatz beendet") — sets an
   *  informational badge for the operator; does NOT change status. */
  async simulateFieldComplete(
    eventId: string,
    incidentId: string
  ): Promise<ApiIncident> {
    return this.request<ApiIncident>(`/api/training/events/${eventId}/simulate/field-complete/${incidentId}`, {
      method: 'POST',
    })
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

  /** List Divera members (id + name) — for picking a test-alarm recipient. */
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

  /** Divera polling/connection status — for the Verbindung indicator. */
  async getDiveraPollingStatus(): Promise<ApiDiveraPollingStatus> {
    return this.request<ApiDiveraPollingStatus>('/api/divera/polling/status')
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
    // Admin-only endpoint, but also probed by the user menu for every user —
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

  async getViewerData(token: string): Promise<{
    event: ApiEvent
    incidents: ApiIncident[]
  }> {
    return this.request<{
      event: ApiEvent
      incidents: ApiIncident[]
    }>(
      `/api/viewer/data?token=${encodeURIComponent(token)}`
    )
  }

  // Read-only board data for a logged-in viewer (cookie auth, no link token)
  async getViewerDataAuthenticated(eventId: string): Promise<{
    event: ApiEvent
    incidents: ApiIncident[]
  }> {
    return this.request<{
      event: ApiEvent
      incidents: ApiIncident[]
    }>(
      `/api/viewer/data-authenticated?event_id=${encodeURIComponent(eventId)}`
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
