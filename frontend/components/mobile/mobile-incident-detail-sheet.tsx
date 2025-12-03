"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import {
  MapPin,
  Clock,
  Truck,
  Users,
  Package,
  Siren,
  FileCheck,
  AlertTriangle,
  MessageCircle,
  Map as MapIcon,
  Phone,
  ChevronUp,
  ChevronDown,
  Minus,
} from "lucide-react"
import { type Operation, type Material } from "@/lib/contexts/operations-context"
import { getTimeSince, columns } from "@/lib/kanban-utils"
import { getIncidentTypeLabel } from "@/lib/incident-types"
import { cn } from "@/lib/utils"
import { formatWhatsAppMessage } from "@/lib/whatsapp-formatter"
import { apiClient, type ApiRekoReportResponse } from "@/lib/api-client"
import { toast } from "sonner"
import { useEvent } from "@/lib/contexts/event-context"

interface MobileIncidentDetailSheetProps {
  operation: Operation | null
  open: boolean
  onOpenChange: (open: boolean) => void
  materials: Material[]
  formatLocation: (address: string) => string
}

// Priority visual configuration
const priorityStyles = {
  high: {
    dot: "bg-red-500",
    chevron: "text-red-600 dark:text-red-400",
    label: "Hoch",
  },
  medium: {
    dot: "bg-orange-500",
    chevron: "text-orange-600 dark:text-orange-400",
    label: "Mittel",
  },
  low: {
    dot: "bg-green-500",
    chevron: "text-green-600 dark:text-green-400",
    label: "Niedrig",
  },
} as const

// Status label mapping
const statusLabels: Record<string, string> = {
  incoming: "Eingegangen",
  ready: "Reko",
  enroute: "Unterwegs",
  active: "Einsatz",
  returning: "Rückfahrt",
  complete: "Abgeschlossen",
}

