"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { apiClient } from "@/lib/api-client"
import type { ApiAutogenState } from "@/lib/api/types"
import { usePolling } from "@/lib/hooks/use-polling"
import { wsClient } from "@/lib/websocket-client"

/**
 * The training Automatik's switch and run, for the Übungssteuerung of `eventId` (null = not a
 * training Ereignis: nothing loads). Loaded once, then on every `training_autogen` WebSocket
 * message (a switch from another device, or the backend monitor stopping itself at the
 * maximum), and by a slow poll while the socket is down.
 *
 * `onStoppedAtMax` runs once when THIS Übung's Automatik goes from on to «stopped at the max» –
 * the one change nobody on this page made. `apply` takes the answer of the page's own switch.
 */
export function useTrainingAutogen(eventId: string | null, onStoppedAtMax: () => void) {
  const [state, setState] = useState<ApiAutogenState | null>(null)
  const previous = useRef<ApiAutogenState | null>(null)
  // The latest callback, without making `apply` (and so the poll) restart on every render.
  const announce = useRef(onStoppedAtMax)
  useEffect(() => {
    announce.current = onStoppedAtMax
  })

  const apply = useCallback(
    (next: ApiAutogenState) => {
      const before = previous.current
      previous.current = next
      setState(next)
      if (before?.enabled && !next.enabled && next.run?.stopped === "max" && next.run.event_id === eventId) {
        announce.current()
      }
    },
    [eventId],
  )

  const load = useCallback(async () => {
    if (!eventId) return
    apply(await apiClient.getAutogen())
  }, [eventId, apply])

  usePolling(load, { intervalMs: 30_000, enabled: !!eventId, skipWhileWsConnected: true })

  useEffect(() => {
    if (!eventId) return
    return wsClient.on("training_autogen", () => void load().catch(() => {}))
  }, [eventId, load])

  return { state, apply }
}
