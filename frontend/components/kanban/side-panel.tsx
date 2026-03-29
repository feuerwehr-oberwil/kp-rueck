"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { cn, copyToClipboard, copyToClipboardAsync } from "@/lib/utils"
import { FileText, Map as MapIcon, PanelRightClose, PanelRight, MapPin, Clock, Siren, Users, Truck, Package, AlertTriangle, FileCheck, Plus, X, Trash2, MessageCircle, ArrowRightLeft, Search, Copy, Check, Link2, LayoutDashboard, Loader2, Building2 } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { type Operation, type Material } from "@/lib/contexts/operations-context"
import { getTimeSince } from "@/lib/kanban-utils"
import { getIncidentTypeLabel, incidentTypeKeys } from "@/lib/incident-types"
import { LocationInput } from "@/components/location/location-input"
import RekoReportSection from "@/components/reko/reko-report-section"
import { toast } from "sonner"
import { apiClient, type ApiRekoReportResponse } from "@/lib/api-client"
import { formatWhatsAppMessage } from "@/lib/whatsapp-formatter"
import { useEvent } from "@/lib/contexts/event-context"
import { TransferIncidentDialog } from "@/components/incidents/transfer-incident-dialog"
import { AssignRekoDialog } from "@/components/incidents/assign-reko-dialog"
import { TransferRekoDialog } from "@/components/kanban/transfer-reko-dialog"
import { usePersonnel } from "@/lib/contexts/personnel-context"
import type { Incident } from "@/lib/types/incidents"
import dynamic from "next/dynamic"

interface SidePanelProps {
  mode: 'detail' | 'map' | 'collapsed'
  onModeChange: (mode: 'detail' | 'map' | 'collapsed') => void
  selectedOperation: Operation | null
  operations: Operation[]
  materials: Material[]
  formatLocation: (address: string) => string
  onOpenModal: () => void
  onSelectOperation: (operation: Operation) => void
  vehicleTypes: Array<{ key: string; name: string; id: string; type: string }>
  // Editing handlers
  onUpdate: (updates: Partial<Operation>) => void
  onDelete: (operationId: string) => void
  onAssignVehicle: (vehicleId: string, vehicleName: string, operationId: string) => void
  onRemoveVehicle: (operationId: string, vehicleName: string) => void
  onAssignResource: (resourceType: 'crew' | 'vehicles' | 'materials', operationId: string) => void
  onRemoveCrew: (operationId: string, crewName: string) => void
  onRemoveMaterial: (operationId: string, materialId: string) => void
}

// Breakpoint for side panel visibility (in pixels)
// Set to 1536px (2xl) - sidebar only on large external monitors, modal on laptops
const SIDEPANEL_BREAKPOINT = 1536

