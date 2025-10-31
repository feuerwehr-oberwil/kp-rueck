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
