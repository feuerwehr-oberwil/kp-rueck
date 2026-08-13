import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Default `collisionPadding` for Radix poppers — menus, popovers, selects.
 *
 * Radix avoids collisions against the VIEWPORT, and on the board the viewport
 * reaches ~53px past the top of the fixed footer toolbar. A context menu opened
 * on a low sidebar row was therefore placed flush with the viewport's bottom
 * edge, and its last entries ended up behind the toolbar — which is opaque and
 * at a higher z-index, so they were neither readable nor reachable. Reserving
 * the toolbar's height turns that into a shorter, scrollable menu instead
 * (`max-h-(--radix-*-content-available-height)` is already on every popper).
 *
 * Measured, not hard-coded: the toolbar's height follows its content and
 * padding. The extra few pixels are so the menu ends visibly ABOVE the toolbar
 * — flush with its top edge still reads as cut off. Returns `undefined` — i.e.
 * Radix's own default — on every page that has no footer, which is every page
 * except the board.
 *
 * Only the bottom, and only for placements Radix can move: a popper with
 * `side="top"` is pinned to its trigger and is not shifted along that axis, so
 * one anchored to a button INSIDE the toolbar needs a `sideOffset` that clears
 * it instead (see CardViewMenu and the Bereitschaft checklist).
 */
export function footerCollisionPadding(): { bottom: number } | undefined {
  if (typeof document === 'undefined') return undefined
  const footer = document.querySelector('footer')
  if (!footer) return undefined
  return { bottom: Math.ceil(footer.getBoundingClientRect().height) + 4 }
}

// Module-level mirror of the home-city setting so non-React helpers (e.g.
// getIncidentRefLabel) can format addresses. Kept in sync by
// operations-context whenever the setting loads/changes — same pattern as
// translateOutsideReact in lib/i18n-messages.
let globalHomeCity = ''

export function setGlobalHomeCity(city: string): void {
  globalHomeCity = city
}

export function getGlobalHomeCity(): string {
  return globalHomeCity
}

/**
 * Country components, as Nominatim writes them. Without an `accept-language`
 * parameter — and lib/geocoding.ts sends none — the Swiss one comes back as the
 * multilingual "Schweiz/Suisse/Svizzera/Svizra", so the check is per
 * slash-separated token. Every token must be a country name, which is what
 * keeps a street like "Schweizerhalle" out of it.
 */
const COUNTRY_NAMES = new Set([
  'switzerland', 'schweiz', 'suisse', 'svizzera', 'svizra',
  'germany', 'deutschland', 'allemagne', 'germania',
  'france', 'frankreich', 'francia',
  'italy', 'italien', 'italia', 'italie',
  'austria', 'österreich', 'autriche',
  'liechtenstein',
])

const POSTCODE_RE = /^\d{4,5}$/
const NUMBER_RE = /^\d+$/
/**
 * A county / district component. Word-bounded on purpose: `^region` alone also
 * matched "Regionalstrasse", which would have swallowed a street.
 */
const DISTRICT_RE = /^(?:bezirk|region|kanton|canton|district|wahlkreis)\b/i
/** Half-cantons that are never a municipality, so they can be dropped by name. */
const STATE_NAMES = new Set(['basel-landschaft', 'basel-stadt'])

function isCountryPart(part: string): boolean {
  const tokens = part.split('/').map(t => t.trim().toLowerCase()).filter(Boolean)
  return tokens.length > 0 && tokens.every(t => COUNTRY_NAMES.has(t))
}

/** Postcode / canton / country tail noise — never the street, never the city. */
function isAddressNoise(part: string): boolean {
  if (POSTCODE_RE.test(part)) return true
  if (isCountryPart(part)) return true
  if (DISTRICT_RE.test(part)) return true
  return STATE_NAMES.has(part.toLowerCase())
}

/**
 * Format a full address for display based on home city.
 * If the address is in the home city, show "Street HouseNumber".
 * If outside the home city, show "Street HouseNumber, City".
 *
 * Shapes that reach this function, all of them real:
 * - `"Bahnhofstrasse 12, 4133 Pratteln"` — what lib/geocoding.ts stores today
 *   (built from Nominatim's structured `address` object, never `display_name`).
 * - `"12, Bahnhofstrasse, Pratteln, Bezirk Liestal, Basel-Landschaft, 4133,
 *   Schweiz/Suisse/Svizzera/Svizra"` — a raw Nominatim `display_name`, i.e.
 *   house number FIRST, pasted by an operator or held by an older row.
 * - The same without a house number (`"Storchenweg, Therwil, …"`), or with
 *   neither (`"Therwil, Bezirk Arlesheim, …"` — a place, not an address).
 * - Free text an operator typed, and `"47.516377, 7.561800"` from a map pin.
 *
 * The city is therefore looked up from the END, past the postcode / canton /
 * country tail, rather than at a fixed index: index 1 is the STREET in the
 * house-number-first shape and the CITY in the short one. A component that sits
 * directly after a "Bezirk …" is the canton, not the town ("…, Dornach, Bezirk
 * Dorneck, Solothurn, 4143, …"), so it is skipped too.
 *
 * Known limitation: for a canton with no districts whose name differs from the
 * town (Carouge GE, Baar ZG), the canton is shown instead of the town. Outside
 * Switzerland the state component is not recognised at all.
 *
 * @param fullAddress - The complete address from Nominatim/database
 * @param homeCity - The configured home city (e.g., "Oberwil" or "Oberwil, BL")
 * @returns Formatted address string
 *
 * @example
 * formatLocationForDisplay("8, Storchenweg, Oberwil, Bezirk Arlesheim, Basel-Landschaft, 4104, Switzerland", "Oberwil")
 * // Returns: "Storchenweg 8"
 *
 * formatLocationForDisplay("45, Main Street, Basel, Switzerland", "Oberwil")
 * // Returns: "Main Street 45, Basel"
 *
 * formatLocationForDisplay("Oberwil, BL", "Oberwil, BL")
 * // Returns: "" (location is only the home city — redundant, so hidden)
 *
 * The case table both this and its Python mirror are held to lives in
 * backend/tests/test_services/location_display_cases.json.
 */
