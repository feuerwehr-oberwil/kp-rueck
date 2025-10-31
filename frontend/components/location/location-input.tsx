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
import dynamic from "next/dynamic"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { MapPin, Check, AlertCircle, ArrowUpDown, X, Map, Navigation } from "lucide-react"
import { cn } from "@/lib/utils"
import { searchAddress, geocodeAddress } from "@/lib/geocoding"
import { parseCoordinates, checkRegion } from "@/lib/coordinate-parser"
import type { SearchResult } from "@/lib/geocoding"

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
}

export function LocationInput({
  address,
  latitude,
  longitude,
  onAddressChange,
  onCoordinatesChange,
  disabled = false,
}: LocationInputProps) {
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

  const searchTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined)

  // Only render map picker on client side
  useEffect(() => {
    setIsMounted(true)
  }, [])

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
      const results = await searchAddress(addressSearchQuery)
      setAddressResults(results)
      setIsSearching(false)
    }, 300) // Debounce 300ms

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current)
      }
    }
  }, [addressSearchQuery])

  // Geocode address when it changes (if no coordinates set yet)
  useEffect(() => {
    if (address && address.trim().length > 0 && (latitude === null || longitude === null)) {
      geocodeAddress(address).then((coords) => {
        if (coords) {
          onCoordinatesChange(coords.lat, coords.lon)
        }
      })
    }
  }, [address]) // Only depend on address, not lat/lon to avoid infinite loop

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
      setParseSuccess(parsed.error || `Format erkannt: ${parsed.format}`)

      // Check region
      const regionCheck = checkRegion(parsed.lat, parsed.lon)
      setCoordinateWarning(regionCheck.warning || null)
    } else {
      setCoordinateError(parsed.error || "Ungültiges Format")
      setCoordinateWarning(null)
      setParseSuccess(null)
    }
  }

  const handleSwapCoordinates = () => {
    if (latitude !== null && longitude !== null) {
      onCoordinatesChange(longitude, latitude)
      setParseSuccess("Koordinaten wurden getauscht")
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
        <Label htmlFor="location_address" className="text-sm font-semibold text-muted-foreground">
          Einsatzort (Adresse)
        </Label>
        <div className="flex items-start gap-2 mt-2">
          <Popover open={addressSearchOpen} onOpenChange={setAddressSearchOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={addressSearchOpen}
                className="flex-1 justify-between"
                disabled={disabled}
              >
                <span className="truncate">
                  {address || "Adresse eingeben oder suchen..."}
                </span>
                <MapPin className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-full p-0" align="start">
              <Command shouldFilter={false}>
                <CommandInput
                  placeholder="Adresse suchen..."
                  value={addressSearchQuery}
                  onValueChange={setAddressSearchQuery}
                />
                <CommandList>
                  {isSearching && (
                    <div className="p-4 text-sm text-muted-foreground text-center">
                      Suche läuft...
                    </div>
                  )}
                  {!isSearching && addressResults.length === 0 && addressSearchQuery.length >= 3 && (
                    <CommandEmpty>Keine Adressen gefunden.</CommandEmpty>
                  )}
                  {!isSearching && addressResults.length === 0 && addressSearchQuery.length < 3 && (
                    <div className="p-4 text-sm text-muted-foreground text-center">
                      Mindestens 3 Zeichen eingeben
                    </div>
                  )}
                  {!isSearching && addressResults.length > 0 && (
                    <CommandGroup>
                      {addressResults.map((result) => (
                        <CommandItem
                          key={result.id}
                          value={result.formattedAddress}
                          onSelect={() => handleAddressSelect(result)}
                          className="flex items-start gap-2"
                        >
                          <MapPin className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium truncate">{result.formattedAddress}</div>
                            <div className="text-xs text-muted-foreground truncate">
                              {result.lat.toFixed(6)}, {result.lon.toFixed(6)}
                            </div>
                          </div>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  )}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>

          {/* Map Picker Button */}
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => setMapPickerOpen(true)}
            disabled={disabled}
            title="Auf Karte wählen"
          >
            <Map className="h-4 w-4" />
          </Button>

          {/* Show Coordinates Button */}
          <Button
            type="button"
            variant={showCoordinates ? "default" : "outline"}
            size="icon"
            onClick={() => setShowCoordinates(!showCoordinates)}
            disabled={disabled}
            title="Koordinaten eingeben"
          >
            <Navigation className="h-4 w-4" />
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
                Koordinaten (alle Formate)
              </Label>
              {hasValidCoordinates && !coordinateError && (
                <div className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400">
                  <MapPin className="h-3.5 w-3.5" />
                  <Check className="h-3.5 w-3.5" />
                  <span className="font-medium">Gültig</span>
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <Input
                value={coordinateInput}
                onChange={(e) => handleCoordinatePaste(e.target.value)}
                placeholder="47.5164, 7.5618 oder Swiss LV95 oder URL einfügen"
                disabled={disabled || !showCoordinates}
                className={cn(
                  coordinateError && "border-red-500",
                  coordinateWarning && "border-yellow-500"
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
                  title="Lat/Lng vertauschen"
                >
                  <ArrowUpDown className="h-4 w-4" />
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
                  title="Standort löschen"
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>

            {/* Feedback Messages */}
            {coordinateError && (
              <div className="flex items-start gap-2 text-sm text-red-600 dark:text-red-400">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{coordinateError}</span>
              </div>
            )}

            {coordinateWarning && !coordinateError && (
              <div className="flex items-start gap-2 text-sm text-yellow-600 dark:text-yellow-400">
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
              Unterstützte Formate: Dezimal (47.5164, 7.5618), Swiss LV95 (2621234, 1260789), DMS (47°31'2.96"N), Google Maps URL
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
