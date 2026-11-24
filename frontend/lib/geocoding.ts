/**
 * Address lookup through the authenticated, operator-configured backend.
 *
 * Credentials travel with every lookup, whichever page asks: the board's session cookie, the
 * bound /feld device (cookie scoped to /feld, so it goes in a header), or on /alarm – a token
 * link with no login – the link's own token. `searchAddress` answers null when the lookup
 * failed, so the field can say «nicht erreichbar» instead of «Keine Adressen gefunden.»
 */
import { z } from 'zod'
import { getApiUrl } from './env'
import { haversineKm } from './utils/route-geo'

const suggestionSchema = z.object({
  id: z.string(),
  display_name: z.string(),
  lat: z.number().finite().min(-90).max(90),
  lon: z.number().finite().min(-180).max(180),
  formattedAddress: z.string(),
  attribution: z.string().optional(),
})
export type SearchResult = z.infer<typeof suggestionSchema>

interface SearchOptions {
  stationCenter?: [number, number]
  viewbox?: [number, number, number, number]
  countryCodes?: string
  signal?: AbortSignal
}

/** Field cookies are scoped to /feld; forward the bound device credential in a header.
 *  /alarm has no login: forward its link token (`?token=`) instead. */
function requestHeaders(): Headers {
  const headers = new Headers()
  if (typeof document !== 'undefined') {
    const token = document.cookie.split(';').map(part => part.trim())
      .find(part => part.startsWith('feld-device-token='))?.slice('feld-device-token='.length)
    if (token) headers.set('X-Feld-Token', token)
    const intakeToken = window.location.pathname.replace(/\/$/, '') === '/alarm'
      ? new URLSearchParams(window.location.search).get('token')
      : null
    if (intakeToken) headers.set('X-Intake-Token', intakeToken)
  }
  return headers
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted()
    const abort = () => { clearTimeout(timer); reject(signal.reason) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, ms)
    signal.addEventListener('abort', abort, { once: true })
  })
}

/** Bound retries and elapsed time; superseded searches cancel both fetch and retry waits. */
async function lookup(path: string, params: URLSearchParams, callerSignal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController()
  const { signal } = controller
  const abortFromCaller = () => controller.abort(callerSignal?.reason)
  if (callerSignal?.aborted) abortFromCaller()
  else callerSignal?.addEventListener('abort', abortFromCaller, { once: true })
  // A single deadline covers fetch, response consumption, and every retry wait.
  const timeout = setTimeout(() => controller.abort(new DOMException('Address lookup timed out', 'TimeoutError')), 10_000)
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      signal.throwIfAborted()
      const response = await fetch(`${getApiUrl()}/api/geocoding/${path}?${params}`, {
        credentials: 'include', headers: requestHeaders(), signal,
      })
      if (response.status === 429 && attempt < 2) {
        const retry = Number(response.headers.get('Retry-After') ?? 2)
        await pause(Math.min(3, Math.max(1, Number.isFinite(retry) ? retry : 2)) * 1000, signal)
        continue
      }
      if (!response.ok) return null
      return await response.json()
    }
    return null
  } finally {
    clearTimeout(timeout)
    callerSignal?.removeEventListener('abort', abortFromCaller)
  }
}

const DEFAULT_COUNTRY_CODES = 'ch'

/** Half-width of the search bias box around the station, in degrees (~5 km). */
const VIEWBOX_DELTA = 0.05

/**
 * Create a viewbox around the station center for search prioritization.
 * Returns a string in format "minLon,minLat,maxLon,maxLat".
 *
 * This used to be a lookup table of the sixteen municipalities around one
 * station, which meant every other station fell through to a hardcoded Basel
 * region box. The configured coordinates are the station, whoever it is.
 */
function getViewboxForCenter([lon, lat]: [number, number]): string {
  // Rounded: the subtraction leaves float noise (47.373000000000005), and ~10 cm
  // of precision is already far finer than a search-bias box needs.
  const round = (n: number) => Number(n.toFixed(6))
  return [
    round(lon - VIEWBOX_DELTA),
    round(lat - VIEWBOX_DELTA),
    round(lon + VIEWBOX_DELTA),
    round(lat + VIEWBOX_DELTA),
  ].join(',')
}

/** Search results retain the configured station's distance ordering. Null: the lookup failed
 *  (refused, unavailable, timed out, cancelled or malformed) – not the same as no address. */
export async function searchAddress(query: string, options?: SearchOptions): Promise<SearchResult[] | null> {
  const trimmed = query.trim()
  if (trimmed.length < 3 || trimmed.length > 200) return []
  const params = new URLSearchParams({ q: trimmed, countrycodes: options?.countryCodes || DEFAULT_COUNTRY_CODES })
  const viewbox = options?.viewbox?.join(',') ?? (options?.stationCenter ? getViewboxForCenter(options.stationCenter) : null)
  if (viewbox) params.set('viewbox', viewbox)
  try {
    const parsed = suggestionSchema.array().max(10).safeParse(await lookup('search', params, options?.signal))
    if (!parsed.success) return null
    if (options?.stationCenter) {
      const [lon, lat] = options.stationCenter
      parsed.data.sort((a, b) => haversineKm([a.lat, a.lon], [lat, lon]) - haversineKm([b.lat, b.lon], [lat, lon]))
    }
    return parsed.data
  } catch {
    // Unavailable providers and cancelled searches leave manual location entry usable.
    return null
  }
}

export async function geocodeAddress(address: string, options?: SearchOptions): Promise<{ lat: number; lon: number } | null> {
  const [first] = (await searchAddress(address, options)) ?? []
  return first ? { lat: first.lat, lon: first.lon } : null
}

export async function reverseGeocode(lat: number, lon: number, signal?: AbortSignal): Promise<string | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
  try {
    const params = new URLSearchParams({ lat: String(lat), lon: String(lon) })
    const parsed = z.object({ address: z.string().nullable() }).safeParse(await lookup('reverse', params, signal))
    return parsed.success ? parsed.data.address : null
  } catch {
    return null
  }
}
