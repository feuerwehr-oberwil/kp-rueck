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

import { useState, useEffect, useRef } from "react"
import { useTranslations } from "next-intl"
import dynamic from "next/dynamic"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"
import { MapPin, Check, AlertCircle, ArrowUpDown, X, Map, Navigation } from "lucide-react"
import { cn } from "@/lib/utils"
import { searchAddress, geocodeAddress } from "@/lib/geocoding"
import { parseCoordinates, checkRegion } from "@/lib/coordinate-parser"
import type { SearchResult } from "@/lib/geocoding"
import { apiClient } from "@/lib/api-client"

// Dynamically import MapPickerModal to avoid SSR issues with Leaflet
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
  /** Row layout for the 420px side panel: the label sits left of the field
   *  instead of above it, and the map/coordinate buttons shrink to match. Same
   *  control either way — see components/kanban/detail-field.tsx. */
  dense?: boolean
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
  dense = false,
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

    if (addressSearchQuery.length < 3) {
      setAddressResults([])
      setActiveIndex(-1)
      return
    }

    setIsSearching(true)
    setActiveIndex(-1)
    searchTimeoutRef.current = setTimeout(async () => {
      // Pass the station's coordinates to prioritize results near it
      const results = await searchAddress(addressSearchQuery, {
        stationCenter: stationCenter || undefined,
        countryCodes: countryCodes || undefined,
      })
      setAddressResults(results)
      setIsSearching(false)
    }, 300) // Debounce 300ms

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current)
      }
    }
  }, [addressSearchQuery, stationCenter, countryCodes])

  // Geocode address when it changes (if no coordinates set yet)
  useEffect(() => {
    if (disabled) return
    if (address !== initialAddressRef.current) addressChangedRef.current = true
    if (!geocodeInitialAddress && !addressChangedRef.current) return

    const current = geocodeInputsRef.current
    if (current.address && current.address.trim().length > 0 && (current.latitude === null || current.longitude === null)) {
      geocodeAddress(current.address).then((coords) => {
        if (coords) current.onCoordinatesChange(coords.lat, coords.lon)
      })
    }
  }, [address, disabled, geocodeInitialAddress])

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

  return (
    <div className={cn(dense ? "space-y-1" : "space-y-4")}>
      {/* Address Input with Autocomplete */}
      <div className={cn(dense ? "flex items-center gap-2 border-b border-border/50 py-1" : "min-h-[40px]")}>
        <div className={cn("flex items-center gap-1", dense && "w-[104px] shrink-0")}>
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
          <span className="text-destructive" title={t('locationInput.requiredField')}>*</span>
        </div>
        <div className={cn("flex items-start gap-2", dense ? "min-w-0 flex-1" : "mt-2")}>
          {/* One field, not two. The input IS the search box: what you type is
              what the geocoder gets, and what is committed is what the field
              shows afterwards. The old shape put a read-only combobox button in
              the form and a *second* «Adresse suchen…» input inside its popover,
              which meant the field the operator aimed at was never the field
              they typed into. */}
          <Popover open={addressSearchOpen} onOpenChange={setAddressSearchOpen}>
            <PopoverAnchor asChild>
              <div ref={anchorRef} className="relative flex-1">
                <MapPin className={cn(
                  "pointer-events-none absolute top-1/2 size-4 -translate-y-1/2 text-muted-foreground",
                  dense ? "left-1.5 size-3.5" : "left-3",
                )} />
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
                    setAddressSearchOpen(true)
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
                    "pl-9",
                    dense &&
                      "h-7 rounded-md border-0 bg-transparent px-1 pl-7 shadow-none hover:bg-input/50 focus-visible:bg-input dark:bg-transparent dark:hover:bg-input/50 dark:focus-visible:bg-input",
                    error && "border-destructive focus-visible:ring-destructive"
                  )}
                />
              </div>
            </PopoverAnchor>
            <PopoverContent
              className="w-(--radix-popover-trigger-width) p-0"
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
                  {isSearching && (
                    <div className="p-4 text-sm text-muted-foreground text-center">
                      {t('locationInput.searching')}
                    </div>
                  )}
                  {!isSearching && addressResults.length === 0 && addressSearchQuery.length >= 3 && (
                    <div className="py-1">
                      <div className="px-3 py-2 text-sm text-muted-foreground text-center">
                        {t('locationInput.noResults')}
                      </div>
                      <button
                        type="button"
                        onClick={() => commitFreetext(addressSearchQuery)}
                        className="w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-muted transition-colors cursor-pointer border-t"
                      >
                        <MapPin className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{t('locationInput.useFreetext', { query: addressSearchQuery.trim() })}</div>
                          <div className="text-xs text-muted-foreground">
                            {t('locationInput.freetextNote')}
                          </div>
                        </div>
                      </button>
                    </div>
                  )}
                  {!isSearching && addressResults.length === 0 && addressSearchQuery.length < 3 && (
                    <div className="p-4 text-sm text-muted-foreground text-center">
                      {t('locationInput.minChars')}
                    </div>
                  )}
                  {!isSearching && addressResults.length > 0 && (
                    <div className="py-1">
                      {addressResults.map((result, index) => (
                        <button
                          key={result.id}
                          type="button"
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
                            <div className="font-medium truncate">{result.formattedAddress}</div>
                            <div className="text-xs text-muted-foreground truncate">
                              {result.lat.toFixed(6)}, {result.lon.toFixed(6)}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </PopoverContent>
          </Popover>

          {/* Map Picker Button - excluded from tab order for cleaner form navigation */}
          <Button
            type="button"
            variant={dense ? "ghost" : "outline"}
            size={dense ? "icon-xs" : "icon"}
            onClick={() => setMapPickerOpen(true)}
            disabled={disabled}
            title={t('locationInput.pickOnMap')}
            tabIndex={-1}
          >
            <Map className={dense ? "size-3.5" : "size-4"} />
          </Button>

          {/* Show Coordinates Button - excluded from tab order for cleaner form navigation */}
          <Button
            type="button"
            variant={showCoordinates ? "default" : dense ? "ghost" : "outline"}
            size={dense ? "icon-xs" : "icon"}
            onClick={() => setShowCoordinates(!showCoordinates)}
            disabled={disabled}
            title={t('locationInput.enterCoordinates')}
            tabIndex={-1}
          >
            <Navigation className={dense ? "size-3.5" : "size-4"} />
          </Button>
        </div>
      </div>

      {/* Coordinates Input - Hidden by default, shown when button clicked */}
      <div
        className={cn(
          "grid transition-all duration-200 ease-in-out",
          showCoordinates
            ? "grid-rows-[1fr] opacity-100"
            : "grid-rows-[0fr] opacity-0"
        )}
      >
        <div className="overflow-hidden">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-semibold text-muted-foreground">
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
                  coordinateWarning && !coordinateError && "border-warning"
                )}
              />

              {/* Swap Lat/Lng Button */}
              {hasValidCoordinates && (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
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
                  size="icon"
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
          onLocationSelect={handleMapSelect}
        />
      )}
    </div>
  )
}
