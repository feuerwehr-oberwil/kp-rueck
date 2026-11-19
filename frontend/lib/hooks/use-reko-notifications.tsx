'use client'

import { useCallback, useEffect, useRef } from 'react'
import { apiClient } from '@/lib/api-client'
import { useEvent } from '@/lib/contexts/event-context'
import { useNotifications } from '@/lib/contexts/notification-context'
import type { Operation, RekoSummary } from '@/lib/contexts/operations-context'
import { rekoDangerTypes } from '@/lib/contexts/operations/mapping'
import { wsClient } from '@/lib/websocket-client'
import { usePolling } from '@/lib/hooks/use-polling'

/**
 * The card with its Reko summary – nothing else. The card's status is the server's: a filing
 * moves «Reko» → «Reko abgeschlossen» there and the incident update brings it here. Moving it
 * on this side too put a card into «Reko abgeschlossen» on this board only, when a report filed
 * while the card stood elsewhere was amended after it went back to «Reko» (Sol review pass 5, S1).
 */
export function withRekoSummary(operations: Operation[], incidentId: string, rekoSummary: RekoSummary): Operation[] {
  return operations.map(op => (op.id === incidentId ? { ...op, hasCompletedReko: true, rekoSummary } : op))
}

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
 * and on the fallback poll (`usePolling`, only while the socket is down).
 *
 * A NEW filing (its `submitted_at` moved) updates the card and refetches the bell; a changed
 * summary of the same filing – the board's Reko form auto-saves amendments and each one
 * emits `reko_update` – updates the card only (Sol review pass 4, S6).
 */
export function useRekoNotifications(
  onOpenIncidentModal?: (incidentId: string) => void,
  onUpdateOperationReko?: (incidentId: string, rekoSummary: RekoSummary) => void
) {
  const { selectedEvent } = useEvent()
  const { refetchNotifications } = useNotifications()
  // Per incident, the latest submitted report as last applied: its `submitted_at` (a newer
  // report moves it, so it reads as a new filing) and the summary the card was given.
  const seenRef = useRef<{ eventId: string; reports: Map<string, { submittedAt: string; summary: string }> } | null>(null)
  // the callbacks change identity with their parents' renders; reading them through refs keeps
  // the effect below from re-running (and re-fetching) every time they do
  const onUpdateRef = useRef(onUpdateOperationReko)
  onUpdateRef.current = onUpdateOperationReko
  const refetchRef = useRef(refetchNotifications)
  refetchRef.current = refetchNotifications
  const eventId = selectedEvent?.id
  // The Ereignis the answers are for: a check still in flight when the operator
  // switches must not mark the new one's reports seen or touch its cards.
  const activeEventRef = useRef(eventId)
  activeEventRef.current = eventId

  const checkForNewRekos = useCallback(async () => {
    if (!eventId) return
    try {
      const { summaries } = await apiClient.getEventRekoSummaries(eventId)
      if (activeEventRef.current !== eventId) return
      const submitted = Object.values(summaries).filter((s) => s.has_completed_reko && s.submitted_at)
      const current = new Map(submitted.map((report) => {
        const dangerTypes = rekoDangerTypes(report.dangers_json)
        const rekoSummary: RekoSummary = {
          isRelevant: report.is_relevant ?? null,
          hasDangers: dangerTypes.length > 0,
          dangerTypes,
          personnelCount: report.effort_json?.personnel_count ?? null,
          estimatedDuration: report.effort_json?.estimated_duration_hours ?? null,
          summaryText: report.summary_text ?? null,
          photos: report.photos_json ?? [],
        }
        return [report.incident_id, { submittedAt: report.submitted_at ?? '', rekoSummary }] as const
      }))

      // On the first answer for this Ereignis, just mark all as seen without notifications
      const seen = seenRef.current?.eventId === eventId ? seenRef.current.reports : null
      seenRef.current = {
        eventId,
        reports: new Map([...current].map(([id, { submittedAt, rekoSummary }]) => [id, { submittedAt, summary: JSON.stringify(rekoSummary) }])),
      }
      if (!seen) return

      let filed = false
      for (const [incidentId, { submittedAt, rekoSummary }] of current) {
        const before = seen.get(incidentId)
        const isNewFiling = before?.submittedAt !== submittedAt
        if (!isNewFiling && before?.summary === JSON.stringify(rekoSummary)) continue
        filed ||= isNewFiling
        onUpdateRef.current?.(incidentId, rekoSummary)
      }

      // A new filing rings the backend's bell: show it in the sidebar.
      if (filed) refetchRef.current()
    } catch (error) {
      console.error('Failed to check for new rekos:', error)
    }
  }, [eventId])

  // `reko_update` pushes; the poll covers the gaps while the socket is down.
  usePolling(checkForNewRekos, { intervalMs: 10000, enabled: !!eventId, skipWhileWsConnected: true })
  useEffect(() => {
    if (!eventId) return
    return wsClient.on('reko_update', () => {
      void checkForNewRekos()
    })
  }, [eventId, checkForNewRekos])
}