export function MobileIncidentDetailSheet({
  operation,
  open,
  onOpenChange,
  materials,
  formatLocation,
}: MobileIncidentDetailSheetProps) {
  const { selectedEvent } = useEvent()
  const [isCopyingWhatsApp, setIsCopyingWhatsApp] = useState(false)
  const [vehicleDrivers, setVehicleDrivers] = useState<Map<string, string>>(new Map())

  // Load vehicle drivers when sheet opens
  useEffect(() => {
    const loadDrivers = async () => {
      if (!open || !selectedEvent) return

      try {
        const vehicles = await apiClient.getVehicles()
        const specialFunctions = await apiClient.getEventSpecialFunctions(selectedEvent.id)
        const driverMap = new Map<string, string>()

        const vehicleIdToName = new Map<string, string>()
        vehicles.forEach(v => vehicleIdToName.set(v.id, v.name))

        specialFunctions
          .filter(f => f.function_type === "driver" && f.vehicle_id)
          .forEach(f => {
            const vehicleName = vehicleIdToName.get(f.vehicle_id!)
            if (vehicleName) {
              driverMap.set(vehicleName, f.personnel_name)
            }
          })

        setVehicleDrivers(driverMap)
      } catch (error) {
        console.error("Failed to load drivers:", error)
      }
    }

    loadDrivers()
  }, [open, selectedEvent])

  // Handler for copying WhatsApp message
  const handleCopyWhatsApp = async () => {
    if (!operation) return

    setIsCopyingWhatsApp(true)
    try {
      let rekoReport: ApiRekoReportResponse | null = null
      if (operation.hasCompletedReko) {
        try {
          const reports = await apiClient.getIncidentRekoReports(operation.id)
          const completedReports = reports.filter(r => !r.is_draft)
          if (completedReports.length > 0) {
            rekoReport = completedReports[completedReports.length - 1]
          }
        } catch (error) {
          console.error("Failed to fetch Reko report:", error)
        }
      }

      const message = formatWhatsAppMessage({
        operation,
        materials,
        rekoReport,
        vehicleDrivers,
      })

      await navigator.clipboard.writeText(message)
      toast.success("In Zwischenablage kopiert")
    } catch (error) {
      console.error("Failed to copy WhatsApp message:", error)
      toast.error("Fehler beim Kopieren")
    } finally {
      setIsCopyingWhatsApp(false)
    }
  }

  if (!operation) return null

  const priority = operation.priority || "low"
  const priorityConfig = priorityStyles[priority as keyof typeof priorityStyles]
  const timeReference = operation.statusChangedAt || operation.dispatchTime

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="h-[85vh] overflow-y-auto px-4"
        style={{
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 5rem)",
        }}
      >
        <SheetHeader className="pb-4 border-b mb-4">
          <div className="flex items-start gap-3">
            {/* Priority indicator */}
            <div className="flex items-center gap-0.5 flex-shrink-0 mt-1">
              <div
                className={cn("w-3 h-3 rounded-full", priorityConfig?.dot)}
                aria-hidden="true"
              />
              {priority === "high" ? (
                <ChevronUp className={cn("h-5 w-5", priorityConfig?.chevron)} />
              ) : priority === "medium" ? (
                <Minus className={cn("h-5 w-5", priorityConfig?.chevron)} />
              ) : (
                <ChevronDown className={cn("h-5 w-5", priorityConfig?.chevron)} />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <SheetTitle className="text-xl text-left">
                {formatLocation(operation.location)}
              </SheetTitle>
              <SheetDescription className="text-left mt-1">
                Einsatz-ID: {operation.id}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="space-y-5">
          {/* Status & Time Row */}
          <div className="flex items-center gap-3 flex-wrap">
            <Badge variant="secondary" className="text-sm">
              {statusLabels[operation.status] || operation.status}
            </Badge>
            <Badge variant="outline" className="text-sm">
              {getIncidentTypeLabel(operation.incidentType)}
            </Badge>
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" />
              <span className="font-mono">{getTimeSince(timeReference)}</span>
            </div>
            {operation.hasCompletedReko && (
              <Badge variant="outline" className="gap-1 text-green-600 border-green-600/30">
                <FileCheck className="h-3 w-3" />
                Reko
              </Badge>
            )}
          </div>

          {/* Notes/Meldung */}
          {operation.notes && (
            <div className="bg-muted/50 rounded-lg p-3">
              <p className="text-sm text-foreground whitespace-pre-wrap">
                {operation.notes}
              </p>
            </div>
          )}

          {/* Danger warnings from Reko */}
          {operation.rekoSummary?.hasDangers && operation.rekoSummary.dangerTypes.length > 0 && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <span className="font-semibold text-amber-600 text-sm">Gefahren</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {operation.rekoSummary.dangerTypes.map((danger, idx) => (
                  <Badge key={idx} variant="outline" className="text-xs">
                    {danger}
                  </Badge>
                ))}
              </div>
              {(operation.rekoSummary.personnelCount || operation.rekoSummary.estimatedDuration) && (
                <div className="mt-2 text-xs text-muted-foreground">
                  {operation.rekoSummary.personnelCount && (
                    <span className="mr-3">{operation.rekoSummary.personnelCount} Personen</span>
                  )}
                  {operation.rekoSummary.estimatedDuration && (
                    <span>{operation.rekoSummary.estimatedDuration}h geschätzt</span>
                  )}
                </div>
              )}
            </div>
          )}

          <Separator />

          {/* Assigned Resources */}
          <div className="space-y-4">
            {/* Vehicles */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Truck className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Fahrzeuge ({operation.vehicles.length})</span>
              </div>
              {operation.vehicles.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {operation.vehicles.map((vehicleName, idx) => {
                    const driverName = vehicleDrivers.get(vehicleName)
                    return (
                      <Badge key={idx} variant="default" className="text-sm">
                        {vehicleName}
                        {driverName && (
                          <span className="ml-1 opacity-70">({driverName})</span>
                        )}
                      </Badge>
                    )
                  })}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Keine Fahrzeuge zugewiesen</p>
              )}
            </div>

            {/* Crew */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Mannschaft ({operation.crew.length})</span>
              </div>
              {operation.crew.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {operation.crew.map((member, idx) => (
                    <Badge key={idx} variant="secondary" className="text-sm">
                      {member}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Keine Mannschaft zugewiesen</p>
              )}
            </div>

            {/* Materials */}
            {operation.materials.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Package className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Material ({operation.materials.length})</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {operation.materials.map((matId, idx) => (
                    <Badge key={idx} variant="outline" className="text-sm">
                      {materials.find(m => m.id === matId)?.name || matId}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>

          <Separator />

          {/* Contact */}
          {operation.contact && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Phone className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Kontakt / Melder</span>
              </div>
              <p className="text-sm text-foreground">{operation.contact}</p>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex flex-col gap-2 pt-2">
            <Link href={`/map?highlight=${operation.id}`} onClick={() => onOpenChange(false)}>
              <Button variant="outline" className="w-full h-12 gap-2">
                <MapIcon className="h-4 w-4" />
                Auf Karte anzeigen
              </Button>
            </Link>

            <Button
              variant="outline"
              onClick={handleCopyWhatsApp}
              disabled={isCopyingWhatsApp}
              className="w-full h-12 gap-2"
            >
              <MessageCircle className="h-4 w-4" />
              {isCopyingWhatsApp ? "Kopiere..." : "WhatsApp Nachricht kopieren"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