export function formatLocationForDisplay(fullAddress: string, homeCity?: string): string {
  if (!homeCity || !fullAddress) return fullAddress

  // Parse the full address to extract components
  const parts = fullAddress.split(',').map(s => s.trim()).filter(Boolean)

  // Check if the address contains the home city
  const homeCityParts = homeCity.split(',').map(s => s.trim()).filter(Boolean)
  const isHomeCityPart = (part: string) =>
    homeCityParts.some(hcp => part.toLowerCase().includes(hcp.toLowerCase()))

  if (parts.some(isHomeCityPart)) {
    // Return street name with house number
    // E.g., "8, Storchenweg, Oberwil..." -> "Storchenweg 8"
    let houseNumber = ''
    let streetName = ''

    for (const part of parts) {
      // Skip the noise FIRST (before checking for house numbers) so a postcode
      // is never mistaken for one.
      if (isAddressNoise(part)) continue
      if (isHomeCityPart(part)) continue

      // Check if it's a house number (pure digits, but not a postcode)
      if (NUMBER_RE.test(part)) {
        houseNumber = part
        continue
      }

      // This should be the street name
      if (!streetName) {
        streetName = part
      }
    }

    if (streetName) return houseNumber ? `${streetName} ${houseNumber}` : streetName
    // Nothing more specific than the home city remained → redundant, hide it.
    return ''
  }

  // Address is outside home city, include street and city
  // Typically: "Street, Town, Region, Country" -> "Street, Town"
  let houseNumber = ''
  let street = ''
  let streetIndex = -1

  parts.forEach((part, idx) => {
    if (POSTCODE_RE.test(part)) return

    // House number (pure digits, but not a postcode)
    if (NUMBER_RE.test(part)) {
      houseNumber = part
      return
    }

    // First non-numeric part is the street (or, for a place, the place itself)
    if (streetIndex === -1) {
      street = part
      streetIndex = idx
    }
  })

  let city = ''
  for (let idx = parts.length - 1; idx > streetIndex; idx--) {
    const part = parts[idx]
    if (NUMBER_RE.test(part) || isAddressNoise(part)) continue
    // "…, Dornach, Bezirk Dorneck, Solothurn, …" — what follows a district is
    // the canton, and the town is further left.
    if (idx > 0 && DISTRICT_RE.test(parts[idx - 1])) continue
    // Never print the street where the city belongs.
    if (part.toLowerCase() === street.toLowerCase()) continue
    city = part
    break
  }

  const formattedStreet = [street, houseNumber].filter(Boolean).join(' ')
  return city ? `${formattedStreet}, ${city}` : formattedStreet
}

/**
 * Copy text to clipboard with Safari support.
 *
 * @param text - The text to copy to clipboard
 * @returns Promise that resolves when copy succeeds, rejects on failure
 */
export async function copyToClipboard(text: string): Promise<void> {
  // Try modern Clipboard API first (works in Chrome, Firefox, and Safari with direct user gesture)
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      // Fall through to fallback
    }
  }

  // Fallback using textarea and execCommand
  return new Promise((resolve, reject) => {
    const textArea = document.createElement('textarea')
    textArea.value = text
    textArea.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none;'
    document.body.appendChild(textArea)
    textArea.focus()
    textArea.select()

    try {
      const successful = document.execCommand('copy')
      document.body.removeChild(textArea)
      if (successful) {
        resolve()
      } else {
        reject(new Error('execCommand copy failed'))
      }
    } catch (err) {
      document.body.removeChild(textArea)
      reject(err)
    }
  })
}

/**
 * Copy text to clipboard with Safari support for async content.
 *
 * Safari requires clipboard access to be "reserved" during the user gesture.
 * This function uses ClipboardItem with a Promise, which Safari supports,
 * allowing you to fetch content asynchronously while maintaining clipboard access.
 *
 * IMPORTANT: Call this function synchronously in your click handler, passing
 * a Promise that resolves to the text content.
 *
 * @param textPromise - A Promise that resolves to the text to copy
 * @returns Promise that resolves when copy succeeds, rejects on failure
 *
 * @example
 * const handleClick = () => {
 *   // Call synchronously - the promise can resolve later
 *   copyToClipboardAsync(fetchData().then(data => formatMessage(data)))
 * }
 */
export function copyToClipboardAsync(textPromise: Promise<string>): Promise<void> {
  // Check if ClipboardItem is supported (Safari, Chrome, Edge)
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    // Create a ClipboardItem with a Promise - Safari will "reserve" clipboard access
    const clipboardItem = new ClipboardItem({
      'text/plain': textPromise.then(text => new Blob([text], { type: 'text/plain' }))
    })
    return navigator.clipboard.write([clipboardItem])
  }

  // Fallback: wait for the text and use regular copy
  return textPromise.then(text => copyToClipboard(text))
}

/**
 * Keep only characters that can legitimately appear in a phone number
 * (digits, a leading +, spaces, and the separators / - ( )). Used on the
 * incident contact-phone inputs so operators can't type free text there.
 */
export function sanitizePhoneInput(value: string): string {
  return value.replace(/[^\d+\s()/-]/g, '')
}
