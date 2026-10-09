/**
 * Weather layer – what the map shows from `GET /api/weather/` (backend: app/services/weather/).
 *
 * Three rules the helpers here keep:
 * - **Never old as current.** A source is stale once its data is older than the backend's
 *   `stale_after_seconds`, measured on the BACKEND's clock (device clock + `serverClockOffset`) –
 *   if the backend itself is unreachable the last answer keeps aging on screen instead of
 *   freezing as «fresh».
 * - **Verbatim.** A MeteoSwiss warning may only be passed on unaltered (MetO art. 5): the texts
 *   are picked by language, never shortened or rephrased. The chip shows the source's own
 *   `event` word; the full text is one tap away.
 * - **Expired is gone, not stale.** A warning past its `expires` disappears immediately.
 */

export interface WeatherSourceStatus {
  last_attempt_at: string | null
  last_success_at: string | null
  last_error: string | null
  last_error_at: string | null
  stale?: boolean | null
}

export interface WeatherRadarFrame {
  key: string
  time: string
}

export interface WeatherRadar {
  frames: WeatherRadarFrame[]
  /** MapLibre image-source corners: top-left, top-right, bottom-right, bottom-left, [lon, lat]. */
  coordinates: [number, number][] | null
  data_time: string | null
  stale: boolean
  stale_after_seconds: number
  status: WeatherSourceStatus
  legend: { min_mm_h: number; color: string }[]
  attribution: string
  source_url: string
}

export interface WeatherWarningText {
  event: string
  headline: string
  description: string
  instructions: string[]
}

export type WeatherWarningSource = 'meteoswiss' | 'alertswiss'

export interface WeatherWarning {
  id: string
  source: WeatherWarningSource
  /** 1 minor · 2 yellow · 3 orange · 4 red */
  level: number
  color: string | null
  kind: string | null
  sent: string | null
  onset: string | null
  expires: string | null
  sender: string
  link: string | null
  region: string
  texts: Record<string, WeatherWarningText>
  fetched_at: string | null
}

export interface ApiWeather {
  enabled: boolean
  station_configured: boolean
  generated_at: string | null
  radar: WeatherRadar | null
  warnings: {
    items: WeatherWarning[]
    sources: Record<string, WeatherSourceStatus>
    stale_after_seconds: number
  } | null
}

/** MeteoAlarm's awareness colours, the ones the warning maps use. 1 = information only. */
export const WARNING_LEVEL_COLORS: Record<number, string> = {
  1: '#94a3b8',
  2: '#facc15',
  3: '#f97316',
  4: '#dc2626',
}

export function warningLevelColor(level: number): string {
  return WARNING_LEVEL_COLORS[Math.min(4, Math.max(1, Math.round(level)))]
}

/** Is data from `time` older than the source's limit at `now`? No time at all counts as stale. */
export function isStale(time: string | null | undefined, staleAfterSeconds: number, now: number): boolean {
  if (!time) return true
  const at = Date.parse(time)
  if (Number.isNaN(at)) return true
  return now - at > staleAfterSeconds * 1000
}

/** The backend already called it stale, or it has aged past the limit since. */
export function radarIsStale(radar: WeatherRadar, now: number): boolean {
  return radar.stale || isStale(radar.data_time, radar.stale_after_seconds, now)
}

/**
 * How far the backend's clock is ahead of this device's (ms): `generated_at` minus the moment the
 * answer arrived. All staleness is judged on «device now + offset» – the backend's clock, which
 * also stamped the data – so a tablet whose clock is ten minutes off neither greys out fresh rain
 * nor passes old rain as current. Between answers the device clock keeps it running, so a
 * backend that stops answering still ages on screen. (Network latency adds at most a second.)
 */
export function serverClockOffset(generatedAt: string | null | undefined, receivedAt: number): number {
  if (!generatedAt) return 0
  const at = Date.parse(generatedAt)
  return Number.isNaN(at) ? 0 : at - receivedAt
}

/** The warnings still in force (or still to come) at `now`, highest level first. */
export function activeWarnings(weather: ApiWeather | null, now: number): WeatherWarning[] {
  const items = weather?.warnings?.items ?? []
  return items
    .filter((warning) => !warning.expires || Date.parse(warning.expires) > now)
    .sort((a, b) => b.level - a.level)
}

export function warningIsStale(weather: ApiWeather, warning: WeatherWarning, now: number): boolean {
  return isStale(warning.fetched_at, weather.warnings?.stale_after_seconds ?? 0, now)
}

/** The source's own text in the board's language – German, then anything, as fallbacks. */
export function warningText(warning: WeatherWarning, locale: string): WeatherWarningText {
  return (
    warning.texts[locale] ??
    warning.texts.de ??
    Object.values(warning.texts)[0] ?? { event: '', headline: '', description: '', instructions: [] }
  )
}

/** The newest frame index, or -1 without frames. */
export function latestFrameIndex(radar: WeatherRadar | null | undefined): number {
  return (radar?.frames.length ?? 0) - 1
}

/** Minutes between a frame and the newest one (0 for the newest itself). */
export function frameAgeMinutes(radar: WeatherRadar, index: number): number {
  const frames = radar.frames
  if (index < 0 || index >= frames.length) return 0
  return Math.round((Date.parse(frames[frames.length - 1].time) - Date.parse(frames[index].time)) / 60000)
}

/** «17:05», or «Fr 08:00» when the moment is not today (device-local, Swiss formatting). */
export function formatWeatherTime(iso: string, intlLocale: string, now: number): string {
  const date = new Date(iso)
  const time = date.toLocaleTimeString(intlLocale, { hour: '2-digit', minute: '2-digit' })
  if (new Date(now).toDateString() === date.toDateString()) return time
  const day = date.toLocaleDateString(intlLocale, { weekday: 'short' }).replace(/\.$/, '')
  return `${day} ${time}`
}

/** The «Wetter» layer switch, remembered per device – shared by /map and /display/map, like
 *  «Färben nach». Off by default: the radar is something you look at on purpose. */
export const WEATHER_LAYER_STORAGE_KEY = 'kp-map-weather'

export function readWeatherLayerPref(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(WEATHER_LAYER_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function writeWeatherLayerPref(on: boolean): void {
  try {
    window.localStorage.setItem(WEATHER_LAYER_STORAGE_KEY, on ? '1' : '0')
  } catch {
    // Private mode / storage full: the switch still works for this visit.
  }
}
