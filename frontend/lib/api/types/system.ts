/**
 * Users, the print queue, first-run setup and demo mode — the system-level
 * shapes that used to sit at the end of `lib/api-client.ts`. Moved verbatim
 * (2026-09-23); `api-client` still re-exports them through the barrel.
 */

// User Management Types
export interface ApiUser {
  id: string
  username: string
  role: 'admin' | 'editor' | 'viewer'
  display_name: string
  is_active: boolean
  created_at: string
  last_login: string | null
}

export interface ApiUserCreate {
  username: string
  password: string
  role: 'admin' | 'editor' | 'viewer'
  display_name?: string
}

export interface ApiUserUpdate {
  username?: string
  role?: 'admin' | 'editor' | 'viewer'
  display_name?: string
  is_active?: boolean
}

// Print Job Types
export interface ApiPrinterStatus {
  enabled: boolean
  ip: string
  port: number
  auto_anfahrt: boolean
  pending_jobs: number
  last_job_at: string | null
  last_error: string | null
  agent_online: boolean
  agent_last_seen: string | null
}

export interface ApiQRCodePrintRequest {
  qr_content: string
  title: string
  subtitle?: string
  event_id?: string
  /** The four digits the scanned page asks for next. Without them the Feld slip
   *  leads to a prompt it cannot answer — see `components/kanban/links-qr-sheet.tsx`. */
  code?: string
  /** When the link stops working (ISO). Printed as a date, so a dead slip in
   *  the Magazin can be recognised as dead. */
  valid_until?: string
}

export interface ApiPrintJob {
  id: string
  job_type: 'assignment' | 'board' | 'test' | 'qr_code'
  status: 'pending' | 'printing' | 'completed' | 'failed'
  payload: Record<string, unknown>
  incident_id?: string
  event_id?: string
  created_at: string
  claimed_at?: string
  completed_at?: string
  error_message?: string
  retry_count: number
}

// First-Run Setup Types
export interface ApiSetupStatus {
  claimed: boolean
}

export interface ApiSetupClaim {
  station_name: string
  admin_password: string
}

export interface ApiSetupResult {
  username: string
}

// Demo Mode Types
export interface DemoStatus {
  demo: boolean
  next_reset: string | null
  seconds_until_reset: number
  reset_interval_hours: number
}
