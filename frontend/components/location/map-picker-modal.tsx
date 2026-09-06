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
 *
 * The map is `<BaseMap>` (MapLibre, plan 28). Everything that used to be wired up here – tile URL,
 * attribution, the auto→offline fallback, the dialog-sizing dance – belongs to the base map now, so
 * this file is down to what is actually its own: where the map opens, the pin, and what the pin is
 * called. `initialViewState` is read once per map instance, and a reopened picker has to frame the
 * incident it was opened on — which it does for free: Radix unmounts the dialog body on close, so
 * every open builds a new map anyway.
 */

import { useState, useEffect, useMemo, useCallback } from "react"
import { useTranslations } from "next-intl"
import { Marker, NavigationControl, type MapLayerMouseEvent } from "react-map-gl/maplibre"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { MapPin, Check } from "lucide-react"
import { reverseGeocode } from "@/lib/geocoding"
import { BaseMap } from "@/components/map/base-map"
import { DEFAULT_CENTER_LATLNG, type LatLngPoint } from "@/lib/map-view"

/** `[lat, lon]`, the order every caller of this picker speaks. MapLibre wants them the other way. */
type LatLon = LatLngPoint

/**
 * The blue of Leaflet's default marker pin.
 *
 * MapLibre's own default is teal; hard-coding the old blue keeps a picker that has always shown a
 * blue pin showing a blue pin. Not a status colour – the picked point carries no state.
 */
const PIN_COLOR = "#2a81cb"

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
  // Has the operator dropped a pin of their own? Until they do, the address the
  // caller handed in still describes what the marker is sitting on.
  const [pinMoved, setPinMoved] = useState(false)

  // Memoize center to prevent unnecessary re-renders.
  // Use loose `!= null` so we accept both `null` (explicit no-value) and
  // `undefined` (prop omitted) — strict `!== null` made undefined fall
  // through and the map was asked to open on (undefined, undefined).
  const center: LatLon = useMemo(() => {
    if (selectedLat != null && selectedLon != null) {
      return [selectedLat, selectedLon]
    }
    if (initialLat != null && initialLon != null) {
      return [initialLat, initialLon]
    }
    return DEFAULT_CENTER_LATLNG
  }, [selectedLat, selectedLon, initialLat, initialLon])

  // Reset state when modal opens with new initial values
  useEffect(() => {
    if (open) {
      setSelectedLat(initialLat ?? null)
      setSelectedLon(initialLon ?? null)
      setGeocodedAddress(null)
      setPinMoved(false)
    }
  }, [open, initialLat, initialLon])

  // Cancel obsolete pin lookups, including retries, when the pin moves or the dialog closes.
  useEffect(() => {
    if (!open || selectedLat === null || selectedLon === null ||
      !Number.isFinite(selectedLat) || !Number.isFinite(selectedLon)) {
      setIsGeocoding(false)
      return
    }
    const controller = new AbortController()
    setIsGeocoding(true)
    reverseGeocode(selectedLat, selectedLon, controller.signal)
      .then((address) => {
        if (!controller.signal.aborted) setGeocodedAddress(address)
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsGeocoding(false)
      })
    return () => controller.abort()
  }, [open, selectedLat, selectedLon])

  const handleMapClick = useCallback((event: MapLayerMouseEvent) => {
    const { lat, lng } = event.lngLat
    // Defensive: a malformed click event (undefined/NaN) would otherwise
    // poison selectedLat/Lon and put the marker nowhere.
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return
    setSelectedLat(lat)
    setSelectedLon(lng)
    // From here on the caller's address describes somewhere else — and so does
    // the address the geocoder found for the PREVIOUS pin. Dropping it is what
    // stops «Bestätigen», pressed before the new lookup returns, from writing
    // the old street name onto the new coordinates.
    setPinMoved(true)
    setGeocodedAddress(null)
  }, [])

  // Guard for any spot that hands coords to the map — accepts only finite
  // numbers, rejects null / undefined / NaN. Returning a narrowed tuple lets
  // TS infer `number` (not `number | null`) at every consumer site.
  const validPin: LatLon | null = useMemo(
    () =>
      Number.isFinite(selectedLat) && Number.isFinite(selectedLon)
        ? [selectedLat as number, selectedLon as number]
        : null,
    [selectedLat, selectedLon],
  )
  const hasValidPin = validPin !== null

  // Read once per map instance (i.e. once per open), which is why dropping a pin does not
  // re-frame the map — same as the Leaflet `MapContainer` this replaces.
  const initialViewState = useMemo(
    () => ({ longitude: center[1], latitude: center[0], zoom: hasValidPin ? 16 : 13 }),
    [center, hasValidPin],
  )

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
          {/* Map. Both importers load this modal through `dynamic(ssr: false)`, so there is no
              server render to guard against — the canvas always has a browser under it. */}
          <div className="h-[400px] rounded-lg overflow-hidden border">
            <BaseMap initialViewState={initialViewState} onClick={handleMapClick}>
              {/* Leaflet's zoom buttons, kept – the picker is the one map that always had them.
                  No compass: the base map disables rotation, so it would be a dead control. */}
              <NavigationControl position="top-left" showCompass={false} />
              {validPin && (
                <Marker longitude={validPin[1]} latitude={validPin[0]} color={PIN_COLOR} />
              )}
            </BaseMap>
          </div>

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
