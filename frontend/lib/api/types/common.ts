/**
 * Shared / cross-domain API types.
 */

import type { In, Out, Sparse } from '../wire'
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
 * Thrown when a request never reached the server (offline, DNS, refused, timed
 * out) after its retries – a read as well as a write. A write's caller rolls back
 * its optimistic state; a poller keeps its last known state. «No answer» never
 * resolves to a value, so it cannot pass for an empty list.
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
 *  `schemas/integrations.py`). A stored document, served key for key: a key an older or a
 *  refused run did not write is absent (`Sparse`). */
export type ApiRosterSnapshotStatus = Sparse<'RosterSnapshotStatus'>

export type ApiRosterSnapshot = Omit<Out<'RosterSnapshotResponse'>, 'status'> & {
  status: ApiRosterSnapshotStatus | null
}

export type ApiIntegrations = Out<'IntegrationsResponse'>
