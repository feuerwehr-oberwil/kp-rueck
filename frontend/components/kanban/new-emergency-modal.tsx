"use client"

import { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Plus, MapPin, ChevronDown, ChevronUp } from 'lucide-react'
import { type Operation, type OperationStatus } from "@/lib/contexts/operations-context"
import { incidentTypeKeys, getIncidentTypeLabel } from "@/lib/incident-types"
import { apiClient } from "@/lib/api-client"

interface NewEmergencyModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreateOperation: (operation: Omit<Operation, "id" | "dispatchTime">) => void
  nextOperationId: string
}

export function NewEmergencyModal({
  open,
  onOpenChange,
  onCreateOperation,
  nextOperationId,
}: NewEmergencyModalProps) {
  const [formData, setFormData] = useState({
    location: "",
    incidentType: "elementarereignis",
    priority: "low" as "high" | "medium" | "low",
    vehicle: null as string | null,
    coordinates: [47.51637699933488, 7.561800450458299] as [number, number],
    status: "incoming" as OperationStatus,
    crew: [] as string[],
    materials: [] as string[],
    notes: "",
    contact: "",
    statusChangedAt: null as Date | null,
    crewAssignments: new Map(),
    materialAssignments: new Map(),
    vehicles: [] as string[],
    vehicleAssignments: new Map(),
  })

  const [homeCity, setHomeCity] = useState<string>("")
  const [isLoadingSettings, setIsLoadingSettings] = useState(true)

  const [locationSearchResults, setLocationSearchResults] = useState<Array<{
    display_name: string
    lat: string
    lon: string
  }>>([])
  const [showLocationResults, setShowLocationResults] = useState(false)
  const [isSearchingLocation, setIsSearchingLocation] = useState(false)
  const [showCoordinates, setShowCoordinates] = useState(false)

  // Load settings when modal opens
  useEffect(() => {
    const loadModalData = async () => {
      if (!open) return

      setIsLoadingSettings(true)
      try {
        const settings = await apiClient.getAllSettings()

        if (settings.home_city) {
          setHomeCity(settings.home_city)
        }
      } catch (error) {
        console.error('Failed to load modal data:', error)
      } finally {
        setIsLoadingSettings(false)
      }
    }

    loadModalData()
  }, [open])

  // Smart location formatting based on home city
  const formatLocationForDisplay = (fullAddress: string): string => {
    if (!homeCity) return fullAddress

    // Parse the full address to extract components
    const parts = fullAddress.split(',').map(s => s.trim())

    // Check if the address contains the home city
    const homeCityParts = homeCity.split(',').map(s => s.trim())
    const addressContainsHomeCity = homeCityParts.some(part =>
      parts.some(addressPart => addressPart.includes(part))
    )

    if (addressContainsHomeCity) {
      // Return only the street name (first part)
      return parts[0] || fullAddress
    } else {
      // Address is outside home city, include street and city
      // Typically: "Street, Town, Region, Country" -> "Street, Town"
      return parts.slice(0, 2).join(', ')
    }
  }

  const searchLocation = async (query: string) => {
    if (query.length < 3) {
      setLocationSearchResults([])
      setShowLocationResults(false)
      return
    }

    setIsSearchingLocation(true)
    try {
      // Search within Oberwil and surrounding areas (viewbox: Oberwil, Basel-Landschaft)
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?` +
        `q=${encodeURIComponent(query)}&` +
        `format=json&` +
        `addressdetails=1&` +
        `limit=5&` +
        `countrycodes=ch&` +
        `viewbox=7.53,47.49,7.59,47.54&` +
        `bounded=1`,
        {
          headers: {
            'User-Agent': 'KP-Rueck-Dashboard/1.0'
          }
        }
      )
      const data = await response.json()
      setLocationSearchResults(data)
      setShowLocationResults(true)
    } catch (error) {
      console.error('Error searching location:', error)
    } finally {
      setIsSearchingLocation(false)
    }
  }

  const handleLocationSelect = (result: typeof locationSearchResults[0]) => {
    // Store the FULL address for geocoding, not the formatted one
    setFormData({
      ...formData,
      location: result.display_name,
      coordinates: [parseFloat(result.lat), parseFloat(result.lon)]
    })
    setShowLocationResults(false)
    setLocationSearchResults([])
  }

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (formData.location) {
        searchLocation(formData.location)
      }
    }, 300)

    return () => clearTimeout(timer)
  }, [formData.location])

  const handleSubmit = () => {
    if (!formData.location) {
      return
    }

    onCreateOperation(formData)

    // Reset form
    setFormData({
      location: "",
      incidentType: "elementarereignis",
      priority: "low",
      vehicle: null,
      coordinates: [47.51637699933488, 7.561800450458299],
      status: "incoming",
      crew: [],
      materials: [],
      notes: "",
      contact: "",
      statusChangedAt: null,
      crewAssignments: new Map(),
      materialAssignments: new Map(),
      vehicles: [],
      vehicleAssignments: new Map(),
    })

    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl flex items-center gap-3">
            <Plus className="h-6 w-6 text-primary" />
            Neuer Einsatz
          </DialogTitle>
          <DialogDescription className="text-base">
            Einsatz-ID: {nextOperationId} (wird automatisch vergeben)
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Location - Full Width */}
          <div className="relative">
            <div className="flex items-center justify-between">
              <Label htmlFor="location" className="text-sm font-semibold text-muted-foreground">
                Einsatzort *
              </Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowCoordinates(!showCoordinates)}
                className="h-7 px-2 gap-1 text-xs"
              >
                <MapPin className="h-3 w-3" />
                Koordinaten
                {showCoordinates ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </Button>
            </div>
            <div className="relative">
              <Input
                id="location"
                placeholder="z.B. Hauptstrasse 45"
                value={formData.location}
                onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                onFocus={() => {
                  if (locationSearchResults.length > 0) {
                    setShowLocationResults(true)
                  }
                }}
                onBlur={() => {
                  // Close dropdown after a short delay to allow click on dropdown item
                  setTimeout(() => setShowLocationResults(false), 200)
                }}
                className="mt-2"
                autoFocus
              />
              {isSearchingLocation && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2 mt-1">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                </div>
              )}
            </div>
            {showLocationResults && locationSearchResults.length > 0 && (
              <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-popover shadow-lg max-h-60 overflow-auto">
                {locationSearchResults.map((result, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onMouseDown={(e) => {
                      // Use onMouseDown instead of onClick to fire before onBlur
                      e.preventDefault()
                      handleLocationSelect(result)
                    }}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground transition-colors border-b border-border/50 last:border-b-0"
                  >
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <MapPin className="h-4 w-4 flex-shrink-0 text-primary" />
                        <span className="text-sm font-medium">{formatLocationForDisplay(result.display_name)}</span>
                      </div>
                      <span className="text-xs text-muted-foreground pl-6">{result.display_name}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* Optional Coordinates */}
            {showCoordinates && (
              <div className="grid grid-cols-2 gap-4 mt-3">
                <div>
                  <Label htmlFor="location-lat" className="text-xs text-muted-foreground">
                    Breitengrad (Lat)
                  </Label>
                  <Input
                    id="location-lat"
                    type="number"
                    step="any"
                    value={formData.coordinates[0]}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        coordinates: [
                          e.target.value ? parseFloat(e.target.value) : 0,
                          formData.coordinates[1]
                        ]
                      })
                    }
                    placeholder="47.51637699"
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="location-lng" className="text-xs text-muted-foreground">
                    Längengrad (Lng)
                  </Label>
                  <Input
                    id="location-lng"
                    type="number"
                    step="any"
                    value={formData.coordinates[1]}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        coordinates: [
                          formData.coordinates[0],
                          e.target.value ? parseFloat(e.target.value) : 0
                        ]
                      })
                    }
                    placeholder="7.56180045"
                    className="mt-1"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Meldung - Moved up from bottom */}
          <div>
            <Label htmlFor="notes" className="text-sm font-semibold text-muted-foreground">
              Meldung
            </Label>
            <Textarea
              id="notes"
              placeholder="Notizen, Besonderheiten, Gefahren..."
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              className="mt-2 min-h-[100px]"
            />
          </div>

          {/* Grid - 2 columns */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="incidentType" className="text-sm font-semibold text-muted-foreground">
                Einsatzart
              </Label>
              <Select
                value={formData.incidentType}
                onValueChange={(value) => setFormData({ ...formData, incidentType: value })}
              >
                <SelectTrigger className="mt-2">
                  <SelectValue placeholder="Einsatzart auswählen" />
                </SelectTrigger>
                <SelectContent>
                  {incidentTypeKeys.map((typeKey) => (
                    <SelectItem key={typeKey} value={typeKey}>
                      {getIncidentTypeLabel(typeKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="priority" className="text-sm font-semibold text-muted-foreground">
                Priorität
              </Label>
              <Select
                value={formData.priority}
                onValueChange={(value) => setFormData({ ...formData, priority: value as "high" | "medium" | "low" })}
              >
                <SelectTrigger className="mt-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Niedrig</SelectItem>
                  <SelectItem value="medium">Mittel</SelectItem>
                  <SelectItem value="high">Hoch</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Contact - Moved up */}
          <div>
            <Label htmlFor="contact" className="text-sm font-semibold text-muted-foreground">
              Kontakt / Melder
            </Label>
            <Input
              id="contact"
              placeholder="Name, Telefonnummer..."
              value={formData.contact}
              onChange={(e) => setFormData({ ...formData, contact: e.target.value })}
              className="mt-2"
            />
          </div>

          {/* Info */}
          <div className="bg-secondary/30 p-3 rounded-lg">
            <p className="text-sm text-muted-foreground">
              Fahrzeuge, Mannschaft und Material können nach dem Erstellen des Einsatzes per Drag & Drop zugewiesen werden.
            </p>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-4 border-t">
            <Button onClick={handleSubmit} disabled={!formData.location} className="gap-2">
              <Plus className="h-4 w-4" />
              Einsatz erstellen
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
