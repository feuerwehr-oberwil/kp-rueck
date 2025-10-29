"use client"

import { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import { MapPin, Trash2, Plus, Truck, X, Check, ChevronDown, ChevronUp } from 'lucide-react'
import { type Operation, type Material } from "@/lib/contexts/operations-context"
import { useOperations } from "@/lib/contexts/operations-context"
import { getTimeSince } from "@/lib/kanban-utils"
import { incidentTypeKeys, getIncidentTypeLabel } from "@/lib/incident-types"
import { apiClient } from "@/lib/api-client"
import RekoReportSection from "@/components/reko/reko-report-section"

interface OperationDetailModalProps {
  operation: Operation | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onUpdate: (updates: Partial<Operation>) => void
  onDelete: (operationId: string) => void
  materials: Material[]
  vehicleTypes: Array<{ key: string; name: string; id: string }>
  onAssignVehicle: (vehicleId: string, vehicleName: string, operationId: string) => void
  onRemoveVehicle: (operationId: string, vehicleName: string) => void
}

export function OperationDetailModal({
  operation,
  open,
  onOpenChange,
  onUpdate,
  onDelete,
  materials,
  vehicleTypes,
  onAssignVehicle,
  onRemoveVehicle,
}: OperationDetailModalProps) {
  const { formatLocation } = useOperations()
  const [locationSearchResults, setLocationSearchResults] = useState<Array<{
    display_name: string
    lat: string
    lon: string
  }>>([])
  const [showLocationResults, setShowLocationResults] = useState(false)
  const [isSearchingLocation, setIsSearchingLocation] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [editingLocation, setEditingLocation] = useState("")
  const [availableVehicles, setAvailableVehicles] = useState<Array<{ id: string; name: string; type: string }>>([])
  const [isLoadingVehicles, setIsLoadingVehicles] = useState(true)
  const [showCoordinates, setShowCoordinates] = useState(false)

  // Load vehicles when modal opens
  useEffect(() => {
    const loadVehicles = async () => {
      if (!open) return

      setIsLoadingVehicles(true)
      try {
        const vehicles = await apiClient.getVehicles()
        setAvailableVehicles(vehicles.map((v) => ({ id: v.id, name: v.name, type: v.type })))
      } catch (error) {
        console.error('Failed to load vehicles:', error)
      } finally {
        setIsLoadingVehicles(false)
      }
    }

    loadVehicles()
  }, [open])

  // Sync editingLocation with operation.location when modal opens
  useEffect(() => {
    if (operation) {
      setEditingLocation(operation.location)
    }
  }, [operation?.id])

  const searchLocation = async (query: string) => {
    if (query.length < 3) {
      setLocationSearchResults([])
      setShowLocationResults(false)
      return
    }

    setIsSearchingLocation(true)
    try {
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
    // Store the full address from Nominatim for geocoding purposes
    setEditingLocation(result.display_name)
    onUpdate({
      location: result.display_name,
      coordinates: [parseFloat(result.lat), parseFloat(result.lon)]
    })
    setShowLocationResults(false)
    setLocationSearchResults([])
  }

  // Debounced search
  useEffect(() => {
    if (!editingLocation) return

    const timer = setTimeout(() => {
      searchLocation(editingLocation)
    }, 300)

    return () => clearTimeout(timer)
  }, [editingLocation])

  if (!operation) return null

  // Check if coordinates are valid
  const hasValidCoordinates =
    operation.coordinates &&
    operation.coordinates.length === 2 &&
    typeof operation.coordinates[0] === 'number' &&
    typeof operation.coordinates[1] === 'number' &&
    !isNaN(operation.coordinates[0]) &&
    !isNaN(operation.coordinates[1]) &&
    operation.coordinates[0] >= -90 &&
    operation.coordinates[0] <= 90 &&
    operation.coordinates[1] >= -180 &&
    operation.coordinates[1] <= 180

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!w-[90vw] !h-[85vh] !max-w-none sm:!max-w-none !pb-4 overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl flex items-center gap-3">
            <MapPin className="h-6 w-6 text-primary" />
            {operation.location ? formatLocation(operation.location) : "Einsatz-Details"}
          </DialogTitle>
          <DialogDescription className="text-sm">
            Einsatz-ID: {operation.id} • {getTimeSince(operation.dispatchTime)} seit Alarmierung
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-6 py-4">
          {/* Left Column - Entry Fields */}
          <div className="space-y-6">
          {/* Location */}
          <div className="relative">
            <div className="flex items-center justify-between">
              <Label htmlFor="edit-location" className="text-sm font-semibold text-muted-foreground">
                Einsatzort
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
                {hasValidCoordinates && <Check className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />}
                {showCoordinates ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </Button>
            </div>
            <div className="relative">
              <Input
                id="edit-location"
                value={editingLocation}
                onChange={(e) => {
                  setEditingLocation(e.target.value)
                  onUpdate({ location: e.target.value })
                }}
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
                    <div className="flex items-start gap-2">
                      <MapPin className="h-4 w-4 flex-shrink-0 mt-0.5 text-primary" />
                      <span className="text-xs leading-relaxed">{result.display_name}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* Optional Coordinates */}
            {showCoordinates && (
              <div className="grid grid-cols-2 gap-4 mt-3">
                <div>
                  <Label htmlFor="edit-location-lat" className="text-xs text-muted-foreground">
                    Breitengrad (Lat)
                  </Label>
                  <Input
                    id="edit-location-lat"
                    type="number"
                    step="any"
                    value={operation.coordinates?.[0] ?? ''}
                    onChange={(e) =>
                      onUpdate({
                        coordinates: [
                          e.target.value ? parseFloat(e.target.value) : 0,
                          operation.coordinates?.[1] ?? 0
                        ]
                      })
                    }
                    placeholder="47.51637699"
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="edit-location-lng" className="text-xs text-muted-foreground">
                    Längengrad (Lng)
                  </Label>
                  <Input
                    id="edit-location-lng"
                    type="number"
                    step="any"
                    value={operation.coordinates?.[1] ?? ''}
                    onChange={(e) =>
                      onUpdate({
                        coordinates: [
                          operation.coordinates?.[0] ?? 0,
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
            <Label htmlFor="notes" className="text-sm font-semibold text-muted-foreground">Meldung</Label>
            <Textarea
              id="notes"
              placeholder="Notizen, Besonderheiten, Gefahren..."
              value={operation.notes}
              onChange={(e) => onUpdate({ notes: e.target.value })}
              className="mt-2 min-h-[100px]"
            />
          </div>

          {/* Other fields - Grid */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="edit-incidentType" className="text-sm font-semibold text-muted-foreground">
                Einsatzart
              </Label>
              <Select
                value={operation.incidentType}
                onValueChange={(value) => onUpdate({ incidentType: value })}
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
              <Label htmlFor="edit-priority" className="text-sm font-semibold text-muted-foreground">
                Priorität
              </Label>
              <Select
                value={operation.priority}
                onValueChange={(value) => onUpdate({ priority: value as "high" | "medium" | "low" })}
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

          {/* Contact */}
          <div>
            <Label htmlFor="contact" className="text-sm font-semibold text-muted-foreground">Kontakt / Melder</Label>
            <Input
              id="contact"
              placeholder="Name, Telefonnummer..."
              value={operation.contact}
              onChange={(e) => onUpdate({ contact: e.target.value })}
              className="mt-2"
            />
          </div>
          </div>

          {/* Right Column - External Info */}
          <div className="space-y-6">
          {/* Reko Reports */}
          <div>
            <Label className="text-sm font-semibold text-muted-foreground">
              Rekognoszierungs-Meldungen
            </Label>
            <div className="mt-3">
              <RekoReportSection incidentId={operation.id} />
            </div>
          </div>

          {/* Assigned Vehicles */}
          <div>
            <Label className="text-sm font-semibold text-muted-foreground">Zugewiesene Fahrzeuge ({operation.vehicles.length})</Label>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              {operation.vehicles.map((vehicleName, idx) => (
                <Badge
                  key={idx}
                  variant="default"
                  className="text-sm gap-1 pr-1 group hover:bg-destructive/20 transition-colors"
                >
                  <Truck className="h-3 w-3" />
                  {vehicleName}
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onRemoveVehicle(operation.id, vehicleName)
                    }}
                    className="ml-1 opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Fahrzeug entfernen"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}

              {/* Add Vehicle Button */}
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 gap-1 text-xs"
                    title="Fahrzeug zuweisen"
                  >
                    <Plus className="h-3 w-3" />
                    <Truck className="h-3 w-3" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-64 p-2" align="start">
                  <div className="space-y-1">
                    <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                      Fahrzeug zuweisen
                    </div>
                    {isLoadingVehicles ? (
                      <div className="px-2 py-3 text-xs text-muted-foreground text-center">
                        Lade Fahrzeuge...
                      </div>
                    ) : availableVehicles.filter(v => !operation.vehicles.includes(v.name)).length === 0 ? (
                      <div className="px-2 py-3 text-xs text-muted-foreground text-center">
                        Alle Fahrzeuge zugewiesen
                      </div>
                    ) : (
                      availableVehicles
                        .filter(v => !operation.vehicles.includes(v.name))
                        .map((vehicle) => (
                          <button
                            key={vehicle.id}
                            onClick={() => {
                              onAssignVehicle(vehicle.id, vehicle.name, operation.id)
                            }}
                            className="w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md hover:bg-accent transition-colors"
                          >
                            <Truck className="h-4 w-4 text-muted-foreground" />
                            <div className="text-left">
                              <div className="font-medium">{vehicle.name}</div>
                              <div className="text-xs text-muted-foreground">{vehicle.type}</div>
                            </div>
                          </button>
                        ))
                    )}
                  </div>
                </PopoverContent>
              </Popover>

              {operation.vehicles.length === 0 && (
                <p className="text-sm text-muted-foreground">Keine Fahrzeuge zugewiesen</p>
              )}
            </div>
          </div>

          {/* Crew */}
          <div>
            <Label className="text-sm font-semibold text-muted-foreground">Mannschaft ({operation.crew.length})</Label>
            <div className="flex flex-wrap gap-2 mt-2">
              {operation.crew.length > 0 ? (
                operation.crew.map((member, idx) => (
                  <Badge key={idx} variant="secondary" className="text-sm px-3 py-1">
                    {member}
                  </Badge>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">Keine Mannschaft zugewiesen</p>
              )}
            </div>
          </div>

          {/* Materials */}
          <div>
            <Label className="text-sm font-semibold text-muted-foreground">Material ({operation.materials.length})</Label>
            <div className="flex flex-wrap gap-2 mt-2">
              {operation.materials.length > 0 ? (
                operation.materials.map((matId, idx) => (
                  <Badge key={idx} variant="outline" className="text-sm px-3 py-1">
                    {materials.find(m => m.id === matId)?.name || matId}
                  </Badge>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">Kein Material zugewiesen</p>
              )}
            </div>
          </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3 pt-4 border-t">
          {operation.status === "complete" && (
            <Button
              variant="destructive"
              className="gap-2"
              onClick={() => setShowDeleteConfirm(true)}
            >
              <Trash2 className="h-4 w-4" />
              Löschen
            </Button>
          )}
          <Button variant="outline" className="ml-auto bg-transparent" onClick={() => onOpenChange(false)}>
            Schliessen
          </Button>
        </div>
      </DialogContent>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Einsatz wirklich löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Dieser Vorgang kann nicht rückgängig gemacht werden. Der Einsatz "{operation.location}" wird permanent gelöscht.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                onDelete(operation.id)
                setShowDeleteConfirm(false)
                onOpenChange(false)
              }}
            >
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  )
}
