/**
 * API Client for KP Rück Backend
 * Handles all HTTP requests to the FastAPI backend
 */

import { getApiUrl } from './env'

const API_URL = getApiUrl()

export interface ApiOperation {
  id: number
  location: string
  vehicle: string | null
  incident_type: string
  dispatch_time: string
  crew: string[]
  priority: string
  status: string
  coordinates: number[]
  materials: string[]
  notes: string
  contact: string
  created_at: string
  updated_at: string
}

export interface ApiPerson {
  id: number
  name: string
  role: string
  status: string
  created_at: string
}

export interface ApiMaterial {
  id: number
  name: string
  category: string
  status: string
  created_at: string
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
        throw new Error(`API Error: ${response.status} ${response.statusText} - ${errorText}`)
      }

      const data = await response.json()
      console.log(`[API Success] ${options?.method || 'GET'} ${endpoint}`, data)
      return data
    } catch (error) {
      console.error(`[API Exception] ${options?.method || 'GET'} ${endpoint}:`, error)
      throw error
    }
  }

  // Operations
  async getOperations(): Promise<ApiOperation[]> {
    return this.request<ApiOperation[]>('/api/operations')
  }

  async getOperation(id: number): Promise<ApiOperation> {
    return this.request<ApiOperation>(`/api/operations/${id}`)
  }

  async createOperation(data: Partial<ApiOperation>): Promise<ApiOperation> {
    return this.request<ApiOperation>('/api/operations', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async updateOperation(id: number, data: Partial<ApiOperation>): Promise<ApiOperation> {
    return this.request<ApiOperation>(`/api/operations/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  async deleteOperation(id: number): Promise<void> {
    return this.request<void>(`/api/operations/${id}`, {
      method: 'DELETE',
    })
  }

  // Personnel
  async getPersonnel(): Promise<ApiPerson[]> {
    return this.request<ApiPerson[]>('/api/personnel')
  }

  async getPerson(id: number): Promise<ApiPerson> {
    return this.request<ApiPerson>(`/api/personnel/${id}`)
  }

  async createPerson(data: Partial<ApiPerson>): Promise<ApiPerson> {
    return this.request<ApiPerson>('/api/personnel', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async updatePerson(id: number, data: Partial<ApiPerson>): Promise<ApiPerson> {
    return this.request<ApiPerson>(`/api/personnel/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  // Materials
  async getMaterials(): Promise<ApiMaterial[]> {
    return this.request<ApiMaterial[]>('/api/materials')
  }

  async getMaterial(id: number): Promise<ApiMaterial> {
    return this.request<ApiMaterial>(`/api/materials/${id}`)
  }

  async createMaterial(data: Partial<ApiMaterial>): Promise<ApiMaterial> {
    return this.request<ApiMaterial>('/api/materials', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async updateMaterial(id: number, data: Partial<ApiMaterial>): Promise<ApiMaterial> {
    return this.request<ApiMaterial>(`/api/materials/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
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
}

export const apiClient = new ApiClient(API_URL)
