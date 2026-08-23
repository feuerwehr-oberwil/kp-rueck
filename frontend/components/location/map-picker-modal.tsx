"use client"

/**
 * MapPickerModal Component
 *
 * IMPORTANT: This component is used by LocationInput, which is used in:
 * - IncidentForm (components/incidents/incident-form.tsx) - Edit incident details
 * - NewEmergencyModal (components/kanban/new-emergency-modal.tsx) - Create new incident from Kanban
 * - Any other forms that need location input
 *
 * Changes to this modal automatically affect all forms using LocationInput.
 * Key optimizations to maintain:
 * - Memoized MapView to prevent constant re-renders
 * - Memoized center, tileUrl, and attribution
 * - useCallback for handleMapClick
 * - Map key for controlled remounting
 */

import { useState, useEffect, useMemo, useCallback, useRef } from "react"
import { useTranslations } from "next-intl"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { MapPin, Check } from "lucide-react"
import { reverseGeocode } from "@/lib/geocoding"
import { useMapMode } from "@/lib/hooks/use-map-mode"
import type { LeafletMouseEvent } from "leaflet"

// Leaflet coordinate type (lat, lng tuple)
type LatLngExpression = [number, number]

interface MapPickerModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialLat?: number | null
  initialLon?: number | null
  /**
   * The address the caller already has, for the pin it opens on.
   *
   * Without it the picker knew coordinates and nothing else, so opening the map
   * on an incident that HAS an Einsatzort showed «Keine Adresse gefunden» —
   * the picker announcing the absence of something that was on screen behind
   * it — whenever Nominatim's reverse lookup came back empty. Worse, confirming
   * from there wrote `47.123456, 7.654321` over the address, because
   * `handleConfirm` fell back to the coordinate string.
   *
   * Only valid while the pin has NOT been moved: once the operator drops a new
   * one, the old address describes a different place.
   */
  initialAddress?: string | null
  onLocationSelect: (lat: number, lon: number, address: string | null) => void
}

// Component to handle map clicks
function MapClickHandler({
  onLocationClick,
}: {
  onLocationClick: (lat: number, lon: number) => void
}) {
  if (typeof window === 'undefined') return null

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useMapEvents } = require('react-leaflet')
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useMapEvents({
    click: (e: LeafletMouseEvent) => {
      onLocationClick(e.latlng.lat, e.latlng.lng)
    },
  })
  return null
}

