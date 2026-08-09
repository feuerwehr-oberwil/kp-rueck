"use client"

import { useState, useEffect, useCallback } from "react"
import { useTranslations } from "next-intl"
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { RemovableChip } from "@/components/ui/removable-chip"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { MapPin, Trash2, Plus, Truck, MessageCircle, ArrowRightLeft, Users, Package, Search, Check, Link2, LayoutDashboard, Loader2, Building2, Timer, Footprints, Undo2, Layers, Siren, Phone, Waypoints } from 'lucide-react'
import { useMaterials } from "@/lib/contexts/materials-context"
import { groupAssignedMaterials } from "@/lib/material-grouping"
import { sortCrewByLeader } from "@/lib/crew-order"
import { type Operation, type Material, type OperationStatus } from "@/lib/contexts/operations-context"
import { useOperations } from "@/lib/contexts/operations-context"
import { useToggleDriverStay } from "@/lib/hooks/use-driver-stay"
import {
  useOperationDetailShortcutTabs,
  type OperationDetailTab,
} from "@/lib/hooks/use-operation-detail-shortcuts"
import { useGroups } from "@/lib/contexts/groups-context"
import { columns } from "@/lib/kanban-utils"
import { IncidentTime, useIncidentTimeVisible } from "@/components/ui/incident-time"
import { telHref } from "@/lib/phone"
import { incidentTypeKeys, getIncidentTypeLabel } from "@/lib/incident-types"
import { apiClient } from "@/lib/api-client"
import { useVehicleDrivers } from "@/lib/hooks/use-vehicle-drivers"
import { useRekoLinkActions } from "@/lib/hooks/use-reko-link-actions"
import { useWhatsAppCopy } from "@/lib/hooks/use-whatsapp-copy"
import RekoReportSection from "@/components/reko/reko-report-section"
import { SchadenplatzRapportSection } from "@/components/kanban/schadenplatz-rapport-section"
import { LocationInput } from "@/components/location/location-input"
import { toast } from "sonner"
import { cn, sanitizePhoneInput } from "@/lib/utils"
import { useEvent } from "@/lib/contexts/event-context"
import { TransferIncidentDialog } from "@/components/incidents/transfer-incident-dialog"
import { AssignRekoDialog } from "@/components/incidents/assign-reko-dialog"
import { IncidentTimelinePopover } from "@/components/kanban/incident-timeline-popover"
import { IncidentParticipants } from "@/components/kanban/incident-participants"
import { LeaderBadge } from "@/components/kanban/leader-badge"
import { FieldReportsRow } from "@/components/kanban/field-reports-row"
import { PickupBadge } from "@/components/kanban/pickup-badge"
import { RouteResourceSections } from "@/components/kanban/route-resource-sections"
import { TransferRekoDialog } from "@/components/kanban/transfer-reko-dialog"
import { usePersonnel } from "@/lib/contexts/personnel-context"
import type { Incident } from "@/lib/types/incidents"

export interface OperationDetailContentProps {
  operation: Operation
  layout: 'modal' | 'panel'
  active?: boolean
  canEdit?: boolean
  onUpdate: (updates: Partial<Operation>) => void
  onDelete?: (operationId: string) => void
  materials: Material[]
  onAssignVehicle?: (vehicleId: string, vehicleName: string, operationId: string) => void
  onRemoveVehicle?: (operationId: string, vehicleName: string) => void
  onAssignResource?: (resourceType: 'crew' | 'vehicles' | 'materials', operationId: string) => void
  onRemoveCrew?: (operationId: string, crewName: string) => void
  onRemoveMaterial?: (operationId: string, materialId: string) => void
  diveraEnabled?: boolean
  onSendDivera?: (operation: Operation) => void
  /** Editor-only: archive the incident (status → complete) via the shared
      completion + material-decision flow. Surfaced in the Reko-Meldung card. */
  onRequestComplete?: (operationId: string) => void
  /** Opens the Auftrag picker to distribute this incident into a route. */
  onDistributeToAuftrag?: (operationId: string) => void
  onChangeStatus?: (operationId: string, targetStatus: OperationStatus) => void
}

