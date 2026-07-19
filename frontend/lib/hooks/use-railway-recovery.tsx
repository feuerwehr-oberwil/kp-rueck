'use client'

import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { translateOutsideReact } from '@/lib/i18n-messages'
import { apiClient } from '@/lib/api-client'
import { useNotifications } from '@/lib/contexts/notification-context'
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
  const { isSidebarOpen } = useNotifications()
  const previousHealthyRef = useRef<boolean | null>(null)

  useEffect(() => {
    if (!status) return

    const wasUnhealthy = previousHealthyRef.current === false
    const isNowHealthy = status.railway_healthy === true

    // Detect Railway recovery (unhealthy → healthy transition)
    if (wasUnhealthy && isNowHealthy && !isSidebarOpen) {
      // Show recovery notification with action to sync (only if sidebar is closed)
      toast.success(translateOutsideReact('notifications.railway.backOnlineTitle'), {
        description: translateOutsideReact('notifications.railway.backOnlineDescription'),
        duration: 10000, // 10 seconds
        action: {
          label: translateOutsideReact('notifications.railway.syncNowLabel'),
          onClick: async () => {
            try {
              toast.loading(translateOutsideReact('notifications.railway.syncing'))
              await apiClient.triggerSyncToRailway()
              toast.success(translateOutsideReact('notifications.railway.syncSuccess'))
              onRecovery?.()
            } catch (error) {
              toast.error(
                error instanceof Error
                  ? error.message
                  : translateOutsideReact('notifications.railway.syncFailed')
              )
            }
          },
        },
      })
    }

    // Update previous state
    previousHealthyRef.current = status.railway_healthy
  }, [status, onRecovery, isSidebarOpen])
}