export function SidePanel({
  mode,
  onModeChange,
  selectedOperation,
  operations,
  materials,
  formatLocation,
  onOpenModal,
  onSelectOperation,
  vehicleTypes,
  onUpdate,
  onDelete,
  onAssignVehicle,
  onRemoveVehicle,
  onAssignResource,
  onRemoveCrew,
  onRemoveMaterial,
}: SidePanelProps) {
  const [isWideEnough, setIsWideEnough] = useState(false)

  // Detect screen width
  useEffect(() => {
    const checkWidth = () => {
      setIsWideEnough(window.innerWidth >= SIDEPANEL_BREAKPOINT)
    }
    checkWidth()
    window.addEventListener('resize', checkWidth)
    return () => window.removeEventListener('resize', checkWidth)
  }, [])

  // Auto-collapse on smaller screens
  useEffect(() => {
    if (!isWideEnough && mode !== 'collapsed') {
      onModeChange('collapsed')
    }
  }, [isWideEnough, mode, onModeChange])

  // Don't render on small screens
  if (!isWideEnough) {
    return null
  }

  // Collapsed state - floating button that overlays content
  if (mode === 'collapsed') {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="secondary"
            size="icon"
            onClick={() => onModeChange('detail')}
            className="fixed right-4 top-24 z-40 shadow-lg border border-border h-10 w-10 rounded-full"
          >
            <PanelRight className="h-5 w-5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Panel ein-/ausblenden</TooltipContent>
      </Tooltip>
    )
  }

  return (
    <aside className="w-[420px] 2xl:w-[480px] border-l border-border bg-card/30 backdrop-blur-sm flex flex-col">
      {/* Panel header with toggle tabs */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-1">
          <Button
            variant={mode === 'detail' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => onModeChange('detail')}
            className="gap-1.5 px-3"
          >
            <FileText className="h-4 w-4" />
            Details
          </Button>
          <Button
            variant={mode === 'map' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => onModeChange('map')}
            className="gap-1.5 px-3"
          >
            <MapIcon className="h-4 w-4" />
            Karte
          </Button>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onModeChange('collapsed')}
            >
              <PanelRightClose className="h-5 w-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Schliessen</TooltipContent>
        </Tooltip>
      </div>

      {/* Panel content */}
      <div className="flex-1 overflow-hidden">
        {mode === 'detail' && (
          <SidePanelDetail
            operation={selectedOperation}
            materials={materials}
            formatLocation={formatLocation}
            vehicleTypes={vehicleTypes}
            onUpdate={onUpdate}
            onDelete={onDelete}
            onAssignVehicle={onAssignVehicle}
            onRemoveVehicle={onRemoveVehicle}
            onAssignResource={onAssignResource}
            onRemoveCrew={onRemoveCrew}
            onRemoveMaterial={onRemoveMaterial}
          />
        )}
        {mode === 'map' && (
          <SidePanelMap
            operations={operations}
            selectedOperation={selectedOperation}
            onSelectOperation={onSelectOperation}
            onSwitchToDetail={(operation) => {
              onSelectOperation(operation)
              onModeChange('detail')
            }}
            formatLocation={formatLocation}
          />
        )}
      </div>
    </aside>
  )
}

// Priority visual configuration - subtle color for high priority
const priorityStyles = {
  high: { label: 'Hoch', color: 'text-red-400' },
  medium: { label: 'Mittel', color: 'text-muted-foreground' },
  low: { label: 'Niedrig', color: 'text-muted-foreground' },
} as const

