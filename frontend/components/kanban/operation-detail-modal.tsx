"use client"

import { useState, useEffect, useCallback } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { MapPin, Trash2, Plus, Truck, X, Keyboard, MessageCircle, ArrowRightLeft, Users, Package } from 'lucide-react'
import { type Operation, type Material } from "@/lib/contexts/operations-context"
import { useOperations } from "@/lib/contexts/operations-context"
import { getTimeSince } from "@/lib/kanban-utils"
import { incidentTypeKeys, getIncidentTypeLabel } from "@/lib/incident-types"
import { apiClient, type ApiRekoReportResponse } from "@/lib/api-client"
import RekoReportSection from "@/components/reko/reko-report-section"
import { LocationInput } from "@/components/location/location-input"
import { toast } from "sonner"
import { Kbd } from "@/components/ui/kbd"
import { formatWhatsAppMessage } from "@/lib/whatsapp-formatter"
import { useEvent } from "@/lib/contexts/event-context"
import { TransferIncidentDialog } from "@/components/incidents/transfer-incident-dialog"
import type { Incident } from "@/lib/types/incidents"

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
  onAssignResource?: (resourceType: 'crew' | 'vehicles' | 'materials', operationId: string) => void
  onRemoveCrew?: (operationId: string, crewName: string) => void
  onRemoveMaterial?: (operationId: string, materialId: string) => void
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
  onAssignResource,
  onRemoveCrew,
  onRemoveMaterial,
}: OperationDetailModalProps) {
  const { formatLocation } = useOperations()
  const { selectedEvent } = useEvent()
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [availableVehicles, setAvailableVehicles] = useState<Array<{ id: string; name: string; type: string }>>([])
  const [vehicleDrivers, setVehicleDrivers] = useState<Map<string, string>>(new Map())
  const [isLoadingVehicles, setIsLoadingVehicles] = useState(true)
  const [isCopyingWhatsApp, setIsCopyingWhatsApp] = useState(false)
  const [transferDialogOpen, setTransferDialogOpen] = useState(false)
  const [availableIncidents, setAvailableIncidents] = useState<Incident[]>([])
  const [isTransferring, setIsTransferring] = useState(false)

  // Load vehicles and special functions when modal opens
  useEffect(() => {
    const loadVehicles = async () => {
      if (!open || !selectedEvent) return

      setIsLoadingVehicles(true)
      try {
        const vehicles = await apiClient.getVehicles()
        setAvailableVehicles(vehicles.map((v) => ({ id: v.id, name: v.name, type: v.type })))

        // Load special functions to get driver information
        const specialFunctions = await apiClient.getEventSpecialFunctions(selectedEvent.id)
        const driverMap = new Map<string, string>()

        // Build vehicle ID to name mapping
        const vehicleIdToName = new Map<string, string>()
        vehicles.forEach(v => vehicleIdToName.set(v.id, v.name))

        // Map vehicle names to driver names
        specialFunctions
          .filter(f => f.function_type === 'driver' && f.vehicle_id)
          .forEach(f => {
            const vehicleName = vehicleIdToName.get(f.vehicle_id!)
            if (vehicleName) {
              driverMap.set(vehicleName, f.personnel_name)
            }
          })

        setVehicleDrivers(driverMap)
      } catch (error) {
        console.error('Failed to load vehicles:', error)
      } finally {
        setIsLoadingVehicles(false)
      }
    }

    loadVehicles()
  }, [open, selectedEvent])

  // Handler for copying WhatsApp message
  const handleCopyWhatsApp = async () => {
    if (!operation) return

    setIsCopyingWhatsApp(true)
    try {
      // Fetch the latest Reko report if one exists
      let rekoReport: ApiRekoReportResponse | null = null
      if (operation.hasCompletedReko) {
        try {
          const reports = await apiClient.getIncidentRekoReports(operation.id)
          const completedReports = reports.filter(r => !r.is_draft)
          if (completedReports.length > 0) {
            // Use the most recent completed report
            rekoReport = completedReports[completedReports.length - 1]
          }
        } catch (error) {
          console.error('Failed to fetch Reko report:', error)
          // Continue without Reko data
        }
      }

      // Format the message
      const message = formatWhatsAppMessage({
        operation,
        materials,
        rekoReport,
        vehicleDrivers,
      })

      // Copy to clipboard
      await navigator.clipboard.writeText(message)
      toast.success('In Zwischenablage kopiert', {
        description: 'Die Einsatzmeldung wurde für WhatsApp formatiert kopiert.',
      })
    } catch (error) {
      console.error('Failed to copy WhatsApp message:', error)
      toast.error('Fehler beim Kopieren', {
        description: 'Die Nachricht konnte nicht in die Zwischenablage kopiert werden.',
      })
    } finally {
      setIsCopyingWhatsApp(false)
    }
  }

  // Handler for opening transfer dialog
  const handleOpenTransfer = async () => {
    if (!operation || !selectedEvent) {
      toast.error('Fehler', {
        description: 'Kein Event ausgewählt. Bitte wählen Sie ein Event aus.',
      })
      return
    }

    try {
      // Fetch all incidents for the current event
      const apiIncidents = await apiClient.getIncidents(selectedEvent.id)
      // Convert ApiIncident to Incident type (string coords/dates -> number/Date)
      const incidents: Incident[] = apiIncidents.map(inc => ({
        ...inc,
        location_lat: inc.location_lat !== null ? parseFloat(inc.location_lat) : null,
        location_lng: inc.location_lng !== null ? parseFloat(inc.location_lng) : null,
        created_at: new Date(inc.created_at),
        updated_at: new Date(inc.updated_at),
        status_changed_at: inc.status_changed_at ? new Date(inc.status_changed_at) : null,
        completed_at: inc.completed_at ? new Date(inc.completed_at) : null,
        assigned_vehicles: inc.assigned_vehicles.map(v => ({
          ...v,
          assigned_at: new Date(v.assigned_at),
        })),
      }))
      setAvailableIncidents(incidents)
      setTransferDialogOpen(true)
    } catch (error) {
      console.error('Failed to load incidents:', error)
      toast.error('Fehler beim Laden', {
        description: 'Die Einsätze konnten nicht geladen werden.',
      })
    }
  }

  // Handler for transferring assignments
  const handleTransfer = async (targetIncidentId: string) => {
    if (!operation) return

    try {
      setIsTransferring(true)
      await apiClient.transferAssignments(operation.id, targetIncidentId)

      // Close dialogs immediately for better UX
      setTransferDialogOpen(false)
      onOpenChange(false)

      // Success toast after dialogs close
      toast.success("Ressourcen übertragen", {
        description: `Alle Ressourcen wurden erfolgreich übertragen.`
      })
    } catch (error: any) {
      toast.error("Fehler beim Übertragen", {
        description: error?.message || "Die Ressourcen konnten nicht übertragen werden."
      })
    } finally {
      setIsTransferring(false)
    }
  }

  // Keyboard shortcuts for modal
  useEffect(() => {
    if (!open || !operation) return

    const handleKeyPress = (e: KeyboardEvent) => {
      // Ignore shortcuts if typing in input/textarea/select
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target as HTMLElement).getAttribute('role') === 'combobox'
      ) {
        return
      }

      // Priority shortcuts (Shift+1/2/3)
      if (e.shiftKey) {
        if (e.key === '1' || e.key === '!') {
          e.preventDefault()
          onUpdate({ priority: 'low' })
          toast.success('Priorität auf Niedrig gesetzt')
          return
        } else if (e.key === '2' || e.key === '@') {
          e.preventDefault()
          onUpdate({ priority: 'medium' })
          toast.success('Priorität auf Mittel gesetzt')
          return
        } else if (e.key === '3' || e.key === '#') {
          e.preventDefault()
          onUpdate({ priority: 'high' })
          toast.success('Priorität auf Hoch gesetzt')
          return
        }
      }

      // Vehicle assignment shortcuts (1-5)
      const vehicleIndex = parseInt(e.key) - 1
      if (!isNaN(vehicleIndex) && vehicleIndex >= 0 && vehicleIndex < 5 && vehicleIndex < availableVehicles.length) {
        const vehicle = availableVehicles[vehicleIndex]
        if (vehicle) {
          e.preventDefault()
          // Check if vehicle is already assigned
          const isAssigned = operation.vehicles.includes(vehicle.name)
          if (isAssigned) {
            // Unassign the vehicle
            onRemoveVehicle(operation.id, vehicle.name)
            toast.success(`${vehicle.name} entfernt`)
          } else {
            // Assign the vehicle
            onAssignVehicle(vehicle.id, vehicle.name, operation.id)
            toast.success(`${vehicle.name} zugewiesen`)
          }
        }
        return
      }
    }

    window.addEventListener('keydown', handleKeyPress)
    return () => window.removeEventListener('keydown', handleKeyPress)
  }, [open, operation, onUpdate, onAssignVehicle, onRemoveVehicle, availableVehicles])

  if (!operation) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!w-[90vw] !h-[85vh] !max-w-none sm:!max-w-none !pb-2 flex flex-col overflow-hidden">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="text-2xl flex items-center gap-3">
            <MapPin className="h-6 w-6 text-primary" />
            {operation.location ? formatLocation(operation.location) : "Einsatz-Details"}
          </DialogTitle>
          <DialogDescription className="text-sm">
            Einsatz-ID: {operation.id} • {getTimeSince(operation.dispatchTime)} seit Alarmierung
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0">
        <div className="grid grid-cols-2 gap-6 py-4">
          {/* Left Column - Entry Fields */}
          <div className="space-y-6">
          {/* Location - Smart Input with Geocoding */}
          <LocationInput
            address={operation.location}
            latitude={operation.coordinates?.[0] ?? null}
            longitude={operation.coordinates?.[1] ?? null}
            onAddressChange={(address) => onUpdate({ location: address ?? '' })}
            onCoordinatesChange={(lat, lon) => {
              if (lat !== null && lon !== null) {
                onUpdate({ coordinates: [lat, lon] })
              } else {
                onUpdate({ coordinates: undefined })
              }
            }}
          />

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
              <div className="flex items-center gap-2 mb-2">
                <Label htmlFor="edit-priority" className="text-sm font-semibold text-muted-foreground">
                  Priorität
                </Label>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Kbd className="h-4 text-[10px]">⇧1</Kbd>
                  <Kbd className="h-4 text-[10px]">⇧2</Kbd>
                  <Kbd className="h-4 text-[10px]">⇧3</Kbd>
                </div>
              </div>
              <Select
                value={operation.priority}
                onValueChange={(value) => onUpdate({ priority: value as "high" | "medium" | "low" })}
              >
                <SelectTrigger>
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

          {/* Internal Notes */}
          <div>
            <Label htmlFor="internalNotes" className="text-sm font-semibold text-muted-foreground">Notizen</Label>
            <Textarea
              id="internalNotes"
              placeholder="Interne Notizen..."
              value={operation.internalNotes}
              onChange={(e) => onUpdate({ internalNotes: e.target.value })}
              className="mt-2 min-h-[80px]"
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

          {/* Resource Assignment Section */}
          <div>
            <Label className="text-sm font-semibold text-muted-foreground mb-3 block">
              Zugewiesene Ressourcen
            </Label>

            {/* Mannschaft (Crew) */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Mannschaft ({operation.crew.length})</span>
                </div>
                {onAssignResource && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onAssignResource('crew', operation.id)}
                    className="h-7 px-2 gap-1"
                    title="Mannschaft zuweisen"
                  >
                    <Plus className="h-3 w-3" />
                    Hinzufügen
                  </Button>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {operation.crew.length > 0 ? (
                  operation.crew.map((member, idx) => (
                    <Badge
                      key={idx}
                      variant="secondary"
                      className="text-sm gap-1 pr-1 group hover:bg-destructive/20 transition-colors"
                    >
                      {member}
                      {onRemoveCrew && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            onRemoveCrew(operation.id, member)
                          }}
                          className="ml-1 opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Person entfernen"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </Badge>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">Keine Mannschaft zugewiesen</p>
                )}
              </div>
            </div>

            {/* Fahrzeuge (Vehicles) */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Truck className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Fahrzeuge ({operation.vehicles.length})</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mr-1">
                    <Kbd className="h-4 text-[10px]">1-5</Kbd>
                  </div>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 gap-1"
                        title="Fahrzeug zuweisen"
                      >
                        <Plus className="h-3 w-3" />
                        Hinzufügen
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
                                className="w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md hover:bg-muted transition-colors"
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
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {operation.vehicles.length > 0 ? (
                  operation.vehicles.map((vehicleName, idx) => {
                    const driverName = vehicleDrivers.get(vehicleName)
                    return (
                      <Badge
                        key={idx}
                        variant="default"
                        className="text-sm gap-1 pr-1 group hover:bg-destructive/20 transition-colors"
                      >
                        {vehicleName}{driverName ? ` (${driverName})` : ''}
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
                    )
                  })
                ) : (
                  <p className="text-sm text-muted-foreground">Keine Fahrzeuge zugewiesen</p>
                )}
              </div>
            </div>

            {/* Material */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Package className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Material ({operation.materials.length})</span>
                </div>
                {onAssignResource && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onAssignResource('materials', operation.id)}
                    className="h-7 px-2 gap-1"
                    title="Material zuweisen"
                  >
                    <Plus className="h-3 w-3" />
                    Hinzufügen
                  </Button>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {operation.materials.length > 0 ? (
                  operation.materials.map((matId, idx) => (
                    <Badge
                      key={idx}
                      variant="outline"
                      className="text-sm gap-1 pr-1 group hover:bg-destructive/20 transition-colors"
                    >
                      {materials.find(m => m.id === matId)?.name || matId}
                      {onRemoveMaterial && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            onRemoveMaterial(operation.id, matId)
                          }}
                          className="ml-1 opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Material entfernen"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </Badge>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">Kein Material zugewiesen</p>
                )}
              </div>
            </div>
          </div>
          </div>
        </div>
        </div>

        {/* Actions - Fixed Footer */}
        <div className="flex-shrink-0 flex items-center gap-3 pt-4 mt-4 border-t">
          <Button
            variant="outline"
            onClick={() => setShowDeleteConfirm(true)}
          >
            <Trash2 className="h-4 w-4 text-muted-foreground" />
            Löschen
          </Button>
          <Button
            variant="outline"
            onClick={handleCopyWhatsApp}
            disabled={isCopyingWhatsApp}
          >
            <MessageCircle className="h-4 w-4" />
            {isCopyingWhatsApp ? 'Kopiere...' : 'WhatsApp kopieren'}
          </Button>
          <Button
            variant="outline"
            onClick={handleOpenTransfer}
          >
            <ArrowRightLeft className="h-4 w-4" />
            Ressourcen übertragen
          </Button>
          <Button variant="outline" className="ml-auto" onClick={() => onOpenChange(false)}>
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

      {/* Transfer Incident Dialog */}
      <TransferIncidentDialog
        open={transferDialogOpen}
        onOpenChange={setTransferDialogOpen}
        sourceIncident={operation as unknown as Incident}
        availableIncidents={availableIncidents}
        onTransfer={handleTransfer}
        isTransferring={isTransferring}
      />
    </Dialog>
  )
}
