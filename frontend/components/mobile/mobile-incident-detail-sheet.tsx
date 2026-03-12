"use client"

import { useState, useEffect, useRef } from "react"
import Link from "next/link"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
  Pencil,
} from "lucide-react"
import { type Operation, type Material, type OperationStatus } from "@/lib/contexts/operations-context"
import { getTimeSince, columns } from "@/lib/kanban-utils"
import { getIncidentTypeLabel } from "@/lib/incident-types"
import { cn, copyToClipboardAsync } from "@/lib/utils"
import { formatWhatsAppMessage } from "@/lib/whatsapp-formatter"
import { apiClient, type ApiRekoReportResponse } from "@/lib/api-client"
import { toast } from "sonner"
import { useEvent } from "@/lib/contexts/event-context"
import RekoReportSection from "@/components/reko/reko-report-section"

interface MobileIncidentDetailSheetProps {
  operation: Operation | null
  open: boolean
  onOpenChange: (open: boolean) => void
  materials: Material[]
  formatLocation: (address: string) => string
  onUpdateOperation?: (id: string, updates: Partial<Operation>) => void
  isEditor?: boolean
}

// Priority visual configuration
const priorityStyles = {
  high: {
    dot: "bg-destructive",
    chevron: "text-destructive",
    label: "Hoch",
  },
  medium: {
    dot: "bg-orange-500",
    chevron: "text-orange-600 dark:text-orange-400",
    label: "Mittel",
  },
  low: {
    dot: "bg-green-500",
    chevron: "text-success",
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

const statusKeys: OperationStatus[] = ["incoming", "ready", "enroute", "active", "returning", "complete"]

export function MobileIncidentDetailSheet({
  operation,
  open,
  onOpenChange,
  materials,
  formatLocation,
  onUpdateOperation,
  isEditor = false,
}: MobileIncidentDetailSheetProps) {
  const { selectedEvent } = useEvent()
  const [isCopyingWhatsApp, setIsCopyingWhatsApp] = useState(false)
  const [vehicleDrivers, setVehicleDrivers] = useState<Map<string, string>>(new Map())
  const [editingNotes, setEditingNotes] = useState(false)
  const [editingContact, setEditingContact] = useState(false)
  const [notesValue, setNotesValue] = useState("")
  const [contactValue, setContactValue] = useState("")
  const notesRef = useRef<HTMLTextAreaElement>(null)
  const contactRef = useRef<HTMLInputElement>(null)

  // Reset editing state when operation changes or sheet closes
  useEffect(() => {
    if (!open) {
      setEditingNotes(false)
      setEditingContact(false)
    }
  }, [open, operation?.id])

  // Sync local values when operation changes
  useEffect(() => {
    if (operation) {
      setNotesValue(operation.notes || "")
      setContactValue(operation.contact || "")
    }
  }, [operation?.id, operation?.notes, operation?.contact])

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

  const handleStatusChange = (newStatus: string) => {
    if (!operation || !onUpdateOperation) return
    onUpdateOperation(operation.id, { status: newStatus as OperationStatus })
  }

  const handleNotesSave = () => {
    if (!operation || !onUpdateOperation) return
    if (notesValue !== operation.notes) {
      onUpdateOperation(operation.id, { notes: notesValue })
    }
    setEditingNotes(false)
  }

  const handleContactSave = () => {
    if (!operation || !onUpdateOperation) return
    if (contactValue !== operation.contact) {
      onUpdateOperation(operation.id, { contact: contactValue })
    }
    setEditingContact(false)
  }

  const startEditingNotes = () => {
    if (!isEditor || !onUpdateOperation) return
    setEditingNotes(true)
    setTimeout(() => notesRef.current?.focus(), 50)
  }

  const startEditingContact = () => {
    if (!isEditor || !onUpdateOperation) return
    setEditingContact(true)
    setTimeout(() => contactRef.current?.focus(), 50)
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
          console.error("Failed to fetch Reko report:", error)
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
        toast.success("In Zwischenablage kopiert")
      })
      .catch((error) => {
        console.error("Failed to copy WhatsApp message:", error)
        toast.error("Fehler beim Kopieren")
      })
      .finally(() => {
        setIsCopyingWhatsApp(false)
      })
  }

  if (!operation) return null

  const priority = operation.priority || "low"
  const priorityConfig = priorityStyles[priority as keyof typeof priorityStyles]
  const timeReference = operation.statusChangedAt || operation.dispatchTime
  const canEdit = isEditor && !!onUpdateOperation

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
            {canEdit ? (
              <Select value={operation.status} onValueChange={handleStatusChange}>
                <SelectTrigger size="sm" className="w-auto h-7 text-sm gap-1.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {statusKeys.map((key) => (
                    <SelectItem key={key} value={key}>
                      {statusLabels[key]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Badge variant="secondary" className="text-sm">
                {statusLabels[operation.status] || operation.status}
              </Badge>
            )}
            <Badge variant="outline" className="text-sm">
              {getIncidentTypeLabel(operation.incidentType)}
            </Badge>
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" />
              <span className="font-mono">{getTimeSince(timeReference)}</span>
            </div>
            {operation.hasCompletedReko && (
              <Badge variant="outline" className="gap-1 text-success border-success/30">
                <FileCheck className="h-3 w-3" />
                Reko
              </Badge>
            )}
          </div>

          {/* Notes/Meldung */}
          <div>
            {editingNotes ? (
              <Textarea
                ref={notesRef}
                value={notesValue}
                onChange={(e) => setNotesValue(e.target.value)}
                onBlur={handleNotesSave}
                placeholder="Notiz hinzufügen..."
                className="min-h-[80px] text-sm"
              />
            ) : (
              <div
                onClick={startEditingNotes}
                className={cn(
                  "bg-muted/50 rounded-lg p-3",
                  canEdit && "cursor-pointer hover:bg-muted/70 transition-colors"
                )}
              >
                {operation.notes ? (
                  <p className="text-sm text-foreground whitespace-pre-wrap">
                    {operation.notes}
                  </p>
                ) : canEdit ? (
                  <p className="text-sm text-muted-foreground flex items-center gap-2">
                    <Pencil className="h-3.5 w-3.5" />
                    Notiz hinzufügen...
                  </p>
                ) : null}
              </div>
            )}
          </div>

          {/* Danger warnings from Reko */}
          {operation.rekoSummary?.hasDangers && operation.rekoSummary.dangerTypes.length > 0 && (
            <div className="bg-warning/10 border border-warning/30 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="h-4 w-4 text-warning" />
                <span className="font-semibold text-warning text-sm">Gefahren</span>
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
                  {operation.vehicles.map((vehicleName) => {
                    const driverName = vehicleDrivers.get(vehicleName)
                    return (
                      <Badge key={vehicleName} variant="default" className="text-sm">
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
                  {operation.crew.map((member) => (
                    <Badge key={member} variant="secondary" className="text-sm">
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
                  {operation.materials.map((matId) => (
                    <Badge key={matId} variant="outline" className="text-sm">
                      {materials.find(m => m.id === matId)?.name || matId}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>

          <Separator />

          {/* Contact */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Phone className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Kontakt / Melder</span>
            </div>
            {editingContact ? (
              <Input
                ref={contactRef}
                value={contactValue}
                onChange={(e) => setContactValue(e.target.value)}
                onBlur={handleContactSave}
                onKeyDown={(e) => { if (e.key === 'Enter') handleContactSave() }}
                placeholder="Kontakt hinzufügen..."
                className="text-sm"
              />
            ) : (
              <div
                onClick={startEditingContact}
                className={cn(
                  canEdit && "cursor-pointer hover:bg-muted/50 rounded-md px-2 py-1 -mx-2 transition-colors"
                )}
              >
                {operation.contact ? (
                  <p className="text-sm text-foreground">{operation.contact}</p>
                ) : canEdit ? (
                  <p className="text-sm text-muted-foreground flex items-center gap-2">
                    <Pencil className="h-3.5 w-3.5" />
                    Kontakt hinzufügen...
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">Kein Kontakt</p>
                )}
              </div>
            )}
          </div>

          {/* Reko Report Section */}
          {operation.hasCompletedReko && (
            <>
              <Separator />
              <RekoReportSection incidentId={operation.id} />
            </>
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
