"use client"

/**
 * LocationInput Component
 *
 * IMPORTANT: This component is used in multiple places:
 * - IncidentForm (components/incidents/incident-form.tsx) - Edit incident details
 * - NewEmergencyModal (components/kanban/new-emergency-modal.tsx) - Create new incident from Kanban
 * - Any other forms that need location input
 *
 * Changes to this component automatically apply everywhere it's used.
 * Ensure backward compatibility when modifying props or behavior.
 */

import { useState, useEffect, useRef, type ReactNode } from "react"
import { useTranslations } from "next-intl"
import dynamic from "next/dynamic"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"
import { SHEET_LAYER_ATTR } from "@/components/ui/footer-sheet"
import { MapPin, Check, AlertCircle, ArrowUpDown, X, Map, Navigation } from "lucide-react"
import { cn } from "@/lib/utils"
import { DENSE_CONTROL } from "@/components/kanban/detail-field"
import { searchAddress, geocodeAddress } from "@/lib/geocoding"
import { parseCoordinates, checkRegion } from "@/lib/coordinate-parser"
import type { SearchResult } from "@/lib/geocoding"
import { apiClient } from "@/lib/api-client"

// Dynamically import MapPickerModal to avoid SSR issues – MapLibre GL needs a browser
const MapPickerModal = dynamic(
  () => import("./map-picker-modal").then((mod) => mod.MapPickerModal),
  { ssr: false }
)

interface LocationInputProps {
  address: string | null
  latitude: number | null
  longitude: number | null
  onAddressChange: (address: string | null) => void
  onCoordinatesChange: (lat: number | null, lon: number | null) => void
  disabled?: boolean
  autoFocus?: boolean
  geocodeInitialAddress?: boolean
  /** Show error styling for validation feedback */
  error?: boolean
  /** An extra icon button in the same row as the map and coordinate buttons.
   *  `/feld` puts "Standort übernehmen" there — a GPS action belongs with the
   *  other two ways of setting the location, not on a line of its own
   *  underneath, which is where it read as a leftover. */
  extraAction?: ReactNode
  /** Row layout for the 420px side panel: the label sits left of the field
   *  instead of above it, and the map/coordinate buttons shrink to match. Same
   *  control either way — see components/kanban/detail-field.tsx. */
  dense?: boolean
  /** With `dense`: keep the row grammar but draw the input as a normal boxed
   *  field. For creation dialogs, where every field is empty at open — a
   *  borderless empty input has no affordance, and the pin icon alone reads
   *  as a row of buttons, not a field. */
  boxed?: boolean
  /** Draw the required asterisk. Only a form that can be SUBMITTED empty has
   *  anything to require — an existing incident already has an Einsatzort, and
   *  marking it on the detail asked the operator to satisfy a rule they had
   *  satisfied when the card was created. */
  required?: boolean
}

