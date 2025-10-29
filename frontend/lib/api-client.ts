/**
 * API Client for KP Rück Backend
 * Handles all HTTP requests to the FastAPI backend
 */

import { getApiUrl } from './env'
import type { SyncStatusResponse, SyncHistoryEntry, SyncConfig, SyncResult } from '@/types/sync'

const API_URL = getApiUrl()

// Event Management Types
export interface ApiEvent {
  id: string // UUID
  name: string
  training_flag: boolean
  created_at: string
  updated_at: string
  archived_at: string | null
  last_activity_at: string
  incident_count: number
}

export interface ApiEventCreate {
  name: string
  training_flag: boolean
}

export interface ApiEventUpdate {
  name?: string
  training_flag?: boolean
  archived_at?: string | null
}

export interface ApiEventListResponse {
  events: ApiEvent[]
  total: number
}

// Resource Management Types
export interface ApiPersonnel {
  id: string // UUID
  name: string
  role?: string | null // e.g., "Firefighter", "Paramedic", "Driver"
  availability: string // available, assigned, unavailable
  checked_in: boolean
  checked_in_at: string | null
  checked_out_at: string | null
  created_at: string
  updated_at: string
}

export interface ApiPersonnelListItem {
  id: string
  name: string
  role?: string | null
  checked_in: boolean
  is_assigned?: boolean  // Whether assigned to any incident in this event
}

export interface ApiPersonnelCreate {
  name: string
  role?: string | null
  availability: string
}

export interface ApiPersonnelUpdate {
  name?: string
  role?: string | null
  availability?: string
}

export interface ApiVehicle {
  id: string // UUID
  name: string // e.g., "TLF 1", "DLK 2"
  type: string // e.g., "TLF", "DLK", "MTW"
  status: string // available, assigned, planned, maintenance
  created_at: string
  updated_at: string
}

export interface ApiVehicleCreate {
  name: string
  type: string
  status: string
}

export interface ApiVehicleUpdate {
  name?: string
  type?: string
  status?: string
}

export interface ApiMaterialResource {
  id: string // UUID
  name: string
  status: string // available, assigned, planned, maintenance
  location?: string | null
  created_at: string
  updated_at: string
}

export interface ApiMaterialCreate {
  name: string
  status: string
  location?: string | null
}

export interface ApiMaterialUpdate {
  name?: string
  status?: string
  location?: string | null
}

export interface ApiAssignment {
  id: string // UUID
  incident_id: string
  resource_type: string // 'personnel' | 'vehicle' | 'material'
  resource_id: string
  assigned_at: string
  unassigned_at: string | null
  assigned_by: string
}

export interface ApiAssignmentCreate {
  resource_type: string
  resource_id: string
}

export interface ApiAuditLog {
  id: string
  user_id: string | null
  action_type: string
  resource_type: string
  resource_id: string | null
  changes_json: Record<string, any> | null
  timestamp: string
  ip_address: string | null
  user_agent: string | null
}

// Incident Types (new schema)
export type IncidentType =
  | "brandbekaempfung"
  | "elementarereignis"
  | "strassenrettung"
  | "technische_hilfeleistung"
  | "oelwehr"
  | "chemiewehr"
  | "strahlenwehr"
  | "einsatz_bahnanlagen"
  | "bma_unechte_alarme"
  | "dienstleistungen"
  | "diverse_einsaetze"
  | "gerettete_menschen"
  | "gerettete_tiere"

export type IncidentPriority = "low" | "medium" | "high"

export type IncidentStatus =
  | "eingegangen"
  | "reko"
  | "disponiert"
  | "einsatz"
  | "einsatz_beendet"
  | "abschluss"

export interface ApiAssignedVehicle {
  assignment_id: string // UUID
  vehicle_id: string
  name: string
  type: string
  assigned_at: string
}

export interface ApiIncident {
  id: string // UUID
  event_id: string // UUID - reference to parent event
  title: string
  type: IncidentType
  priority: IncidentPriority
  location_address: string | null
  location_lat: string | null  // Decimal as string
  location_lng: string | null  // Decimal as string
  status: IncidentStatus
  description: string | null
  created_at: string
  updated_at: string
  created_by: string | null // UUID
  completed_at: string | null
  status_changed_at: string | null // Timestamp of last status transition
  assigned_vehicles: ApiAssignedVehicle[]
}

