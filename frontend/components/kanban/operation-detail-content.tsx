"use client"

import { useState, useEffect, useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react"
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
import { Kbd, KbdGroup } from "@/components/ui/kbd"
import { MapPin, Trash2, Plus, Truck, MessageCircle, ArrowRightLeft, Users, Package, Search, Check, Link2, LayoutDashboard, Loader2, Building2, Timer, Footprints, Undo2, Layers, Siren, Phone, Waypoints } from 'lucide-react'
import { useMaterials } from "@/lib/contexts/materials-context"
import { groupAssignedMaterials } from "@/lib/material-grouping"
import { sortCrewByLeader } from "@/lib/crew-order"
import { rapportApplies } from "@/lib/rapport-visibility"
import { type Operation, type Material, type OperationStatus } from "@/lib/contexts/operations-context"
import { useOperations } from "@/lib/contexts/operations-context"
import { useToggleDriverStay } from "@/lib/hooks/use-driver-stay"
import {
  OPERATION_DETAIL_TABS,
  readRememberedTab,
  rememberDetailTab,
  useOperationDetailShortcutTabs,
  useOperationDetailTabArrows,
  type OperationDetailTab,
} from "@/lib/hooks/use-operation-detail-shortcuts"
import { useIncidentTimeline } from "@/lib/hooks/use-incident-timeline"
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
import { IncidentTimeline } from "@/components/kanban/incident-timeline"
import { IncidentParticipants } from "@/components/kanban/incident-participants"
import { LeaderBadge } from "@/components/kanban/leader-badge"
import { FieldReportsRow, FieldMessageThread } from "@/components/kanban/field-reports-row"
import { FieldStatusNudge } from "@/components/kanban/field-status-nudge"
import { PickupBadge } from "@/components/kanban/pickup-badge"
import { RouteResourceSections } from "@/components/kanban/route-resource-sections"
import { TransferRekoDialog } from "@/components/kanban/transfer-reko-dialog"
import { usePersonnel } from "@/lib/contexts/personnel-context"
import type { Incident } from "@/lib/types/incidents"

/** Whether the provenance toggle applies to this card at all.
 *
 *  Only "operator" and "intake" are an editor's to claim. A card carrying
 *  "divera" or a webhook slug came from a delivering system; offering a switch
 *  that would relabel it as a phone call — and be refused with a 422 — is worse
 *  than not offering one. A locally-created card has no `source` yet and is the
 *  operator case. */
function isEditorClaimedSource(source: string | undefined): boolean {
  return !source || source === 'operator' || source === 'intake'
}

export interface OperationDetailContentProps {
  operation: Operation
  layout: 'modal' | 'panel'
  active?: boolean
  /** "Open on THIS tab" — a notification click, which is the operator pointing
   *  at one specific thing (§18.27). It beats the remembered tab for that one
   *  opening and is deliberately NOT written back to the memory: reopening the
   *  card by hand later still returns to whatever tab they were working in.
   *
   *  Carries a `nonce` because the panel does not remount when the same
   *  incident is opened again — clicking the same notification twice has to
   *  bring the tab forward both times. */
  openOnTab?: { tab: OperationDetailTab; nonce: number }
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
  openOnTab,
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
  // Reopening a Schadenplatz lands on the tab it was left on. An operator
  // working through the rapports of a storm night reopens the same card again
  // and again; sending them back to Übersicht every time is a click per visit.
  /** The requested tab, but only if this detail actually has it. A tab that is
   *  not on screen for this incident would be an empty shell, and Übersicht is
   *  always there — the honest fallback for a pointer that misses. */
  const requestedTab =
    openOnTab && OPERATION_DETAIL_TABS.includes(openOnTab.tab) ? openOnTab.tab : undefined
  const [tab, setTab] = useState<OperationDetailTab>(
    () => requestedTab ?? readRememberedTab(operation.id) ?? 'overview',
  )
  const rootRef = useRef<HTMLDivElement>(null)

  /** The one way the tab changes — so nothing can move it without recording it. */
  const selectTab = useCallback(
    (next: OperationDetailTab) => {
      setTab(next)
      rememberDetailTab(operation.id, next)
    },
    [operation.id],
  )
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
    // A different incident brings its own remembered tab, Übersicht if it has
    // none. The modal remounts by key, but the side panel keeps this component
    // alive across selections — read it here rather than trusting the mount.
    // A notification's tab outranks the memory: the operator clicked one
    // specific thing. `setTab`, never `selectTab` — this must not be written
    // back, or one bell click would repoint the card for good.
    setTab(requestedTab ?? readRememberedTab(operation.id) ?? 'overview')
    // openOnTab is read, not depended on: it must not re-run this reset on its
    // own — the effect below owns that, and doing it here as well would fight
    // an operator who switched tabs after arriving.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEvent?.id, operation.id])

  // A second (or third) click on the same notification. The panel keeps this
  // component alive for the incident already on screen, so nothing above fires
  // — and "take me to the thing you just told me about" has to work every time,
  // not only the first. The nonce is what makes a repeat click a new event.
  useEffect(() => {
    if (requestedTab) setTab(requestedTab)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openOnTab])

  // Shortcut targets that are not on screen: Shift+1/2/3 sets the priority,
  // `0` and `1`..`5` touch "zu Fuss" / the quick-assign fleet — all on
  // Übersicht. Bring that tab forward so the operator sees the change they just
  // made. Editors only — a viewer's keypress changes nothing, so it must not
  // move the view either.
  useOperationDetailShortcutTabs({
    enabled: active && canEdit,
    availableVehicleCount: availableVehicles.length,
    onFocusTab: selectTab,
  })

  // ← / → walk the tabs from anywhere inside the detail. Viewers included: this
  // is navigation, not a mutation, and reading is most of what a viewer does.
  useOperationDetailTabArrows({
    enabled: active,
    tab,
    containerRef: rootRef,
    focusTrapped: layout === 'modal',
    onFocusTab: selectTab,
  })

  /**
   * Put the keyboard inside the panel — the half of the arrow-key story a modal
   * gets for free.
   *
   * The modal traps focus, so every keystroke while it is open is a keystroke
   * in the modal. The panel traps nothing: the board behind it is live, the
   * kanban card that opened it is not a focusable element, and most of the
   * panel's own surface is inert text. So a click on a card — or on the panel's
   * own heading — leaves `document.activeElement` on `<body>`, the arrow keys
   * belong to nobody, and Chrome spends them scrolling `#kanban-main`
   * horizontally. That is what "the arrows do not work in the panel" was.
   *
   * The boundary drawn here is *the surface you last touched owns the arrows*:
   * touch the panel and it takes them, touch the board — anywhere, including
   * empty background — and the browser has them back for scrolling. Nothing is
   * claimed globally, and no keystroke is stolen from a control that wants it.
   */
  const focusPanelRoot = useCallback(() => {
    if (layout !== 'panel') return
    // `preventScroll`: the panel is already on screen, and scrolling its
    // content to the top under the operator would be a worse bug than the one
    // this fixes.
    rootRef.current?.focus({ preventScroll: true })
  }, [layout])

  // Selecting a card IS the act of pointing at the panel — the click has no
  // other effect. Mount-only: the panel remounts per incident (it is keyed on
  // event + incident), and the board opens with nothing selected, so this can
  // never fire without an operator having asked for this incident.
  useEffect(() => {
    focusPanelRoot()
  }, [focusPanelRoot])

  /** A click on inert panel content — a heading, a label, whitespace — would
   *  otherwise blur to `<body>` and hand the arrows back to the board while the
   *  operator is looking straight at the panel. Controls keep their own click:
   *  a button, an input or anything else focusable focuses itself, and the
   *  arrows then follow the caret rules in `resolveArrowTabStep`. */
  const handlePanelPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (layout !== 'panel') return
      const target = event.target
      if (
        target instanceof HTMLElement &&
        target.closest(
          'a[href], button, input, textarea, select, [role="combobox"], [contenteditable="true"], [tabindex]:not([tabindex="-1"])',
        )
      ) {
        return
      }
      focusPanelRoot()
    },
    [layout, focusPanelRoot],
  )

  // Status changes, assignments and the crew's Freitext-Meldungen, fetched once
  // for the two tabs that show them: Verlauf renders all of it, Rapport renders
  // the messages as a thread. Not fetched at all while Übersicht is in front,
  // which is where a board click lands.
  const timeline = useIncidentTimeline(operation.id, active && (tab === 'history' || tab === 'rapport'))

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

  return (
    <div
      ref={rootRef}
      // A focus sink, and only in the panel: the modal traps focus, so "inside
      // the modal" is already everywhere. See `focusPanelRoot` above for why
      // the panel needs one. `outline-none` because this is not a control —
      // it holds the keyboard, it does not invite a click.
      tabIndex={layout === 'panel' ? -1 : undefined}
      onPointerDown={handlePanelPointerDown}
      className={cn("flex h-full min-h-0 flex-col", layout === 'panel' && "outline-none")}
      data-testid="operation-detail-content"
      data-layout={layout}
    >
        {/* Radix Tabs: the trigger list is one tab stop with arrow-key roving
            focus between the three triggers, the panel is the next. Nothing here
            overrides tabIndex, so that stays intact. The root wraps the header
            too, because the tab bar lives IN the header row — the modal is
            already taller than a 1280x800 laptop likes, and a tab bar on a line
            of its own was a whole row spent on nothing but the empty space to
            the right of the address. */}
        <Tabs
          value={tab}
          onValueChange={(value) => selectTab(value as OperationDetailTab)}
          className="flex min-h-0 flex-1 flex-col gap-0"
        >
        {/* One centre line for the whole row, and — in the modal — a reserved
            strip on the right for the dialog's close X. The X is a window
            control and owns the true corner (`absolute top-4 right-4`, which
            reaches 24px into the content box); the tabs are content and must
            not be pushed under it. */}
        <header
          className={cn(
            "flex flex-shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2",
            layout === 'modal' && "pr-8",
          )}
        >
          <div className="min-w-0 space-y-1.5">
            <h2 className="text-xl font-semibold leading-none tracking-tight flex items-center gap-2.5">
              <MapPin className="h-5 w-5 text-muted-foreground" />
              {formatLocation(operation.location ?? '') || getIncidentTypeLabel(operation.incidentType)}
              {/* Stays visible on a completed incident on purpose, and is the
                  KP's "Abholung erledigt" control here as everywhere else —
                  passing `incidentId` is what turns the chip into that button. */}
              {operation.pickupNeeded && (
                <PickupBadge
                  requestedAt={operation.pickupRequestedAt}
                  note={operation.pickupNote}
                  incidentId={operation.id}
                  canEdit={canEdit}
                />
              )}
            </h2>
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <span className="font-mono text-xs text-muted-foreground/70">{operation.id}</span>
              {/* The board-wide time chip (start / in status / since alarm). Its
                  durations are dropped once the incident is closed: a running clock
                  on a finished Einsatz reads «19h 40'» the next morning and answers
                  nothing. The Verlauf tab holds the actual times. */}
              {showIncidentTime && (
                <>
                  <span className="text-muted-foreground/40">·</span>
                  <IncidentTime operation={operation} size="lg" suppressDurations={operation.status === "complete"} />
                </>
              )}
            </p>
          </div>

          <div className={cn("flex min-w-0 items-center gap-2", layout === 'panel' && "w-full")}>
            <TabsList className={cn("flex-shrink-0", layout === 'panel' && "w-full")}>
              <TabsTrigger value="overview">{t('detail.tabs.overview')}</TabsTrigger>
              <TabsTrigger value="rapport">
                {t('detail.tabs.rapport')}
                {/* Whitespace-only text nodes generate no box in a flex
                    container, so this costs nothing visually and keeps the
                    trigger's accessible name from reading «Rapport·erfasst». */}
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

            {/* The shortcut has to be visible or it does not exist. Same Kbd the
                rest of the board hints with, in a KbdGroup so the two keys stay
                one horizontal line — `shrink-0` because the row is
                `justify-between` and a long address would otherwise squeeze
                exactly this element. Hidden on the panel mount, where the bar
                already takes the full width. */}
            {layout === 'modal' && (
              <KbdGroup
                className="hidden shrink-0 whitespace-nowrap text-muted-foreground lg:inline-flex"
                title={t('detail.tabs.switchHint')}
              >
                <Kbd aria-label={t('detail.tabs.switchHint')}>←</Kbd>
                <Kbd aria-hidden="true">→</Kbd>
              </KbdGroup>
            )}
          </div>
        </header>

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

          {/* "Telefonisch gemeldet", correctable after the fact (plan 26
              decision 8): the realistic order is "type it in, then realise it
              was a phone call". Same place as in the new-emergency modal, and
              the same sentence — somebody phoned, this is who, this is the
              number. A card that arrived from a delivering system keeps its own
              provenance and is not an operator's to relabel. */}
          {isEditorClaimedSource(operation.source) ? (
            <div
              className="rounded-lg border border-border p-4 cursor-pointer select-none"
              onClick={() => canEdit && onUpdate({ source: operation.source === 'intake' ? 'operator' : 'intake' })}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Phone className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <Label className="text-sm font-semibold pointer-events-none">{t('common.phoneReported')}</Label>
                    <p className="text-xs text-muted-foreground">{t('common.phoneReportedDescription')}</p>
                  </div>
                </div>
                <Switch
                  aria-label={t('common.phoneReported')}
                  checked={operation.source === 'intake'}
                  disabled={!canEdit}
                  onCheckedChange={(checked) => onUpdate({ source: checked ? 'intake' : 'operator' })}
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
            </div>
          ) : null}

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

          {/* Notes and the flags that qualify the incident stay in this column:
              together with the fields above they are one reading — what this
              incident IS. The other column answers who is on it. */}
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

          </div>

          {/* Right column — who is on it. Ressourcen used to be a tab of its
              own; an operator asking "what is this and who is there" was made
              to click twice for one question, and the modal is wide enough to
              answer it in one look. */}
          <div className={tabColumnBreakClass}>
          {/* Status quick-change — one-click move across the board (drops the
              card at the top of the target column) instead of drag & drop. It
              opens this column because it is the most-used control on the tab
              and must not sit below a resource list of unpredictable length. */}
          {/* The same question the card asks, in front of the control that
              answers it — the field reported «angekommen» / «beendet», and the
              next thing an operator does about it is move the card. Dismissal
              is shared with the card behind the modal (one external store in
              field-status-nudge.tsx), so the X only has to be clicked once. */}
          {(operation.fieldCompleteReportedAt || operation.fieldArrivedAt) && (
            <FieldStatusNudge
              operation={operation}
              canEdit={canEdit}
              variant="detail"
              className="mb-5"
              onRequestComplete={canEdit && onRequestComplete ? () => onRequestComplete(operation.id) : undefined}
            />
          )}

          {canEdit && onChangeStatus && (
          <div className="mb-5">
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

          <div className="flex flex-wrap items-center gap-2">
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

          <div className="mt-4">
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

          {/* The resource sections bring their own `mt-4` rhythm, which is what
              spaces them from the Reko block above. */}
          <div>
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
          </div>
          </TabsContent>

          {/* -------------------------------------------------------- Rapport */}
          {/* `forceMount` on this one panel only: it is the sole tab holding an
              editing surface with its own state (the rapport form's autosave
              and the material return list). Unmounting it on every tab switch
              would refetch and re-restore the local draft mid-entry. The other
              two are read-and-act surfaces where a remount costs nothing.
              `hidden` is set explicitly because Radix leaves visibility to the
              caller once forceMount is on. */}
          <TabsContent
            value="rapport"
            forceMount
            hidden={tab !== 'rapport'}
            className={tabPanelClass}
          >
          <div className={tabGridClass}>
          {/* Left — Reko: what somebody went to look at, before the work. */}
          <div className="space-y-5">
            <div>
              <Label className="text-sm font-semibold text-muted-foreground">
                {t('common.rekoReports')}
              </Label>
              <div className="mt-1.5">
                <RekoReportSection
                  incidentId={operation.id}
                  canEdit={canEdit}
                  onRequestComplete={canEdit && onRequestComplete ? () => onRequestComplete(operation.id) : undefined}
                />
              </div>
            </div>
          </div>

          {/* Right — one flow, not three scattered things: what the crew
              reported (the three toggles), what they said (the thread), and
              what they filed (the rapport). All three came from the same people
              on the same Schadenplatz, and they belong on one page. */}
          <div className={tabColumnBreakClass}>
            {/* Feldmeldungen — KP parity (decision 28). Everything a crew taps on
                /feld, an operator enters here from a radio message. */}
            <FieldReportsRow operation={operation} canEdit={canEdit} />

            {/* Everything the crew said, plus the two reports that used to be
                toggles above (§18.19). Before this thread existed a Meldung
                became a notification and an audit entry and showed up on the
                incident nowhere at all — dismiss the bell and it was gone. */}
            <FieldMessageThread
              operation={operation}
              events={timeline.events}
              isLoading={timeline.isLoading}
              failed={timeline.failed}
              onRetry={timeline.reload}
            />

            {/* The Schadenplatz-Rapport itself, as a FULL editing surface: the KP
                must be able to file one for an incident that never had any field
                contact. Same form component /feld mounts, different transport. */}
            <SchadenplatzRapportSection
              incidentId={operation.id}
              canEdit={canEdit}
              hasRapport={operation.hasSchadenplatzRapport}
              // No rapport before the Schadenplatz was disponiert (§18.27).
              // Same gate on both shapes of the detail, because it is the same
              // component — and on the card and the Restliste through the same
              // helper.
              applies={rapportApplies({
                hasBeenDispatched: operation.hasBeenDispatched,
                status: operation.status,
                hasReport: operation.hasSchadenplatzRapport || operation.hasSchadenplatzRapportDraft,
              })}
            />
          </div>
          </div>
          </TabsContent>

          {/* -------------------------------------------------------- Verlauf */}
          <TabsContent value="history" className={tabPanelClass}>
          {/* Everything, expanded, no toggles. The Verlauf tab IS the "show me
              the history" click; a collapsed panel inside it was a second one.
              Two lists, newest-first: what happened (status changes,
              assignments and the crew's messages interleaved), and who was
              here — the same three resource kinds as Übersicht but including
              everything already released. Single column on purpose. */}
          <div className="space-y-4 py-4">
            <IncidentTimeline
              events={timeline.events}
              isLoading={timeline.isLoading}
              failed={timeline.failed}
              onRetry={timeline.reload}
            />
            <IncidentParticipants incidentId={operation.id} />
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
