/**
 * Einsatztagebuch, KP→Trupp field messages and field requests.
 *
 * One slice of `apiClient` (`lib/api-client.ts` mixes every resource class into
 * the one client object). Methods go through the shared transport in `../http`.
 */

import { request as httpRequest } from '../http'
import type {
  ApiJournalEntry,
  ApiJournalPage,
  ApiKpFieldMessage,
  ApiFieldRequest,
  ApiFieldRequestStatus,
} from '../types'

export class JournalApi {
  /** The Ereignis' Einsatztagebuch; `sinceSeq` = the `latest_seq` last seen (0 = all). */
  async getJournal(eventId: string, sinceSeq = 0): Promise<ApiJournalPage> {
    return httpRequest<ApiJournalPage>(`/api/events/${eventId}/journal?since_seq=${sinceSeq}`)
  }

  /** A manual Einsatztagebuch line. `clientId` makes a retry after a lost answer harmless. */
  async appendJournal(
    eventId: string,
    body: { client_id: string; text: string; incident_id?: string | null },
  ): Promise<ApiJournalEntry> {
    return httpRequest<ApiJournalEntry>(`/api/events/${eventId}/journal`, {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  /** Correct a manual line — appended, the original stays. */
  async correctJournal(
    eventId: string,
    entryId: string,
    body: { client_id: string; text: string },
  ): Promise<ApiJournalEntry> {
    return httpRequest<ApiJournalEntry>(`/api/events/${eventId}/journal/${entryId}/corrections`, {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  /** «Meldung an den Trupp» — the KP's half of the field message loop (§P3.2). */
  async sendKpFieldMessage(incidentId: string, message: string): Promise<ApiKpFieldMessage> {
    return httpRequest<ApiKpFieldMessage>(`/api/incidents/${incidentId}/field-messages`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    })
  }

  /** Every request the field made of this Schadenplatz, any state (R13). */
  async getFieldRequests(incidentId: string): Promise<ApiFieldRequest[]> {
    return httpRequest<ApiFieldRequest[]>(`/api/incidents/${incidentId}/field-requests`)
  }

  /** Work a request: offen → in Arbeit → erledigt, or back to offen. */
  async setFieldRequestStatus(
    incidentId: string,
    requestId: string,
    status: ApiFieldRequestStatus,
    /** The state the operator's screen showed — a request another board moved
     *  on meanwhile answers 409 instead of being overwritten. */
    expectedStatus?: ApiFieldRequestStatus,
  ): Promise<ApiFieldRequest> {
    return httpRequest<ApiFieldRequest>(`/api/incidents/${incidentId}/field-requests/${requestId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status, expected_status: expectedStatus }),
    })
  }
}
