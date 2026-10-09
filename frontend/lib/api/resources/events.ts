/**
 * Ereignisse: CRUD, archive, special functions, Restliste, stats and Kennzahlen.
 *
 * One slice of `apiClient` (`lib/api-client.ts` mixes every resource class into
 * the one client object). Methods go through the shared transport in `../http`.
 */

import { request as httpRequest } from '../http'
import type {
  ApiEvent,
  ApiEventCreate,
  ApiEventUpdate,
  ApiEventListResponse,
  ApiEventSpecialFunctionCreate,
  ApiEventSpecialFunctionDelete,
  ApiEventSpecialFunctionResponse,
  ApiEventStats,
  ApiEventFigures,
  ApiPersonnelActivity,
  ApiEventRestliste,
} from '../types'

export class EventsApi {
  // Event endpoints
  async getEvents(includeArchived: boolean = false): Promise<ApiEventListResponse> {
    const params = new URLSearchParams()
    if (includeArchived) {
      params.append('include_archived', 'true')
    }
    const endpoint = `/api/events/${params.toString() ? `?${params.toString()}` : ''}`
    return httpRequest<ApiEventListResponse>(endpoint)
  }

  async getEvent(eventId: string, options?: { skipToast?: boolean }): Promise<ApiEvent> {
    return httpRequest<ApiEvent>(`/api/events/${eventId}`, options)
  }

  /**
   * The Restliste (§6, V-8): what is still open in this Ereignis.
   *
   * Three counts, each carrying the incidents behind it – the count is only the
   * way in, because nobody clicks twenty-three cards individually.
   */
  async getEventRestliste(eventId: string): Promise<ApiEventRestliste> {
    return httpRequest<ApiEventRestliste>(`/api/events/${eventId}/restliste`)
  }

  async createEvent(data: ApiEventCreate): Promise<ApiEvent> {
    return httpRequest<ApiEvent>('/api/events/', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async updateEvent(eventId: string, data: ApiEventUpdate): Promise<ApiEvent> {
    return httpRequest<ApiEvent>(`/api/events/${eventId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  async archiveEvent(eventId: string, options?: { checkoutAttendees?: boolean }): Promise<ApiEvent> {
    // The archive dialog's «automatisch abmelden»: everyone still checked in
    // gets Abmeldezeit = Ereignisende, server-side in the same request.
    const query = options?.checkoutAttendees ? '?checkout_attendees=true' : ''
    return httpRequest<ApiEvent>(`/api/events/${eventId}/archive${query}`, {
      method: 'POST',
    })
  }

  async unarchiveEvent(eventId: string): Promise<ApiEvent> {
    return httpRequest<ApiEvent>(`/api/events/${eventId}/unarchive`, {
      method: 'POST',
    })
  }

  async deleteEvent(eventId: string): Promise<void> {
    return httpRequest<void>(`/api/events/${eventId}`, {
      method: 'DELETE',
    })
  }

  // Special Functions (event-scoped)
  async getEventSpecialFunctions(eventId: string): Promise<ApiEventSpecialFunctionResponse[]> {
    return httpRequest<ApiEventSpecialFunctionResponse[]>(`/api/events/${eventId}/special-functions/`)
  }

  async getPersonnelSpecialFunctions(eventId: string, personnelId: string): Promise<ApiEventSpecialFunctionResponse[]> {
    return httpRequest<ApiEventSpecialFunctionResponse[]>(`/api/events/${eventId}/special-functions/personnel/${personnelId}`)
  }

  async assignSpecialFunction(eventId: string, data: ApiEventSpecialFunctionCreate): Promise<ApiEventSpecialFunctionResponse> {
    return httpRequest<ApiEventSpecialFunctionResponse>(`/api/events/${eventId}/special-functions/`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async unassignSpecialFunction(eventId: string, data: ApiEventSpecialFunctionDelete): Promise<void> {
    return httpRequest<void>(`/api/events/${eventId}/special-functions/`, {
      method: 'DELETE',
      body: JSON.stringify(data),
    })
  }

  // Event Stats
  async getEventStats(eventId: string): Promise<ApiEventStats> {
    return httpRequest<ApiEventStats>(`/api/events/${eventId}/stats`)
  }

  /** Kennzahlen: Lage counts + Reaktionszeiten per priority (the PDF's stage times). */
  async getEventFigures(eventId: string): Promise<ApiEventFigures> {
    return httpRequest<ApiEventFigures>(`/api/events/${eventId}/figures`)
  }

  /** Time on duty of everybody checked in (the Dienstzeiten overview), longest first. */
  async getEventPersonnelActivity(eventId: string): Promise<ApiPersonnelActivity[]> {
    return httpRequest<ApiPersonnelActivity[]>(`/api/events/${eventId}/personnel-activity`)
  }
}
