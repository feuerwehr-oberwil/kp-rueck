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

import { useState, useEffect, useMemo, useCallback } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { MapPin, Check } from "lucide-react"
import { reverseGeocode } from "@/lib/geocoding"
import { useMapMode } from "@/lib/hooks/use-map-mode"

// Leaflet coordinate type (lat, lng tuple)
type LatLngExpression = [number, number]

interface MapPickerModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialLat?: number | null
  initialLon?: number | null
  onLocationSelect: (lat: number, lon: number, address: string | null) => void
}

// Component to handle map clicks
function MapClickHandler({
  onLocationClick,
}: {
  onLocationClick: (lat: number, lon: number) => void
}) {
  if (typeof window === 'undefined') return null

  const { useMapEvents } = require('react-leaflet')
  useMapEvents({
    click: (e: any) => {
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
  onLocationSelect,
}: MapPickerModalProps) {
  const [selectedLat, setSelectedLat] = useState<number | null>(initialLat ?? null)
  const [selectedLon, setSelectedLon] = useState<number | null>(initialLon ?? null)
  const [isGeocoding, setIsGeocoding] = useState(false)
  const [geocodedAddress, setGeocodedAddress] = useState<string | null>(null)
  const [isClient, setIsClient] = useState(false)
  const [mapKey, setMapKey] = useState(0) // Key to force map remount only when needed

  // Map mode management
  const { getTileUrl, getAttribution, handleTileError } = useMapMode()

  // Only render map on client side
  useEffect(() => {
    setIsClient(true)

    // Fix Leaflet default icon issue with Next.js
    if (typeof window !== 'undefined') {
      const L = require('leaflet')
      delete (L.Icon.Default.prototype as any)._getIconUrl
      L.Icon.Default.mergeOptions({
        iconUrl: require('leaflet/dist/images/marker-icon.png').default.src,
        iconRetinaUrl: require('leaflet/dist/images/marker-icon-2x.png').default.src,
        shadowUrl: require('leaflet/dist/images/marker-shadow.png').default.src,
      })
    }
  }, [])

  // Default center (Basel-Landschaft)
  const defaultCenter: LatLngExpression = [47.51637699933488, 7.561800450458299]

  // Memoize center to prevent unnecessary re-renders
  const center: LatLngExpression = useMemo(() => {
    if (selectedLat !== null && selectedLon !== null) {
      return [selectedLat, selectedLon]
    }
    if (initialLat !== null && initialLon !== null) {
      return [initialLat, initialLon]
    }
    return defaultCenter
  }, [selectedLat, selectedLon, initialLat, initialLon])

  // Reset state when modal opens with new initial values
  useEffect(() => {
    if (open) {
      setSelectedLat(initialLat ?? null)
      setSelectedLon(initialLon ?? null)
      setGeocodedAddress(null)
      // Increment key to force map remount on open
      setMapKey((prev) => prev + 1)
    }
  }, [open, initialLat, initialLon])

  // Reverse geocode when location is selected
  useEffect(() => {
    if (selectedLat !== null && selectedLon !== null) {
      setIsGeocoding(true)
      reverseGeocode(selectedLat, selectedLon)
        .then((address) => {
          setGeocodedAddress(address)
        })
        .catch((error) => {
          console.error('Reverse geocoding failed:', error)
          setGeocodedAddress(null)
        })
        .finally(() => {
          setIsGeocoding(false)
        })
    }
  }, [selectedLat, selectedLon])

  const handleMapClick = useCallback((lat: number, lon: number) => {
    setSelectedLat(lat)
    setSelectedLon(lon)
  }, [])

  const handleConfirm = () => {
    if (selectedLat !== null && selectedLon !== null) {
      onLocationSelect(selectedLat, selectedLon, geocodedAddress)
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
          <div className="text-muted-foreground">Karte wird geladen...</div>
        </div>
      )
    }

    const { MapContainer, TileLayer, Marker } = require('react-leaflet')
    require('leaflet/dist/leaflet.css')

    return (
      <div className="h-[400px] rounded-lg overflow-hidden border">
        <MapContainer
          key={mapKey}
          center={center}
          zoom={selectedLat !== null && selectedLon !== null ? 16 : 13}
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

          {selectedLat !== null && selectedLon !== null && (
            <Marker position={[selectedLat, selectedLon]} />
          )}
        </MapContainer>
      </div>
    )
  }, [isClient, mapKey, center, selectedLat, selectedLon, tileUrl, attribution, handleTileError, handleMapClick])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5" />
            Einsatzort auf Karte wählen
          </DialogTitle>
          <DialogDescription>
            Klicken Sie auf die Karte, um den Einsatzort zu markieren
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 overflow-y-auto flex-1 min-h-0">
          {/* Map */}
          {MapView}

          {/* Selected location info */}
          {selectedLat !== null && selectedLon !== null && (
            <div className="flex items-start gap-2 p-3 bg-muted rounded-lg">
              <MapPin className="h-4 w-4 text-primary mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                {isGeocoding ? (
                  <div className="text-sm text-muted-foreground">Adresse wird gesucht...</div>
                ) : geocodedAddress ? (
                  <div className="text-sm">{geocodedAddress}</div>
                ) : (
                  <div className="text-sm text-muted-foreground">Keine Adresse gefunden</div>
                )}
                <div className="text-xs text-muted-foreground font-mono mt-1">
                  {selectedLat.toFixed(8)}, {selectedLon.toFixed(8)}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-3 pt-4 border-t flex-shrink-0">
          <Button
            onClick={handleConfirm}
            disabled={selectedLat === null || selectedLon === null}
            className="gap-2"
          >
            <Check className="h-4 w-4" />
            Standort übernehmen
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
