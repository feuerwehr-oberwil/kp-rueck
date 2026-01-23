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
  /** Home city name to prioritize results near (optional) */
  homeCity?: string
  /** Custom viewbox to prioritize [minLon, minLat, maxLon, maxLat] */
  viewbox?: [number, number, number, number]
}

// Default viewbox for Basel-Landschaft region
const DEFAULT_VIEWBOX = '7.4,47.3,7.8,47.7'

// Known cities in Basel-Landschaft with approximate centers
// Used to bias search results when home_city setting is set
const KNOWN_CITIES: Record<string, [number, number]> = {
  'oberwil': [7.555, 47.515],
  'binningen': [7.570, 47.540],
  'allschwil': [7.535, 47.550],
  'reinach': [7.595, 47.495],
  'muttenz': [7.645, 47.530],
  'pratteln': [7.695, 47.520],
  'liestal': [7.735, 47.485],
  'birsfelden': [7.625, 47.555],
  'therwil': [7.555, 47.495],
  'bottmingen': [7.575, 47.520],
  'arlesheim': [7.620, 47.495],
  'münchenstein': [7.610, 47.515],
  'aesch': [7.595, 47.470],
  'ettingen': [7.545, 47.480],
  'pfeffingen': [7.580, 47.460],
  'basel': [7.590, 47.560],
}

/**
 * Create a viewbox centered on a city for search prioritization
 * Returns a string in format "minLon,minLat,maxLon,maxLat"
 */
function getViewboxForCity(cityName: string): string {
  const normalizedName = cityName.toLowerCase().trim()

  // Look for exact or partial match
  for (const [city, coords] of Object.entries(KNOWN_CITIES)) {
    if (normalizedName.includes(city) || city.includes(normalizedName)) {
      const [lon, lat] = coords
      // Create a ~10km viewbox around the city center
      const delta = 0.05 // ~5km in each direction
      return `${lon - delta},${lat - delta},${lon + delta},${lat + delta}`
    }
  }

  // Unknown city, use default Basel region
  return DEFAULT_VIEWBOX
}

/**
 * Get center coordinates for a known city
 * Returns [lon, lat] or null if city not found
 */
function getCityCenterCoords(cityName: string): [number, number] | null {
  const normalizedName = cityName.toLowerCase().trim()

  for (const [city, coords] of Object.entries(KNOWN_CITIES)) {
    if (normalizedName.includes(city) || city.includes(normalizedName)) {
      return coords
    }
  }
  return null
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

  // Determine viewbox based on options
  let viewbox = DEFAULT_VIEWBOX
  if (options?.viewbox) {
    viewbox = options.viewbox.join(',')
  } else if (options?.homeCity) {
    viewbox = getViewboxForCity(options.homeCity)
  }

  try {
    const params = new URLSearchParams({
      q: query,
      format: 'json',
      addressdetails: '1',
      limit: '10',
      countrycodes: 'ch', // Limit to Switzerland
      viewbox,
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

    // Map results to SearchResult format
    let searchResults = results.map((result, index) => ({
      id: `${result.lat}-${result.lon}-${index}`,
      display_name: result.display_name,
      lat: parseFloat(result.lat),
      lon: parseFloat(result.lon),
      formattedAddress: formatNaturalAddress(result),
    }))

    // Sort results by proximity to home city if specified
    if (options?.homeCity) {
      const centerCoords = getCityCenterCoords(options.homeCity)
      if (centerCoords) {
        const [centerLon, centerLat] = centerCoords
        searchResults = searchResults.sort((a, b) => {
          const distA = calculateDistance(a.lat, a.lon, centerLat, centerLon)
          const distB = calculateDistance(b.lat, b.lon, centerLat, centerLon)
          return distA - distB
        })
      }
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
