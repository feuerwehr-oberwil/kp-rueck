'use client'

import { useCallback } from 'react'
import { apiClient } from '@/lib/api-client'
import { toast } from 'sonner'

/**
 * Hook for triggering event-based sync.
 * Call triggerSync() after creating incidents/events to immediately sync to Railway.
 */
export function useAutoSync() {
  const triggerSync = useCallback(async () => {
    try {
      await apiClient.triggerImmediateSync()
      // Don't show toast for auto-sync - it should be silent
    } catch (error) {
      // Log error but don't show toast - auto-sync failures shouldn't interrupt user flow
      console.error('[Auto-Sync] Failed:', error)
    }
  }, [])

  return { triggerSync }
}