export function LocationInput({
  address,
  latitude,
  longitude,
  onAddressChange,
  onCoordinatesChange,
  disabled = false,
  autoFocus = false,
  geocodeInitialAddress = true,
  error = false,
  extraAction,
  dense = false,
  boxed = false,
  required = false,
}: LocationInputProps) {
  const t = useTranslations('map')
  const [addressSearchOpen, setAddressSearchOpen] = useState(false)
  const [addressSearchQuery, setAddressSearchQuery] = useState("")
  const [addressResults, setAddressResults] = useState<SearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [mapPickerOpen, setMapPickerOpen] = useState(false)
  const [isMounted, setIsMounted] = useState(false)
  const [showCoordinates, setShowCoordinates] = useState(false)

  const [coordinateInput, setCoordinateInput] = useState("")
  const [coordinateError, setCoordinateError] = useState<string | null>(null)
  const [coordinateWarning, setCoordinateWarning] = useState<string | null>(null)
  const [parseSuccess, setParseSuccess] = useState<string | null>(null)
  const [stationCenter, setStationCenter] = useState<[number, number] | null>(null)
  const [countryCodes, setCountryCodes] = useState<string | null>(null)

  // Which result the keyboard is on. -1 = none, and Enter then commits the typed
  // text as freetext — the board is operated at speed, and reaching for the mouse
  // to confirm an address the geocoder does not know is the slow path.
  const [activeIndex, setActiveIndex] = useState(-1)

  const searchTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const anchorRef = useRef<HTMLDivElement>(null)
  const initialAddressRef = useRef(address)
  const addressChangedRef = useRef(false)
  const geocodeInputsRef = useRef({ address, latitude, longitude, onCoordinatesChange })
  geocodeInputsRef.current = { address, latitude, longitude, onCoordinatesChange }

  // Fetch the station's own coordinates on mount to prioritize search results
  // near it. Previously this read home_city and matched it against a hardcoded
  // list of sixteen municipalities, so a station outside that list got results
  // biased towards a region it is nowhere near.
  useEffect(() => {
    async function fetchStationLocation() {
      try {
        const settings = await apiClient.getAllSettings()
        const lat = parseFloat(settings['firestation_latitude'] ?? '')
        const lon = parseFloat(settings['firestation_longitude'] ?? '')
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          setStationCenter([lon, lat])
        }
        if (settings['geocoder_country_codes']) {
          setCountryCodes(settings['geocoder_country_codes'])
        }
      } catch (error) {
        console.error('Failed to fetch station location settings:', error)
      }
    }
    fetchStationLocation()
  }, [])

  // Only render map picker on client side
  useEffect(() => {
    setIsMounted(true)
  }, [])

  // Is the operator typing in the field right now? While they are, the input
  // holds their query; the rest of the time it holds the committed address —
  // there is only one field, so it has to be both.
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    if (!editing) setAddressSearchQuery(address ?? "")
  }, [address, editing])

  // Auto-focus: focus the address field when autoFocus is true. The focus
  // handler opens the suggestion list; a short delay lets the modal render.
  useEffect(() => {
    if (autoFocus && isMounted && !disabled) {
      const timer = setTimeout(() => {
        searchInputRef.current?.focus()
      }, 150)
      return () => clearTimeout(timer)
    }
  }, [autoFocus, isMounted, disabled])

  // Sync coordinate input with props
  useEffect(() => {
    if (latitude !== null && longitude !== null) {
      setCoordinateInput(`${latitude.toFixed(8)}, ${longitude.toFixed(8)}`)
      setCoordinateError(null)
      setParseSuccess(null)

      // Check region
      const regionCheck = checkRegion(latitude, longitude)
      setCoordinateWarning(regionCheck.warning || null)
    } else {
      setCoordinateInput("")
      setCoordinateError(null)
      setCoordinateWarning(null)
      setParseSuccess(null)
    }
  }, [latitude, longitude])

  // Search for addresses as user types
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current)
    }

    if (!editing || disabled || addressSearchQuery.trim().length < 3) {
      setIsSearching(false)
      setAddressResults([])
      setActiveIndex(-1)
      return
    }

    const controller = new AbortController()
    setIsSearching(true)
    setAddressResults([])
    setActiveIndex(-1)
    searchTimeoutRef.current = setTimeout(async () => {
      // Pass the station's coordinates to prioritize results near it
      const results = await searchAddress(addressSearchQuery, {
        stationCenter: stationCenter || undefined,
        countryCodes: countryCodes || undefined,
        signal: controller.signal,
      })
      if (controller.signal.aborted) return
      setAddressResults(results)
      setIsSearching(false)
    }, 300) // Debounce 300ms

    return () => {
      controller.abort()
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current)
      }
    }
  }, [addressSearchQuery, stationCenter, countryCodes, editing, disabled])

  // Geocode address when it changes (if no coordinates set yet)
  useEffect(() => {
    if (disabled) return
    if (address !== initialAddressRef.current) addressChangedRef.current = true
    if (!geocodeInitialAddress && !addressChangedRef.current) return

    const current = geocodeInputsRef.current
    if (current.address && current.address.trim().length > 0 && (current.latitude === null || current.longitude === null)) {
      const controller = new AbortController()
      geocodeAddress(current.address, {
        stationCenter: stationCenter || undefined,
        countryCodes: countryCodes || undefined,
        signal: controller.signal,
      }).then((coords) => {
        const latest = geocodeInputsRef.current
        if (!controller.signal.aborted && coords && latest.address === current.address &&
          latest.latitude === current.latitude && latest.longitude === current.longitude) {
          latest.onCoordinatesChange(coords.lat, coords.lon)
        }
      })
      return () => controller.abort()
    }
  }, [address, latitude, longitude, disabled, geocodeInitialAddress, stationCenter, countryCodes])

  const handleAddressSelect = (result: SearchResult) => {
    onAddressChange(result.formattedAddress)
    onCoordinatesChange(result.lat, result.lon)
    setEditing(false)
    setAddressSearchOpen(false)
    setAddressSearchQuery(result.formattedAddress)
    setActiveIndex(-1)
  }

  /** Take the typed text as the address, without coordinates. The geocoder does
   *  not know every Flurname, every Baustellenzufahrt or every "hinter dem
   *  Schulhaus", and an operator must never be blocked by that. */
  const commitFreetext = (value: string) => {
    const text = value.trim()
    if (!text) return
    // A CHANGED freetext is a new answer to "where", so a pin that belonged to
    // the previous address must not survive it: the map — and everything that
    // trusts the pin over the text, like the /alarm correction — would keep
    // pointing at the old spot. Cleared only when the text actually changed;
    // re-committing the same address (a blur, a stray Enter) must not throw
    // away a pin that was picked on the map. If the geocoder does know the new
    // text after all, the geocode effect above sets a fresh pin.
    if (text !== (address ?? "").trim()) onCoordinatesChange(null, null)
    onAddressChange(text)
    setEditing(false)
    setAddressSearchOpen(false)
    setAddressSearchQuery(text)
    setActiveIndex(-1)
  }

  const handleAddressKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Tab") {
      // Close and let the natural tab order take over.
      setAddressSearchOpen(false)
      return
    }
    if (event.key === "Escape") {
      // Back to whatever is committed — Escape discards a half-typed address,
      // it does not commit one.
      setAddressSearchOpen(false)
      setEditing(false)
      setAddressSearchQuery(address ?? "")
      return
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (addressResults.length === 0) return
      event.preventDefault()
      setAddressSearchOpen(true)
      setActiveIndex((current) => {
        const next = event.key === "ArrowDown" ? current + 1 : current - 1
        if (next < 0) return addressResults.length - 1
        if (next >= addressResults.length) return 0
        return next
      })
      return
    }
    if (event.key === "Enter") {
      // Inside a form, Enter must pick the address rather than submit it.
      event.preventDefault()
      const picked = addressResults[activeIndex >= 0 ? activeIndex : 0]
      if (picked) handleAddressSelect(picked)
      else commitFreetext(addressSearchQuery)
    }
  }

  const handleCoordinatePaste = (value: string) => {
    setCoordinateInput(value)

    // Try to parse immediately
    const parsed = parseCoordinates(value)

    if (parsed.success) {
      onCoordinatesChange(parsed.lat, parsed.lon)
      setCoordinateError(null)
      setParseSuccess(parsed.error || t('locationInput.formatDetected', { format: parsed.format }))

      // Check region
      const regionCheck = checkRegion(parsed.lat, parsed.lon)
      setCoordinateWarning(regionCheck.warning || null)
    } else {
      setCoordinateError(parsed.error || t('locationInput.invalidFormat'))
      setCoordinateWarning(null)
      setParseSuccess(null)
    }
  }

  const handleSwapCoordinates = () => {
    if (latitude !== null && longitude !== null) {
      onCoordinatesChange(longitude, latitude)
      setParseSuccess(t('locationInput.coordinatesSwapped'))
      setTimeout(() => setParseSuccess(null), 3000)
    }
  }

  const handleClearLocation = () => {
    onAddressChange(null)
    onCoordinatesChange(null, null)
    setCoordinateInput("")
    setCoordinateError(null)
    setCoordinateWarning(null)
    setParseSuccess(null)
  }

  const handleMapSelect = (lat: number, lon: number, geocodedAddress: string | null) => {
    onCoordinatesChange(lat, lon)
    if (geocodedAddress) {
      onAddressChange(geocodedAddress)
    }
  }

  const hasValidCoordinates =
    latitude !== null &&
    longitude !== null &&
    !isNaN(latitude) &&
    !isNaN(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180

  // The map picker and the coordinate toggle. Beside the field normally; INSIDE
  // its right edge when `boxed`, so the input ends where every other control of
  // the form ends instead of stopping two buttons short of the shared edge.
  const locationActions = (
    <>
      <Button
        type="button"
        variant={dense || boxed ? "ghost" : "outline"}
        size={dense || boxed ? "icon-xs" : "icon"}
        className={cn((dense || boxed) && "size-7")}
        onClick={() => setMapPickerOpen(true)}
        disabled={disabled}
        title={t('locationInput.pickOnMap')}
        tabIndex={-1}
      >
        <Map className={dense || boxed ? "size-3.5" : "size-4"} />
      </Button>
      <Button
        type="button"
        variant={showCoordinates ? "default" : dense || boxed ? "ghost" : "outline"}
        size={dense || boxed ? "icon-xs" : "icon"}
        className={cn((dense || boxed) && "size-7")}
        onClick={() => setShowCoordinates(!showCoordinates)}
        disabled={disabled}
        title={t('locationInput.enterCoordinates')}
        tabIndex={-1}
      >
        <Navigation className={dense || boxed ? "size-3.5" : "size-4"} />
      </Button>
    </>
  )

  return (
    // No blanket vertical spacing here: the coordinate drawer below is collapsed
    // to zero height most of the time, and a `space-y-*` on this wrapper still
    // gave the collapsed drawer its margin — phantom air between the address row
    // and whatever field the host form puts next. The drawer brings its own
    // margin only while it is open.
    <div>
      {/* Address Input with Autocomplete */}
      {/* No hairline under the dense row — like every DetailField row since the
          «Nur Abstand» pick: whitespace separates, headings group. */}
      <div className={cn(dense ? "flex items-center gap-2 py-1" : "min-h-[40px]")}>
        <div className={cn("flex items-center gap-1", dense && "w-[120px] shrink-0")}>
          <Label
            htmlFor="location_address"
            className={cn(
              dense
                ? "text-xs font-normal text-muted-foreground"
                : "text-sm font-semibold text-muted-foreground",
            )}
          >
            {dense ? t('locationInput.addressLabelShort') : t('locationInput.addressLabel')}
          </Label>
          {required && (
            <span className="text-destructive" title={t('locationInput.requiredField')}>*</span>
          )}
        </div>
        {/* items-CENTER, not items-start: the two icon buttons belong on the
            field's own line. Nothing in this row ever grows taller than the
            input — the suggestion list is portalled and the coordinate drawer
            is a SIBLING of this row further down, not a child — so centring
            here cannot push either of them out of place. */}
        <div className={cn("flex items-center gap-2", dense ? "min-w-0 flex-1" : "mt-2")}>
          {/* One field, not two. The input IS the search box: what you type is
              what the geocoder gets, and what is committed is what the field
              shows afterwards. The old shape put a read-only combobox button in
              the form and a *second* «Adresse suchen…» input inside its popover,
              which meant the field the operator aimed at was never the field
              they typed into. */}
          <Popover open={addressSearchOpen} onOpenChange={setAddressSearchOpen}>
            <PopoverAnchor asChild>
              <div ref={anchorRef} className="relative flex-1">
                {/* No pin inside the dense field any more: its pl-7 shifted the
                    address right of every sibling row's value — the one visibly
                    unaligned line in the detail. The row's own label plus the
                    map buttons beside it say what the field is. */}
                <Input
                  id="location_address"
                  ref={searchInputRef}
                  role="combobox"
                  aria-expanded={addressSearchOpen}
                  aria-autocomplete="list"
                  aria-controls="location-options"
                  aria-invalid={error}
                  autoComplete="off"
                  disabled={disabled}
                  placeholder={t('locationInput.addressPlaceholder')}
                  value={addressSearchQuery}
                  onChange={(e) => {
                    setEditing(true)
                    setAddressSearchQuery(e.target.value)
                    setAddressSearchOpen(true)
                  }}
                  onFocus={(e) => {
                    setEditing(true)
                    // Only reopen the list when there is something to search for.
                    // With an empty field — the autofocused creation dialog — the
                    // popover has nothing but its «Mindestens 3 Zeichen»-hint and
                    // would open OVER the next row before the operator typed a key.
                    if (addressSearchQuery.trim()) setAddressSearchOpen(true)
                    e.target.select()
                  }}
                  onBlur={() => {
                    setEditing(false)
                    // Leaving the field with text nobody committed: take it as
                    // freetext rather than silently throwing it away. Skipped
                    // while the list is open, because that blur is a click on a
                    // result — and that result must win, not the half-typed
                    // query behind it.
                    if (!addressSearchOpen && addressSearchQuery.trim() !== (address ?? "").trim()) {
                      commitFreetext(addressSearchQuery)
                    }
                  }}
                  onKeyDown={handleAddressKeyDown}
                  className={cn(
                    // `DENSE_CONTROL`, not a copy of it. This row used to
                    // hand-roll the same classes, which is why it was the ONE
                    // field of the detail left without a box when the skin grew
                    // its resting border: every value around it read as
                    // editable and the Einsatzort read as printed text.
                    dense && !boxed && DENSE_CONTROL,
                    boxed && "pr-16",
                    // The hover/focus variants have to be beaten in kind:
                    // `DENSE_CONTROL` sets `hover:border-border` and
                    // `focus-visible:border-border`, and an unprefixed
                    // `border-destructive` loses to both — the error outline
                    // disappeared the moment the field was hovered or focused.
                    error &&
                      "border-destructive hover:border-destructive focus-visible:border-destructive focus-visible:ring-destructive"
                  )}
                />
                {boxed && (
                  <div className="absolute top-1/2 right-1 flex -translate-y-1/2 items-center gap-0.5">
                    {locationActions}
                  </div>
                )}
              </div>
            </PopoverAnchor>
            <PopoverContent
              // The list is portalled to the end of <body>, so to anything that
              // asks "did that click land outside?" it is outside — which is how
              // picking an address inside the /feld «Neue Meldung» slide-up used
              // to dismiss the whole sheet and throw the form away. This says the
              // list belongs to whatever panel the field sits in.
              {...{ [SHEET_LAYER_ATTR]: '' }}
              // Trigger width as the FLOOR, not the size: in the side panel the
              // field is ~250px wide, and an address list that narrow truncates
              // exactly the part that distinguishes two streets of the same name.
              className="w-(--radix-popover-trigger-width) min-w-[340px] p-0"
              align="start"
              // The field keeps the keyboard the whole time — this is one input
              // with a list under it, not a panel you tab into.
              onOpenAutoFocus={(e) => e.preventDefault()}
              onCloseAutoFocus={(e) => e.preventDefault()}
              // Clicking back into the input is not "outside": without this the
              // list closes on pointer-down and reopens on focus, which flickers.
              onInteractOutside={(e) => {
                if (anchorRef.current?.contains(e.target as Node)) e.preventDefault()
              }}
            >
              <div className="flex flex-col">
                {/* data-testid is the contract for the E2E page object: an option is
                    either a geocoded result row or the «…» übernehmen freetext
                    fallback, and clicking either commits the address. */}
                <div id="location-options" data-testid="location-options" className="overflow-y-auto overscroll-contain max-h-[260px]">
                  {/* One type scale for the whole dropdown: an option title is
                      text-sm, everything secondary (coordinates, hints, status
                      lines) is text-xs. The popover itself sets no font size,
                      so anything unsized in here inherits the 16px body text
                      and renders LARGER than the result rows it sits next to —
                      which is what made the list look oversized. */}
                  {isSearching && (
                    <div className="px-3 py-2.5 text-xs text-muted-foreground text-center">
                      {t('locationInput.searching')}
                    </div>
                  )}
                  {!isSearching && addressResults.length === 0 && addressSearchQuery.length >= 3 && (
                    <div className="py-1">
                      <div className="px-3 py-2 text-xs text-muted-foreground text-center">
                        {t('locationInput.noResults')}
                      </div>
                      <button
                        type="button"
                        // Picking must not blur the input first — see the note on
                        // the result rows below.
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => commitFreetext(addressSearchQuery)}
                        className="w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-muted transition-colors cursor-pointer border-t"
                      >
                        <MapPin className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                        <div className="flex-1 min-w-0">
                          <div className="truncate text-sm font-medium">{t('locationInput.useFreetext', { query: addressSearchQuery.trim() })}</div>
                          <div className="text-xs text-muted-foreground">
                            {t('locationInput.freetextNote')}
                          </div>
                        </div>
                      </button>
                    </div>
                  )}
                  {!isSearching && addressResults.length === 0 && addressSearchQuery.length < 3 && (
                    <div className="px-3 py-2.5 text-xs text-muted-foreground text-center">
                      {t('locationInput.minChars')}
                    </div>
                  )}
                  {!isSearching && addressResults.length > 0 && (
                    <div className="py-1">
                      {addressResults.map((result, index) => (
                        <button
                          key={result.id}
                          type="button"
                          /**
                           * Keep the focus in the input while the row is clicked.
                           *
                           * Without this the address was never applied: mousedown
                           * blurred the field → `editing` went false → the sync
                           * effect put the committed address (empty) back into the
                           * query → the search effect saw fewer than 3 characters
                           * and cleared `addressResults` → this very button
                           * unmounted before mouseup, so `onClick` never fired.
                           * The operator watched the list vanish and the field
                           * keep their half-typed text.
                           */
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => handleAddressSelect(result)}
                          onMouseEnter={() => setActiveIndex(index)}
                          aria-selected={index === activeIndex}
                          className={cn(
                            "w-full flex items-start gap-2 px-3 py-2 text-left transition-colors cursor-pointer hover:bg-muted",
                            index === activeIndex && "bg-muted",
                          )}
                        >
                          <MapPin className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                          <div className="flex-1 min-w-0">
                            <div className="truncate text-sm font-medium">{result.formattedAddress}</div>
                            <div className="text-xs text-muted-foreground truncate">
                              {result.lat.toFixed(6)}, {result.lon.toFixed(6)}
                            </div>
                          </div>
                        </button>
                      ))}
                      {addressResults[0]?.attribution && (
                        <div className="px-3 py-1 text-xs text-muted-foreground">
                          {addressResults[0].attribution}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </PopoverContent>
          </Popover>

          {/* Excluded from tab order for cleaner form navigation; boxed mounts
              carry these inside the field instead (see `locationActions`). */}
          {!boxed && locationActions}

          {extraAction}
        </div>
      </div>

      {/* Coordinates Input - Hidden by default, shown when button clicked.
          The margin exists only while open — see the wrapper note above. */}
      <div
        className={cn(
          "grid transition-all duration-200 ease-in-out",
          showCoordinates
            ? cn("grid-rows-[1fr] opacity-100", dense ? "mt-1" : "mt-3")
            : "grid-rows-[0fr] opacity-0"
        )}
      >
        <div className="overflow-hidden">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className={cn(
                "text-muted-foreground",
                dense ? "text-xs font-normal" : "text-sm font-semibold",
              )}>
                {t('locationInput.coordinatesLabel')}
              </Label>
              {hasValidCoordinates && !coordinateError && (
                <div className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400">
                  <MapPin className="h-3.5 w-3.5" />
                  <Check className="h-3.5 w-3.5" />
                  <span className="font-medium">{t('locationInput.valid')}</span>
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <Input
                value={coordinateInput}
                onChange={(e) => handleCoordinatePaste(e.target.value)}
                placeholder={t('locationInput.coordinatesPlaceholder')}
                disabled={disabled || !showCoordinates}
                aria-invalid={!!coordinateError}
                className={cn(
                  dense && "h-7",
                  coordinateWarning && !coordinateError && "border-warning"
                )}
              />

              {/* Swap Lat/Lng Button */}
              {hasValidCoordinates && (
                <Button
                  type="button"
                  variant="outline"
                  size={dense ? "icon-xs" : "icon"}
                  className={cn(dense && "size-7")}
                  onClick={handleSwapCoordinates}
                  disabled={disabled || !showCoordinates}
                  title={t('locationInput.swapLatLng')}
                  tabIndex={-1}
                >
                  <ArrowUpDown className="size-4" />
                </Button>
              )}

              {/* Clear Button */}
              {(address || hasValidCoordinates) && (
                <Button
                  type="button"
                  variant="outline"
                  size={dense ? "icon-xs" : "icon"}
                  className={cn(dense && "size-7")}
                  onClick={handleClearLocation}
                  disabled={disabled || !showCoordinates}
                  title={t('locationInput.clearLocation')}
                  tabIndex={-1}
                >
                  <X className="size-4" />
                </Button>
              )}
            </div>

            {/* Feedback Messages */}
            {coordinateError && (
              <div className="flex items-start gap-2 text-xs text-destructive">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{coordinateError}</span>
              </div>
            )}

            {coordinateWarning && !coordinateError && (
              <div className="flex items-start gap-2 text-sm text-warning-foreground">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{coordinateWarning}</span>
              </div>
            )}

            {parseSuccess && !coordinateError && (
              <div className="flex items-start gap-2 text-sm text-green-600 dark:text-green-400">
                <Check className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{parseSuccess}</span>
              </div>
            )}

            {/* Format Help */}
            <div className="text-xs text-muted-foreground">
              {t('locationInput.supportedFormats')}
            </div>
          </div>
        </div>
      </div>

      {/* Map Picker Modal - Only render on client side */}
      {isMounted && (
        <MapPickerModal
          open={mapPickerOpen}
          onOpenChange={setMapPickerOpen}
          initialLat={latitude}
          initialLon={longitude}
          // The address this field already holds, so the picker does not report
          // «Keine Adresse gefunden» about a place whose name is in the input
          // right behind it — and does not overwrite it with coordinates.
          initialAddress={address}
          onLocationSelect={handleMapSelect}
        />
      )}
    </div>
  )
}
