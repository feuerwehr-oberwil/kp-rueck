'use client'

import { useEffect, useRef } from 'react'
import { apiClient } from '@/lib/api-client'
import { useEvent } from '@/lib/contexts/event-context'
import { useNotifications } from '@/lib/contexts/notification-context'
import type { RekoSummary } from '@/lib/contexts/operations-context'
import { rekoDangerTypes } from '@/lib/contexts/operations/mapping'
import { wsClient, type WebSocketStatus } from '@/lib/websocket-client'

/**
 * Hook to track new Reko reports across all incidents and update operation state.
 * Notifications are now handled by the backend notification system and shown in the sidebar.
 *
 * ⚠️ One request per check, never one per card. This used to fetch every card's reports
 * separately, and its effect depended on the board's `operations` array, which every reload
 * replaces. So every remote change cost each open device one request per card: 500 for one
 * change on a 500-card board, measured with `just fat-perf` (docs/FAT_EVENT_PERF.md), and
 * about 9 % of all prod traffic in June 2026. It now reads the same bulk summaries the board
 * loads (latest submitted report per incident), and runs only on mount, on `reko_update`
 * and on the fallback poll.
 */
export function useRekoNotifications(
  onOpenIncidentModal?: (incidentId: string) => void,
  onUpdateOperationReko?: (incidentId: string, rekoSummary: RekoSummary) => void
) {
  const { selectedEvent } = useEvent()
  const { refetchNotifications } = useNotifications()
  // `incident_id@submitted_at` of the latest submitted report per incident: a newer report on
  // the same incident moves its submitted_at, so it reads as new too
  const seenRef = useRef<Set<string> | null>(null)
  // the callbacks change identity with their parents' renders; reading them through refs keeps
  // the effect below from re-running (and re-fetching) every time they do
  const onUpdateRef = useRef(onUpdateOperationReko)
  onUpdateRef.current = onUpdateOperationReko
  const refetchRef = useRef(refetchNotifications)
  refetchRef.current = refetchNotifications
  const eventId = selectedEvent?.id

  useEffect(() => {
    if (!eventId) {
      return
    }
    seenRef.current = null
    let cancelled = false

    const checkForNewRekos = async () => {
      try {
        const { summaries } = await apiClient.getEventRekoSummaries(eventId)
        if (cancelled) return
        const submitted = Object.values(summaries).filter((s) => s.has_completed_reko && s.submitted_at)
        const keys = new Set(submitted.map((s) => `${s.incident_id}@${s.submitted_at}`))

        // On initial load, just mark all as seen without notifications
        const seen = seenRef.current
        seenRef.current = keys
        if (!seen) return

        const newReports = submitted.filter((s) => !seen.has(`${s.incident_id}@${s.submitted_at}`))
        if (newReports.length === 0) return

        // Update operation with REKO summary immediately
        for (const report of newReports) {
          const dangerTypes = rekoDangerTypes(report.dangers_json)
          onUpdateRef.current?.(report.incident_id, {
            isRelevant: report.is_relevant ?? false,
            hasDangers: dangerTypes.length > 0,
            dangerTypes,
            personnelCount: report.effort_json?.personnel_count ?? null,
            estimatedDuration: report.effort_json?.estimated_duration_hours ?? null,
            summaryText: report.summary_text ?? null,
            photos: report.photos_json ?? [],
          })
        }

        // Trigger notification refetch to show new reko notifications in sidebar
        refetchRef.current()
      } catch (error) {
        console.error('Failed to check for new rekos:', error)
      }
    }

    // Check immediately
    checkForNewRekos()

    // Listen for WebSocket reko updates
    const unsubscribeReko = wsClient.on('reko_update', () => {
      checkForNewRekos()
    })

    // Fallback polling when WebSocket is disconnected
    let pollIntervalId: NodeJS.Timeout | undefined

    const startPolling = () => {
      if (!pollIntervalId) {
        pollIntervalId = setInterval(checkForNewRekos, 10000)
      }
    }

    const stopPolling = () => {
      if (pollIntervalId) {
        clearInterval(pollIntervalId)
        pollIntervalId = undefined
      }
    }

    const unsubscribeStatus = wsClient.onStatusChange((status: WebSocketStatus) => {
      if (status === 'disconnected' || status === 'error') {
        startPolling()
      } else if (status === 'connected') {
        stopPolling()
      }
    })

    return () => {
      cancelled = true
      unsubscribeReko()
      unsubscribeStatus()
      stopPolling()
    }
  }, [eventId])
}
