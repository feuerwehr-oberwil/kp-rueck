"use client"

import { useCallback, useEffect, useState } from "react"
import { apiClient, type ApiEventFigures } from "@/lib/api-client"
import { usePolling } from "@/lib/hooks/use-polling"

export interface EventFiguresState {
  figures: ApiEventFigures | null
  /** The last load failed; `figures` keeps the last good answer (if any). */
  failed: boolean
}

/**
 * The Kennzahlen of one Ereignis, kept fresh while somebody looks at them.
 *
 * Read off `GET /events/{id}/stats` (`figures`), whose reaction times are the PDF's
 * own computation. Polls every 10 s while `enabled`: the numbers are aggregates over
 * the whole Ereignis, a few seconds behind the board is fine, and the oldest-waiting
 * age re-renders with each answer. `pauseWhenHidden` is the caller's — a wall passes
 * false (see `usePolling`).
 */
export function useEventFigures(
  eventId: string | null | undefined,
  { enabled = true, pauseWhenHidden = true }: { enabled?: boolean; pauseWhenHidden?: boolean } = {},
): EventFiguresState {
  const [state, setState] = useState<EventFiguresState>({ figures: null, failed: false })

  // A different Ereignis must not show the previous one's numbers while it loads.
  useEffect(() => {
    setState({ figures: null, failed: false })
  }, [eventId])

  const load = useCallback(async () => {
    if (!eventId) return
    try {
      const stats = await apiClient.getEventStats(eventId)
      if (!stats?.figures) {
        setState((prev) => ({ ...prev, failed: true }))
        return
      }
      setState({ figures: stats.figures, failed: false })
    } catch {
      setState((prev) => ({ ...prev, failed: true }))
    }
  }, [eventId])

  usePolling(load, { intervalMs: 10_000, enabled: enabled && !!eventId, pauseWhenHidden })
  return state
}