function SidePanelDetail({
  operation,
  materials,
  formatLocation,
  vehicleTypes,
  onUpdate,
  onDelete,
  onAssignVehicle,
  onRemoveVehicle,
  onAssignResource,
  onRemoveCrew,
  onRemoveMaterial,
}: {
  operation: Operation | null
  materials: Material[]
  formatLocation: (address: string) => string
  vehicleTypes: Array<{ key: string; name: string; id: string; type: string }>
  onUpdate: (updates: Partial<Operation>) => void
  onDelete: (operationId: string) => void
  onAssignVehicle: (vehicleId: string, vehicleName: string, operationId: string) => void
  onRemoveVehicle: (operationId: string, vehicleName: string) => void
  onAssignResource: (resourceType: 'crew' | 'vehicles' | 'materials', operationId: string) => void
  onRemoveCrew: (operationId: string, crewName: string) => void
  onRemoveMaterial: (operationId: string, materialId: string) => void
}) {
  const { selectedEvent } = useEvent()
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [vehicleDrivers, setVehicleDrivers] = useState<Map<string, string>>(new Map())
  const [isCopyingWhatsApp, setIsCopyingWhatsApp] = useState(false)
  const [transferDialogOpen, setTransferDialogOpen] = useState(false)
  const [availableIncidents, setAvailableIncidents] = useState<Incident[]>([])
  const [isTransferring, setIsTransferring] = useState(false)
  const [rekoDialogOpen, setRekoDialogOpen] = useState(false)
  const [rekoTransferDialogOpen, setRekoTransferDialogOpen] = useState(false)
  const [isCopyingRekoLink, setIsCopyingRekoLink] = useState(false)
  const [rekoCopied, setRekoCopied] = useState<'direct' | 'dashboard' | null>(null)
  const { personnel } = usePersonnel()

  // Use assignedReko directly from the operation (kept in sync by operations context)
  const assignedRekoPersonnel = operation?.assignedReko ?? null

  // Load vehicle drivers when operation changes
  useEffect(() => {
    const loadVehicleDrivers = async () => {
      if (!operation || !selectedEvent) return

      try {
        const [vehicles, specialFunctions] = await Promise.all([
          apiClient.getVehicles(),
          apiClient.getEventSpecialFunctions(selectedEvent.id),
        ])

        const vehicleIdToName = new Map<string, string>()
        vehicles.forEach(v => vehicleIdToName.set(v.id, v.name))

        const driverMap = new Map<string, string>()
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
        console.error('Failed to load vehicle drivers:', error)
      }
    }

    loadVehicleDrivers()
  }, [operation, selectedEvent])

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

  // Handler for copying WhatsApp message
  // Uses copyToClipboardAsync for Safari support - must call synchronously with a Promise
  const handleCopyWhatsApp = () => {
    if (!operation) return

    setIsCopyingWhatsApp(true)

    // Create a promise that fetches data and formats the message
    const messagePromise = (async () => {
      let rekoReport: ApiRekoReportResponse | null = null
      if (operation.hasCompletedReko) {
        try {
          const reports = await apiClient.getIncidentRekoReports(operation.id)
          const completedReports = reports.filter(r => !r.is_draft)
          if (completedReports.length > 0) {
            rekoReport = completedReports[completedReports.length - 1]
          }
        } catch (error) {
          console.error('Failed to fetch Reko report:', error)
        }
      }

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
        toast.error('Fehler beim Kopieren')
      })
      .finally(() => {
        setIsCopyingWhatsApp(false)
      })
  }

  // Handler for opening transfer dialog
  const handleOpenTransfer = async () => {
    if (!operation || !selectedEvent) {
      toast.error('Fehler', { description: 'Kein Event ausgewählt.' })
      return
    }

    try {
      const apiIncidents = await apiClient.getIncidents(selectedEvent.id)
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
      toast.error('Fehler beim Laden')
    }
  }

  // Handler for transferring assignments
  const handleTransfer = async (targetIncidentId: string) => {
    if (!operation) return

    try {
      setIsTransferring(true)
      await apiClient.transferAssignments(operation.id, targetIncidentId)
      setTransferDialogOpen(false)
    } catch (error: any) {
      toast.error("Fehler beim Übertragen", {
        description: error?.message || "Die Ressourcen konnten nicht übertragen werden."
      })
    } finally {
      setIsTransferring(false)
    }
  }

  if (!operation) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground p-4">
        <p className="text-center text-sm">Klicken Sie auf einen Einsatz, um Details anzuzeigen</p>
      </div>
    )
  }

  const priority = operation.priority || 'low'
  const priorityConfig = priorityStyles[priority as keyof typeof priorityStyles]
  const timeInStatus = operation.statusChangedAt || operation.dispatchTime

  return (
    <div className="p-4 overflow-y-auto h-full space-y-4">
      {/* Header with time info */}
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <span className="font-mono text-muted-foreground">{getTimeSince(timeInStatus)}</span>
        </div>
        {operation.hasCompletedReko && (
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <FileCheck className="h-4 w-4" />
            <span className="text-xs font-medium">Reko</span>
          </div>
        )}
      </div>

      {/* Location - Editable */}
      <LocationInput
        address={operation.location}
        latitude={operation.coordinates?.[0] ?? null}
        longitude={operation.coordinates?.[1] ?? null}
        onAddressChange={(address) => onUpdate({ location: address ?? '' })}
        onCoordinatesChange={(lat, lon) => {
          if (lat !== null && lon !== null) {
            onUpdate({ coordinates: [lat, lon] })
          }
        }}
      />

      {/* Meldung - Editable */}
      <div>
        <Label htmlFor="panel-notes" className="text-xs font-semibold text-muted-foreground">Meldung</Label>
        <Textarea
          id="panel-notes"
          placeholder="Notizen, Besonderheiten, Gefahren..."
          value={operation.notes}
          onChange={(e) => onUpdate({ notes: e.target.value })}
          className="mt-1 min-h-[80px] text-sm"
        />
      </div>

      {/* Type & Priority - Grid */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label id="panel-type-label" className="text-xs font-semibold text-muted-foreground">Einsatzart</Label>
          <Select
            value={operation.incidentType}
            onValueChange={(value) => onUpdate({ incidentType: value })}
          >
            <SelectTrigger className="mt-1 h-9 text-sm w-full" aria-labelledby="panel-type-label" tabIndex={0}>
              <SelectValue placeholder="Auswählen" />
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
          <Label id="panel-priority-label" className="text-xs font-semibold text-muted-foreground">Priorität</Label>
          <Select
            value={operation.priority}
            onValueChange={(value) => onUpdate({ priority: value as "high" | "medium" | "low" })}
          >
            <SelectTrigger className="mt-1 h-9 text-sm w-full" aria-labelledby="panel-priority-label" tabIndex={0}>
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

      {/* Contact - Editable */}
      <div>
        <Label htmlFor="panel-contact" className="text-xs font-semibold text-muted-foreground">Kontakt / Melder</Label>
        <Input
          id="panel-contact"
          placeholder="Name, Telefonnummer..."
          value={operation.contact}
          onChange={(e) => onUpdate({ contact: e.target.value })}
          className="mt-1 h-9 text-sm"
        />
      </div>

      {/* Internal Notes - Editable */}
      <div>
        <Label htmlFor="panel-internal" className="text-xs font-semibold text-muted-foreground">Notizen</Label>
        <Textarea
          id="panel-internal"
          placeholder="Interne Notizen..."
          value={operation.internalNotes}
          onChange={(e) => onUpdate({ internalNotes: e.target.value })}
          className="mt-1 min-h-[60px] text-sm"
        />
      </div>

      {/* Nachbarhilfe Toggle */}
      <div className="rounded-lg border p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-muted-foreground" />
            <div>
              <Label htmlFor="panel-nachbarhilfe" className="text-xs font-semibold">Nachbarhilfe</Label>
              <p className="text-xs text-muted-foreground">Nachbarfeuerwehr-Beteiligung</p>
            </div>
          </div>
          <Switch
            id="panel-nachbarhilfe"
            checked={operation.nachbarhilfe || false}
            onCheckedChange={(checked) => onUpdate({ nachbarhilfe: checked })}
          />
        </div>
        {operation.nachbarhilfe && (
          <Input
            placeholder="Feuerwehr, Kontakt..."
            value={operation.nachbarhilfeNote || ''}
            onChange={(e) => onUpdate({ nachbarhilfeNote: e.target.value })}
            className="h-8 text-sm"
          />
        )}
      </div>

      {/* Reko Reports Section */}
      <div>
        <Label className="text-xs font-semibold text-muted-foreground">Rekognoszierungs-Meldungen</Label>
        <div className="mt-1">
          <RekoReportSection incidentId={operation.id} />
        </div>
      </div>


      {/* Resource Assignment Section */}
      <div className="space-y-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Zugewiesene Ressourcen</p>

        {/* Reko Personnel - separate from Mannschaft */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Search className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Reko</span>
            </div>
            <div className="flex gap-1">
              {assignedRekoPersonnel && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setRekoTransferDialogOpen(true)}
                  className="h-6 px-2 gap-1 text-xs"
                  tabIndex={-1}
                  title="Alle offenen Rekos an andere Person übertragen"
                >
                  <ArrowRightLeft className="h-3 w-3" />
                  Übertragen
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setRekoDialogOpen(true)}
                className="h-6 px-2 gap-1 text-xs"
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
          </div>

          {assignedRekoPersonnel ? (
            <div className="space-y-2">
              <Badge variant="secondary" className="text-xs">
                <Search className="h-2.5 w-2.5 mr-1" />
                {assignedRekoPersonnel.name}
              </Badge>

              {/* Link sharing buttons */}
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleCopyDirectRekoLink}
                  disabled={isCopyingRekoLink}
                  className="h-7 px-2 gap-1.5 text-xs flex-1"
                  tabIndex={-1}
                >
                  {isCopyingRekoLink ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : rekoCopied === 'direct' ? (
                    <Check className="h-3 w-3 text-muted-foreground" />
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
                  className="h-7 px-2 gap-1.5 text-xs flex-1"
                  tabIndex={-1}
                >
                  {rekoCopied === 'dashboard' ? (
                    <Check className="h-3 w-3 text-muted-foreground" />
                  ) : (
                    <LayoutDashboard className="h-3 w-3" />
                  )}
                  Dashboard
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Keine Reko-Person zugewiesen</p>
          )}
        </div>

        {/* Crew */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Mannschaft ({operation.crew.length})</span>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onAssignResource('crew', operation.id)}
              className="h-6 px-2 gap-1 text-xs"
              tabIndex={0}
            >
              <Plus className="h-3 w-3" />
              Hinzufügen
            </Button>
          </div>
          <div className="flex flex-wrap gap-1">
            {operation.crew.length > 0 ? (
              operation.crew.map((member) => (
                <Badge
                  key={member}
                  variant="secondary"
                  className="text-xs gap-1 pr-1 group hover:bg-destructive/20 transition-colors"
                >
                  {member}
                  <button
                    onClick={() => onRemoveCrew(operation.id, member)}
                    className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity rounded-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    tabIndex={-1}
                    aria-label={`${member} entfernen`}
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </Badge>
              ))
            ) : (
              <p className="text-xs text-muted-foreground">Keine Mannschaft</p>
            )}
          </div>
        </div>

        {/* Vehicles */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-1.5">
              <Truck className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Fahrzeuge ({operation.vehicles.length})</span>
            </div>
            <Popover>
              <PopoverTrigger asChild>
                <Button size="sm" variant="ghost" className="h-6 px-2 gap-1 text-xs" tabIndex={0}>
                  <Plus className="h-3 w-3" />
                  Hinzufügen
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-56 p-2" align="end">
                <div className="space-y-1">
                  <div className="px-2 py-1 text-xs font-semibold text-muted-foreground">
                    Fahrzeug zuweisen
                  </div>
                  {vehicleTypes.filter(v => !operation.vehicles.includes(v.name)).length === 0 ? (
                    <div className="px-2 py-2 text-xs text-muted-foreground text-center">
                      Alle Fahrzeuge zugewiesen
                    </div>
                  ) : (
                    vehicleTypes
                      .filter(v => !operation.vehicles.includes(v.name))
                      .map((vehicle) => (
                        <button
                          key={vehicle.id}
                          onClick={() => onAssignVehicle(vehicle.id, vehicle.name, operation.id)}
                          className="w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md hover:bg-muted focus:bg-muted focus:outline-none focus:ring-1 focus:ring-ring transition-colors"
                        >
                          <Truck className="h-3.5 w-3.5 text-muted-foreground" />
                          <div className="text-left">
                            <div className="font-medium text-xs">{vehicle.name}</div>
                            <div className="text-xs text-muted-foreground">{vehicle.type}</div>
                          </div>
                        </button>
                      ))
                  )}
                </div>
              </PopoverContent>
            </Popover>
          </div>
          <div className="flex flex-wrap gap-1">
            {operation.vehicles.length > 0 ? (
              operation.vehicles.map((vehicleName) => {
                const driverName = vehicleDrivers.get(vehicleName)
                return (
                  <Badge
                    key={vehicleName}
                    variant="default"
                    className="text-xs gap-1 pr-1 group hover:bg-destructive/20 transition-colors"
                  >
                    {vehicleName}{driverName ? ` (${driverName})` : ''}
                    <button
                      onClick={() => onRemoveVehicle(operation.id, vehicleName)}
                      className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity rounded-sm focus:outline-none focus:ring-1 focus:ring-ring"
                      tabIndex={-1}
                      aria-label={`${vehicleName} entfernen`}
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </Badge>
                )
              })
            ) : (
              <p className="text-xs text-muted-foreground">Keine Fahrzeuge</p>
            )}
          </div>
        </div>

        {/* Materials */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-1.5">
              <Package className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Material ({operation.materials.length})</span>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onAssignResource('materials', operation.id)}
              className="h-6 px-2 gap-1 text-xs"
              tabIndex={0}
            >
              <Plus className="h-3 w-3" />
              Hinzufügen
            </Button>
          </div>
          <div className="flex flex-wrap gap-1">
            {operation.materials.length > 0 ? (
              operation.materials.map((materialId) => {
                const material = materials.find(m => m.id === materialId)
                return (
                  <Badge
                    key={materialId}
                    variant="outline"
                    className="text-xs gap-1 pr-1 group hover:bg-destructive/20 transition-colors"
                  >
                    {material?.name || materialId}
                    <button
                      onClick={() => onRemoveMaterial(operation.id, materialId)}
                      className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity rounded-sm focus:outline-none focus:ring-1 focus:ring-ring"
                      tabIndex={-1}
                      aria-label={`${material?.name || materialId} entfernen`}
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </Badge>
                )
              })
            ) : (
              <p className="text-xs text-muted-foreground">Kein Material</p>
            )}
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="pt-2 space-y-2 border-t border-border">
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopyWhatsApp}
            disabled={isCopyingWhatsApp}
            className="gap-1.5 text-xs"
          >
            <MessageCircle className="h-3.5 w-3.5" />
            {isCopyingWhatsApp ? 'Kopiere...' : 'WhatsApp'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleOpenTransfer}
            className="gap-1.5 text-xs"
          >
            <ArrowRightLeft className="h-3.5 w-3.5" />
            Übertragen
          </Button>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowDeleteConfirm(true)}
          className="w-full gap-1.5 text-xs text-destructive hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Löschen
        </Button>
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Einsatz wirklich löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Dieser Vorgang kann nicht rückgängig gemacht werden. Der Einsatz "{formatLocation(operation.location)}" wird permanent gelöscht.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                onDelete(operation.id)
                setShowDeleteConfirm(false)
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

      {/* Transfer Reko Assignments Dialog */}
      {assignedRekoPersonnel && (
        <TransferRekoDialog
          open={rekoTransferDialogOpen}
          onOpenChange={setRekoTransferDialogOpen}
          fromPerson={assignedRekoPersonnel ? { id: assignedRekoPersonnel.id, name: assignedRekoPersonnel.name, role: '' as any, status: 'assigned' as any, roleSortOrder: 0 } : null}
          rekoPersonnel={personnel.filter(p => p.isReko)}
          onTransferred={() => {
            // Refresh will happen via polling/WebSocket
          }}
        />
      )}
    </div>
  )
}

// Dynamic import for Leaflet to avoid SSR issues
const SidePanelMapContent = dynamic(
  () => import("./side-panel-map"),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <p className="text-sm">Karte wird geladen...</p>
      </div>
    ),
  }
)

function SidePanelMap({
  operations,
  selectedOperation,
  onSelectOperation,
  onSwitchToDetail,
  formatLocation,
}: {
  operations: Operation[]
  selectedOperation: Operation | null
  onSelectOperation: (operation: Operation) => void
  onSwitchToDetail: (operation: Operation) => void
  formatLocation: (address: string) => string
}) {
  return (
    <div className="h-full">
      <SidePanelMapContent
        operations={operations}
        selectedOperation={selectedOperation}
        onSelectOperation={onSelectOperation}
        onSwitchToDetail={onSwitchToDetail}
        formatLocation={formatLocation}
      />
    </div>
  )
}
