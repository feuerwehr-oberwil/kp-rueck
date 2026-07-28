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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
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

  const searchTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined)
  const searchInputRef = useRef<HTMLInputElement>(null)
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

  // Track the trigger button for autoFocus
  const triggerButtonRef = useRef<HTMLButtonElement>(null)

  // Auto-focus: open the popover and focus the search input when autoFocus is true
  useEffect(() => {
    if (autoFocus && isMounted && !disabled) {
      // Open the popover after a short delay to let the modal render
      const timer = setTimeout(() => {
        setAddressSearchOpen(true)
      }, 150)
      return () => clearTimeout(timer)
    }
  }, [autoFocus, isMounted, disabled])

  // Focus search input when popover opens
  useEffect(() => {
    if (addressSearchOpen && searchInputRef.current) {
      // Small delay to ensure the input is visible
      const timer = setTimeout(() => {
        searchInputRef.current?.focus()
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [addressSearchOpen])

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
      return
    }

    setIsSearching(true)
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
    setAddressSearchOpen(false)
    setAddressSearchQuery("")
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
    <div className="space-y-4">
      {/* Address Input with Autocomplete */}
      <div className="min-h-[40px]">
        <div className="flex items-center gap-1">
          <Label htmlFor="location_address" className="text-sm font-semibold text-muted-foreground">
            {t('locationInput.addressLabel')}
          </Label>
          <span className="text-destructive" title={t('locationInput.requiredField')}>*</span>
        </div>
        <div className="flex items-start gap-2 mt-2">
          <Popover
            open={addressSearchOpen}
            onOpenChange={(open) => {
              // Pre-fill the search input with the current address when opening,
              // so the user can edit it (e.g. change a house number) instead of
              // starting from an empty field.
              if (open) {
                setAddressSearchQuery(address ?? "")
              }
              setAddressSearchOpen(open)
            }}
          >
            <PopoverTrigger asChild>
              <Button
                ref={triggerButtonRef}
                variant="outline"
                role="combobox"
                aria-expanded={addressSearchOpen}
                aria-invalid={error}
                className={cn(
                  "flex-1 justify-between",
                  error && "border-destructive focus:ring-destructive"
                )}
                disabled={disabled}
              >
                <span className="truncate">
                  {address || t('locationInput.addressPlaceholder')}
                </span>
                <MapPin className="ml-2 size-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[500px] p-0" align="start">
              <div className="flex flex-col">
                <div className="p-2 border-b">
                  <Input
                    ref={searchInputRef}
                    placeholder={t('locationInput.searchPlaceholder')}
                    value={addressSearchQuery}
                    onChange={(e) => setAddressSearchQuery(e.target.value)}
                    onFocus={(e) => e.target.select()}
                    onKeyDown={(e) => {
                      // Close popover on Tab and let natural tab order take over
                      if (e.key === 'Tab') {
                        setAddressSearchOpen(false)
                        // Don't prevent default - let the browser handle tab navigation naturally
                      }
                    }}
                    className="h-9"
                  />
                </div>
                <div className="overflow-y-auto overscroll-contain max-h-[260px]">
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
                        onClick={() => {
                          onAddressChange(addressSearchQuery.trim())
                          setAddressSearchOpen(false)
                          setAddressSearchQuery("")
                        }}
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
                      {addressResults.map((result) => (
                        <button
                          key={result.id}
                          type="button"
                          onClick={() => handleAddressSelect(result)}
                          className="w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-muted transition-colors cursor-pointer"
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
            variant="outline"
            size="icon"
            onClick={() => setMapPickerOpen(true)}
            disabled={disabled}
            title={t('locationInput.pickOnMap')}
            tabIndex={-1}
          >
            <Map className="size-4" />
          </Button>

          {/* Show Coordinates Button - excluded from tab order for cleaner form navigation */}
          <Button
            type="button"
            variant={showCoordinates ? "default" : "outline"}
            size="icon"
            onClick={() => setShowCoordinates(!showCoordinates)}
            disabled={disabled}
            title={t('locationInput.enterCoordinates')}
            tabIndex={-1}
          >
            <Navigation className="size-4" />
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
