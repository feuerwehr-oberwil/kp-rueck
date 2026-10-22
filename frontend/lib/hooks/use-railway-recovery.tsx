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
 *
 * `canSync` = the user is an admin (POST /api/sync/* is admin-only): only then does the
 * toast ask «Lokale Änderungen synchronisieren?» and offer «Jetzt synchronisieren».
 * Everyone else gets the bare «wieder online». The sync's progress toast is replaced
 * in place (same id) by its outcome, so it never spins on after the sync is done.
 */
export function useRailwayRecovery(
  status: SyncStatusResponse | null,
  canSync: boolean,
  options: UseRailwayRecoveryOptions = {}
) {
  const { onRecovery } = options
  const { isSidebarOpen } = useNotifications()
  const previousHealthyRef = useRef<boolean | null>(null)

  useEffect(() => {
    if (!status) return

    const wasUnhealthy = previousHealthyRef.current === false
    const isNowHealthy = status.railway_healthy === true

    // Detect Railway recovery (unhealthy → healthy transition), only if the sidebar is closed
    if (wasUnhealthy && isNowHealthy && !isSidebarOpen) {
      const title = translateOutsideReact('notifications.railway.backOnlineTitle')
      if (!canSync) {
        toast.success(title)
      } else {
        toast.success(title, {
          description: translateOutsideReact('notifications.railway.backOnlineDescription'),
          duration: 10000, // 10 seconds
          action: {
            label: translateOutsideReact('notifications.railway.syncNowLabel'),
            onClick: async () => {
              const id = toast.loading(translateOutsideReact('notifications.railway.syncing'))
              try {
                await apiClient.triggerSyncToRailway()
                toast.success(translateOutsideReact('notifications.railway.syncSuccess'), { id })
                onRecovery?.()
              } catch (error) {
                toast.error(
                  error instanceof Error
                    ? error.message
                    : translateOutsideReact('notifications.railway.syncFailed'),
                  { id }
                )
              }
            },
          },
        })
      }
    }

    // Update previous state
    previousHealthyRef.current = status.railway_healthy
  }, [status, canSync, onRecovery, isSidebarOpen])
}
