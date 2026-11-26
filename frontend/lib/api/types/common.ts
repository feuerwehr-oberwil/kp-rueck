/**
 * Shared / cross-domain API types.
 */

import type { In, Out } from '../wire'
import { translateOutsideReact } from "@/lib/i18n-messages"

/**
 * Custom API error class that includes HTTP status code
 * Used to distinguish between different error types (e.g., 409 Conflict)
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly isConflict: boolean = false,
    /** The backend's stable error code, when it sent one (backend/app/utils/error_codes.py). */
    public readonly code?: string,
    /** The facts that go with `code` (e.g. who moved the card for `incident_status_changed`). */
    public readonly params?: Readonly<Record<string, string | number>>,
  ) {
    super(message)
    this.name = 'ApiError'
  }

  /**
   * Check if this error is a 409 Conflict (concurrent modification)
   */
  static isConflictError(error: unknown): error is ApiError {
    return error instanceof ApiError && error.status === 409
  }
}

/**
 * Thrown when a request never reached the server (offline, DNS, refused).
 * Mutations must reject with this so callers roll back optimistic state —
 * silently resolving made the UI report success for writes that never
 * happened. Polling GETs still resolve to undefined instead (soft degrade).
 */
export class NetworkError extends Error {
  constructor(message: string = translateOutsideReact('errors.networkError')) {
    super(message)
    this.name = 'NetworkError'
  }

  static isNetworkError(error: unknown): error is NetworkError {
    return error instanceof NetworkError
  }
}

export type CategorySortOrder = In<'CategorySortOrder'>

export type BulkCategorySortOrderUpdate = In<'BulkCategorySortOrderUpdate'>

export type ApiAuditLog = Out<'AuditLogEntry'>

// Provider capability registry (GET /api/integrations)
export type ApiProviderCapability = Out<'ProviderCapability'>

/** What this instance may do to the outside world (GET /api/deployment, backend
 *  `app/environment.py`). Set by the DEPLOYMENT_ROLE variable, deliberately not by a
 *  setting — staging runs on a copy of the production database. */
export type ApiDeployment = Out<'DeploymentRole'>

/** A link the board hands out (backend `ShareLinkResponse`): check-in, viewer, alarm intake,
 *  `/feld`, Reko. `link` is relative – prefix the page's own origin. `qr_code_data` is what the
 *  QR code encodes; `valid_until` (ISO) is set where the slip prints its expiry (the `/feld` poster). */
export type ApiShareLink = Out<'ShareLinkResponse'>

/** The standby box's mirror of the hosted board (GET /api/standby, backend `StandbyStatus`).
 *  `mirror` is false on every other deployment, and then the mirror fields are null. */
export type ApiStandby = Out<'StandbyStatus'>

/** Who leads one Ereignis, and how its two-way sync stands (backend `app/standby_sync.py`). */
export type ApiStandbyLead = Out<'StandbyLead'>

/** Something both systems changed while they could not talk; the leader's version stands. */
export type ApiStandbyConflict = Out<'StandbyConflict'>

export type ApiStandbyConflicts = Out<'StandbyConflicts'>

/** One provider this build knows about, whether or not this station uses it. `implemented`
 *  is false for a provider whose contract is published but whose ingestion is not built. */
export type ApiKnownProvider = Out<'KnownProvider'>

/** The last roster-snapshot run (GET /api/integrations/roster-snapshot; backend
 *  `roster_snapshot_ingest.status_json` plus the attempt/success stamps). Every field optional:
 *  a station that never ran one has `status: null`. */
export interface ApiRosterSnapshotStatus {
  held?: boolean
  unchanged?: boolean
  stale?: boolean
  activeBefore?: number
  deactivationLimit?: number | null
  pendingDeactivations?: number
  /** deactivations waiting because the person is checked in / assigned on an open Ereignis */
  postponed?: Array<{ display_name: string; reason: string }>
  unmatchedTotal?: number
  lastAttempt?: string | null
  lastSuccess?: string | null
  lastError?: string | null
  lastGood?: { generatedAt: string; count: number; provider: string } | null
  /** how the roster was found: through the station index, or ROSTER_SNAPSHOT_SOURCE directly */
  via?: 'index' | 'direct'
  /** the station index of that run (backend `station_index.summary`) */
  index?: {
    generatedAt: string
    files: Array<{ kind: string; schema: string; read: boolean; known: boolean }>
  } | null
  outcome?: {
    refused?: string | null
    created?: number
    updated?: number
    deactivated?: number
    unmatched?: Array<{ display_name: string; reason: string }>
    unknown_ranks?: string[]
  } | null
}

export interface ApiRosterSnapshot {
  configured: boolean
  intervalMinutes: number
  maxDeactivatePct: number
  status: ApiRosterSnapshotStatus | null
}

export type ApiIntegrations = Out<'IntegrationsResponse'>
