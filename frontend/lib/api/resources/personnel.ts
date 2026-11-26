/**
 * Personnel CRUD and attendance (check-in through the token and the board's door).
 *
 * One slice of `apiClient` (`lib/api-client.ts` mixes every resource class into
 * the one client object). Methods go through the shared transport in `../http`.
 */

import { linkRequest, request as httpRequest, requestVoid } from '../http'
import type {
  BulkCategorySortOrderUpdate,
  ApiPersonnel,
  ApiPersonnelListItem,
  ApiCheckInResponse,
  ApiCheckInStats,
  ApiPersonnelCreate,
  ApiPersonnelUpdate,
  ApiAttendancePlan,
  ApiShareLink,
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
    return requestVoid(`/api/personnel/${id}`, {
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
  async generateCheckInLink(eventId: string): Promise<ApiShareLink> {
    return httpRequest<ApiShareLink>(`/api/personnel/check-in/generate-link?event_id=${encodeURIComponent(eventId)}`, {
      method: 'POST',
    })
  }

  async getCheckInList(token: string, checkedInOnly: boolean = false): Promise<{ personnel: ApiPersonnelListItem[]; event_id: string; event_name: string }> {
    return linkRequest<{ personnel: ApiPersonnelListItem[]; event_id: string; event_name: string }>(
      `/api/personnel/check-in/list?token=${encodeURIComponent(token)}&checked_in_only=${checkedInOnly}`,
      { skipToast: true, maxRetries: 0 },
    )
  }

  async checkInPersonnel(personnelId: string, token: string): Promise<ApiPersonnel> {
    return linkRequest<ApiPersonnel>(
      `/api/personnel/check-in/${personnelId}/in?token=${encodeURIComponent(token)}`,
      {
        method: 'POST',
      }
    )
  }

  async checkOutPersonnel(personnelId: string, token: string): Promise<ApiPersonnel> {
    return linkRequest<ApiPersonnel>(
      `/api/personnel/check-in/${personnelId}/out?token=${encodeURIComponent(token)}`,
      {
        method: 'POST',
      }
    )
  }

  /**
   * «‹Name› als Gast einchecken» – the link's walk-in door. A listed name checks that person
   * in; an unknown one becomes a guest of the link's Ereignis. 409 `checkin_guest_ask_kp`
   * when the door cannot settle the name. No toast here: the kiosk says each outcome itself.
   */
  async checkInGuest(token: string, name: string): Promise<ApiPersonnelListItem> {
    return linkRequest<ApiPersonnelListItem>(`/api/personnel/check-in/guest?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      body: JSON.stringify({ name }),
      skipToast: true,
    })
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

  /** `resume`: the board's undo of its own check-out – the `checked_out_at` that check-out
   *  answered. The same stint continues («anwesend seit» and the plan kept); a 409 when that
   *  departure is gone (somebody checked the person in or out since). */
  async checkInPersonnelForEvent(
    personnelId: string,
    eventId: string,
    { resume }: { resume?: string } = {},
  ): Promise<ApiPersonnel> {
    return httpRequest<ApiPersonnel>(
      `/api/personnel/check-in/${personnelId}/in?event_id=${encodeURIComponent(eventId)}${resume ? `&resume=${encodeURIComponent(resume)}` : ''}`,
      { method: 'POST' }
    )
  }

  /** `onlyIfFree`: the person popover's check-out without a question – a 409 when an
   *  assignment or a function binds the person after all. The Appell leaves it off. */
  async checkOutPersonnelForEvent(
    personnelId: string,
    eventId: string,
    { onlyIfFree = false }: { onlyIfFree?: boolean } = {},
  ): Promise<ApiCheckInResponse> {
    return httpRequest<ApiCheckInResponse>(
      `/api/personnel/check-in/${personnelId}/out?event_id=${encodeURIComponent(eventId)}${onlyIfFree ? '&only_if_free=true' : ''}`,
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

  /** «kommt um» / «geht um»: the Appell (editor session + `eventId`) or the check-in link (`token`). */
  async setAttendancePlan(
    personnelId: string,
    door: { eventId: string } | { token: string },
    plan: ApiAttendancePlan,
  ): Promise<ApiPersonnelListItem> {
    const path = `/api/personnel/check-in/${personnelId}/plan`
    const body = { method: 'PUT', body: JSON.stringify(plan) }
    return 'token' in door
      ? linkRequest<ApiPersonnelListItem>(`${path}?token=${encodeURIComponent(door.token)}`, body)
      : httpRequest<ApiPersonnelListItem>(`${path}?event_id=${encodeURIComponent(door.eventId)}`, body)
  }

  /** "Alle auschecken" – everyone still present goes to `gegangen`. Board only. */
  async checkOutAllPersonnel(eventId: string): Promise<ApiPersonnel[]> {
    return httpRequest<ApiPersonnel[]>(
      `/api/personnel/check-in/event/${encodeURIComponent(eventId)}/out-all`,
      { method: 'POST' }
    )
  }

  async getEventCheckInStats(eventId: string): Promise<ApiCheckInStats> {
    return httpRequest<ApiCheckInStats>(
      `/api/personnel/check-in/stats?event_id=${encodeURIComponent(eventId)}`
    )
  }
}
