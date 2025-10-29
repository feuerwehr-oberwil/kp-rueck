'use client'

import { useState, useEffect } from 'react'
import { apiClient } from '@/lib/api-client'
import type { SyncStatusResponse } from '@/types/sync'

interface UseSyncStatusOptions {
  pollInterval?: number // milliseconds, default 10000 (10s)
  enabled?: boolean
}

export function useSyncStatus(options: UseSyncStatusOptions = {}) {
  const { pollInterval = 10000, enabled = true } = options
  const [status, setStatus] = useState<SyncStatusResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Track previous railway health state for detecting recovery
  const [previousRailwayHealthy, setPreviousRailwayHealthy] = useState<boolean | null>(null)

  useEffect(() => {
    if (!enabled) return

    let isMounted = true
    let timeoutId: NodeJS.Timeout

    const fetchStatus = async () => {
      try {
        const data = await apiClient.getSyncStatus()

        if (isMounted) {
          setStatus(data)
          setError(null)
          setIsLoading(false)

          // Detect Railway recovery (unhealthy → healthy transition)
          if (previousRailwayHealthy === false && data.railway_healthy === true) {
            // Railway has recovered! This will be handled by use-railway-recovery hook
          }
          setPreviousRailwayHealthy(data.railway_healthy)
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Failed to fetch sync status')
          setIsLoading(false)
        }
      } finally {
        if (isMounted) {
          // Schedule next poll
          timeoutId = setTimeout(fetchStatus, pollInterval)
        }
      }
    }

    // Initial fetch
    fetchStatus()

    return () => {
      isMounted = false
      if (timeoutId) clearTimeout(timeoutId)
    }
  }, [enabled, pollInterval, previousRailwayHealthy])

  return {
    status,
    isLoading,
    error,
    // Helper computed properties
    isStale: status ? isStatusStale(status) : false,
    railwayHealthy: status?.railway_healthy ?? false,
    isSyncing: status?.is_syncing ?? false,
  }
}

// Helper function to determine if data is stale (>5 min since last sync)
function isStatusStale(status: SyncStatusResponse): boolean {
  if (!status.last_sync) return true

  const lastSync = new Date(status.last_sync)
  const now = new Date()
  const minutesSinceSync = (now.getTime() - lastSync.getTime()) / (1000 * 60)

  return minutesSinceSync > 5
}
