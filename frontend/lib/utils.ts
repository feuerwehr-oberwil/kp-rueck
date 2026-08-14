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
 * The postcode a geocoded component carries in front of the town
 * ("4104 Oberwil"), which the home-city comparison has to look past.
 */
const POSTCODE_PREFIX_RE = /^\d{4,5}\s+/
/**
 * A county / district component. Word-bounded on purpose: `^region` alone also
 * matched "Regionalstrasse", which would have swallowed a street.
 */
const DISTRICT_RE = /^(?:bezirk|region|kanton|canton|district|wahlkreis)\b/i
/** Half-cantons that are never a municipality, so they can be dropped by name. */
const STATE_NAMES = new Set(['basel-landschaft', 'basel-stadt'])

/**
 * The 26 Swiss canton abbreviations. A whitelist, NOT a "drop two trailing
 * letters" rule: a two-letter word is a legitimate ending for a place or a POI
 * ("Ca' Rossa", "Alterszentrum am Bach" abbreviated by an operator), and a
 * blanket rule would quietly rename it.
 *
 * The suffix is only ever removed to COMPARE a component with the home city —
 * never from the output, which always echoes the raw component. So the worst a
 * mis-strip can do is claim a town IS home and hide it; the canton is therefore
 * compared as well when both sides name one ("Oberwil BE" ≠ "Oberwil, BL").
 */
const CANTON_ABBREVS = new Set([
  'ag', 'ai', 'ar', 'be', 'bl', 'bs', 'fr', 'ge', 'gl', 'gr', 'ju', 'lu', 'ne',
  'nw', 'ow', 'sg', 'sh', 'so', 'sz', 'tg', 'ti', 'ur', 'vd', 'vs', 'zg', 'zh',
])

/** The two ways Divera writes the canton onto the town: "Oberwil (BL)" / "Oberwil BL". */
const CANTON_PAREN_RE = /^(.+?)\s*\(([A-Za-z]{2})\)$/
const CANTON_BARE_RE = /^(.+?)\s+([A-Za-z]{2})$/

/**
 * A component that carries its own house number — "Talstrasse 61", "Mittleri
 * Rüti 5", "Bahnhofstrasse 12a". THE street marker, because it is the only one
 * the data actually offers: Divera delivers town and street as bare components
 * in either order, and nothing but the trailing number distinguishes a street
 * from a town, a POI ("Coop Center") or Divera's status wording ("Nicht mehr
 * einrücken").
 *
 * Deliberately narrow: at most three digits, so "4104 Oberwil" (number in
 * front) and a postcode cannot pose as a street, and something before the
 * number that is neither blank nor a digit, so a bare "12" and a coordinate
 * ("47.516377") are excluded. A house number of four digits or more is not
 * recognised — the address is then left in the order it arrived instead of
 * being reordered on a guess.
 */
const STREET_WITH_NUMBER_RE = /^.*[^\s\d]\s+\d{1,3}[A-Za-z]?(?:\s*[-/]\s*\d{1,3}[A-Za-z]?)?$/

/** A component that is nothing but a canton abbreviation ("Oberwil, BL"). */
function isCantonAbbrev(part: string): boolean {
  const token = part.trim().toLowerCase()
  return token.length === 2 && CANTON_ABBREVS.has(token)
}

/** A town component split into the name the comparison uses and its canton, if named. */
type CityPart = { name: string; canton: string | null }

/**
 * One address / home-city component, reduced to the form the two are compared
 * in: no postcode prefix, no canton suffix, no double spaces, lower case. Not a
 * fuzzy match — "4104 Oberwil", "Oberwil (BL)" and "Oberwil BL" are the same
 * town written four ways, everything else is a different place.
 */
function parseCityPart(part: string): CityPart {
  const base = part.replace(POSTCODE_PREFIX_RE, '').trim().replace(/\s+/g, ' ')
  for (const re of [CANTON_PAREN_RE, CANTON_BARE_RE]) {
    const match = base.match(re)
    if (match && CANTON_ABBREVS.has(match[2].toLowerCase())) {
      return { name: match[1].trim().toLowerCase(), canton: match[2].toLowerCase() }
    }
  }
  return { name: base.toLowerCase(), canton: null }
}

/**
 * The home-city setting as the town name(s) it holds plus the canton, whether
 * the operator wrote it as its own component ("Oberwil, BL") or onto the name
 * ("Oberwil (BL)").
 */
function parseHomeCity(homeCity: string): { names: string[]; canton: string | null } {
  const names: string[] = []
  let canton: string | null = null
  for (const raw of homeCity.split(',')) {
    const trimmed = raw.trim()
    if (!trimmed) continue
    if (isCantonAbbrev(trimmed)) {
      canton ??= trimmed.toLowerCase()
      continue
    }
    const parsed = parseCityPart(trimmed)
    if (!parsed.name) continue
    names.push(parsed.name)
    canton ??= parsed.canton
  }
  return { names, canton }
}

function isCountryPart(part: string): boolean {
  const tokens = part.split('/').map(t => t.trim().toLowerCase()).filter(Boolean)
  return tokens.length > 0 && tokens.every(t => COUNTRY_NAMES.has(t))
}

/** Postcode / canton / country tail noise — never the street, never the city. */
function isAddressNoise(part: string): boolean {
  if (POSTCODE_RE.test(part)) return true
  if (isCountryPart(part)) return true
  if (DISTRICT_RE.test(part)) return true
  if (isCantonAbbrev(part)) return true
  return STATE_NAMES.has(part.toLowerCase())
}

