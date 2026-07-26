import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { searchAddress } from './geocoding'

/**
 * Address search used to bias towards whichever of sixteen hardcoded Basel-Landschaft
 * municipalities matched the home_city string, and fell back to a fixed Basel-region box
 * for everything else. Every station outside that list therefore had its address search
 * weighted towards a region it is nowhere near — silently, because biased results still
 * look like results. The bias now comes from the station's own configured coordinates.
 */

const originalFetch = globalThis.fetch

/** Nominatim rows, deliberately returned far-then-near to prove the sort runs. */
const NOMINATIM_ROWS = [
  { display_name: 'Far', lat: '47.9000', lon: '8.0000', address: { road: 'Fernweg', house_number: '1' } },
  { display_name: 'Near', lat: '47.5100', lon: '7.5550', address: { road: 'Nahweg', house_number: '2' } },
]

function paramsOfLastCall(): URLSearchParams {
  const [url] = vi.mocked(fetch).mock.calls[0]
  return new URL(String(url)).searchParams
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
