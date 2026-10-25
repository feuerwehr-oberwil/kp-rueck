"use client"

import { useCallback, useEffect, useState } from "react"
import { apiClient, type ApiVehiclePosition } from "@/lib/api-client"
import { usePolling } from "@/lib/hooks/use-polling"
import { wsClient } from "@/lib/websocket-client"

const POSITIONS_POLL_MS = 10_000

export interface VehiclePositions {
  positions: ApiVehiclePosition[]
  /** Traccar is set up on this deployment. False until it answered, and on any error. */
  configured: boolean
}

/**
 * The live GPS fixes from Traccar, for the Lagekarte (`MapView`) and the wall's
 * Statusanzeige. Asks once whether Traccar is configured; if so, the server
 * pushes `vehicle_positions_update` and a 10 s poll covers the gaps while the
 * socket is down. Errors are silent by design: Traccar is optional, and a
 * station without it would otherwise hear about it on every tick.
 *
 * `pauseWhenHidden: false` on the unattended walls (`/display/*`) – see
 * `usePolling`. `enabled: false` (token mode) asks nothing at all.
 */
export function useVehiclePositions({
  enabled = true,
  pauseWhenHidden = true,
}: { enabled?: boolean; pauseWhenHidden?: boolean } = {}): VehiclePositions {
  const [positions, setPositions] = useState<ApiVehiclePosition[]>([])
  const [configured, setConfigured] = useState(false)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    apiClient
      .getTraccarStatus()
      .then((status) => {
        if (!cancelled) setConfigured(status.configured)
      })
      .catch(() => {
        if (!cancelled) setConfigured(false)
      })
    return () => {
      cancelled = true
    }
  }, [enabled])

  const live = enabled && configured

  const fetchPositions = useCallback(async () => {
    try {
      setPositions(await apiClient.getVehiclePositions())
    } catch {
      // Silent: see above.
    }
  }, [])

  usePolling(fetchPositions, {
    intervalMs: POSITIONS_POLL_MS,
    enabled: live,
    pauseWhenHidden,
    skipWhileWsConnected: true,
  })

  useEffect(() => {
    if (!live) return
    return wsClient.on("vehicle_positions_update", (data: { data: ApiVehiclePosition[] }) => {
      setPositions(data.data)
    })
  }, [live])

  return { positions, configured }
}