export interface ApiIncidentCreate {
  event_id: string // UUID - required for all new incidents
  title: string
  type: IncidentType
  priority: IncidentPriority
  location_address?: string | null
  location_lat?: string | null
  location_lng?: string | null
  status?: IncidentStatus
  description?: string | null
}

export interface ApiIncidentUpdate {
  title?: string
  type?: IncidentType
  priority?: IncidentPriority
  location_address?: string | null
  location_lat?: string | null
  location_lng?: string | null
  status?: IncidentStatus
  description?: string | null
}

export interface ApiStatusTransition {
  id: string
  incident_id: string
  from_status: string
  to_status: string
  timestamp: string
  user_id: string | null
  notes: string | null
}

// Reko Report Types
export interface ApiDangersAssessment {
  fire: boolean
  explosion: boolean
  collapse: boolean
  chemical: boolean
  electrical: boolean
  other_notes: string | null
}

export interface ApiEffortEstimation {
  personnel_count: number | null
  vehicles_needed: string[]
  equipment_needed: string[]
  estimated_duration_hours: number | null
}

export interface ApiRekoReportBase {
  is_relevant: boolean | null
  dangers_json: ApiDangersAssessment | null
  effort_json: ApiEffortEstimation | null
  power_supply: string | null  // 'available' | 'unavailable' | 'emergency_needed'
  summary_text: string | null
  additional_notes: string | null
  is_draft: boolean
}

export interface ApiRekoReportCreate extends ApiRekoReportBase {
  incident_id: string
  token: string
}

export interface ApiRekoReportResponse extends ApiRekoReportBase {
  id: string
  incident_id: string
  incident_title?: string | null
  incident_location?: string | null
  incident_type?: string | null
  incident_description?: string | null
  submitted_at: string
  updated_at: string
  photos_json: string[]
}

export interface ApiRekoFormResponse extends ApiRekoReportResponse {
  // Same as ApiRekoReportResponse, backend returns this on GET /form
}

// Excel Import/Export Types
export interface ApiExcelImportPreview {
  personnel_preview: Array<Record<string, any>>
  personnel_total: number
  vehicles_preview: Array<Record<string, any>>
  vehicles_total: number
  materials_preview: Array<Record<string, any>>
  materials_total: number
}

export interface ApiExcelImportResult {
  success: boolean
  mode: string
  counts: {
    personnel: number
    vehicles: number
    materials: number
  }
  timestamp: string
}

// Training Automation Types
export interface ApiEmergencyTemplate {
  id: string // UUID
  title_pattern: string
  incident_type: string
  category: 'normal' | 'critical'
  message_pattern: string
  created_at: string
  is_active: boolean
}

export interface ApiTrainingLocation {
  id: string // UUID
  street: string
  house_number: string
  postal_code: string
  city: string
  building_type: string | null
  latitude: number | null
  longitude: number | null
  is_active: boolean
}

// Event Stats Types
export interface ApiEventStats {
  status_counts: Record<string, number> // Keys are incident statuses as strings
  personnel_available: number
  personnel_total: number
  avg_duration_minutes: number
  resource_utilization_percent: number
}

