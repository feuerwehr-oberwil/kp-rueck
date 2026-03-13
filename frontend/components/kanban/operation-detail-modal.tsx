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
import { Switch } from "@/components/ui/switch"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { MapPin, Trash2, Plus, Truck, X, Keyboard, MessageCircle, ArrowRightLeft, Users, Package, Search, Copy, Check, Link2, LayoutDashboard, Loader2, Building2 } from 'lucide-react'
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
import { copyToClipboard, copyToClipboardAsync } from "@/lib/utils"
import { useEvent } from "@/lib/contexts/event-context"
import { TransferIncidentDialog } from "@/components/incidents/transfer-incident-dialog"
import { AssignRekoDialog } from "@/components/incidents/assign-reko-dialog"
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
  const [rekoDialogOpen, setRekoDialogOpen] = useState(false)
  const [isCopyingRekoLink, setIsCopyingRekoLink] = useState(false)
  const [rekoCopied, setRekoCopied] = useState<'direct' | 'dashboard' | null>(null)

  // Use assignedReko directly from the operation (kept in sync by operations context)
  const assignedRekoPersonnel = operation?.assignedReko ?? null

  // Load vehicles and special functions when modal opens
  useEffect(() => {
    const loadVehicles = async () => {
      if (!open || !selectedEvent) return

      setIsLoadingVehicles(true)
      try {
        const vehicles = await apiClient.getVehicles()
        const sorted = [...vehicles].sort((a, b) => a.display_order - b.display_order)
        setAvailableVehicles(sorted.map((v) => ({ id: v.id, name: v.name, type: v.type })))

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
  // Uses copyToClipboardAsync for Safari support - must call synchronously with a Promise
  const handleCopyWhatsApp = () => {
    if (!operation) return

    setIsCopyingWhatsApp(true)

    // Create a promise that fetches data and formats the message
    const messagePromise = (async () => {
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

      // Format and return the message
      return formatWhatsAppMessage({
        operation,
        materials,
        rekoReport,
        vehicleDrivers,
      })
    })()

    // Call synchronously with the promise - Safari will "reserve" clipboard access
    copyToClipboardAsync(messagePromise)
      .then(() => {
        toast.success('In Zwischenablage kopiert', {
          description: 'Die Einsatzmeldung wurde für WhatsApp formatiert kopiert.',
        })
      })
      .catch((error) => {
        console.error('Failed to copy WhatsApp message:', error)
        toast.error('Fehler beim Kopieren', {
          description: 'Die Nachricht konnte nicht in die Zwischenablage kopiert werden.',
        })
      })
      .finally(() => {
        setIsCopyingWhatsApp(false)
      })
  }

  // Handler for copying direct reko form link
  const handleCopyDirectRekoLink = async () => {
    if (!operation || !assignedRekoPersonnel) {
      toast.error('Keine Reko-Person zugewiesen')
      return
    }

    setIsCopyingRekoLink(true)
    try {
      const response = await apiClient.generateRekoLink(operation.id, assignedRekoPersonnel.id)
      const fullUrl = `${window.location.origin}${response.link}`
      await copyToClipboard(fullUrl)
      setRekoCopied('direct')
      toast.success('Direkt-Link kopiert', {
        description: `Formular-Link für ${assignedRekoPersonnel.name}`
      })
      setTimeout(() => setRekoCopied(null), 2000)
    } catch (error) {
      console.error('Failed to copy direct reko link:', error)
      toast.error('Fehler beim Kopieren')
    } finally {
      setIsCopyingRekoLink(false)
    }
  }

  // Handler for copying dashboard link
  const handleCopyDashboardLink = async () => {
    if (!selectedEvent) {
      toast.error('Kein Event ausgewählt')
      return
    }

    setIsCopyingRekoLink(true)
    try {
      const response = await apiClient.generateRekoDashboardLink(selectedEvent.id)
      const fullUrl = `${window.location.origin}${response.link}`
      await copyToClipboard(fullUrl)
      setRekoCopied('dashboard')
      toast.success('Dashboard-Link kopiert', {
        description: 'Reko-Personal kann ihre Zuweisungen sehen'
      })
      setTimeout(() => setRekoCopied(null), 2000)
    } catch (error) {
      console.error('Failed to copy dashboard link:', error)
      toast.error('Fehler beim Kopieren')
    } finally {
      setIsCopyingRekoLink(false)
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
      const incidents: Incident[] = apiIncidents.map(inc => {
        // Destructure to omit fields we need to transform
        const { location_lat, location_lng, created_at, updated_at, status_changed_at, completed_at, reko_arrived_at, assigned_vehicles, ...rest } = inc
        return {
          ...rest,
          location_lat: location_lat !== null ? parseFloat(location_lat) : null,
          location_lng: location_lng !== null ? parseFloat(location_lng) : null,
          created_at: new Date(created_at),
          updated_at: new Date(updated_at),
          status_changed_at: status_changed_at ? new Date(status_changed_at) : null,
          completed_at: completed_at ? new Date(completed_at) : null,
          reko_arrived_at: reko_arrived_at ? new Date(reko_arrived_at) : null,
          assigned_vehicles: assigned_vehicles.map(v => ({
            ...v,
            assigned_at: new Date(v.assigned_at),
          })),
        }
      })
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
      <DialogContent className="!w-[90vw] !h-[85vh] !max-w-6xl !pb-2 flex flex-col overflow-hidden">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="text-xl flex items-center gap-2.5">
            <MapPin className="h-5 w-5 text-muted-foreground" />
            {operation.location ? formatLocation(operation.location) : "Einsatz-Details"}
          </DialogTitle>
          <DialogDescription className="text-sm flex items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground/70">{operation.id}</span>
            <span className="text-muted-foreground/40">·</span>
            <span>{getTimeSince(operation.dispatchTime)} seit Alarmierung</span>
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 py-4">
          {/* Left Column - Entry Fields */}
          <div className="space-y-5">
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
              placeholder="Eingegangene Meldung, Schadensbild..."
              value={operation.notes}
              onChange={(e) => onUpdate({ notes: e.target.value })}
              className="mt-1.5 min-h-[100px]"
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
                <SelectTrigger className="mt-1.5" tabIndex={0}>
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
              <div className="flex items-center gap-2">
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
                <SelectTrigger className="mt-1.5" tabIndex={0}>
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
              className="mt-1.5"
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
              className="mt-1.5 min-h-[80px]"
            />
          </div>

          {/* Nachbarhilfe Toggle */}
          <div className="flex items-center justify-between rounded-lg border border-border p-4">
            <div className="flex items-center gap-3">
              <Building2 className="h-5 w-5 text-muted-foreground" />
              <div>
                <Label htmlFor="modal-nachbarhilfe" className="text-sm font-semibold">Nachbarhilfe</Label>
                <p className="text-xs text-muted-foreground">Einsatz mit Nachbarfeuerwehr-Beteiligung</p>
              </div>
            </div>
            <Switch
              id="modal-nachbarhilfe"
              checked={operation.nachbarhilfe || false}
              onCheckedChange={(checked) => onUpdate({ nachbarhilfe: checked })}
            />
          </div>
          </div>

          {/* Right Column - External Info */}
          <div className="space-y-5 lg:border-l lg:border-border lg:pl-8">
          {/* Reko Reports */}
          <div>
            <Label className="text-sm font-semibold text-muted-foreground">
              Rekognoszierungs-Meldungen
            </Label>
            <div className="mt-1.5">
              <RekoReportSection incidentId={operation.id} />
            </div>
          </div>

          {/* Resource Assignment Section */}
          <div>
            <Label className="text-sm font-semibold text-muted-foreground block">
              Zugewiesene Ressourcen
            </Label>

            {/* Reko Personnel */}
            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Search className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Reko</span>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setRekoDialogOpen(true)}
                  className="h-7 px-2 gap-1"
                  tabIndex={0}
                >
                  {assignedRekoPersonnel ? (
                    <>
                      <ArrowRightLeft className="h-3 w-3" />
                      Wechseln
                    </>
                  ) : (
                    <>
                      <Plus className="h-3 w-3" />
                      Zuweisen
                    </>
                  )}
                </Button>
              </div>

              {assignedRekoPersonnel ? (
                <div className="space-y-2">
                  <Badge variant="secondary" className="text-sm bg-info/10 text-info">
                    <Search className="h-3 w-3 mr-1" />
                    {assignedRekoPersonnel.name}
                  </Badge>

                  {/* Link sharing buttons */}
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleCopyDirectRekoLink}
                      disabled={isCopyingRekoLink}
                      className="h-8 px-3 gap-1.5 text-sm flex-1"
                    >
                      {isCopyingRekoLink ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : rekoCopied === 'direct' ? (
                        <Check className="h-3 w-3 text-success" />
                      ) : (
                        <Link2 className="h-3 w-3" />
                      )}
                      Direkt-Link
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleCopyDashboardLink}
                      disabled={isCopyingRekoLink}
                      className="h-8 px-3 gap-1.5 text-sm flex-1"
                    >
                      {rekoCopied === 'dashboard' ? (
                        <Check className="h-3 w-3 text-success" />
                      ) : (
                        <LayoutDashboard className="h-3 w-3" />
                      )}
                      Dashboard
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground/60 italic">Keine Reko-Person zugewiesen</p>
              )}
            </div>

            {/* Mannschaft (Crew) */}
            <div className="mt-4">
              <div className="flex items-center justify-between mb-1.5">
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
                    tabIndex={0}
                  >
                    <Plus className="h-3 w-3" />
                    Hinzufügen
                  </Button>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {operation.crew.length > 0 ? (
                  operation.crew.map((member) => (
                    <Badge
                      key={member}
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
                          tabIndex={-1}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </Badge>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground/60 italic">Keine Mannschaft zugewiesen</p>
                )}
              </div>
            </div>

            {/* Fahrzeuge (Vehicles) */}
            <div className="mt-4">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <Truck className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Fahrzeuge ({operation.vehicles.length})</span>
                </div>
                <div className="flex items-center gap-1">
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 gap-1"
                        title="Fahrzeug zuweisen"
                        tabIndex={0}
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
                            .map((vehicle) => {
                              const shortcutIndex = availableVehicles.indexOf(vehicle)
                              return (
                                <button
                                  key={vehicle.id}
                                  onClick={() => {
                                    onAssignVehicle(vehicle.id, vehicle.name, operation.id)
                                  }}
                                  className="w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md hover:bg-muted transition-colors"
                                >
                                  <Truck className="h-4 w-4 text-muted-foreground" />
                                  <div className="text-left flex-1">
                                    <div className="font-medium">{vehicle.name}</div>
                                    <div className="text-xs text-muted-foreground">{vehicle.type}</div>
                                  </div>
                                  {shortcutIndex < 5 && (
                                    <Kbd className="h-5 text-xs">{shortcutIndex + 1}</Kbd>
                                  )}
                                </button>
                              )
                            })
                        )}
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {operation.vehicles.length > 0 ? (
                  operation.vehicles.map((vehicleName) => {
                    const driverName = vehicleDrivers.get(vehicleName)
                    return (
                      <Badge
                        key={vehicleName}
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
                          tabIndex={-1}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    )
                  })
                ) : (
                  <p className="text-sm text-muted-foreground/60 italic">Keine Fahrzeuge zugewiesen</p>
                )}
              </div>
            </div>

            {/* Material */}
            <div className="mt-4">
              <div className="flex items-center justify-between mb-1.5">
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
                    tabIndex={0}
                  >
                    <Plus className="h-3 w-3" />
                    Hinzufügen
                  </Button>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {operation.materials.length > 0 ? (
                  operation.materials.map((matId) => (
                    <Badge
                      key={matId}
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
                          tabIndex={-1}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </Badge>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground/60 italic">Kein Material zugewiesen</p>
                )}
              </div>
            </div>
          </div>
          </div>
        </div>
        </div>

        {/* Actions - Fixed Footer */}
        <div className="flex-shrink-0 flex items-center gap-2 pt-3 mt-auto border-t">
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopyWhatsApp}
            disabled={isCopyingWhatsApp}
          >
            <MessageCircle className="h-4 w-4" />
            {isCopyingWhatsApp ? 'Kopiere...' : 'WhatsApp kopieren'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleOpenTransfer}
          >
            <ArrowRightLeft className="h-4 w-4" />
            Ressourcen übertragen
          </Button>
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowDeleteConfirm(true)}
              className="text-destructive hover:text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="h-4 w-4" />
              Löschen
            </Button>
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Schliessen
            </Button>
          </div>
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

      {/* Assign Reko Dialog */}
      <AssignRekoDialog
        open={rekoDialogOpen}
        onOpenChange={setRekoDialogOpen}
        incidentId={operation.id}
        incidentTitle={operation.location}
        onAssigned={() => {
          // Assignment is handled by context via optimistic update + WebSocket/polling
        }}
      />
    </Dialog>
  )
}
