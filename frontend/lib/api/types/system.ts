/**
 * Users, the print queue, first-run setup and demo mode — the system-level
 * shapes that used to sit at the end of `lib/api-client.ts`. Moved verbatim
 * (2026-09-23); `api-client` still re-exports them through the barrel.
 */

import type { In, Out } from '../wire'

// User Management Types
export type ApiUser = Out<'User'>

export type ApiUserCreate = In<'UserCreate'>

export type ApiUserUpdate = In<'UserUpdate'>

// Print Job Types
export type ApiPrinterStatus = Out<'PrinterStatusResponse'>

export type ApiQRCodePrintRequest = In<'PrintQRCodeRequest'>

export type ApiPrintJob = Out<'PrintJobResponse'>

// First-Run Setup Types
export type ApiSetupStatus = Out<'SetupStatusResponse'>

export type ApiSetupClaim = In<'SetupClaimRequest'>

export type ApiSetupResult = Out<'SetupClaimResponse'>

// Demo Mode Types
export interface DemoStatus {
  demo: boolean
  next_reset: string | null
  seconds_until_reset: number
  reset_interval_hours: number
}
