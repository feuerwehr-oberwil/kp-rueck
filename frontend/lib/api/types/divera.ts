/**
 * Divera 24/7 integration types — emergency pool + personnel sync.
 */

export interface ApiDiveraEmergency {
  id: string // UUID
  /** Delivering system: "divera", "webhook", or a custom per-sender slug. */
  source: string
  /** Sender-side alarm id (dedupe key); null on older rows. */
  source_id: string | null
  /** Divera's internal id — null for alarms from the generic webhook. */
  divera_id: number | null
  /** e.g., "E-123" */
  divera_number: string | null
  title: string
  text: string | null
  address: string | null
  /** Decimal as string */
  latitude: string | null
  /** Decimal as string */
  longitude: string | null
  // Note: priority is not stored - it's inferred when creating incidents
  received_at: string
  /** UUID */
  attached_to_event_id: string | null
  attached_at: string | null
  /** UUID */
  created_incident_id: string | null
  is_archived: boolean
  /** Simulated alarm injected by the Übungssteuerung (ÜBUNG badge). */
  is_training?: boolean
}

export interface ApiDiveraEmergencyListResponse {
  emergencies: ApiDiveraEmergency[]
  total: number
  /** Count of unattached, non-archived emergencies */
  unattached_count: number
}

// Personnel sync
export interface ApiDiveraMemberPreview {
  divera_id: number
  name: string
}

export interface ApiDiveraSyncPreviewItem {
  member: ApiDiveraMemberPreview
  status: 'new' | 'unchanged' | 'not_in_divera'
  existing_id: string | null
  /** For "unchanged" matches: whether the local person already has the Divera id. */
  divera_linked?: boolean
}

export interface ApiDiveraSyncPreview {
  new: ApiDiveraSyncPreviewItem[]
  unchanged: ApiDiveraSyncPreviewItem[]
  not_in_divera: ApiDiveraSyncPreviewItem[]
}

export interface ApiDiveraSyncResult {
  created: number
  deleted: number
  unchanged: number
  /** Existing people backfilled with their Divera id during this sync. */
  linked?: number
}

// Outbound alarm (ausalarmierung)
export interface ApiDiveraAlarmRecipient {
  personnel_id: string
  name: string
  divera_user_id?: number | null
  /** Why this recipient was skipped, if skipped. */
  reason?: string | null
}

export interface ApiDiveraAlarmResult {
  success: boolean
  foreign_id: string
  divera_alarm_id?: number | null
  sent: ApiDiveraAlarmRecipient[]
  skipped: ApiDiveraAlarmRecipient[]
  count_recipients?: number | null
  error?: string | null
  /** True for a training run: the flow ran but nothing was sent to Divera. */
  simulated?: boolean
}

// Mitteilung ("news") — informational, NOT an alarm
export interface ApiDiveraGroup {
  divera_id: number
  name: string
}

export interface SendDiveraMessageOptions {
  text: string
  title?: string
  /** No default on purpose — reaching the whole Feuerwehr is a decision. */
  target: 'groups' | 'all'
  group_ids?: number[]
  /** Lets the backend simulate instead of sending when the event is a drill. */
  event_id?: string
}

export interface ApiDiveraMessageResult {
  success: boolean
  foreign_id: string
  divera_message_id?: number | null
  target: 'groups' | 'all'
  /** Names of the groups actually addressed, echoed back for the confirmation. */
  group_names: string[]
  /** True for a training run: the flow ran but nothing was sent to Divera. */
  simulated?: boolean
}

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

export interface SendDiveraAlarmOptions {
  personnel_ids: string[]
  title?: string
  text?: string
  priority?: boolean
  send_push?: boolean
  send_sms?: boolean
  send_call?: boolean
  send_mail?: boolean
}

// Rückmeldungen — GET /api/divera/{events,incidents}/{id}/responses
// (backend/app/services/divera_responses.py; the same rules as KP Front's half).

/** How a Divera status reads: kommt / kommt nicht / anderes (e.g. «Rückruf erbeten»). */
export type ApiDiveraResponseKind = 'coming' | 'not_coming' | 'other'

export interface ApiDiveraResponseStatusCount {
  status_id: number
  /** The Einheit's own name; «Status <id>» while the catalogue is unknown. */
  name: string
  kind: ApiDiveraResponseKind
  /** Divera's `time` for the status in minutes; 0 = none. */
  time: number
  count: number
}

export interface ApiDiveraResponsePerson {
  ucr_id: number
  /** Via the person's `divera` identity. Answers nobody on the roster is linked to are never
   *  listed — only counted in `unmapped`. */
  personnel_id: string
  name: string
  role: string | null
  tags: string[]
  /** Any attendance record on this Ereignis (in now, or in and out again): never «anrückend». */
  attended: boolean
  status_id: number
  status_name: string
  kind: ApiDiveraResponseKind
  answered_at: string | null
  /** answered_at + status time — an ESTIMATE («ca.»), only for «coming» with a time. */
  eta: string | null
  /** Divera free text; editors and admins only (it can be health data). */
  note: string | null
}

export interface ApiDiveraResponsesSummary {
  /** false = the block is absent: Divera not configured, nothing here came from Divera, or no
   *  alarm of the last 6 h carries answers (`no_data`). */
  available: boolean
  reason: 'not_configured' | 'not_linked' | 'no_data' | null
  alarm_count: number
  counts: Record<ApiDiveraResponseKind, number>
  statuses: ApiDiveraResponseStatusCount[]
  people: ApiDiveraResponsePerson[]
  addressed: number
  read: number
  answered: number
  unanswered: number
  /** Answers from Divera members no roster person is linked to. */
  unmapped: number
  updated_at: string | null
}
