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
 * Format a Nominatim result into a natural, readable address
 */
function formatNaturalAddress(result: GeocodingResult): string {
  const addr = result.address
  if (!addr) return result.display_name

  const parts: string[] = []

  // Street and number
  if (addr.road) {
    if (addr.house_number) {
      parts.push(`${addr.road} ${addr.house_number}`)
    } else {
      parts.push(addr.road)
    }
  }

  // City/town
  const city = addr.city || addr.town || addr.village || addr.municipality
  if (city) {
    if (addr.postcode) {
      parts.push(`${addr.postcode} ${city}`)
    } else {
      parts.push(city)
    }
  }

  return parts.length > 0 ? parts.join(', ') : result.display_name
}

/**
 * Search for addresses using Nominatim
 * Returns natural formatted addresses prioritizing Basel-Landschaft region
 */
export async function searchAddress(query: string): Promise<SearchResult[]> {
  if (!query || query.trim().length < 3) {
    return []
  }

  try {
    const params = new URLSearchParams({
      q: query,
      format: 'json',
      addressdetails: '1',
      limit: '10',
      countrycodes: 'ch', // Limit to Switzerland
      viewbox: '7.4,47.3,7.8,47.7', // Basel region bounding box
      bounded: '0', // Don't strictly limit to viewbox, but prioritize it
    })

    const response = await fetch(`${NOMINATIM_BASE_URL}/search?${params}`, {
      headers: {
        'User-Agent': USER_AGENT,
      },
    })

    if (!response.ok) {
      throw new Error(`Nominatim search failed: ${response.statusText}`)
    }

    const results: GeocodingResult[] = await response.json()

    return results.map((result, index) => ({
      id: `${result.lat}-${result.lon}-${index}`,
      display_name: result.display_name,
      lat: parseFloat(result.lat),
      lon: parseFloat(result.lon),
      formattedAddress: formatNaturalAddress(result),
    }))
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
