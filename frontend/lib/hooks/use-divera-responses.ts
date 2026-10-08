"use client"

import { useCallback, useEffect, useState } from "react"
import { apiClient } from "@/lib/api-client"
import type { ApiDiveraResponsesSummary } from "@/lib/api/types"
import { usePolling } from "@/lib/hooks/use-polling"
import { wsClient } from "@/lib/websocket-client"

/**
 * The Divera Rückmeldungen of one Ereignis, kept fresh only while a block shows them.
 *
 * The backend stores what its Divera poll already fetched and pushes
 * `divera_responses_update` when it changed, so with a live socket this reads once and then
 * on that event; without one it falls back to the board's ~5 s rhythm. Nothing here talks to
 * Divera. `null` until the first answer — the caller shows nothing rather than a loader for a
 * block that may not exist at all. Divera not configured → it stops asking.
 */
export function useDiveraResponses(eventId: string | null, enabled: boolean): ApiDiveraResponsesSummary | null {
  const [summary, setSummary] = useState<ApiDiveraResponsesSummary | null>(null)

  useEffect(() => {
    setSummary(null)
  }, [eventId])

  const load = useCallback(async () => {
    if (!eventId) return
    try {
      setSummary(await apiClient.getEventDiveraResponses(eventId))
    } catch {
      // Keep what is on screen; the next tick or push tries again.
    }
  }, [eventId])

  const notConfigured = summary?.reason === "not_configured"
  const active = enabled && !!eventId && !notConfigured

  usePolling(load, { intervalMs: 5000, enabled: active, skipWhileWsConnected: true })

  useEffect(() => {
    if (!active || !eventId) return
    return wsClient.on("divera_responses_update", (message: { event_ids?: string[] } | undefined) => {
      if (!message?.event_ids || message.event_ids.includes(eventId)) void load()
    })
  }, [active, eventId, load])

  return summary
}