/** Which of the surviving components carry a house number of their own. */
function streetComponentIndexes(kept: string[]): number[] {
  return kept.flatMap((part, idx) => (STREET_WITH_NUMBER_RE.test(part) ? [idx] : []))
}

/** The surviving components with the street in front, the rest in their own order. */
function renderStreetFirst(kept: string[], streetIdx: number): string {
  return [kept[streetIdx], ...kept.filter((_, idx) => idx !== streetIdx)].join(', ')
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
 * - `"Oberwil (BL), Talstrasse 61"` — what Divera delivers: the TOWN FIRST, the
 *   canton in parentheses or bare ("Oberwil BL"), optionally a POI after the
 *   street (`"…, Grenzweg 1, BLT Tramdepot"`) and optionally status wording in
 *   front (`"Nicht mehr einrücken, Oberwil (BL), Im Lohgraben 60"`).
 * - Free text an operator typed, and `"47.516377, 7.561800"` from a map pin.
 *
 * Because the order is not fixed, the STREET is found by the only marker the
 * data offers: a component carrying its own house number ("Talstrasse 61"). If
 * exactly one does, it leads the output and every other surviving component
 * follows in its original order, so a town-first address is reordered to
 * street-first ("Bottmingen, Mittleri Rüti 5" → "Mittleri Rüti 5, Bottmingen")
 * and every card on the board reads the same way. If none or several do, the
 * address falls back to the Nominatim reading below — never to a guess.
 *
 * In that fallback the city is looked up from the END, past the postcode /
 * canton / country tail, rather than at a fixed index: index 1 is the STREET in
 * the house-number-first shape and the CITY in the short one. A component that
 * sits directly after a "Bezirk …" is the canton, not the town ("…, Dornach,
 * Bezirk Dorneck, Solothurn, 4143, …"), so it is skipped too.
 *
 * The home city is matched component against component, both normalised
 * ("4104 Oberwil" ≡ "Oberwil (BL)" ≡ "Oberwil BL" ≡ "Oberwil"), NEVER as a
 * substring: the setting holds a town plus its canton ("Oberwil, BL"), and a
 * substring test let that "BL" match any component containing the letters —
 * "4223 Blauen", "Blauenstrasse" — so a Nachbarhilfe address in a neighbouring
 * town silently lost the one part that has to be right. By the same rule
 * "Oberwil im Simmental" is a different municipality and keeps its name, and so
 * does "Oberwil BE" — when both sides name a canton, the cantons must agree.
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
 * formatLocationForDisplay("Bottmingen, Mittleri Rüti 5", "Oberwil, BL")
 * // Returns: "Mittleri Rüti 5, Bottmingen" (Divera's town-first, reordered)
 *
 * formatLocationForDisplay("Oberwil, BL", "Oberwil, BL")
 * // Returns: "" (location is only the home city — redundant, so hidden)
 *
 * The case table both this and its Python mirror are held to lives in
 * backend/tests/test_services/location_display_cases.json.
 */
export function formatLocationForDisplay(fullAddress: string, homeCity?: string): string {
  if (!fullAddress) return fullAddress

  // An unset — or blank — home city leaves nothing to strip against, so the
  // address is passed through untouched.
  const home = parseHomeCity(homeCity ?? '')
  if (home.names.length === 0) return fullAddress

  // Parse the full address to extract components
  const parts = fullAddress.split(',').map(s => s.trim()).filter(Boolean)

  // Check if the address is IN the home city — one whole component equal to one
  // whole component of the setting, postcode prefix and canton suffix looked
  // past. A canton on both sides has to agree, so a different Oberwil keeps its
  // name.
  const isHomeCityPart = (part: string) => {
    const parsed = parseCityPart(part)
    if (!parsed.name || !home.names.includes(parsed.name)) return false
    return !parsed.canton || !home.canton || parsed.canton === home.canton
  }

  if (parts.some(isHomeCityPart)) {
    // Everything that is neither noise nor the home city itself survives — the
    // street, and whatever the dispatch system put around it.
    const kept = parts.filter(part => !isAddressNoise(part) && !isHomeCityPart(part))

    // Divera shape: one component carries the house number, so it leads and the
    // POI / status wording follows. With several, the fallback below is the safe
    // reading — here it keeps every component, so nothing is lost either way.
    const streetIndexes = streetComponentIndexes(kept)
    if (streetIndexes.length === 1) return renderStreetFirst(kept, streetIndexes[0])

    // Nominatim shape: the house number is its own component.
    // E.g., "8, Storchenweg, Oberwil..." -> "Storchenweg 8"
    let houseNumber = ''
    let streetName = ''
    const rest: string[] = []

    for (const part of kept) {
      // Check if it's a house number (pure digits, but not a postcode — those
      // were filtered out as noise above)
      if (NUMBER_RE.test(part)) {
        houseNumber = part
        continue
      }

      // The first one is the street name, the others stay behind it
      if (!streetName) streetName = part
      else rest.push(part)
    }

    // Nothing more specific than the home city remained → redundant, hide it.
    if (!streetName) return ''
    return [houseNumber ? `${streetName} ${houseNumber}` : streetName, ...rest].join(', ')
  }

  // Address is outside home city, include street and city. A town-first shape is
  // reordered so the board reads the same way everywhere.
  const kept = parts.filter(part => !isAddressNoise(part))
  const streetIndexes = streetComponentIndexes(kept)
  if (streetIndexes.length === 1) return renderStreetFirst(kept, streetIndexes[0])
  // Several house numbers: which one is THE address is a guess, and the reading
  // below keeps only one component beside the street, so it would drop the
  // others. Leave the address exactly as it arrived instead.
  if (streetIndexes.length > 1) return fullAddress

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
