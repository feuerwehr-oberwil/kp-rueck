/**
 * Smart coordinate parser supporting multiple formats
 * Handles paste from various sources (Google Maps, Swiss LV95, etc.)
 */

export interface ParsedCoordinates {
  lat: number
  lon: number
  format: 'decimal' | 'dms' | 'lv95' | 'google-maps'
  success: boolean
  error?: string
}

/**
 * Convert Swiss LV95 (CH1903+) coordinates to WGS84
 * LV95 is commonly used in Swiss emergency dispatch systems
 */
function lv95ToWgs84(east: number, north: number): { lat: number; lon: number } {
  // Convert to LV03 (subtract offset)
  const y = (east - 2600000) / 1000000
  const x = (north - 1200000) / 1000000

  // Calculate WGS84 (simplified Swisstopo formulas)
  const lon = 2.6779094 +
    4.728982 * y +
    0.791484 * y * x +
    0.1306 * y * Math.pow(x, 2) -
    0.0436 * Math.pow(y, 3)

  const lat = 16.9023892 +
    3.238272 * x -
    0.270978 * Math.pow(y, 2) -
    0.002528 * Math.pow(x, 2) -
    0.0447 * Math.pow(y, 2) * x -
    0.0140 * Math.pow(x, 3)

  return {
    lat: lat * 100 / 36,
    lon: lon * 100 / 36,
  }
}

/**
 * Parse DMS (Degrees Minutes Seconds) to decimal
 * Example: 47°31'2.96"N -> 47.5174889
 */
function dmsToDecimal(degrees: number, minutes: number, seconds: number, direction: string): number {
  let decimal = degrees + minutes / 60 + seconds / 3600
  if (direction === 'S' || direction === 'W') {
    decimal = -decimal
  }
  return decimal
}

/**
 * Parse coordinates from various formats
 */
export function parseCoordinates(input: string): ParsedCoordinates {
  const trimmed = input.trim()

  if (!trimmed) {
    return {
      lat: 0,
      lon: 0,
      format: 'decimal',
      success: false,
      error: 'Empty input',
    }
  }

  // 1. Try Google Maps URL format
  // https://www.google.com/maps?q=47.5164,7.5618 or https://maps.google.com/?q=47.5164,7.5618
  const googleMapsMatch = trimmed.match(/[?&]q=(-?\d+\.?\d*),(-?\d+\.?\d*)/)
  if (googleMapsMatch) {
    const lat = parseFloat(googleMapsMatch[1])
    const lon = parseFloat(googleMapsMatch[2])
    if (isValidCoordinate(lat, lon)) {
      return { lat, lon, format: 'google-maps', success: true }
    }
  }

  // 2. Try Swiss LV95 format (2621234, 1260789 or 2621234 1260789)
  // LV95 East: 2'480'000 - 2'840'000, North: 1'070'000 - 1'300'000
  const lv95Match = trimmed.match(/^\s*(\d{7})[,\s]+(\d{7})\s*$/)
  if (lv95Match) {
    const east = parseFloat(lv95Match[1])
    const north = parseFloat(lv95Match[2])

    // Validate LV95 range
    if (east >= 2480000 && east <= 2840000 && north >= 1070000 && north <= 1300000) {
      const { lat, lon } = lv95ToWgs84(east, north)
      return { lat, lon, format: 'lv95', success: true }
    }
  }

  // 3. Try DMS format (47°31'2.96"N 7°33'42.48"E)
  const dmsPattern = /(\d+)°\s*(\d+)'?\s*(\d+(?:\.\d+)?)["']?\s*([NSEW])/gi
  const dmsMatches = Array.from(trimmed.matchAll(dmsPattern))

  if (dmsMatches.length === 2) {
    const lat = dmsToDecimal(
      parseInt(dmsMatches[0][1]),
      parseInt(dmsMatches[0][2]),
      parseFloat(dmsMatches[0][3]),
      dmsMatches[0][4]
    )
    const lon = dmsToDecimal(
      parseInt(dmsMatches[1][1]),
      parseInt(dmsMatches[1][2]),
      parseFloat(dmsMatches[1][3]),
      dmsMatches[1][4]
    )

    if (isValidCoordinate(lat, lon)) {
      return { lat, lon, format: 'dms', success: true }
    }
  }

  // 4. Try simple decimal format (47.5164, 7.5618 or 47.5164 7.5618)
  const decimalMatch = trimmed.match(/^\s*(-?\d+\.?\d*)[,\s]+(-?\d+\.?\d*)\s*$/)
  if (decimalMatch) {
    const lat = parseFloat(decimalMatch[1])
    const lon = parseFloat(decimalMatch[2])

    if (isValidCoordinate(lat, lon)) {
      return { lat, lon, format: 'decimal', success: true }
    }

    // Try swapped (user might have entered lon, lat)
    if (isValidCoordinate(lon, lat)) {
      return {
        lat: lon,
        lon: lat,
        format: 'decimal',
        success: true,
        error: 'Coordinates were auto-swapped (detected lon/lat order)',
      }
    }
  }

  return {
    lat: 0,
    lon: 0,
    format: 'decimal',
    success: false,
    error: 'Could not parse coordinates. Supported formats: decimal (47.5164, 7.5618), Swiss LV95 (2621234, 1260789), DMS (47°31\'2.96"N), or Google Maps URL',
  }
}

/**
 * Validate WGS84 coordinates
 */
function isValidCoordinate(lat: number, lon: number): boolean {
  return (
    !isNaN(lat) &&
    !isNaN(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  )
}

/**
 * Check if coordinates are within Basel-Landschaft region (with buffer)
 * Returns warning if coordinates are far from expected region
 */
export function checkRegion(lat: number, lon: number): { isNearBasel: boolean; warning?: string } {
  // Basel-Landschaft approximate bounds with generous buffer
  const minLat = 47.3
  const maxLat = 47.7
  const minLon = 7.4
  const maxLon = 7.9

  const isNearBasel = lat >= minLat && lat <= maxLat && lon >= minLon && lon <= maxLon

  if (!isNearBasel) {
    // Check if at least in Switzerland
    const isInSwitzerland = lat >= 45.8 && lat <= 47.8 && lon >= 5.9 && lon <= 10.5

    if (isInSwitzerland) {
      return {
        isNearBasel: false,
        warning: 'Diese Koordinaten liegen ausserhalb der Region Basel-Landschaft',
      }
    } else {
      return {
        isNearBasel: false,
        warning: 'Diese Koordinaten liegen ausserhalb der Schweiz',
      }
    }
  }

  return { isNearBasel: true }
}
