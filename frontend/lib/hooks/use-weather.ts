"use client"

import { useEffect, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { apiClient } from "@/lib/api-client"
import { queryKeys } from "@/lib/query/keys"
import { serverClockOffset } from "@/lib/weather"

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
 * Polls also in a hidden tab (a wall's map). Polling stops for good once the backend answers
 * `enabled: false` (WEATHER_ENABLED=false): that is deployment configuration, it does not
 * change while the page is open. `active: false` (token mode without a token, tests) fetches
 * nothing.
 */
export function useWeather({ active = true, viewerToken }: { active?: boolean; viewerToken?: string } = {}) {
  const query = useQuery({
    queryKey: queryKeys.weather.of(viewerToken),
    queryFn: () => apiClient.getWeather(viewerToken),
    enabled: active,
    refetchInterval: (q) => (q.state.data?.enabled === false ? false : POLL_MS),
    refetchIntervalInBackground: true,
  })
  const weather = query.data ?? null
  const receivedAt = query.dataUpdatedAt
  const offset = weather ? serverClockOffset(weather.generated_at, receivedAt) : 0

  const [deviceNow, setDeviceNow] = useState(() => Date.now())
  const enabled = weather?.enabled === true
  useEffect(() => {
    if (!active || !enabled) return
    const tick = setInterval(() => setDeviceNow(Date.now()), CLOCK_MS)
    return () => clearInterval(tick)
  }, [active, enabled])

  return { weather: active ? weather : null, now: Math.max(deviceNow, receivedAt) + offset }
}