export function OperationDetailContent({
  operation,
  layout,
  active = true,
  canEdit = true,
  onUpdate,
  onDelete,
  materials,
  onAssignVehicle,
  onRemoveVehicle,
  onAssignResource,
  onRemoveCrew,
  onRemoveMaterial,
  diveraEnabled,
  onSendDivera,
  onRequestComplete,
  onDistributeToAuftrag,
  onChangeStatus,
}: OperationDetailContentProps) {
  const t = useTranslations('kanban')
  const { formatLocation, refreshOperations } = useOperations()
  const toggleDriverStay = useToggleDriverStay()
  const { selectedEvent } = useEvent()
  const { personnel } = usePersonnel()
  const { materialGroups } = useMaterials()
  const { groups, getGroupResources, unassignResource, refreshGroups } = useGroups()
  // The «·» separator has to vanish with the chip, or a closed incident keeps an
  // orphan dot behind the id.
  const showIncidentTime = useIncidentTimeVisible(operation.status === "complete")

  // A grouped incident carries no resources itself — the Auftrag (route) owns
  // them. Show the route's roll-up in the resource sections and route any
  // add/remove to the Auftrag so the modal edits the same thing the sheet does.
  const auftrag = operation?.groupId ? groups.find((g) => g.id === operation.groupId) : undefined
  const auftragResources = auftrag ? getGroupResources(auftrag.id) : null

  // Promote a crew member to Einsatzleiter. The backend demotes the previous
  // holder in the same transaction, so this is set-and-move in one call; we
  // just need the board to re-read who holds it afterwards.
  const promoteToLeader = useCallback(
    async (crewName: string) => {
      const assignmentId = operation.crewAssignments.get(crewName)
      if (!assignmentId) return
      try {
        await apiClient.updateAssignment(operation.id, assignmentId, { is_leader: true })
        await refreshOperations()
      } catch {
        toast.error(t('detail.leaderFailed'))
      }
    },
    [operation.id, operation.crewAssignments, refreshOperations, t],
  )

  /** Same promotion, one level up: the route owns the people, so a grouped
   *  incident's leader is set on the Auftrag. */
  const promoteRouteLeader = useCallback(
    async (groupId: string, assignmentId: string) => {
      try {
        await apiClient.updateGroupAssignment(groupId, assignmentId, { is_leader: true })
        await refreshGroups()
      } catch {
        toast.error(t('detail.leaderFailed'))
      }
    },
    [refreshGroups, t],
  )
  const viaAuftrag = auftrag ? (
    <span
      className="inline-flex items-center gap-1 text-xs font-normal text-muted-foreground"
      title={t('detail.viaAuftrag', { name: auftrag.name })}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: auftrag.color ?? 'var(--muted-foreground)' }}
      />
      {t('detail.viaAuftrag', { name: auftrag.name })}
    </span>
  ) : null
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [tab, setTab] = useState<OperationDetailTab>('overview')
  const [availableVehicles, setAvailableVehicles] = useState<Array<{ id: string; name: string; type: string }>>([])
  const vehicleDrivers = useVehicleDrivers(selectedEvent?.id ?? null, active)
  const [isLoadingVehicles, setIsLoadingVehicles] = useState(true)
  const [transferDialogOpen, setTransferDialogOpen] = useState(false)
  const [availableIncidents, setAvailableIncidents] = useState<Incident[]>([])
  const [isTransferring, setIsTransferring] = useState(false)
  const [rekoDialogOpen, setRekoDialogOpen] = useState(false)
  const [rekoTransferDialogOpen, setRekoTransferDialogOpen] = useState(false)

  const {
    copied: rekoCopied,
    isCopying: isCopyingRekoLink,
    copyDirectLink: handleCopyDirectRekoLink,
    copyDashboardLink: handleCopyDashboardLink,
  } = useRekoLinkActions({
    incidentId: operation?.id ?? null,
    assignedReko: operation?.assignedReko ?? null,
    eventId: selectedEvent?.id ?? null,
  })

  // Use assignedReko directly from the operation (kept in sync by operations context)
  const assignedRekoPersonnel = operation?.assignedReko ?? null
  const assignedRekoPerson = assignedRekoPersonnel
    ? personnel.find((person) => person.id === assignedRekoPersonnel.id)
      ?? personnel.find((person) => person.name === assignedRekoPersonnel.name)
      ?? {
        id: assignedRekoPersonnel.id,
        name: assignedRekoPersonnel.name,
        role: '',
        status: 'assigned' as const,
        roleSortOrder: 0,
        isReko: true,
      }
    : null

  // Load available vehicles list when modal opens. The driver map is
  // handled by useVehicleDrivers above (live-synced).
  useEffect(() => {
    const loadVehicles = async () => {
      if (!active || !selectedEvent || !canEdit) return

      setIsLoadingVehicles(true)
      try {
        const vehicles = await apiClient.getVehicles()
        const sorted = [...vehicles].sort((a, b) => a.display_order - b.display_order)
        setAvailableVehicles(sorted.map((v) => ({ id: v.id, name: v.name, type: v.type })))
      } catch (error) {
        console.error('Failed to load vehicles:', error)
        toast.error(t('detail.vehiclesLoadFailed'), {
          description: t('detail.vehiclesLoadFailedDescription'),
        })
      } finally {
        setIsLoadingVehicles(false)
      }
    }

    loadVehicles()
  }, [active, canEdit, selectedEvent, t])

  useEffect(() => {
    setShowDeleteConfirm(false)
    setTransferDialogOpen(false)
    setAvailableIncidents([])
    setIsTransferring(false)
    setRekoDialogOpen(false)
    setRekoTransferDialogOpen(false)
    // A different incident always starts on Übersicht. The modal remounts by
    // key, but the side panel keeps this component alive across selections.
    setTab('overview')
  }, [selectedEvent?.id, operation.id])

  // Shortcut targets that are no longer on screen: Shift+1/2/3 sets the
  // priority (Übersicht), `0` and `1`..`5` touch "zu Fuss" / the quick-assign
  // fleet (Ressourcen). Bring the owning tab forward so the operator sees the
  // change they just made. Editors only — a viewer's keypress changes nothing,
  // so it must not move the view either.
  useOperationDetailShortcutTabs({
    enabled: active && canEdit,
    availableVehicleCount: availableVehicles.length,
    onFocusTab: setTab,
  })

  const { isCopying: isCopyingWhatsApp, copy: handleCopyWhatsApp } =
    useWhatsAppCopy({ operation, materials, vehicleDrivers })

  // Handler for opening transfer dialog
  const handleOpenTransfer = async () => {
    if (!operation || !selectedEvent) {
      toast.error(t('common.error'), {
        description: t('detail.noEventSelectedLong'),
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
      toast.error(t('common.loadFailed'), {
        description: t('detail.incidentsLoadFailedDescription'),
      })
    }
  }

  // Handler for transferring assignments
  const handleTransfer = async (targetIncidentId: string) => {
    if (!operation) return

    try {
      setIsTransferring(true)
      await apiClient.transferAssignments(operation.id, targetIncidentId)
      await refreshOperations()
      setTransferDialogOpen(false)
    } catch (error: unknown) {
      toast.error(t('common.transferFailed'), {
        description: error instanceof Error ? error.message : t('common.transferFailedDescription')
      })
    } finally {
      setIsTransferring(false)
    }
  }

  // The modal is 90vw wide — a tab that only fills one narrow column wastes it.
  // The panel mount stays single-column; it is barely wider than one.
  const tabGridClass = cn("grid grid-cols-1 gap-8 py-4", layout === 'modal' && "lg:grid-cols-2")
  const tabColumnBreakClass = cn("space-y-5", layout === 'modal' && "lg:border-l lg:border-border lg:pl-8")
  // The one scrolling region: the dialog itself is a fixed 85vh, so switching
  // tabs must never resize it or scroll the header away.
  const tabPanelClass = "min-h-0 flex-1 overflow-y-auto"

  // What the Ressourcen tab actually lists — a grouped incident shows the
  // Auftrag's roll-up there, so the badge has to count that, not its own
  // (always empty) assignments.
  const assignedCount = auftrag
    ? (auftragResources?.personnel.length ?? 0) +
      (auftragResources?.vehicles.length ?? 0) +
      (auftragResources?.materials.length ?? 0)
    : operation.crew.length + operation.vehicles.length + operation.materials.length

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="operation-detail-content" data-layout={layout}>
        <header className="flex-shrink-0 space-y-1.5">
          <h2 className="text-xl font-semibold leading-none tracking-tight flex items-center gap-2.5">
            <MapPin className="h-5 w-5 text-muted-foreground" />
            {formatLocation(operation.location ?? '') || getIncidentTypeLabel(operation.incidentType)}
            {/* Stays visible on a completed incident on purpose — see PickupBadge. */}
            {operation.pickupNeeded && (
              <PickupBadge requestedAt={operation.pickupRequestedAt} note={operation.pickupNote} />
            )}
          </h2>
          <div className="flex items-center gap-1">
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <span className="font-mono text-xs text-muted-foreground/70">{operation.id}</span>
              {/* The board-wide time chip (start / in status / since alarm). Its
                  durations are dropped once the incident is closed: a running clock
                  on a finished Einsatz reads «19h 40'» the next morning and answers
                  nothing. The Verlauf beside it holds the actual times. */}
              {showIncidentTime && (
                <>
                  <span className="text-muted-foreground/40">·</span>
                  <IncidentTime operation={operation} size="lg" suppressDurations={operation.status === "complete"} />
                </>
              )}
            </p>
            <IncidentTimelinePopover incidentId={operation.id} />
          </div>
        </header>

        {/* Radix Tabs: the trigger list is one tab stop with arrow-key roving
            focus between the four triggers, the panel is the next. Nothing here
            overrides tabIndex, so that stays intact. */}
        <Tabs
          value={tab}
          onValueChange={(value) => setTab(value as OperationDetailTab)}
          className="flex min-h-0 flex-1 flex-col gap-0"
        >
          <TabsList className={cn("mt-3 flex-shrink-0", layout === 'panel' ? "w-full" : "self-start")}>
            <TabsTrigger value="overview">{t('detail.tabs.overview')}</TabsTrigger>
            <TabsTrigger value="resources">
              {t('detail.tabs.resources')}
              {/* Whitespace-only text nodes generate no box in a flex container,
                  so this costs nothing visually and keeps the trigger's
                  accessible name from reading «Ressourcen4». */}
              {' '}
              {assignedCount > 0 && (
                <span className="rounded-sm bg-foreground/10 px-1 text-2xs font-medium tabular-nums text-muted-foreground">
                  {assignedCount}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="rapport">
              {t('detail.tabs.rapport')}
              {' '}
              {/* Filed and draft are mutually exclusive board flags. «Entwurf»
                  is the one worth surfacing — somebody started and walked away
                  — so it must not hide behind a silent tab. Nothing is shown
                  when no rapport exists at all; the card already carries that. */}
              {(operation.hasSchadenplatzRapport || operation.hasSchadenplatzRapportDraft) && (
                <span className="text-2xs font-normal text-muted-foreground">
                  ·{' '}
                  {operation.hasSchadenplatzRapport
                    ? t('detail.tabs.rapportFiled')
                    : t('detail.tabs.rapportDraft')}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="history">{t('detail.tabs.history')}</TabsTrigger>
          </TabsList>

          {/* ------------------------------------------------------ Übersicht */}
          <TabsContent value="overview" className={tabPanelClass}>
          <div className={tabGridClass}>
          {/* Left Column - Entry Fields */}
          <div className="space-y-5">
          {/* Location - Smart Input with Geocoding */}
          <LocationInput
            address={operation.location}
            latitude={operation.coordinates?.[0] ?? null}
            longitude={operation.coordinates?.[1] ?? null}
            disabled={!canEdit}
            geocodeInitialAddress={false}
            onAddressChange={(address) => {
              if (canEdit) onUpdate({ location: address ?? '' })
            }}
            onCoordinatesChange={(lat, lon) => {
              if (!canEdit) return
              if (lat !== null && lon !== null) {
                onUpdate({ coordinates: [lat, lon] })
              } else {
                onUpdate({ coordinates: null })
              }
            }}
          />

          {/* Meldung - Moved up from bottom */}
          <div>
            <Label htmlFor="notes" className="text-sm font-semibold text-muted-foreground">{t('common.meldung')}</Label>
              <Textarea
                id="notes"
              placeholder={t('detail.meldungPlaceholder')}
              value={operation.notes}
              disabled={!canEdit}
              onChange={(e) => onUpdate({ notes: e.target.value })}
              className="mt-1.5 min-h-[100px]"
            />
          </div>

          {/* Other fields - Grid */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="edit-incidentType" className="text-sm font-semibold text-muted-foreground">
                {t('common.einsatzart')}
              </Label>
              <Select
                value={operation.incidentType}
                disabled={!canEdit}
                onValueChange={(value) => onUpdate({ incidentType: value })}
              >
                <SelectTrigger className="mt-1.5" tabIndex={0}>
                  <SelectValue placeholder={t('common.einsatzartPlaceholder')} />
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
                  {t('common.priority')}
                </Label>
              </div>
              <Select
                value={operation.priority}
                disabled={!canEdit}
                onValueChange={(value) => onUpdate({ priority: value as "high" | "medium" | "low" })}
              >
                <SelectTrigger className="mt-1.5" tabIndex={0}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">{t('common.priorityLow')}</SelectItem>
                  <SelectItem value="medium">{t('common.priorityMedium')}</SelectItem>
                  <SelectItem value="high">{t('common.priorityHigh')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Contact */}
          <div>
            <Label htmlFor="contact" className="text-sm font-semibold text-muted-foreground">{t('common.contact')}</Label>
            <Input
              id="contact"
              placeholder={t('common.contactPlaceholder')}
              value={operation.contact}
              disabled={!canEdit}
              onChange={(e) => onUpdate({ contact: e.target.value })}
              className="mt-1.5"
            />
          </div>

          {/* Contact phone */}
          <div>
            <div className="flex items-center justify-between">
              <Label htmlFor="contact-phone" className="text-sm font-semibold text-muted-foreground">{t('common.contactPhone')}</Label>
              {operation.contactPhone.trim() && (
                <a
                  href={telHref(operation.contactPhone) ?? undefined}
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  <Phone className="h-3 w-3" />
                  {t('common.callContact')}
                </a>
              )}
            </div>
            <Input
              id="contact-phone"
              type="tel"
              inputMode="tel"
              placeholder={t('common.contactPhonePlaceholder')}
              value={operation.contactPhone}
              disabled={!canEdit}
              onChange={(e) => onUpdate({ contactPhone: sanitizePhoneInput(e.target.value) })}
              className="mt-1.5"
            />
          </div>
          </div>

          {/* Right Column - Notes and the flags that qualify the incident */}
          <div className={tabColumnBreakClass}>
          {/* Internal Notes */}
          <div>
            <Label htmlFor="internalNotes" className="text-sm font-semibold text-muted-foreground">{t('common.notes')}</Label>
            <Textarea
              id="internalNotes"
              placeholder={t('common.internalNotesPlaceholder')}
              value={operation.internalNotes}
              disabled={!canEdit}
              onChange={(e) => onUpdate({ internalNotes: e.target.value })}
              className="mt-1.5 min-h-[80px]"
            />
          </div>

          {/* Nachbarhilfe Toggle */}
          <div
            className="rounded-lg border border-border p-4 space-y-3 cursor-pointer select-none"
            onClick={() => canEdit && onUpdate({ nachbarhilfe: !operation.nachbarhilfe })}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Building2 className="h-5 w-5 text-muted-foreground" />
                <div>
                  <Label className="text-sm font-semibold pointer-events-none">{t('common.nachbarhilfe')}</Label>
                  <p className="text-xs text-muted-foreground">{t('detail.nachbarhilfeDescription')}</p>
                </div>
              </div>
              <Switch
                aria-label={t('common.nachbarhilfe')}
                checked={operation.nachbarhilfe || false}
                disabled={!canEdit}
                onCheckedChange={(checked) => onUpdate({ nachbarhilfe: checked })}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
            {operation.nachbarhilfe && (
              <Input
                placeholder={t('common.nachbarhilfePlaceholder')}
                value={operation.nachbarhilfeNote || ''}
                disabled={!canEdit}
                onChange={(e) => onUpdate({ nachbarhilfeNote: e.target.value })}
                onClick={(e) => e.stopPropagation()}
                className="text-sm cursor-text select-text"
              />
            )}
          </div>

          {/* Am Warten Toggle */}
          <div
            className="rounded-lg border border-border p-4 space-y-3 cursor-pointer select-none"
            onClick={() => canEdit && onUpdate({ amWarten: !operation.amWarten })}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Timer className="h-5 w-5 text-muted-foreground" />
                <div>
                  <Label className="text-sm font-semibold pointer-events-none">{t('common.amWarten')}</Label>
                  <p className="text-xs text-muted-foreground">{t('common.amWartenDescription')}</p>
                </div>
              </div>
              <Switch
                aria-label={t('common.amWarten')}
                checked={operation.amWarten || false}
                disabled={!canEdit}
                onCheckedChange={(checked) => onUpdate({ amWarten: checked })}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
            {operation.amWarten && (
              <Input
                placeholder={t('common.amWartenPlaceholder')}
                value={operation.amWartenNote || ''}
                disabled={!canEdit}
                onChange={(e) => onUpdate({ amWartenNote: e.target.value })}
                onClick={(e) => e.stopPropagation()}
                className="text-sm cursor-text select-text"
              />
            )}
          </div>

          {/* Status quick-change — one-click move across the board (drops the
              card at the top of the target column) instead of drag & drop. It
              belongs to Übersicht: it is the last of the controls that say what
              this incident currently IS. */}
          {canEdit && onChangeStatus && (
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <ArrowRightLeft className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">{t('detail.changeStatus')}</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {columns.map((col) => {
                const isCurrent = col.status.includes(operation.status)
                return (
                  <Button
                    key={col.id}
                    size="xs"
                    variant={isCurrent ? "default" : "outline"}
                    disabled={isCurrent}
                    onClick={() => onChangeStatus(operation.id, col.status[0])}
                  >
                    {t(`columns.${col.id}`)}
                  </Button>
                )
              })}
            </div>
          </div>
          )}
          </div>
          </div>
          </TabsContent>

          {/* ----------------------------------------------------- Ressourcen */}
          <TabsContent value="resources" className={tabPanelClass}>
          {/* Full width above the split: it titles both columns. */}
          <div className="flex flex-wrap items-center gap-2 pt-4">
            <Label className="text-sm font-semibold text-muted-foreground">
              {t('common.assignedResources')}
            </Label>
            {auftrag && (
              <span
                className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-2xs font-medium text-muted-foreground"
                title={t('detail.viaAuftrag', { name: auftrag.name })}
              >
                <Waypoints className="h-3 w-3" />
                {t('detail.viaAuftrag', { name: auftrag.name })}
              </span>
            )}
          </div>

          <div className={cn("grid grid-cols-1 gap-8 pt-4 pb-4", layout === 'modal' && "lg:grid-cols-2")}>
          <div>
            {/* Reko Personnel */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Search className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">{t('common.reko')}</span>
                </div>
                <div className="flex flex-wrap justify-end gap-1">
                {canEdit && assignedRekoPerson && (
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => setRekoTransferDialogOpen(true)}
                    className="px-2"
                    title={t('detail.eventWideRekoTransferTooltip')}
                  >
                    <ArrowRightLeft className="size-3.5" />
                    {t('detail.eventWideRekoTransfer')}
                  </Button>
                )}
                {canEdit && <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => setRekoDialogOpen(true)}
                  className="px-2"
                  tabIndex={0}
                >
                  {assignedRekoPersonnel ? (
                    <>
                      <ArrowRightLeft className="size-3.5" />
                      {t('common.switch')}
                    </>
                  ) : (
                    <>
                      <Plus className="size-3.5" />
                      {t('common.assign')}
                    </>
                  )}
                </Button>}
                </div>
              </div>

              {assignedRekoPersonnel ? (
                <div className="space-y-2">
                  <Badge variant="secondary" className="text-sm bg-info/10 text-info">
                    <Search className="h-3 w-3 mr-1" />
                    {assignedRekoPersonnel.name}
                  </Badge>

                  {/* Link sharing buttons */}
                  {canEdit && <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleCopyDirectRekoLink}
                      disabled={isCopyingRekoLink}
                      className="h-8 px-3 text-sm flex-1"
                    >
                      {isCopyingRekoLink ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : rekoCopied === 'direct' ? (
                        <Check className="size-3.5 text-success" />
                      ) : (
                        <Link2 className="size-3.5" />
                      )}
                      {t('common.directLink')}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleCopyDashboardLink}
                      disabled={isCopyingRekoLink}
                      className="h-8 px-3 text-sm flex-1"
                    >
                      {rekoCopied === 'dashboard' ? (
                        <Check className="size-3.5 text-success" />
                      ) : (
                        <LayoutDashboard className="size-3.5" />
                      )}
                      {t('common.dashboard')}
                    </Button>
                  </div>}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground/60 italic">{t('common.noRekoAssigned')}</p>
              )}
            </div>
          </div>

          {/* The resource sections bring their own `mt-4` rhythm — strip it off
              the first one so this column starts level with the Reko block. */}
          <div className={cn(tabColumnBreakClass, "space-y-0 [&>*:first-child]:mt-0")}>
          {/* Mannschaft / Fahrzeuge / Material. A grouped incident carries no
              resources itself — the Auftrag (route) owns them, so render the
              route's roll-up through the shared section UI (assign/remove target
              the Auftrag). A standalone incident shows its own resources inline. */}
          {auftrag ? (
            <RouteResourceSections
              resources={auftragResources ?? { vehicles: [], personnel: [], materials: [] }}
              viaLabel={viaAuftrag}
              onAssign={(resourceType) => onAssignResource?.(resourceType, operation.id)}
              onUnassign={(assignmentId) => void unassignResource(auftrag.id, assignmentId)}
              onPromoteLeader={(assignmentId) => void promoteRouteLeader(auftrag.id, assignmentId)}
              readOnly={!canEdit || !onAssignResource}
            />
          ) : (
            <>
            {/* Mannschaft (Crew) */}
            <div className="mt-4">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex min-w-0 items-center gap-2">
                  <Users className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <span className="text-sm font-medium">
                    {t('common.crewCount', { count: operation.crew.length })}
                  </span>
                </div>
                {canEdit && onAssignResource && (
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => onAssignResource('crew', operation.id)}
                    className="px-2"
                    title={t('common.assignCrew')}
                    tabIndex={0}
                  >
                    <Plus className="size-3.5" />
                    {t('common.add')}
                  </Button>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {operation.crew.length > 0 ? (
                  // EL first (decision 23) — the star stays, this is ordering on top of it.
                  sortCrewByLeader(operation.crew, operation.leaderName).map((member) => (
                    <RemovableChip
                      key={member}
                      variant="secondary"
                      className="group text-sm gap-1 pr-1 hover:bg-destructive/20"
                      onRemove={canEdit && onRemoveCrew ? () => onRemoveCrew(operation.id, member) : undefined}
                      removeTitle={t('detail.removePerson')}
                      removeButtonClassName="ml-1"
                    >
                      {/* A stop inside an Auftrag takes its leader from the
                          route, so the star is not offered on the stop's own
                          crew — it would set a second, competing leader. */}
                      {!auftrag && (
                        <LeaderBadge
                          isLeader={operation.leaderName === member}
                          onPromote={canEdit ? () => void promoteToLeader(member) : undefined}
                        />
                      )}
                      {member}
                    </RemovableChip>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground/60 italic">{t('detail.noCrew')}</p>
                )}
              </div>
            </div>

            {/* Fahrzeuge (Vehicles) */}
            <div className="mt-4">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex min-w-0 items-center gap-2">
                  <Truck className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <span className="text-sm font-medium">
                    {t('common.vehiclesCount', { count: operation.vehicles.length })}
                  </span>
                </div>
                {canEdit && onAssignVehicle && onRemoveVehicle && <div className="flex items-center gap-1">
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="ghost"
                        size="xs"
                        className="px-2"
                        title={t('common.assignVehicle')}
                        tabIndex={0}
                      >
                        <Plus className="size-3.5" />
                        {t('common.add')}
                      </Button>
                    </PopoverTrigger>
                    {/* Opens to the LEFT of its trigger, and that is the whole point.
                        The trigger sits in the modal's right-hand resource column; the
                        modal's X sits above it in the same column. With the default
                        `side="bottom"` the fleet list is taller than the space beneath
                        the trigger, so Radix flips it upwards — measured at 1280x720:
                        panel x 1024..1267 / y 26..362 against an X at x 1166..1198 /
                        y 71..103. The panel lay straight over the close button, and a
                        click aimed at it hit a vehicle row and silently assigned that
                        vehicle: the operator believes they closed the modal and has in
                        fact changed the incident.
                        `side="left"` separates the two HORIZONTALLY: the panel's right
                        edge is `triggerLeft - sideOffset` (1073), the X's left edge is
                        1166. That clearance does not depend on the panel's height, on
                        how long the station's fleet is, or on where Radix's collision
                        limiter shifts the panel vertically — which a `collisionPadding`
                        reserve or an explicit offset would all depend on. There is
                        ~1080px to the left of the trigger and the panel is 256px wide,
                        so it also never flips back to the right. Nothing shrinks: the
                        list keeps its max-h-64 and Radix just shifts it to fit.
                        It cannot merely move the collision onto the other resource
                        buttons either — those all sit at x >= 1100, to the RIGHT of
                        the panel. */}
                    <PopoverContent className="w-64 p-2" side="left" align="start">
                      <div className="space-y-1">
                        <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                          {t('common.assignVehicle')}
                        </div>
                        <button
                          onClick={() => {
                            onUpdate({ zuFuss: !operation.zuFuss })
                          }}
                          className={cn(
                            "w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md transition-colors",
                            operation.zuFuss ? "bg-primary/10 text-primary" : "hover:bg-muted"
                          )}
                        >
                          <Footprints className="h-4 w-4" />
                           <div className="text-left flex-1">
                             <div className="font-medium">{t('common.zuFuss')}</div>
                             <div className="text-xs text-muted-foreground">{t('detail.ohneFahrzeug')}</div>
                           </div>
                         </button>
                        <div className="border-t border-border my-1" />
                        {/* The fleet scrolls; the header and "Zu Fuss" stay pinned. A station's
                            vehicle list only grows, and an unbounded column made Radix flip the
                            whole popper off the top of the screen. max-h-64 ≈ 5 rows — dense
                            enough for a desktop board, tall enough to show there is more. */}
                        <div className="max-h-64 space-y-1 overflow-y-auto overscroll-contain">
                        {isLoadingVehicles ? (
                          <div className="px-2 py-3 text-xs text-muted-foreground text-center">
                            {t('detail.loadingVehicles')}
                          </div>
                        ) : (
                           availableVehicles.map((vehicle) => {
                              const isAssigned = operation.vehicles.includes(vehicle.name)
                              return (
                                <button
                                  key={vehicle.id}
                                  onClick={() => {
                                    if (isAssigned) {
                                       onRemoveVehicle?.(operation.id, vehicle.name)
                                    } else {
                                       onAssignVehicle?.(vehicle.id, vehicle.name, operation.id)
                                    }
                                  }}
                                  className={cn(
                                    "w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md transition-colors",
                                    isAssigned ? "bg-primary/10 text-primary" : "hover:bg-muted"
                                  )}
                                >
                                  <Truck className={cn("h-4 w-4", isAssigned ? "text-primary" : "text-muted-foreground")} />
                                   <div className="text-left flex-1">
                                     <div className="font-medium">{vehicle.name}</div>
                                     <div className="text-xs text-muted-foreground">{vehicle.type}</div>
                                   </div>
                                 </button>
                              )
                            })
                        )}
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>}
              </div>
              <div className="flex flex-wrap gap-2">
                {operation.zuFuss && (
                  <RemovableChip
                    variant="secondary"
                    className="text-sm gap-1"
                    onRemove={canEdit ? () => onUpdate({ zuFuss: false }) : undefined}
                    removeTitle={t('common.removeZuFuss')}
                    removeButtonClassName="ml-0.5 hover:text-destructive"
                  >
                    <Footprints className="h-3.5 w-3.5" />
                    {t('common.zuFuss')}
                  </RemovableChip>
                )}
                {operation.vehicles.length > 0 ? (
                  operation.vehicles.map((vehicleName) => {
                    const driverName = vehicleDrivers.get(vehicleName)
                    const callsign = operation.vehicleCallsigns.get(vehicleName)
                    const driverStay = operation.vehicleDriverStay.get(vehicleName) || false
                    const assignmentId = operation.vehicleAssignments.get(vehicleName)
                    return (
                      <RemovableChip
                        key={vehicleName}
                        variant="default"
                        className="text-sm gap-1 pr-1"
                        title={callsign ? t('common.funkrufname', { callsign }) : undefined}
                        onRemove={canEdit && onRemoveVehicle ? () => onRemoveVehicle(operation.id, vehicleName) : undefined}
                        removeTitle={t('detail.removeVehicle')}
                        removeButtonClassName="ml-0.5 hover:text-white cursor-pointer"
                      >
                        {vehicleName}{callsign ? ` · ${callsign}` : ''}{driverName ? ` (${driverName})` : ''}
                        {canEdit && assignmentId && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              toggleDriverStay(operation.id, vehicleName)
                            }}
                            className={cn(
                              "ml-1 rounded px-1.5 py-0.5 text-xs font-medium transition-colors",
                              driverStay
                                ? "bg-white/20 text-white hover:bg-white/30"
                                : "bg-white/10 text-white/60 hover:bg-white/20"
                            )}
                            title={driverStay ? t('common.driverStayTooltip') : t('common.driverReturnTooltip')}
                            tabIndex={-1}
                          >
                            {driverStay ? (
                              <span className="flex items-center gap-0.5"><MapPin className="h-3 w-3" /> {t('common.driverStays')}</span>
                            ) : (
                              <span className="flex items-center gap-0.5"><Undo2 className="h-3 w-3" /> {t('common.driverReturns')}</span>
                            )}
                          </button>
                        )}
                      </RemovableChip>
                    )
                  })
                ) : (
                  <p className="text-sm text-muted-foreground/60 italic">{t('detail.noVehicles')}</p>
                )}
              </div>
            </div>

            {/* Material */}
            <div className="mt-4">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex min-w-0 items-center gap-2">
                  <Package className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <span className="text-sm font-medium">
                    {t('common.materialsCount', { count: operation.materials.length })}
                  </span>
                </div>
                {canEdit && onAssignResource && (
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => onAssignResource('materials', operation.id)}
                    className="px-2"
                    title={t('common.assignMaterial')}
                    tabIndex={0}
                  >
                    <Plus className="size-3.5" />
                    {t('common.add')}
                  </Button>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {operation.materials.length > 0 ? (
                  (() => {
                    const { completeGroups, ungrouped } = groupAssignedMaterials(operation.materials, materials, materialGroups)
                    return (
                      <>
                        {completeGroups.map(({ group, materialIds: matIds }) => (
                          <RemovableChip
                            key={`group-${group.id}`}
                            variant="outline"
                            className="text-sm gap-1 pr-1 hover:bg-destructive/20"
                            onRemove={canEdit && onRemoveMaterial ? () => matIds.forEach((matId) => onRemoveMaterial(operation.id, matId)) : undefined}
                            removeTitle={t('common.removeNamed', { name: group.name })}
                            removeButtonClassName="ml-1"
                          >
                            <Layers className="h-3 w-3 text-muted-foreground" />
                            {group.name}
                          </RemovableChip>
                        ))}
                        {ungrouped.map((matId) => {
                          const mat = materials.find(m => m.id === matId)
                          return (
                          <RemovableChip
                            key={matId}
                            variant="outline"
                            className="text-sm gap-1 pr-1 hover:bg-destructive/20"
                            onRemove={canEdit && onRemoveMaterial ? () => onRemoveMaterial(operation.id, matId) : undefined}
                            removeTitle={t('detail.removeMaterial')}
                            removeButtonClassName="ml-1"
                          >
                            {mat?.name || matId}
                            {/* Origin/depot, e.g. "(Pio)" — shown here in the modal but
                                deliberately omitted on the kanban card to keep it clean. */}
                            {mat?.category && (
                              <span className="text-xs text-muted-foreground">({mat.category})</span>
                            )}
                          </RemovableChip>
                          )
                        })}
                      </>
                    )
                  })()
                ) : (
                  <p className="text-sm text-muted-foreground/60 italic">{t('detail.noMaterial')}</p>
                )}
              </div>
            </div>
            </>
          )}
          </div>
          </div>
          </TabsContent>

          {/* -------------------------------------------------------- Rapport */}
          {/* `forceMount` on this one panel only: it is the sole tab holding an
              editing surface with its own state (the rapport form's expand,
              its autosave, the material return list). Unmounting it on every
              tab switch would refetch, re-collapse and re-restore the local
              draft mid-entry. The other three are read-and-act surfaces where a
              remount costs nothing. `hidden` is set explicitly because Radix
              leaves visibility to the caller once forceMount is on. */}
          <TabsContent
            value="rapport"
            forceMount
            hidden={tab !== 'rapport'}
            className={tabPanelClass}
          >
          <div className={tabGridClass}>
          <div className="space-y-5">
            {/* Feldmeldungen — KP parity (decision 28). Everything a crew taps on
                /feld, an operator enters here from a radio message. */}
            <FieldReportsRow operation={operation} canEdit={canEdit} />

            {/* The Schadenplatz-Rapport itself, as a FULL editing surface: the KP
                must be able to file one for an incident that never had any field
                contact. Same form component /feld mounts, different transport. */}
            <SchadenplatzRapportSection
              incidentId={operation.id}
              canEdit={canEdit}
              hasRapport={operation.hasSchadenplatzRapport}
            />
          </div>

          <div className={tabColumnBreakClass}>
            {/* Reko Reports */}
            <div>
              <Label className="text-sm font-semibold text-muted-foreground">
                {t('common.rekoReports')}
              </Label>
              <div className="mt-1.5">
                <RekoReportSection
                  incidentId={operation.id}
                  onRequestComplete={canEdit && onRequestComplete ? () => onRequestComplete(operation.id) : undefined}
                />
              </div>
            </div>
          </div>
          </div>
          </TabsContent>

          {/* -------------------------------------------------------- Verlauf */}
          <TabsContent value="history" className={tabPanelClass}>
          {/* Who was here — the same three resource kinds as the Ressourcen
              tab, but including everything already released. It answers the
              same question one tense back: that tab shows who IS on the
              incident, this shows who WAS. On a completed incident it is the
              only one of the two left with anything in it, so it opens
              expanded there. Single column on purpose — it is one list. */}
          <div className="py-4">
            <IncidentParticipants
              incidentId={operation.id}
              defaultOpen={operation.status === "complete"}
            />
          </div>
          </TabsContent>
        </Tabs>

        {/* Actions - Fixed Footer */}
        <div className={cn("flex-shrink-0 flex items-center gap-2 pt-3 mt-auto border-t", layout === 'panel' && "flex-wrap")}>
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopyWhatsApp}
            disabled={isCopyingWhatsApp}
          >
            <MessageCircle className="size-3.5" />
            {isCopyingWhatsApp ? t('common.copying') : t('detail.copyWhatsapp')}
          </Button>
          {canEdit && diveraEnabled && onSendDivera && operation && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onSendDivera(operation)}
              className="border border-border"
            >
              <Siren className="size-3.5" />
              {t('detail.diveraAlarm')}
            </Button>
          )}
          {canEdit && <Button
            variant="ghost"
            size="sm"
            onClick={handleOpenTransfer}
            className="border border-border"
          >
            <ArrowRightLeft className="size-3.5" />
            {t('common.transferResources')}
          </Button>}
          {canEdit && onDistributeToAuftrag && operation && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onDistributeToAuftrag(operation.id)}
              className="border border-border"
            >
              <Waypoints className="size-3.5" />
              {t('common.distributeToAuftrag')}
            </Button>
          )}
          {canEdit && onDelete && <div className="ml-auto flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowDeleteConfirm(true)}
              className="text-destructive hover:text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="size-3.5" />
              {t('common.delete')}
            </Button>
          </div>}
        </div>

      {canEdit && onDelete && <DeleteConfirmDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        title={t('common.deleteIncidentTitle')}
        description={t('common.deleteIncidentDescription', { name: formatLocation(operation.location ?? '') || getIncidentTypeLabel(operation.incidentType) })}
        onConfirm={() => {
          onDelete(operation.id)
        }}
      />}

      {/* Transfer Incident Dialog */}
      <TransferIncidentDialog
        open={transferDialogOpen}
        onOpenChange={setTransferDialogOpen}
        sourceIncident={operation as unknown as Incident}
        sourceName={formatLocation(operation.location ?? '') || getIncidentTypeLabel(operation.incidentType)}
        availableIncidents={availableIncidents}
        onTransfer={handleTransfer}
        isTransferring={isTransferring}
      />

      {/* Assign Reko Dialog */}
      <AssignRekoDialog
        open={rekoDialogOpen}
        onOpenChange={setRekoDialogOpen}
        incidentId={operation.id}
        incidentTitle={formatLocation(operation.location ?? '') || getIncidentTypeLabel(operation.incidentType)}
        onAssigned={() => void refreshOperations()}
      />

      {assignedRekoPerson && (
        <TransferRekoDialog
          open={rekoTransferDialogOpen}
          onOpenChange={setRekoTransferDialogOpen}
          fromPerson={assignedRekoPerson}
          rekoPersonnel={personnel.filter((person) => person.isReko)}
          onTransferred={() => void refreshOperations()}
        />
      )}
    </div>
  )
}
