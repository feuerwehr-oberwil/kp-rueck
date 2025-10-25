/**
 * API Client for KP Rück Backend
 * Handles all HTTP requests to the FastAPI backend
 */

import { getApiUrl } from './env'

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
        const errorText = await response.text()
        console.error(`[API Error] ${options?.method || 'GET'} ${endpoint}: ${response.status} ${response.statusText}`, errorText)
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
}

export const apiClient = new ApiClient(API_URL)
