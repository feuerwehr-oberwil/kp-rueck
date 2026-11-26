/**
 * Divera 24/7 integration types — emergency pool + personnel sync.
 */

import type { In, Out } from '../wire'

export type ApiDiveraEmergency = Out<'DiveraEmergencyResponse'>

export type ApiDiveraEmergencyListResponse = Out<'DiveraEmergencyListResponse'>

// Personnel sync
export type ApiDiveraMemberPreview = Out<'DiveraMemberPreview'>

export type ApiDiveraSyncPreviewItem = Out<'DiveraSyncPreviewItem'>

export type ApiDiveraSyncPreview = Out<'DiveraSyncPreview'>

export type ApiDiveraSyncResult = Out<'DiveraSyncResult'>

// Outbound alarm (ausalarmierung)
export type ApiDiveraAlarmRecipient = Out<'DiveraAlarmRecipient'>

export type ApiDiveraAlarmResult = Out<'DiveraAlarmResponse'>

// Mitteilung ("news") — informational, NOT an alarm
export type ApiDiveraGroup = Out<'DiveraGroupPreview'>

export type SendDiveraMessageOptions = In<'DiveraMessageRequest'>

export type ApiDiveraMessageResult = Out<'DiveraMessageResponse'>

// Polling / connection status (for the Verbindung indicator)
export interface ApiDiveraPollingStatus {
  /** True when an access key is set (alarms + inbound polling can work). */
  configured: boolean
  /** True while the polling fallback task is running (users connected). */
  polling?: boolean
  /** ISO timestamp of the last successful poll, if any. */
  last_poll?: string | null
  poll_count?: number
  error_count?: number
  /** Present only when the poller service is unavailable. */
  message?: string
}

export type SendDiveraAlarmOptions = In<'DiveraAlarmRequest'>

// Rückmeldungen — GET /api/divera/events/{id}/responses
// (backend/app/services/divera_responses.py; the same rules as KP Front's half). Yes/no only.

/** kommt / kommt nicht. Other Divera statuses («Rückruf erbeten») are not kept at all. */
export type ApiDiveraResponseKind = Out<'DiveraResponsePerson'>['kind']

export type ApiDiveraResponsePerson = Out<'DiveraResponsePerson'>

export type ApiDiveraResponsesSummary = Out<'DiveraResponsesSummary'>
