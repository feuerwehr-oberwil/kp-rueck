"use client"

import { useEffect, useState } from "react"
import { apiClient } from "@/lib/api-client"
import type { ApiWeather } from "@/lib/weather"

/** The backend polls the feeds every 5/10 minutes; asking it every minute keeps the board at
 *  most a minute behind it, for a few hundred bytes. */
const POLL_MS = 60_000
/** Staleness is re-evaluated on this tick even when no new answer comes. */
const CLOCK_MS = 30_000

/**
 * The weather layer's data for a map: the last good `GET /api/weather/` answer (kept through a
 * failed poll – the layer labels it with its own time), and a clock that keeps ticking so
 * «veraltet» appears on its own when the answers stop.
 *
 * `active: false` (token mode without a token, tests) fetches nothing.
 */
export function useWeather({ active = true, viewerToken }: { active?: boolean; viewerToken?: string } = {}) {
  const [weather, setWeather] = useState<ApiWeather | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!active) return
    let cancelled = false
    const load = async () => {
      try {
        const next = await apiClient.getWeather(viewerToken)
        if (!cancelled) setWeather(next)
      } catch {
        // Keep the last answer: it carries its own timestamps and goes «veraltet» by itself.
      }
    }
    load()
    const poll = setInterval(load, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(poll)
    }
  }, [active, viewerToken])

  useEffect(() => {
    if (!active) return
    const tick = setInterval(() => setNow(Date.now()), CLOCK_MS)
    return () => clearInterval(tick)
  }, [active])

  return { weather: active ? weather : null, now }
}
