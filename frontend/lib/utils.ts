import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Format a full address for display based on home city.
 * If the address is in the home city, show "Street HouseNumber".
 * If outside the home city, show "Street HouseNumber, City".
 *
 * @param fullAddress - The complete address from Nominatim/database
 * @param homeCity - The configured home city (e.g., "Oberwil" or "Oberwil, Basel-Landschaft")
 * @returns Formatted address string
 *
 * @example
 * formatLocationForDisplay("8, Storchenweg, Oberwil, Bezirk Arlesheim, Basel-Landschaft, 4104, Switzerland", "Oberwil")
 * // Returns: "Storchenweg 8"
 *
 * formatLocationForDisplay("45, Main Street, Basel, Switzerland", "Oberwil")
 * // Returns: "Main Street 45, Basel"
 */
export function formatLocationForDisplay(fullAddress: string, homeCity?: string): string {
  if (!homeCity || !fullAddress) return fullAddress

  // Parse the full address to extract components
  const parts = fullAddress.split(',').map(s => s.trim())

  // Check if the address contains the home city
  const homeCityParts = homeCity.split(',').map(s => s.trim())
  const addressContainsHomeCity = homeCityParts.some(part =>
    parts.some(addressPart => addressPart.toLowerCase().includes(part.toLowerCase()))
  )

  if (addressContainsHomeCity) {
    // Return street name with house number
    // E.g., "8, Storchenweg, Oberwil..." -> "Storchenweg 8"
    let houseNumber = ''
    let streetName = ''

    for (const part of parts) {
      // Skip known suffixes FIRST (before checking for house numbers)
      // This ensures 4-digit postcodes aren't treated as house numbers
      if (part.match(/^\d{4}$/)) continue // Swiss postcodes (4 digits)
      if (part.toLowerCase() === 'switzerland') continue
      if (part.toLowerCase() === 'schweiz') continue
      if (part.toLowerCase() === 'basel-landschaft') continue
      if (part.toLowerCase() === 'basel-stadt') continue
      if (homeCityParts.some(hcp => part.toLowerCase().includes(hcp.toLowerCase()))) continue
      if (part.toLowerCase().startsWith('bezirk')) continue

      // Check if it's a house number (pure digits, but not 4 digits)
      if (/^\d+$/.test(part)) {
        houseNumber = part
        continue
      }

      // This should be the street name
      if (!streetName) {
        streetName = part
      }
    }

    return houseNumber ? `${streetName} ${houseNumber}` : (streetName || parts[0] || fullAddress)
  } else {
    // Address is outside home city, include street and city
    // Typically: "Street, Town, Region, Country" -> "Street, Town"
    let houseNumber = ''
    let street = ''

    for (const part of parts) {
      // Skip postcodes first (4-digit numbers)
      if (part.match(/^\d{4}$/)) continue

      // Check for house number (pure digits, but not 4 digits)
      if (/^\d+$/.test(part)) {
        houseNumber = part
        continue
      }

      // Get first non-numeric part as street name
      if (!street) {
        street = part
      }
    }

    const city = parts.find((part, idx) => {
      if (idx === 0) return false // Skip first part (likely street/house number)
      if (/^\d+$/.test(part)) return false // Skip numbers
      if (part.toLowerCase() === 'switzerland') return false
      if (part.toLowerCase() === 'schweiz') return false
      return !part.match(/^(basel-landschaft|basel-stadt|bezirk|region)/i)
    })

    const formattedStreet = houseNumber ? `${street} ${houseNumber}` : street
    return city ? `${formattedStreet}, ${city}` : formattedStreet
  }
}

/**
 * Calculate the age of an incident and return formatted display information
 * with color coding based on age thresholds.
 *
 * @param createdAt - The timestamp when the incident was created
 * @returns Object containing label, color class, and warning flag
 *
 * Age thresholds:
 * - < 15 minutes: Green "Neu" badge
 * - 15-60 minutes: Yellow badge showing minutes
 * - 1-2 hours: Orange badge showing hours (decimal)
 * - > 2 hours: Red badge showing hours with warning icon
 */
export function getIncidentAge(createdAt: Date): {
  label: string
  color: string
  showWarning: boolean
} {
  const now = new Date()
  const ageMinutes = Math.floor((now.getTime() - createdAt.getTime()) / (1000 * 60))

  if (ageMinutes < 15) {
    return { label: 'Neu', color: 'bg-emerald-500', showWarning: false }
  } else if (ageMinutes < 60) {
    return { label: `${ageMinutes} min`, color: 'bg-yellow-500', showWarning: false }
  } else if (ageMinutes < 120) {
    const hours = (ageMinutes / 60).toFixed(1)
    return { label: `${hours} Std`, color: 'bg-orange-500', showWarning: false }
  } else {
    const hours = Math.floor(ageMinutes / 60)
    return { label: `${hours} Std`, color: 'bg-red-500', showWarning: true }
  }
}
