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
  Clock,
  Truck,
  Users,
  Package,
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
import { useOperations, type Operation, type Material, type OperationStatus } from "@/lib/contexts/operations-context"
import { getTimeSince } from "@/lib/kanban-utils"
import { type Priority, PRIORITY_DOT_CLASSES, PRIORITY_TEXT_CLASSES } from "@/lib/priority"
import { incidentTypeLabels } from "@/lib/incident-types"
import { useTranslations } from "next-intl"
import { cn, copyToClipboardAsync } from "@/lib/utils"
import { formatWhatsAppMessage } from "@/lib/whatsapp-formatter"
import { getMessageTemplates } from "@/lib/message-template"
import { apiClient, type ApiRekoReportResponse } from "@/lib/api-client"
import { toast } from "sonner"
import { useEvent } from "@/lib/contexts/event-context"
import { useVehicleDrivers } from "@/lib/hooks/use-vehicle-drivers"
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

const statusKeys: OperationStatus[] = ["incoming", "reko", "enroute", "active", "returning", "complete"]

export function MobileIncidentDetailSheet({
  operation,
  open,
  onOpenChange,
  materials,
  formatLocation,
  onUpdateOperation,
  isEditor = false,
}: MobileIncidentDetailSheetProps) {
  const t = useTranslations('incidents')
  const { selectedEvent } = useEvent()
  const { changeStatusToTop } = useOperations()
  const [isCopyingWhatsApp, setIsCopyingWhatsApp] = useState(false)
  const vehicleDrivers = useVehicleDrivers(selectedEvent?.id ?? null, open)
  const [editingNotes, setEditingNotes] = useState(false)
  const [editingContact, setEditingContact] = useState(false)
  const [notesValue, setNotesValue] = useState("")
  const [contactValue, setContactValue] = useState("")
  const notesRef = useRef<HTMLTextAreaElement>(null)
  const contactRef = useRef<HTMLInputElement>(null)

  // Byte-identical fallback to the raw type value for unknown types
  const typeLabel = (type: string) => (type in incidentTypeLabels ? t(`types.${type}`) : type)

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

  // Driver map (live-synced via WebSocket + custom event in useVehicleDrivers)

  const handleStatusChange = (newStatus: string) => {
    if (!operation || !onUpdateOperation) return
    // Move the card to the top of its new column (parity with the desktop modal),
    // so a one-tap status change surfaces it the same way the reko auto-move does.
    changeStatusToTop(operation.id, newStatus as OperationStatus)
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

      const { whatsappIncident } = await getMessageTemplates()
      return formatWhatsAppMessage({
        operation,
        materials,
        rekoReport,
        vehicleDrivers,
        template: whatsappIncident,
      })
    })()

    // Call synchronously with the promise - Safari will "reserve" clipboard access
    copyToClipboardAsync(messagePromise)
      .then(() => {
        toast.success(t('mobileDetail.copied'))
      })
      .catch((error) => {
        console.error("Failed to copy WhatsApp message:", error)
        toast.error(t('mobileDetail.copyError'))
      })
      .finally(() => {
        setIsCopyingWhatsApp(false)
      })
  }

  if (!operation) return null

  const priority = operation.priority || "low"
  const priorityConfig = { dot: PRIORITY_DOT_CLASSES[priority as Priority], chevron: PRIORITY_TEXT_CLASSES[priority as Priority] }
  const timeReference = operation.statusChangedAt || operation.dispatchTime
  const canEdit = isEditor && !!onUpdateOperation

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="modal-h-tall overflow-y-auto px-4"
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
                {formatLocation(operation.location) || typeLabel(operation.incidentType)}
              </SheetTitle>
              <SheetDescription className="text-left mt-1">
                {t('mobileDetail.incidentId', { id: operation.id })}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="space-y-5">
          {/* Status & Time Row */}
          <div className="flex items-center gap-3 flex-wrap">
            {canEdit ? (
              <Select value={operation.status} onValueChange={handleStatusChange}>
                <SelectTrigger size="sm" className="w-auto min-h-[44px] text-sm gap-1.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {statusKeys.map((key) => (
                    <SelectItem key={key} value={key}>
                      {t(`status.${key}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Badge variant="secondary" className="text-sm">
                {t(`status.${operation.status}`)}
              </Badge>
            )}
            <Badge variant="outline" className="text-sm">
              {typeLabel(operation.incidentType)}
            </Badge>
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" />
              <span className="font-mono">{getTimeSince(timeReference)}</span>
            </div>
            {operation.hasCompletedReko && (
              <Badge variant="outline" className="gap-1 text-success border-success/30">
                <FileCheck className="h-3 w-3" />
                {t('mobileDetail.rekoBadge')}
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
                placeholder={t('mobileDetail.notesPlaceholder')}
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
                    {t('mobileDetail.notesPlaceholder')}
                  </p>
                ) : null}
              </div>
            )}
          </div>

          {/* Danger warnings from Reko */}
          {operation.rekoSummary?.hasDangers && operation.rekoSummary.dangerTypes.length > 0 && (
            <div className="bg-warning/10 border border-warning/30 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="h-4 w-4 text-warning-foreground" />
                <span className="font-semibold text-warning-foreground text-sm">{t('mobileDetail.dangers')}</span>
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
                    <span className="mr-3">{t('mobileDetail.personnelCount', { count: operation.rekoSummary.personnelCount })}</span>
                  )}
                  {operation.rekoSummary.estimatedDuration && (
                    <span>{t('mobileDetail.estimatedDuration', { duration: String(operation.rekoSummary.estimatedDuration) })}</span>
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
                <span className="text-sm font-medium">{t('mobileDetail.vehicles', { count: operation.vehicles.length })}</span>
              </div>
              {operation.vehicles.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {operation.vehicles.map((vehicleName) => {
                    const driverName = vehicleDrivers.get(vehicleName)
                    const callsign = operation.vehicleCallsigns.get(vehicleName)
                    return (
                      <Badge key={vehicleName} variant="default" className="text-sm">
                        {vehicleName}{callsign ? ` · ${callsign}` : ''}
                        {driverName && (
                          <span className="ml-1 opacity-70">({driverName})</span>
                        )}
                      </Badge>
                    )
                  })}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{t('mobileDetail.noVehicles')}</p>
              )}
            </div>

            {/* Crew */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">{t('mobileDetail.crew', { count: operation.crew.length })}</span>
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
                <p className="text-sm text-muted-foreground">{t('mobileDetail.noCrew')}</p>
              )}
            </div>

            {/* Materials */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Package className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">{t('mobileDetail.materials', { count: operation.materials.length })}</span>
              </div>
              {operation.materials.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {operation.materials.map((matId) => (
                    <Badge key={matId} variant="outline" className="text-sm">
                      {materials.find(m => m.id === matId)?.name || matId}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{t('mobileDetail.noMaterials')}</p>
              )}
            </div>
          </div>

          <Separator />

          {/* Contact */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Phone className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">{t('mobileDetail.contact')}</span>
            </div>
            {editingContact ? (
              <Input
                ref={contactRef}
                value={contactValue}
                onChange={(e) => setContactValue(e.target.value)}
                onBlur={handleContactSave}
                onKeyDown={(e) => { if (e.key === 'Enter') handleContactSave() }}
                placeholder={t('mobileDetail.contactPlaceholder')}
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
                    {t('mobileDetail.contactPlaceholder')}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">{t('mobileDetail.noContact')}</p>
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
              <Button variant="outline" size="lg" className="w-full gap-2">
                <MapIcon className="h-4 w-4" />
                {t('mobileDetail.showOnMap')}
              </Button>
            </Link>

            <Button
              variant="outline"
              onClick={handleCopyWhatsApp}
              disabled={isCopyingWhatsApp}
              size="lg"
              className="w-full gap-2"
            >
              <MessageCircle className="h-4 w-4" />
              {isCopyingWhatsApp ? t('mobileDetail.copying') : t('mobileDetail.copyWhatsApp')}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
