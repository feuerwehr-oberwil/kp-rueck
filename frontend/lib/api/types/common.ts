/**
 * Shared / cross-domain API types.
 */
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

export interface CategorySortOrder {
  /** The category name (role for personnel, location for materials). */
  category: string
  /** The new sort order value. */
  sort_order: number
}

export interface BulkCategorySortOrderUpdate {
  categories: CategorySortOrder[]
}

export interface ApiAuditLog {
  id: string
  user_id: string | null
  action_type: string
  resource_type: string
  resource_id: string | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  changes_json: Record<string, any> | null
  timestamp: string
  ip_address: string | null
  user_agent: string | null
}

// Provider capability registry (GET /api/integrations)
export interface ApiProviderCapability {
  /** Provider slug ("divera", "traccar") or null when only built-ins are available. */
  provider: string | null
  display_name: string | null
  configured: boolean
  capabilities: string[]
}

/** One provider this build knows about, whether or not this station uses it. `implemented`
 *  is false for a provider whose contract is published but whose ingestion is not built. */
export interface ApiKnownProvider {
  provider: string
  display_name: string
  domain: 'alarms' | 'alerting' | 'personnel' | 'vehicles'
  configured: boolean
  implemented: boolean
  capabilities: string[]
  /** Repository-relative path to the published contract, when the provider has one. */
  contract: string | null
}

export interface ApiIntegrations {
  /** Inbound alarm delivery into the pool */
  alarms: ApiProviderCapability
  /** Outbound alerting (Ausalarmierung) */
  alerting: ApiProviderCapability
  /** Personnel roster sync */
  personnel: ApiProviderCapability
  /** Vehicle GPS tracking */
  vehicles: ApiProviderCapability
  /** Always-available ingest paths (not providers) */
  builtin_alarm_paths: string[]
  /** Every provider this build knows about — the domains above say which one is active. */
  known_providers: ApiKnownProvider[]
}
