/**
 * Personnel CRUD and attendance (check-in through the token and the board's door).
 *
 * One slice of `apiClient` (`lib/api-client.ts` mixes every resource class into
 * the one client object). Methods go through the shared transport in `../http`.
 */

import { request as httpRequest } from '../http'
import type {
  BulkCategorySortOrderUpdate,
  ApiPersonnel,
  ApiPersonnelListItem,
  ApiCheckInStats,
  ApiPersonnelCreate,
  ApiPersonnelUpdate,
} from '../types'

export class PersonnelApi {
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
    return httpRequest<ApiPersonnel[]>(`/api/personnel/${query}`)
  }

  async getPersonnelById(id: string): Promise<ApiPersonnel> {
    return httpRequest<ApiPersonnel>(`/api/personnel/${id}`)
  }

  async createPersonnel(data: ApiPersonnelCreate): Promise<ApiPersonnel> {
    return httpRequest<ApiPersonnel>('/api/personnel/', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async updatePersonnel(id: string, data: ApiPersonnelUpdate): Promise<ApiPersonnel> {
    return httpRequest<ApiPersonnel>(`/api/personnel/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  async deletePersonnel(id: string): Promise<void> {
    return httpRequest<void>(`/api/personnel/${id}`, {
      method: 'DELETE',
    })
  }

  async updatePersonnelCategorySortOrder(data: BulkCategorySortOrderUpdate): Promise<{ status: string; updated_categories: number }> {
    return httpRequest<{ status: string; updated_categories: number }>('/api/personnel/categories/sort-order', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  // Personnel Check-In
  async generateCheckInLink(eventId: string): Promise<{ token: string; link: string; full_url: string; qr_code_data: string }> {
    return httpRequest<{ token: string; link: string; full_url: string; qr_code_data: string }>(`/api/personnel/check-in/generate-link?event_id=${encodeURIComponent(eventId)}`, {
      method: 'POST',
    })
  }

  async getCheckInList(token: string, checkedInOnly: boolean = false): Promise<{ personnel: ApiPersonnelListItem[]; event_id: string; event_name: string }> {
    return httpRequest<{ personnel: ApiPersonnelListItem[]; event_id: string; event_name: string }>(
      `/api/personnel/check-in/list?token=${encodeURIComponent(token)}&checked_in_only=${checkedInOnly}`
    )
  }

  async checkInPersonnel(personnelId: string, token: string): Promise<ApiPersonnel> {
    return httpRequest<ApiPersonnel>(
      `/api/personnel/check-in/${personnelId}/in?token=${encodeURIComponent(token)}`,
      {
        method: 'POST',
      }
    )
  }

  async checkOutPersonnel(personnelId: string, token: string): Promise<ApiPersonnel> {
    return httpRequest<ApiPersonnel>(
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
    return httpRequest<{ personnel: ApiPersonnelListItem[]; event_id: string; event_name: string }>(
      `/api/personnel/check-in/list?event_id=${encodeURIComponent(eventId)}&include_unavailable=true`
    )
  }

  async checkInPersonnelForEvent(personnelId: string, eventId: string): Promise<ApiPersonnel> {
    return httpRequest<ApiPersonnel>(
      `/api/personnel/check-in/${personnelId}/in?event_id=${encodeURIComponent(eventId)}`,
      { method: 'POST' }
    )
  }

  async checkOutPersonnelForEvent(personnelId: string, eventId: string): Promise<ApiPersonnel> {
    return httpRequest<ApiPersonnel>(
      `/api/personnel/check-in/${personnelId}/out?event_id=${encodeURIComponent(eventId)}`,
      { method: 'POST' }
    )
  }

  /**
   * Back to «nicht anwesend» – removes the attendance row entirely. Board only;
   * this is a correction of the record, not something a crew reports about itself.
   */
  async clearPersonnelAttendance(personnelId: string, eventId: string): Promise<ApiPersonnel> {
    return httpRequest<ApiPersonnel>(
      `/api/personnel/check-in/${personnelId}?event_id=${encodeURIComponent(eventId)}`,
      { method: 'DELETE' }
    )
  }

  /** "Alle abmelden" – everyone still present goes to `gegangen`. Board only. */
  async checkOutAllPersonnel(eventId: string): Promise<ApiPersonnel[]> {
    return httpRequest<ApiPersonnel[]>(
      `/api/personnel/check-in/event/${encodeURIComponent(eventId)}/out-all`,
      { method: 'POST' }
    )
  }

  async getCheckInStats(token: string): Promise<ApiCheckInStats> {
    return httpRequest<ApiCheckInStats>(
      `/api/personnel/check-in/stats?token=${encodeURIComponent(token)}`
    )
  }

  async getEventCheckInStats(eventId: string): Promise<ApiCheckInStats> {
    return httpRequest<ApiCheckInStats>(
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
}