class ApiClient {
  private baseUrl: string

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl
  }

  private async request<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`

    console.log(`[API] ${options?.method || 'GET'} ${endpoint}`)

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
        console.error(`[API Error] ${options?.method || 'GET'} ${endpoint}: ${response.status} ${response.statusText}`, errorText)

        // Try to parse as JSON for better error messages
        try {
          const errorJson = JSON.parse(errorText)
          if (errorJson.detail) {
            throw new Error(`API-Fehler: ${errorJson.detail}`)
          }
        } catch (e) {
          // Not JSON, use text error
        }

        throw new Error(`API-Fehler: ${response.status} ${response.statusText} - ${errorText}`)
      }

      // Handle empty responses (e.g., DELETE operations with 204 No Content)
      const contentType = response.headers.get('content-type')
      if (response.status === 204 || !contentType || contentType.indexOf('application/json') === -1) {
        console.log(`[API Success] ${options?.method || 'GET'} ${endpoint} (no content)`)
        return undefined as T
      }

      const data = await response.json()
      console.log(`[API Success] ${options?.method || 'GET'} ${endpoint}`, data)
      return data
    } catch (error) {
      console.error(`[API Exception] ${options?.method || 'GET'} ${endpoint}:`, error)

      // Provide better German error messages for common fetch failures
      if (error instanceof TypeError && error.message.includes('fetch')) {
        throw new Error('Verbindung zum Server fehlgeschlagen. Bitte überprüfen Sie, ob der Server läuft.')
      }

      throw error
    }
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

  async getEvent(eventId: string): Promise<ApiEvent> {
    return this.request<ApiEvent>(`/api/events/${eventId}/`)
  }

  async createEvent(data: ApiEventCreate): Promise<ApiEvent> {
    return this.request<ApiEvent>('/api/events/', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async updateEvent(eventId: string, data: ApiEventUpdate): Promise<ApiEvent> {
    return this.request<ApiEvent>(`/api/events/${eventId}/`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  async archiveEvent(eventId: string): Promise<ApiEvent> {
    return this.request<ApiEvent>(`/api/events/${eventId}/archive/`, {
      method: 'POST',
    })
  }

  async unarchiveEvent(eventId: string): Promise<ApiEvent> {
    return this.request<ApiEvent>(`/api/events/${eventId}/unarchive/`, {
      method: 'POST',
    })
  }

  async deleteEvent(eventId: string): Promise<void> {
    return this.request<void>(`/api/events/${eventId}/`, {
      method: 'DELETE',
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

  async deleteIncident(id: string): Promise<void> {
    return this.request<void>(`/api/incidents/${id}`, {
      method: 'DELETE',
    })
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

  // Reko Forms
  async generateRekoLink(incidentId: string): Promise<{ incident_id: string; token: string; link: string; qr_code_url: string }> {
    return this.request<{ incident_id: string; token: string; link: string; qr_code_url: string }>(
      `/api/reko/generate-link?incident_id=${encodeURIComponent(incidentId)}`, {
        method: 'POST',
      }
    )
  }

  async getRekoForm(incidentId: string, token: string, reportId?: string | null): Promise<ApiRekoFormResponse> {
    const params = new URLSearchParams()
    params.append('incident_id', incidentId)
    params.append('token', token)

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

    const url = `${this.baseUrl}/api/reko/${incidentId}/photos`

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'X-Reko-Token': token
      },
      body: formData,
    })

    if (!response.ok) {
      throw new Error('Photo upload failed')
    }

    return response.json()
  }

  async getIncidentRekoReports(incidentId: string): Promise<ApiRekoReportResponse[]> {
    return this.request<ApiRekoReportResponse[]>(`/api/reko/incident/${incidentId}/reports`)
  }

  // Excel Import/Export
  async downloadImportTemplate(): Promise<Blob> {
    const url = `${this.baseUrl}/api/admin/import/template`
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

    const url = `${this.baseUrl}/api/admin/import/preview`
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

    const url = `${this.baseUrl}/api/admin/import/execute`
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
    const url = `${this.baseUrl}/api/admin/export/data`
    const response = await fetch(url, {
      credentials: 'include',
    })

    if (!response.ok) {
      throw new Error(`Export failed: ${response.statusText}`)
    }

    return response.blob()
  }

  // Event Export
  async exportEvent(eventId: string): Promise<Blob> {
    const url = `${this.baseUrl}/api/exports/events/${eventId}`
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
    })

    if (!response.ok) {
      throw new Error(`Event export failed: ${response.statusText}`)
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
    request: { category?: 'normal' | 'critical' | null; count?: number }
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

  // Sync endpoints
  async getSyncStatus(): Promise<SyncStatusResponse> {
    return this.request<SyncStatusResponse>('/api/sync/status')
  }

  async getSyncHistory(limit?: number): Promise<SyncHistoryEntry[]> {
    const params = limit ? `?limit=${limit}` : ''
    return this.request<SyncHistoryEntry[]>(`/api/sync/history${params}`)
  }

  async getSyncConfig(): Promise<SyncConfig> {
    return this.request<SyncConfig>('/api/sync/config')
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
}

export const apiClient = new ApiClient(API_URL)
