"use client"

import { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { MapContainer, TileLayer, Marker, useMapEvents } from "react-leaflet"
import L, { LatLngExpression } from "leaflet"
import { MapPin, Check } from "lucide-react"
import { reverseGeocode } from "@/lib/geocoding"
import { useMapMode } from "@/lib/hooks/use-map-mode"
import "leaflet/dist/leaflet.css"

// Fix Leaflet default icon issue with Next.js
import icon from "leaflet/dist/images/marker-icon.png"
import iconShadow from "leaflet/dist/images/marker-shadow.png"

const DefaultIcon = L.icon({
  iconUrl: icon.src,
  shadowUrl: iconShadow.src,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
})

L.Marker.prototype.options.icon = DefaultIcon

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
  useMapEvents({
    click: (e) => {
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

  // Map mode management
  const { getTileUrl, getAttribution, handleTileError } = useMapMode()

  // Default center (Basel-Landschaft)
  const defaultCenter: LatLngExpression = [47.51637699933488, 7.561800450458299]
  const center: LatLngExpression =
    selectedLat !== null && selectedLon !== null
      ? [selectedLat, selectedLon]
      : initialLat !== null && initialLon !== null
      ? [initialLat, initialLon]
      : defaultCenter

  // Reset state when modal opens with new initial values
  useEffect(() => {
    if (open) {
      setSelectedLat(initialLat ?? null)
      setSelectedLon(initialLon ?? null)
      setGeocodedAddress(null)
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

  const handleMapClick = (lat: number, lon: number) => {
    setSelectedLat(lat)
    setSelectedLon(lon)
  }

  const handleConfirm = () => {
    if (selectedLat !== null && selectedLon !== null) {
      onLocationSelect(selectedLat, selectedLon, geocodedAddress)
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5" />
            Einsatzort auf Karte wählen
          </DialogTitle>
          <DialogDescription>
            Klicken Sie auf die Karte, um den Einsatzort zu markieren
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Map */}
          <div className="h-[500px] rounded-lg overflow-hidden border">
            <MapContainer
              center={center}
              zoom={selectedLat !== null && selectedLon !== null ? 16 : 13}
              className="w-full h-full"
              zoomControl={true}
            >
              <TileLayer
                attribution={getAttribution()}
                url={getTileUrl()}
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

          {/* Selected location info */}
          {selectedLat !== null && selectedLon !== null && (
            <div className="space-y-2 p-4 bg-muted rounded-lg">
              <div className="flex items-start gap-3">
                <MapPin className="h-5 w-5 text-primary mt-0.5" />
                <div className="flex-1 space-y-1">
                  <div className="font-medium">Gewählter Standort</div>
                  {isGeocoding ? (
                    <div className="text-sm text-muted-foreground">Adresse wird gesucht...</div>
                  ) : geocodedAddress ? (
                    <div className="text-sm">{geocodedAddress}</div>
                  ) : (
                    <div className="text-sm text-muted-foreground">Keine Adresse gefunden</div>
                  )}
                  <div className="text-xs text-muted-foreground font-mono">
                    {selectedLat.toFixed(8)}, {selectedLon.toFixed(8)}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
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
        </div>
      </DialogContent>
    </Dialog>
  )
}
