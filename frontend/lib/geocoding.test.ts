import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { reverseGeocode, searchAddress } from './geocoding'

/**
 * Address search used to bias towards whichever of sixteen hardcoded Basel-Landschaft
 * municipalities matched the home_city string, and fell back to a fixed Basel-region box
 * for everything else. Every station outside that list therefore had its address search
 * weighted towards a region it is nowhere near — silently, because biased results still
 * look like results. The bias now comes from the station's own configured coordinates.
 */

const originalFetch = globalThis.fetch

/** Normalized rows, deliberately returned far-then-near to prove the sort runs. */
const NOMINATIM_ROWS = [
  { id: 'far', display_name: 'Far', lat: 47.9, lon: 8, formattedAddress: 'Fernweg 1' },
  { id: 'near', display_name: 'Near', lat: 47.51, lon: 7.555, formattedAddress: 'Nahweg 2' },
]

function paramsOfLastCall(): URLSearchParams {
  const [url] = vi.mocked(fetch).mock.calls[0]
  return new URL(String(url), 'http://localhost').searchParams
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, json: async () => NOMINATIM_ROWS })
  )
})

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.unstubAllGlobals()
})

describe('searchAddress', () => {
  it('biases the search box around the configured station coordinates', async () => {
    await searchAddress('Hauptstrasse', { stationCenter: [9.377, 47.423] })

    const viewbox = paramsOfLastCall().get('viewbox')
    expect(viewbox).toBe('9.327,47.373,9.427,47.473')
  })

  it('sorts results by distance from the station, nearest first', async () => {
    const results = await searchAddress('weg', { stationCenter: [7.555, 47.515] })

    expect(results.map((r) => r.display_name)).toEqual(['Near', 'Far'])
  })

  it('sends no viewbox when the station has no coordinates configured', async () => {
    // The regression that mattered: this used to fall back to a fixed Basel box,
    // so an unconfigured station was quietly weighted towards someone else's canton.
    await searchAddress('Hauptstrasse')

    const params = paramsOfLastCall()
    expect(params.get('viewbox')).toBeNull()
    expect(params.get('bounded')).toBeNull()
  })

  it('leaves result order alone when there is nothing to sort by', async () => {
    const results = await searchAddress('weg')

    expect(results.map((r) => r.display_name)).toEqual(['Far', 'Near'])
  })

  it('restricts to Switzerland by default', async () => {
    await searchAddress('Hauptstrasse')

    expect(paramsOfLastCall().get('countrycodes')).toBe('ch')
  })

  it('accepts a country override so a deployment across the border can search', async () => {
    await searchAddress('Hauptstrasse', { countryCodes: 'de,at' })

    expect(paramsOfLastCall().get('countrycodes')).toBe('de,at')
  })
})


describe('authenticated geocoding transport', () => {
  it('uses the backend and includes login cookies', async () => {
    await searchAddress('Testweg')
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toContain('/api/geocoding/search?')
    expect(String(url)).not.toContain('nominatim')
    expect(init?.credentials).toBe('include')
  })

  it('forwards field credentials only in a header', async () => {
    document.cookie = 'feld-device-token=test-bound-device; path=/'
    try {
      await searchAddress('Testweg')
      const [url, init] = vi.mocked(fetch).mock.calls[0]
      expect(new Headers(init?.headers).get('X-Feld-Token')).toBe('test-bound-device')
      expect(String(url)).not.toContain('test-bound-device')
    } finally {
      document.cookie = 'feld-device-token=; Max-Age=0; path=/'
    }
  })

  it('rejects malformed coordinates from a provider', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify([{ ...NOMINATIM_ROWS[0], lat: 999 }])))
    expect(await searchAddress('Testweg')).toEqual([])
  })

  it('cancels a superseded search during rate-limit backoff', async () => {
    vi.useFakeTimers()
    try {
      vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 429, headers: { 'Retry-After': '2' } }))
      const controller = new AbortController()
      const result = searchAddress('Testweg', { signal: controller.signal })
      await vi.advanceTimersByTimeAsync(0)
      controller.abort()
      expect(await result).toEqual([])
      await vi.advanceTimersByTimeAsync(5000)
      expect(fetch).toHaveBeenCalledTimes(1)
    } finally { vi.useRealTimers() }
  })

  it('retries busy responses a bounded number of times', async () => {
    vi.useFakeTimers()
    try {
      vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 429, headers: { 'Retry-After': '2' } }))
      const result = searchAddress('Testweg')
      await vi.advanceTimersByTimeAsync(6000)
      expect(await result).toEqual([])
      expect(fetch).toHaveBeenCalledTimes(3)
    } finally { vi.useRealTimers() }
  })

  it('normalizes reverse results and handles provider unavailability', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ address: 'Testweg 1' })))
    expect(await reverseGeocode(47, 8)).toBe('Testweg 1')
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 503 }))
    expect(await reverseGeocode(47, 8)).toBeNull()
  })
})
