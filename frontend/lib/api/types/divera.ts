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
export type ApiDiveraPollingStatus = Out<'DiveraPollingStatus'>

export type SendDiveraAlarmOptions = In<'DiveraAlarmRequest'>

// Rückmeldungen — GET /api/divera/events/{id}/responses
// (backend/app/services/divera_responses.py; the same rules as KP Front's half). Yes/no only.

/** kommt / kommt nicht. Other Divera statuses («Rückruf erbeten») are not kept at all. */
export type ApiDiveraResponseKind = Out<'DiveraResponsePerson'>['kind']

export type ApiDiveraResponsePerson = Out<'DiveraResponsePerson'>

export type ApiDiveraResponsesSummary = Out<'DiveraResponsesSummary'>
