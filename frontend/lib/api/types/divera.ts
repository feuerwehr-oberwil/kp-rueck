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
}
