/**
 * Bidirectional sync types for Railway ↔ Local synchronization
 */

export type SyncDirection = 'from_railway' | 'to_railway';
export type SyncStatus = 'success' | 'failed' | 'partial' | 'syncing';

export interface SyncStatusResponse {
  last_sync: string | null;  // ISO timestamp
  direction: SyncDirection;
  railway_healthy: boolean;
  is_syncing: boolean;
  records_pending: number;
  last_error?: string;
  /** «railway» = this IS the central Railway instance (no peer to check). */
  instance_role?: 'railway' | 'station';
  /** Station only: whether a Railway target is configured at all. */
  peer_configured?: boolean;
}

/** The central Railway deployment has no sync peer — never show it «offline». */
export function isCentralInstance(status: SyncStatusResponse | null | undefined): boolean {
  return status?.instance_role === 'railway'
}

/** A station with no Railway target: «nicht eingerichtet», not «offline». */
export function isSyncUnconfigured(status: SyncStatusResponse | null | undefined): boolean {
  return status?.instance_role === 'station' && status.peer_configured === false
}

export interface SyncHistoryEntry {
  id: string;
  sync_direction: SyncDirection;
  started_at: string;
  completed_at: string | null;
  status: SyncStatus;
  records_synced: {
    incidents?: number;
    personnel?: number;
    vehicles?: number;
    materials?: number;
    settings?: number;
  };
  errors?: Record<string, string>;
}

export interface SyncConfig {
  sync_interval_minutes: number;
  auto_sync_on_create: boolean;
  railway_database_url: string;
  sync_conflict_buffer_seconds?: number;
  is_production?: boolean;  // True if running on Railway (production)
}

export interface SyncResult {
  success: boolean;
  records_synced: {
    incidents?: number;
    personnel?: number;
    vehicles?: number;
    materials?: number;
    settings?: number;
  };
  errors?: string[];
}
