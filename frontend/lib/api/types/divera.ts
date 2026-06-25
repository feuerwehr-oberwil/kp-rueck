/**
 * Divera 24/7 integration types — emergency pool + personnel sync.
 */

export interface ApiDiveraEmergency {
  id: string // UUID
  divera_id: number
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
