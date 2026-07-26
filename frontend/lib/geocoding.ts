/**
 * Geocoding utilities using OpenStreetMap Nominatim API
 * Free service, no API keys required
 */

export interface GeocodingResult {
  display_name: string
  lat: string
  lon: string
  address?: {
    road?: string
    house_number?: string
    postcode?: string
    city?: string
    town?: string
    village?: string
    municipality?: string
    state?: string
    country?: string
  }
  importance?: number
}

export interface SearchResult {
  id: string
  display_name: string
  lat: number
  lon: number
  formattedAddress: string
}

const NOMINATIM_BASE_URL = 'https://nominatim.openstreetmap.org'
const USER_AGENT = 'KP-Rueck/1.0' // Required by Nominatim usage policy

/**
 * Format a Nominatim result into a concise, natural address
 * Example: "Löchlimattstrasse 1, 4104 Oberwil" (not the full OSM display_name)
 * ALWAYS returns a short, clean address - never the full display_name
 */
function formatNaturalAddress(result: GeocodingResult): string {
  const addr = result.address

  // Try to build from structured address data first
  if (addr) {
    const parts: string[] = []

    // Street and house number
    if (addr.road && addr.house_number) {
      parts.push(`${addr.road} ${addr.house_number}`)
    } else if (addr.road) {
      parts.push(addr.road)
    }

    // City with postcode
    const city = addr.city || addr.town || addr.village || addr.municipality
    if (city && addr.postcode) {
      parts.push(`${addr.postcode} ${city}`)
    } else if (city) {
      parts.push(city)
    }

    // If we got meaningful parts, return them (max 2 parts)
    if (parts.length > 0) {
      return parts.slice(0, 2).join(', ')
    }
  }

  // Fallback: aggressively truncate display_name
  return truncateDisplayName(result.display_name)
}

/**
 * Aggressively truncate OSM display_name to ONLY street + city
 * Example: "1, Löchlimattstrasse, Im Goldbrunnen, Oberwil, Bezirk Arlesheim, Basel-Landschaft, 4104, Switzerland"
 * Becomes: "Löchlimattstrasse, Oberwil"
 */
function truncateDisplayName(displayName: string): string {
  const parts = displayName.split(',').map(p => p.trim())

  // If already short, return as-is
  if (parts.length <= 2) {
    return displayName
  }

  // Extract meaningful parts:
  // Usually OSM format: [house_number, street, district/area, city, region, postcode, country]
  // We want: street + city only

  let streetPart = parts[0]
  let cityPart = parts[parts.length - 3] || parts[parts.length - 2]

  // Skip house number if it's the first part (just digits)
  if (streetPart.match(/^\d+$/)) {
    streetPart = parts[1] || streetPart
  }

  // Find the actual city (avoid "Bezirk X" or regions)
  for (let i = parts.length - 4; i >= 2 && i < parts.length - 1; i++) {
    const part = parts[i]
    // Skip if it looks like a region/district (contains "Bezirk" or is too long)
    if (!part.includes('Bezirk') && !part.includes('Landschaft') && part.length < 30) {
      cityPart = part
      break
    }
  }

  // Clean result
  const result = `${streetPart}, ${cityPart}`

  // Final safety: if still too long (>60 chars), truncate hard
  if (result.length > 60) {
    return result.substring(0, 57) + '...'
  }

  return result
}

interface SearchOptions {
  /**
   * Station center as [lon, lat] — results are biased towards it and sorted by
   * distance from it. Comes from the firestation_latitude/firestation_longitude
   * settings, so every station biases towards its own area.
   */
  stationCenter?: [number, number]
  /** Custom viewbox to prioritize [minLon, minLat, maxLon, maxLat] */
  viewbox?: [number, number, number, number]
  /**
   * ISO 3166-1 alpha-2 codes Nominatim restricts to, comma-separated. Defaults
   * to Switzerland because that is where the stations running this are; a
   * deployment across the border overrides it rather than patching this file.
   */
  countryCodes?: string
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

/**
 * Calculate distance between two points using Haversine formula
 * Returns distance in kilometers
 */
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371 // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

/**
 * Search for addresses using Nominatim
 * Returns natural formatted addresses prioritizing Basel-Landschaft region
 * Optionally prioritizes results near a home city
 */
export async function searchAddress(query: string, options?: SearchOptions): Promise<SearchResult[]> {
  if (!query || query.trim().length < 3) {
    return []
  }

  // Determine viewbox based on options. With no station coordinates configured
  // there is nothing honest to bias towards, so the search stays unweighted
  // rather than pulling every station's results towards one region.
  let viewbox: string | null = null
  if (options?.viewbox) {
    viewbox = options.viewbox.join(',')
  } else if (options?.stationCenter) {
    viewbox = getViewboxForCenter(options.stationCenter)
  }

  try {
    const params = new URLSearchParams({
      q: query,
      format: 'json',
      addressdetails: '1',
      limit: '10',
      countrycodes: options?.countryCodes || DEFAULT_COUNTRY_CODES,
    })
    if (viewbox) {
      params.set('viewbox', viewbox)
      params.set('bounded', '0') // Don't strictly limit to viewbox, but prioritize it
    }

    const response = await fetch(`${NOMINATIM_BASE_URL}/search?${params}`, {
      headers: {
        'User-Agent': USER_AGENT,
      },
    })

    if (!response.ok) {
      throw new Error(`Nominatim search failed: ${response.statusText}`)
    }

    const results: GeocodingResult[] = await response.json()

    // Map results to SearchResult format
    let searchResults = results.map((result, index) => ({
      id: `${result.lat}-${result.lon}-${index}`,
      display_name: result.display_name,
      lat: parseFloat(result.lat),
      lon: parseFloat(result.lon),
      formattedAddress: formatNaturalAddress(result),
    }))

    // Sort results by proximity to the station, when we know where it is
    if (options?.stationCenter) {
      const [centerLon, centerLat] = options.stationCenter
      searchResults = searchResults.sort((a, b) => {
        const distA = calculateDistance(a.lat, a.lon, centerLat, centerLon)
        const distB = calculateDistance(b.lat, b.lon, centerLat, centerLon)
        return distA - distB
      })
    }

    return searchResults
  } catch (error) {
    console.error('Geocoding search error:', error)
    return []
  }
}

/**
 * Forward geocoding: Convert address to coordinates
 * Returns the best match
 */
export async function geocodeAddress(address: string): Promise<{ lat: number; lon: number } | null> {
  const results = await searchAddress(address)
  return results.length > 0 ? { lat: results[0].lat, lon: results[0].lon } : null
}

/**
 * Reverse geocoding: Convert coordinates to address
 */
export async function reverseGeocode(lat: number, lon: number): Promise<string | null> {
  try {
    const params = new URLSearchParams({
      lat: lat.toString(),
      lon: lon.toString(),
      format: 'json',
      addressdetails: '1',
      zoom: '18', // Street level detail
    })

    const response = await fetch(`${NOMINATIM_BASE_URL}/reverse?${params}`, {
      headers: {
        'User-Agent': USER_AGENT,
      },
    })

    if (!response.ok) {
      throw new Error(`Nominatim reverse geocoding failed: ${response.statusText}`)
    }

    const result: GeocodingResult = await response.json()
    return formatNaturalAddress(result)
  } catch (error) {
    console.error('Reverse geocoding error:', error)
    return null
  }
}
