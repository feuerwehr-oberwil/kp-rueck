'use client'

import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'
import type { SyncStatusResponse } from '@/types/sync'

interface UseRailwayRecoveryOptions {
  onRecovery?: () => void
}

/**
 * Hook that detects when Railway recovers from an outage and shows a notification.
 * Watches sync status for unhealthy → healthy transitions.
 */
export function useRailwayRecovery(
  status: SyncStatusResponse | null,
  options: UseRailwayRecoveryOptions = {}
) {
  const { onRecovery } = options
  const previousHealthyRef = useRef<boolean | null>(null)

  useEffect(() => {
    if (!status) return

    const wasUnhealthy = previousHealthyRef.current === false
    const isNowHealthy = status.railway_healthy === true

    // Detect Railway recovery (unhealthy → healthy transition)
    if (wasUnhealthy && isNowHealthy) {
      // Show recovery notification with action to sync
      toast.success('Railway ist wieder online!', {
        description: 'Lokale Änderungen zu Railway synchronisieren?',
        duration: 10000, // 10 seconds
        action: {
          label: 'Jetzt synchronisieren',
          onClick: async () => {
            try {
              toast.loading('Synchronisiere zu Railway...')
              await apiClient.triggerSyncToRailway()
              toast.success('Erfolgreich zu Railway synchronisiert')
              onRecovery?.()
            } catch (error) {
              toast.error(
                error instanceof Error
                  ? error.message
                  : 'Synchronisation zu Railway fehlgeschlagen'
              )
            }
          },
        },
      })
    }

    // Update previous state
    previousHealthyRef.current = status.railway_healthy
  }, [status, onRecovery])
}