export function MapPickerModal({
  open,
  onOpenChange,
  initialLat,
  initialLon,
  initialAddress,
  onLocationSelect,
}: MapPickerModalProps) {
  const t = useTranslations('map')
  const [selectedLat, setSelectedLat] = useState<number | null>(initialLat ?? null)
  const [selectedLon, setSelectedLon] = useState<number | null>(initialLon ?? null)
  const [isGeocoding, setIsGeocoding] = useState(false)
  const [geocodedAddress, setGeocodedAddress] = useState<string | null>(null)
  const [isClient, setIsClient] = useState(false)
  const [mapKey, setMapKey] = useState(0) // Key to force map remount only when needed
  // Has the operator dropped a pin of their own? Until they do, the address the
  // caller handed in still describes what the marker is sitting on.
  const [pinMoved, setPinMoved] = useState(false)

  // Map mode management
  const { getTileUrl, getAttribution, handleTileError } = useMapMode()

  // Only render map on client side
  useEffect(() => {
    setIsClient(true)

    // Fix Leaflet default icon issue with Next.js
    if (typeof window !== 'undefined') {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const L = require('leaflet')
      delete (L.Icon.Default.prototype as { _getIconUrl?: unknown })._getIconUrl
      L.Icon.Default.mergeOptions({
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        iconUrl: require('leaflet/dist/images/marker-icon.png').default.src,
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        iconRetinaUrl: require('leaflet/dist/images/marker-icon-2x.png').default.src,
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        shadowUrl: require('leaflet/dist/images/marker-shadow.png').default.src,
      })
    }
  }, [])

  // Default center (Basel-Landschaft)
  const defaultCenter: LatLngExpression = [47.51637699933488, 7.561800450458299]

  // Memoize center to prevent unnecessary re-renders.
  // Use loose `!= null` so we accept both `null` (explicit no-value) and
  // `undefined` (prop omitted) — strict `!== null` made undefined fall
  // through and Leaflet threw "Invalid LatLng object: (undefined, undefined)".
  const center: LatLngExpression = useMemo(() => {
    if (selectedLat != null && selectedLon != null) {
      return [selectedLat, selectedLon] as LatLngExpression
    }
    if (initialLat != null && initialLon != null) {
      return [initialLat, initialLon] as LatLngExpression
    }
    return defaultCenter
  }, [selectedLat, selectedLon, initialLat, initialLon])

  // Reset state when modal opens with new initial values
  useEffect(() => {
    if (open) {
      setSelectedLat(initialLat ?? null)
      setSelectedLon(initialLon ?? null)
      setGeocodedAddress(null)
      setPinMoved(false)
      // Increment key to force map remount on open
      setMapKey((prev) => prev + 1)
    }
  }, [open, initialLat, initialLon])

  // Reverse geocode when location is selected.
  //
  // `lookupSeq` makes the LATEST request the only one that may write. Two quick
  // pin drops fire two un-abortable lookups, and if the first resolves last it
  // used to name the pin after the place the operator had already moved away
  // from — and `.finally` cleared «Suche…» while the real request was still out.
  const lookupSeq = useRef(0)
  useEffect(() => {
    if (Number.isFinite(selectedLat) && Number.isFinite(selectedLon)) {
      const seq = ++lookupSeq.current
      setIsGeocoding(true)
      reverseGeocode(selectedLat as number, selectedLon as number)
        .then((address) => {
          if (seq !== lookupSeq.current) return
          setGeocodedAddress(address)
        })
        .catch((error) => {
          if (seq !== lookupSeq.current) return
          console.error('Reverse geocoding failed:', error)
          setGeocodedAddress(null)
        })
        .finally(() => {
          if (seq !== lookupSeq.current) return
          setIsGeocoding(false)
        })
    }
  }, [selectedLat, selectedLon])

  const handleMapClick = useCallback((lat: number, lon: number) => {
    // Defensive: a malformed click event (undefined/NaN) would otherwise
    // poison selectedLat/Lon and crash Leaflet's L.latLng() constructor.
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return
    setSelectedLat(lat)
    setSelectedLon(lon)
    // From here on the caller's address describes somewhere else — and so does
    // the address the geocoder found for the PREVIOUS pin. Dropping it is what
    // stops «Bestätigen», pressed before the new lookup returns, from writing
    // the old street name onto the new coordinates.
    setPinMoved(true)
    setGeocodedAddress(null)
  }, [])

  // Guard for any spot that hands coords to Leaflet — accepts only finite
  // numbers, rejects null / undefined / NaN. Returning a narrowed tuple lets
  // TS infer `number` (not `number | null`) at every consumer site.
  const validPin: [number, number] | null = useMemo(
    () =>
      Number.isFinite(selectedLat) && Number.isFinite(selectedLon)
        ? [selectedLat as number, selectedLon as number]
        : null,
    [selectedLat, selectedLon],
  )
  const hasValidPin = validPin !== null

  /**
   * What this pin is called, best answer first.
   *
   * The caller's own address wins over a coordinate string while the pin has not
   * been moved: confirming an unmoved map used to overwrite a perfectly good
   * Einsatzort with `47.123456, 7.654321` whenever the reverse lookup came back
   * empty — the operator opened the map to LOOK and closed it having lost the
   * address. Once they drop a pin, that address is about somewhere else and only
   * the geocoder (or the coordinates) can name the new place.
   */
  // `||`, not `??`: `formatNaturalAddress` can hand back an empty string, and
  // `"" ?? x` is `""` — which would show «Keine Adresse gefunden» over a pin
  // whose name the caller had passed in.
  //
  // The caller's address wins while the pin is UNMOVED. Opening the map to look
  // at an incident and pressing Bestätigen must not silently replace a
  // hand-typed «Waldhütte Chrischonaweg (Zufahrt Forststrasse)» with Nominatim's
  // rendering of the same spot. Move the pin and the geocoder takes over, because
  // then it is describing a place the caller has no name for.
  const resolvedAddress =
    (!pinMoved ? initialAddress?.trim() || null : null) || geocodedAddress || null

  const handleConfirm = () => {
    if (validPin) {
      const [lat, lon] = validPin
      // Fall back to a coordinate string only when nothing can name the place.
      const address = resolvedAddress || `${lat.toFixed(6)}, ${lon.toFixed(6)}`
      onLocationSelect(lat, lon, address)
      onOpenChange(false)
    }
  }

  // Memoize tile URL and attribution to prevent map refreshes
  const tileUrl = useMemo(() => getTileUrl(), [getTileUrl])
  const attribution = useMemo(() => getAttribution(), [getAttribution])

  // Client-side map component - memoized to prevent constant re-renders
  const MapView = useMemo(() => {
    if (!isClient) {
      return (
        <div className="h-[400px] rounded-lg overflow-hidden border flex items-center justify-center bg-muted">
          <div className="text-muted-foreground">{t('mapPicker.loading')}</div>
        </div>
      )
    }

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { MapContainer, TileLayer, Marker } = require('react-leaflet')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('leaflet/dist/leaflet.css')

    return (
      <div className="h-[400px] rounded-lg overflow-hidden border">
        <MapContainer
          key={mapKey}
          center={center}
          zoom={hasValidPin ? 16 : 13}
          className="w-full h-full"
          zoomControl={true}
        >
          <TileLayer
            attribution={attribution}
            url={tileUrl}
            eventHandlers={{
              tileerror: handleTileError,
            }}
          />

          <MapClickHandler onLocationClick={handleMapClick} />

          {validPin && <Marker position={validPin} />}
        </MapContainer>
      </div>
    )
  }, [isClient, mapKey, center, validPin, tileUrl, attribution, handleTileError, handleMapClick])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl modal-h-tall flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5" />
            {t('mapPicker.title')}
          </DialogTitle>
          <DialogDescription>
            {t('mapPicker.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 overflow-y-auto flex-1 min-h-0">
          {/* Map */}
          {MapView}

          {/* Selected location info */}
          {validPin && (
            <div className="flex items-start gap-2 p-3 bg-muted rounded-lg">
              <MapPin className="h-4 w-4 text-primary mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                {isGeocoding ? (
                  <div className="text-sm text-muted-foreground">{t('mapPicker.searchingAddress')}</div>
                ) : resolvedAddress ? (
                  <div className="text-sm">{resolvedAddress}</div>
                ) : (
                  <div className="text-sm text-muted-foreground">{t('mapPicker.noAddress')}</div>
                )}
                <div className="text-xs text-muted-foreground font-mono mt-1">
                  {validPin[0].toFixed(8)}, {validPin[1].toFixed(8)}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* `DialogFooter`, not a hand-built row: this dialog put its actions on
            the LEFT and its confirm FIRST, so the one button an operator aims at
            sat where every other dialog in the app puts «Abbrechen». Cancel
            left, confirm right, right-aligned — the primitive's order. */}
        <DialogFooter className="flex-shrink-0 border-t pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('mapPicker.cancel')}
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={selectedLat === null || selectedLon === null}
          >
            <Check className="size-4" />
            {t('mapPicker.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
