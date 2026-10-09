"use client"

import { useEffect, useState } from "react"
import { apiClient } from "@/lib/api-client"
import { serverClockOffset, type ApiWeather } from "@/lib/weather"

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
 * `now` is the BACKEND's time (device clock + the offset measured on every answer, see
 * `serverClockOffset`), so a device with a wrong clock judges staleness like the server does.
 *
 * Polling stops for good once the backend answers `enabled: false` (WEATHER_ENABLED=false):
 * that is deployment configuration, it does not change while the page is open.
 * `active: false` (token mode without a token, tests) fetches nothing.
 */
export function useWeather({ active = true, viewerToken }: { active?: boolean; viewerToken?: string } = {}) {
  const [weather, setWeather] = useState<ApiWeather | null>(null)
  const [offset, setOffset] = useState(0)
  const [deviceNow, setDeviceNow] = useState(() => Date.now())

  useEffect(() => {
    if (!active) return
    let cancelled = false
    let poll: ReturnType<typeof setInterval> | null = null
    const load = async () => {
      try {
        const next = await apiClient.getWeather(viewerToken)
        if (cancelled) return
        const receivedAt = Date.now()
        setWeather(next)
        setOffset(serverClockOffset(next.generated_at, receivedAt))
        setDeviceNow(receivedAt)
        if (!next.enabled && poll) {
          clearInterval(poll)
          poll = null
        }
      } catch {
        // Keep the last answer: it carries its own timestamps and goes «veraltet» by itself.
      }
    }
    poll = setInterval(load, POLL_MS)
    load()
    return () => {
      cancelled = true
      if (poll) clearInterval(poll)
    }
  }, [active, viewerToken])

  const enabled = weather?.enabled === true
  useEffect(() => {
    if (!active || !enabled) return
    const tick = setInterval(() => setDeviceNow(Date.now()), CLOCK_MS)
    return () => clearInterval(tick)
  }, [active, enabled])

  return { weather: active ? weather : null, now: deviceNow + offset }
}
