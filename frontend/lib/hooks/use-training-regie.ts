"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { apiClient } from "@/lib/api-client"
import type { ApiAutogenState, ApiRegieState } from "@/lib/api/types"
import { usePolling } from "@/lib/hooks/use-polling"
import { wsClient } from "@/lib/websocket-client"

/** Broadcasts after which the Regie state may have changed: its own, the board's, the
 *  Automatik switching itself off, and a drive starting or ending. */
const REFETCH_ON = ["training_regie", "incident_update", "training_autogen", "gps_sim_status"] as const

/**
 * The Übungs-Steuerung's state for the Übung `eventId` (null = not a training Ereignis:
 * nothing loads). Loaded once, again on every broadcast in `REFETCH_ON`, and by a slow poll
 * while the socket is down. Broadcasts come in bursts (a storm drill), so a refetch asked for
 * while one is under way runs once more after it instead of in parallel.
 *
 * `receivedAt` is when that state came (the paused countdowns stand on it).
 * `failed` says the last load did not get through; `reload` tries again.
 * `apply` takes the answer of the page's own writes (every Regie write returns the state).
 * `onAutomatikStoppedAtMax` runs once when THIS Übung's Automatik goes from on to «stopped at
 * the max» – the one change nobody on this page made.
 */
export function useTrainingRegie(eventId: string | null, onAutomatikStoppedAtMax: () => void) {
  // With the instant it came: a paused countdown stands at `due_at − receivedAt`.
  const [snapshot, setSnapshot] = useState<{ state: ApiRegieState; receivedAt: number } | null>(null)
  // The last load failed: the page offers «Erneut versuchen» instead of waiting forever.
  const [failed, setFailed] = useState(false)
  const previous = useRef<ApiAutogenState | null>(null)
  // The latest callback, without making `apply` (and so the poll) restart on every render.
  const announce = useRef(onAutomatikStoppedAtMax)
  useEffect(() => {
    announce.current = onAutomatikStoppedAtMax
  })

  const apply = useCallback(
    (next: ApiRegieState) => {
      if (next.event_id !== eventId) return
      const before = previous.current
      const after = next.automatik
      previous.current = after
      setSnapshot({ state: next, receivedAt: Date.now() })
      if (before?.enabled && !after.enabled && after.run?.stopped === "max" && after.run.event_id === eventId) {
        announce.current()
      }
    },
    [eventId],
  )

  const inFlight = useRef<Promise<void> | null>(null)
  const again = useRef(false)
  const load = useCallback((): Promise<void> => {
    if (!eventId) return Promise.resolve()
    if (inFlight.current) {
      again.current = true
      return inFlight.current
    }
    const run = async () => {
      try {
        do {
          again.current = false
          apply(await apiClient.getRegie(eventId))
        } while (again.current)
        setFailed(false)
      } catch (error) {
        setFailed(true)
        throw error
      }
    }
    inFlight.current = run().finally(() => {
      inFlight.current = null
    })
    return inFlight.current
  }, [eventId, apply])

  usePolling(load, { intervalMs: 15_000, enabled: !!eventId, skipWhileWsConnected: true })

  useEffect(() => {
    if (!eventId) return
    const refetch = () => void load().catch(() => {})
    const unsubscribe = REFETCH_ON.map((event) => wsClient.on(event, refetch))
    return () => unsubscribe.forEach((off) => off())
  }, [eventId, load])

  // A state of the previous Übung never shows on this one.
  const current = snapshot?.state.event_id === eventId ? snapshot : null
  return { state: current?.state ?? null, receivedAt: current?.receivedAt ?? 0, failed, apply, reload: load }
}
