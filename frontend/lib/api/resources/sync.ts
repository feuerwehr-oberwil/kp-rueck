/**
 * The polling version check and the Railway sync endpoints.
 *
 * One slice of `apiClient` (`lib/api-client.ts` mixes every resource class into
 * the one client object). Methods go through the shared transport in `../http`.
 */

import { request as httpRequest } from '../http'
import type { SyncStatusResponse, SyncHistoryEntry, SyncConfig, SyncResult } from '@/types/sync'

export class SyncApi {
  // Sync version check (lightweight polling optimization)
  async getSyncVersion(eventId: string): Promise<{ version: string }> {
    return httpRequest<{ version: string }>(`/api/incidents/sync-version?event_id=${encodeURIComponent(eventId)}`)
  }

  // Sync endpoints
  async getSyncStatus(): Promise<SyncStatusResponse> {
    return httpRequest<SyncStatusResponse>('/api/sync/status')
  }

  async getSyncHistory(limit?: number): Promise<SyncHistoryEntry[]> {
    const params = limit ? `?limit=${limit}` : ''
    return httpRequest<SyncHistoryEntry[]>(`/api/sync/history${params}`)
  }

  async getSyncConfig(): Promise<SyncConfig> {
    // Admin-only endpoint, but also probed by the user menu for every user –
    // suppress the generic error toast and let callers handle 401/403.
    return httpRequest<SyncConfig>('/api/sync/config', { skipToast: true })
  }

  async updateSyncConfig(config: SyncConfig): Promise<SyncConfig> {
    return httpRequest<SyncConfig>('/api/sync/config', {
      method: 'PUT',
      body: JSON.stringify(config),
    })
  }

  async triggerSyncFromRailway(): Promise<SyncResult> {
    return httpRequest<SyncResult>('/api/sync/from-railway', {
      method: 'POST',
    })
  }

  async triggerSyncToRailway(): Promise<SyncResult> {
    return httpRequest<SyncResult>('/api/sync/to-railway', {
      method: 'POST',
    })
  }

  async triggerImmediateSync(): Promise<SyncResult> {
    return httpRequest<SyncResult>('/api/sync/trigger-immediate', {
      method: 'POST',
    })
  }
}
