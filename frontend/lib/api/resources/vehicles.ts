/**
 * Vehicles: CRUD, archive and per-event status.
 *
 * One slice of `apiClient` (`lib/api-client.ts` mixes every resource class into
 * the one client object). Methods go through the shared transport in `../http`.
 */

import { request as httpRequest } from '../http'
import type { ApiVehicle, ApiVehicleCreate, ApiVehicleUpdate } from '../types'

export class VehiclesApi {
  // Resource Management - Vehicles
  /** Archived vehicles are excluded unless `includeArchived` — the board must
   *  never see a retired unit, the Fahrzeugverwaltung shows it on request. */
  async getVehicles(options?: { includeArchived?: boolean }): Promise<ApiVehicle[]> {
    const query = options?.includeArchived ? '?include_archived=true' : ''
    return httpRequest<ApiVehicle[]>(`/api/vehicles/${query}`)
  }

  async getVehicleById(id: string): Promise<ApiVehicle> {
    return httpRequest<ApiVehicle>(`/api/vehicles/${id}`)
  }

  async createVehicle(data: ApiVehicleCreate): Promise<ApiVehicle> {
    return httpRequest<ApiVehicle>('/api/vehicles/', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async updateVehicle(id: string, data: ApiVehicleUpdate): Promise<ApiVehicle> {
    return httpRequest<ApiVehicle>(`/api/vehicles/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  /** Take a vehicle out of the fleet, reversibly. Broadcast as a WS `delete`. */
  async archiveVehicle(id: string): Promise<ApiVehicle> {
    return httpRequest<ApiVehicle>(`/api/vehicles/${id}/archive`, {
      method: 'POST',
    })
  }

  /** «Zurückholen» — bring an archived vehicle back. Broadcast as a WS `create`. */
  async restoreVehicle(id: string): Promise<ApiVehicle> {
    return httpRequest<ApiVehicle>(`/api/vehicles/${id}/restore`, {
      method: 'POST',
    })
  }

  /**
   * Archives by default; `permanent` purges the row.
   *
   * The purge is refused with 409 (German `detail` on the ApiError) unless the
   * vehicle is already archived AND never stood on a live, non-training Einsatz
   * — otherwise the evaluation of that Einsatz would grow a hole.
   */
  async deleteVehicle(id: string, options?: { permanent?: boolean }): Promise<void> {
    const query = options?.permanent ? '?permanent=true' : ''
    return httpRequest<void>(`/api/vehicles/${id}${query}`, {
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
    return httpRequest(`/api/vehicles/${vehicleId}/status?event_id=${encodeURIComponent(eventId)}`)
  }
}
