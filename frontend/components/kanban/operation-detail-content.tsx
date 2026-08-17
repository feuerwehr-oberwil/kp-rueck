"use client"

import { useState, useEffect, useCallback, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from "react"
import { useTranslations } from "next-intl"
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { RemovableChip } from "@/components/ui/removable-chip"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Kbd } from "@/components/ui/kbd"
import { MapPin, Trash2, Plus, Truck, MessageCircle, ArrowRightLeft, Users, Package, Search, Check, ChevronRight, Link2, LayoutDashboard, Loader2, Building2, Timer, Footprints, Undo2, Layers, Siren, Phone, Waypoints, type LucideIcon } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
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
  type OperationDetailSection,
  type OperationDetailTab,
} from "@/lib/hooks/use-operation-detail-shortcuts"
import { useIncidentTimeline } from "@/lib/hooks/use-incident-timeline"
import { useGroups } from "@/lib/contexts/groups-context"
import { columns } from "@/lib/kanban-utils"
import { IncidentTime, useIncidentTimeVisible } from "@/components/ui/incident-time"
import { formatClockTime } from "@/lib/incident-time"
import { telHref } from "@/lib/phone"
import { incidentTypeKeys, getIncidentTypeLabel } from "@/lib/incident-types"
import { apiClient } from "@/lib/api-client"
import { useVehicleDrivers } from "@/lib/hooks/use-vehicle-drivers"
import { useRekoLinkActions } from "@/lib/hooks/use-reko-link-actions"
import { useWhatsAppCopy } from "@/lib/hooks/use-whatsapp-copy"
import RekoReportSection from "@/components/reko/reko-report-section"
import { SchadenplatzRapportSection } from "@/components/kanban/schadenplatz-rapport-section"
import { MaterialReturnList } from "@/components/kanban/material-return-list"
import { DetailField, DetailToggle, DENSE_CONTROL } from "@/components/kanban/detail-field"
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
import { dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine'
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

/**
 * One action on the detail's footer bar.
 *
 * The modal has room for the word and shows it. The 420px panel does not — four
 * labelled controls do not fit and wrapping grows the bar into the content — so
 * there the icon stands alone AND CARRIES A HOVER LABEL. Not the browser's
 * `title`: that waits about a second and cannot be styled, which is no help to
 * somebody who does not already know that ⇄ means «Ressourcen übertragen». The
 * app's own tooltip opens with `delayDuration = 0`, i.e. on contact.
 *
 * `aria-label` is set in BOTH layouts, so the control keeps one name regardless
 * of how wide the window happens to be.
 *
 * Module level on purpose: declared inside the component it would be a new type
 * every render, and React would remount the button mid-interaction.
 */
function ActionBarButton({
  icon: Icon,
  label,
  visibleLabel,
  dense,
  onClick,
  disabled,
  variant = 'outline',
  className,
}: {
  icon: LucideIcon
  /** The full sentence — accessible name, and the hover label in `dense`. */
  label: string
  /** What the modal prints on the button; defaults to `label`. */
  visibleLabel?: string
  dense: boolean
  onClick: () => void
  disabled?: boolean
  variant?: 'outline' | 'ghost'
  className?: string
}) {
  const button = (
    <Button
      variant={variant}
      size="sm"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={className}
    >
      <Icon className="size-3.5" />
      {!dense && (visibleLabel ?? label)}
    </Button>
  )

  if (!dense) return button

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  )
}

export interface OperationDetailContentProps {
  operation: Operation
  layout: 'modal' | 'panel'
  /** Rendered at the right end of the title row. The side panel puts its
   *  mode switch and its close button there rather than on a bar of its own. */
  headerActions?: ReactNode
  active?: boolean
  /** "Open on THIS tab" — a notification click, or a click on one block of a
   *  kanban card, which is the operator pointing at one specific thing
   *  (§18.27). It beats the remembered tab for that one opening and is
   *  deliberately NOT written back to the memory: reopening the card by hand
   *  later still returns to whatever tab they were working in.
   *
   *  Carries a `nonce` because the panel does not remount when the same
   *  incident is opened again — clicking the same notification twice has to
   *  bring the tab forward both times.
   *
   *  `section` narrows it one step further, to a block inside the tab. */
  openOnTab?: { tab: OperationDetailTab; nonce: number; section?: OperationDetailSection }
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
  headerActions,
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
        className="h-1.5 w-1.5 shrink-0 rounded-full"
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
  /** Übersicht's Ressourcen block — the landing point for `openOnTab.section`. */
  const resourcesRef = useRef<HTMLDivElement>(null)

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
  // Bumped when the rapport section files a rapport: that is the moment the
  // material-return list in the Rapport tab's left column stops being empty.
  const [materialReturnKey, setMaterialReturnKey] = useState(0)

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

  /**
   * …and, for a caller that pointed at a block rather than at a tab, put that
   * block on screen. The 420px panel is the reason this exists: its Übersicht
   * is one column, so the Ressourcen sit a full screen below the address, and a
   * click on the card's Mannschaft row would otherwise land on the Einsatzort
   * field. In the modal the block already opens the right-hand column, so the
   * scroll is a no-op there rather than a special case.
   *
   * One frame late, so the tab set above has been rendered before we measure.
   */
  useEffect(() => {
    if (openOnTab?.section !== 'resources' || requestedTab !== 'overview') return
    const frame = window.requestAnimationFrame(() => {
      resourcesRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    })
    return () => window.cancelAnimationFrame(frame)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openOnTab])

  /**
   * The open side panel takes drops, so a person or a Gerät can go straight
   * onto the incident already on screen instead of being carried back to its
   * card. Panel only: the modal covers the very sidebars the resources are
   * dragged out of, so there is nothing to drop there.
   *
   * **The whole panel, not just the Ressourcen block.** That block was the only
   * target, which made the feature conditional on being on the Übersicht tab
   * *and* on having scrolled the block into view — from the Reko or Rapport tab
   * the panel silently refused every drop, and a refused drop looks exactly
   * like a broken one. So the panel root is a target too. It is registered
   * second and sits further out, and the monitor takes
   * `dropTargets[0]` — the innermost — so the block still wins whenever the
   * pointer is actually over it, and only its ring lights up.
   *
   * The payload is the card's own `operation-drop`, which is what buys the
   * behaviour that matters for free — Doppelbelegung prompt, Reko slot, and a
   * grouped incident routing the assignment to its Auftrag (see
   * `applyResourceDrop`). Cards are refused: neither target has an `index`, so
   * the reorder maths in `applyOperationDrop` has nothing to work with.
   */
  const [isResourceDropOver, setIsResourceDropOver] = useState(false)
  const [isPanelDropOver, setIsPanelDropOver] = useState(false)
  useEffect(() => {
    const root = rootRef.current
    if (!root || layout !== 'panel' || !canEdit) return

    const takesResources = (data: Record<string | symbol, unknown>) =>
      data.type === 'person' ||
      data.type === 'material' ||
      data.type === 'material-group' ||
      data.type === 'driver-vehicle'
    const dropData = () => ({ type: 'operation-drop', operationId: operation.id })

    const block = resourcesRef.current
    return combine(
      dropTargetForElements({
        element: root,
        canDrop: ({ source }) => takesResources(source.data),
        getData: dropData,
        onDragEnter: () => setIsPanelDropOver(true),
        onDragLeave: () => setIsPanelDropOver(false),
        onDrop: () => setIsPanelDropOver(false),
      }),
      ...(block
        ? [
            dropTargetForElements({
              element: block,
              canDrop: ({ source }) => takesResources(source.data),
              getData: dropData,
              onDragEnter: () => setIsResourceDropOver(true),
              onDragLeave: () => setIsResourceDropOver(false),
              onDrop: () => setIsResourceDropOver(false),
            }),
          ]
        : []),
    )
  }, [layout, canEdit, operation.id, tab])

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
  // The panel reads `Label │ Wert` rows; the modal keeps the stacked form.
  const dense = layout === 'panel'
  // The panel's tab bar shares its row with the ← / → hints, so its triggers
  // take their own label plus a share of whatever is left (`flex-auto`) rather
  // than a fixed quarter each (`flex-1`, the default): «Rapport · erfasst» is
  // wider than a quarter of 420px and would spill over «Verlauf».
  const tabTriggerClass = dense ? "flex-auto px-1.5" : undefined
  const tabGridClass = cn("grid grid-cols-1 gap-8 py-4", layout === 'modal' && "lg:grid-cols-2")
  const tabColumnBreakClass = cn("space-y-5", layout === 'modal' && "lg:border-l lg:border-border lg:pl-8")
  // The one scrolling region: the dialog itself is a fixed 85vh, so switching
  // tabs must never resize it or scroll the header away.
  // `scroll`, not `auto`: every one of these panels grows the moment a folded
  // block is opened, and a scrollbar that appears at that moment narrows the
  // column under the pointer — the row you were about to click moves.
  const tabPanelClass = "min-h-0 flex-1 overflow-y-scroll"

  /**
   * The banners: what came in from the field and is still waiting for the KP to
   * do something about it — «Feld meldet beendet / angekommen» and «Abholung».
   * One group, two homes, because the two mounts have different room for it:
   *
   *  * modal — first thing in the Übersicht RIGHT column, directly above
   *    «Status wechseln», which is the control those questions are about.
   *  * panel — a full-width strip directly under the tab bar. 420px has no
   *    second column to put them in, and burying them inside Übersicht would
   *    hide them whenever the operator is on Rapport or Verlauf.
   *
   * `empty:hidden` is what keeps the group honest: FieldStatusNudge renders
   * nothing once its question has been answered, and a dismissed nudge with no
   * pickup must not leave a padded gap under the tabs. A `display:none` box
   * carries no margin either, so the spacing below can stay on this element.
   */
  const banners = (
    <div className={cn("space-y-2 empty:hidden", dense ? "flex-shrink-0 pt-3" : "mb-5")}>
      {(operation.fieldCompleteReportedAt || operation.fieldArrivedAt) && (
        <FieldStatusNudge operation={operation} canEdit={canEdit} variant="detail" />
      )}
      {/* Stays visible on a completed incident on purpose, and is the KP's
          «Abholung disponiert» control here as everywhere else — passing
          `incidentId` is what turns it into that button. */}
      {operation.pickupNeeded && (
        <PickupBadge
          requestedAt={operation.pickupRequestedAt}
          note={operation.pickupNote}
          incidentId={operation.id}
          canEdit={canEdit}
          variant="banner"
        />
      )}
    </div>
  )

  return (
    <div
      ref={rootRef}
      // A focus sink, and only in the panel: the modal traps focus, so "inside
      // the modal" is already everywhere. See `focusPanelRoot` above for why
      // the panel needs one. `outline-none` because this is not a control —
      // it holds the keyboard, it does not invite a click.
      tabIndex={layout === 'panel' ? -1 : undefined}
      onPointerDown={handlePanelPointerDown}
      className={cn(
        "flex h-full min-h-0 flex-col",
        layout === 'panel' && "outline-none",
        // Only when the Ressourcen block itself is NOT the target: a nested
        // drop target leaves its parent "entered" too, and two rings around one
        // drop is a question about which of them takes it.
        isPanelDropOver && !isResourceDropOver &&
          "rounded-lg ring-2 ring-primary ring-offset-2 ring-offset-background",
      )}
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
          {/* In the panel this row carries everything: address, time, and the
              mode/close controls the panel used to spend a bar of its own on.
              The incident id moves into the title's tooltip — 36 monospace
              characters nobody reads aloud cost a whole line there. */}
          <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="min-w-0 flex-1 space-y-1.5">
            <h2
              className={cn(
                "flex items-center gap-2.5 font-semibold leading-none tracking-tight",
                // The panel row also carries the clock and three controls: the
                // address gives way rather than wrapping, and it is the only
                // part that may.
                dense ? "min-w-0 text-lg" : "text-xl",
              )}
              // Both, because the address is what truncated and the id is what
              // lost its line: hovering the title has to answer either question.
              title={dense
                ? `${formatLocation(operation.location ?? '') || getIncidentTypeLabel(operation.incidentType)} · ${operation.id}`
                : undefined}
            >
              <MapPin className="h-5 w-5 shrink-0 text-muted-foreground" />
              {/* min-w-0 as well as truncate: a flex item refuses to shrink
                  below its content without it, so the address pushed the clock
                  and the panel controls off the row instead of giving way. */}
              <span className={cn(dense && "min-w-0 truncate")}>
                {formatLocation(operation.location ?? '') || getIncidentTypeLabel(operation.incidentType)}
              </span>
              {dense && showIncidentTime && (
                // The wrapper, not the component's own className: the chip is a
                // button with its own classes and was being squeezed to «171h 3»
                // instead of letting the address give way.
                <span className="shrink-0">
                  <IncidentTime
                    operation={operation}
                    suppressDurations={operation.status === "complete"}
                    className="font-normal"
                  />
                </span>
              )}
            </h2>
            {/* The line under the title: what identifies the incident without
                being its address — the id and the time chip. «Abholung» used to
                ride here as a chip and is now one of the banners below the tabs
                / in the Übersicht column, where it states the same fact as a
                sentence with its «erledigt» control attached.
                In the panel the id lives in the title's tooltip and the clock
                rides the title row, so there is nothing left to show. */}
            {!dense && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
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
            </div>
            )}
          </div>
          {headerActions && <div className="ml-auto flex flex-shrink-0 items-center gap-1">{headerActions}</div>}
          </div>

          <div className={cn("flex min-w-0 items-center", dense ? "w-full gap-1" : "gap-2")}>
            {/* The shortcut has to be visible or it does not exist. Same Kbd the
                rest of the board hints with, and split so each key sits on the
                side it moves towards: ← before the tabs, → after them. Both
                `shrink-0`, because the row is `justify-between` and a long
                address would otherwise squeeze exactly these. Both mounts: the
                arrows walk the tabs in the panel too, and a shortcut nobody is
                told about is a shortcut nobody uses. The panel pays for them
                with a smaller key cap and a tighter gap — 24px of its 420. */}
            <Kbd
              className={cn("hidden shrink-0 lg:inline-flex", dense && "h-4 min-w-4 px-0.5 text-2xs")}
              title={t('detail.tabs.switchHint')}
              aria-label={t('detail.tabs.switchHint')}
            >
              ←
            </Kbd>
            <TabsList className={cn(dense ? "min-w-0 flex-1" : "flex-shrink-0")}>
              <TabsTrigger value="overview" className={tabTriggerClass}>{t('detail.tabs.overview')}</TabsTrigger>
              {/* Reko stands alone: it is written and read at a different moment
                  than everything the crew sends from the Schadenplatz, and one
                  tab holding both was one tab nobody could see the end of. */}
              <TabsTrigger value="reko" className={tabTriggerClass}>{t('detail.tabs.reko')}</TabsTrigger>
              {/* «Feld», not «Rapport»: the panel stopped being the
                  Schadenplatz-Rapport alone. It carries everything that comes
                  back from `/feld` — the crew's and the driver's Freitext
                  Meldungen, Angekommen und Einsatz beendet, die Abholung — and
                  a tab named after one of its sections hides the rest. The
                  `value` stays `rapport`: it is a deep link (`openOnTab`) and
                  a notification target, not a label. */}
              <TabsTrigger value="rapport" className={tabTriggerClass}>
                {t('detail.tabs.rapport')}
                {/* Whitespace-only text nodes generate no box in a flex
                    container, so this costs nothing visually and keeps the
                    trigger's accessible name from reading «Feld·Rapport». */}
                {' '}
                {/* Filed and draft are mutually exclusive board flags. «Entwurf»
                    is the one worth surfacing — somebody started and walked away
                    — so it must not hide behind a silent tab. Nothing is shown
                    when no rapport exists at all; the card already carries that.
                    Both name the Rapport now: under «Feld» a bare «erfasst» no
                    longer said *what* had been erfasst. */}
                {(operation.hasSchadenplatzRapport || operation.hasSchadenplatzRapportDraft) && (
                  <span className="text-2xs font-normal text-muted-foreground">
                    ·{' '}
                    {operation.hasSchadenplatzRapport
                      ? t('detail.tabs.rapportFiled')
                      : t('detail.tabs.rapportDraft')}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="history" className={tabTriggerClass}>{t('detail.tabs.history')}</TabsTrigger>
            </TabsList>

            <Kbd
              className={cn("hidden shrink-0 lg:inline-flex", dense && "h-4 min-w-4 px-0.5 text-2xs")}
              title={t('detail.tabs.switchHint')}
              aria-hidden="true"
            >
              →
            </Kbd>
          </div>
        </header>

          {/* The panel's home for the banners: under the tabs, above whichever
              tab is in front — see `banners` above. */}
          {dense && banners}

          {/* ------------------------------------------------------ Übersicht */}
          <TabsContent value="overview" className={tabPanelClass}>
          <div className={tabGridClass}>
          {/* Left Column — the fields, as rows in both mounts. They space
              themselves through their own separators. */}
          <div className="space-y-1">
          {/* Location - Smart Input with Geocoding. It carries its own label
              and its own map/coordinate buttons, so it lays itself out as a row
              rather than being wrapped in one. */}
          <LocationInput
            address={operation.location}
            latitude={operation.coordinates?.[0] ?? null}
            longitude={operation.coordinates?.[1] ?? null}
            disabled={!canEdit}
            geocodeInitialAddress={false}
            dense

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
          <DetailField label={t('common.meldung')} htmlFor="notes" alignStart>
            <Textarea
              id="notes"
              placeholder={t('detail.meldungPlaceholder')}
              value={operation.notes}
              disabled={!canEdit}
              onChange={(e) => onUpdate({ notes: e.target.value })}
              // Grows with what is in it. `h-auto` is what makes that work:
              // DENSE_CONTROL's `h-7` is an explicit height, and an explicit
              // height beats the base Textarea's `field-sizing-content` — which
              // is how a dictated Meldung ended up scrolling inside five rems
              // and clipped mid-word. The min-height stays the floor, the
              // max-height is the point where it goes back to scrolling rather
              // than pushing the whole form off the panel.
              className={cn(
                DENSE_CONTROL,
                "h-auto py-1",
                dense ? "max-h-[14rem] min-h-[3.5rem]" : "max-h-[20rem] min-h-[5rem]",
              )}
            />
          </DetailField>

          {/* One per line, both mounts: two half-width controls sharing a row is
              how «Mittel» gets read as the Einsatzart. */}
          <>
            <DetailField label={t('common.einsatzart')} htmlFor="edit-incidentType">
              <Select
                value={operation.incidentType}
                disabled={!canEdit}
                onValueChange={(value) => onUpdate({ incidentType: value })}
              >
                <SelectTrigger className={DENSE_CONTROL} tabIndex={0}>
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
            </DetailField>

            <DetailField label={t('common.priority')} htmlFor="edit-priority">
              <Select
                value={operation.priority}
                disabled={!canEdit}
                onValueChange={(value) => onUpdate({ priority: value as "high" | "medium" | "low" })}
              >
                <SelectTrigger className={DENSE_CONTROL} tabIndex={0}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">{t('common.priorityLow')}</SelectItem>
                  <SelectItem value="medium">{t('common.priorityMedium')}</SelectItem>
                  <SelectItem value="high">{t('common.priorityHigh')}</SelectItem>
                </SelectContent>
              </Select>
            </DetailField>
          </>

          {/* Contact */}
          <DetailField label={t('common.contact')} htmlFor="contact">
            <Input
              id="contact"
              placeholder={t('common.contactPlaceholder')}
              value={operation.contact}
              disabled={!canEdit}
              onChange={(e) => onUpdate({ contact: e.target.value })}
              className={DENSE_CONTROL}
            />
          </DetailField>

          {/* Contact phone */}
          <DetailField
            label={t('common.contactPhone')}
            htmlFor="contact-phone"
            action={operation.contactPhone.trim() ? (
              <a
                href={telHref(operation.contactPhone) ?? undefined}
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                <Phone className="h-3 w-3 shrink-0" />
                {t('common.callContact')}
              </a>
            ) : undefined}
          >
            <Input
              id="contact-phone"
              type="tel"
              inputMode="tel"
              placeholder={t('common.contactPhonePlaceholder')}
              value={operation.contactPhone}
              disabled={!canEdit}
              onChange={(e) => onUpdate({ contactPhone: sanitizePhoneInput(e.target.value) })}
              className={DENSE_CONTROL}
            />
          </DetailField>

          {/* Notes and the flags that qualify the incident stay in this column:
              together with the fields above they are one reading — what this
              incident IS. The other column answers who is on it. */}
          {/* Internal Notes */}
          <DetailField label={t('common.notes')} htmlFor="internalNotes" alignStart>
            <Textarea
              id="internalNotes"
              placeholder={t('common.internalNotesPlaceholder')}
              value={operation.internalNotes}
              disabled={!canEdit}
              onChange={(e) => onUpdate({ internalNotes: e.target.value })}
              // Same auto-grow as «Meldung» above — see there for why `h-auto`.
              className={cn(
                DENSE_CONTROL,
                "h-auto py-1",
                dense ? "max-h-[14rem] min-h-[3.5rem]" : "max-h-[20rem] min-h-[4rem]",
              )}
            />
          </DetailField>

          {/* The three switches stand together: they are the same kind of
              statement about the incident (how it came in, who it is for, why
              it waits), and scattering them between the text fields made the
              form read as five unrelated things. */}
          {/* "Telefonisch gemeldet", correctable after the fact (plan 26
              decision 8): the realistic order is "type it in, then realise it
              was a phone call". Same place as in the new-emergency modal, and
              the same sentence — somebody phoned, this is who, this is the
              number. A card that arrived from a delivering system keeps its own
              provenance and is not an operator's to relabel. */}
          {isEditorClaimedSource(operation.source) ? (
            <DetailToggle
              label={t('common.phoneReported')}
              description={t('common.phoneReportedDescription')}

              icon={<Phone className="h-3.5 w-3.5 shrink-0" />}
              checked={operation.source === 'intake'}
              disabled={!canEdit}
              onToggle={(checked) => canEdit && onUpdate({ source: checked ? 'intake' : 'operator' })}
            />
          ) : null}

          {/* Nachbarhilfe Toggle */}
          <DetailToggle
            label={t('common.nachbarhilfe')}
            description={t('detail.nachbarhilfeDescription')}

            icon={<Building2 className="h-3.5 w-3.5 shrink-0" />}
            checked={operation.nachbarhilfe || false}
            disabled={!canEdit}
            onToggle={(checked) => canEdit && onUpdate({ nachbarhilfe: checked })}
            note={
              <Input
                placeholder={t('common.nachbarhilfePlaceholder')}
                value={operation.nachbarhilfeNote || ''}
                disabled={!canEdit}
                onChange={(e) => onUpdate({ nachbarhilfeNote: e.target.value })}
                onClick={(e) => e.stopPropagation()}
                className="h-7 cursor-text text-sm select-text"
              />
            }
          />

          {/* Am Warten Toggle */}
          <DetailToggle
            label={t('common.amWarten')}
            description={t('common.amWartenDescription')}

            icon={<Timer className="h-3.5 w-3.5 shrink-0" />}
            checked={operation.amWarten || false}
            disabled={!canEdit}
            onToggle={(checked) => canEdit && onUpdate({ amWarten: checked })}
            note={
              <Input
                placeholder={t('common.amWartenPlaceholder')}
                value={operation.amWartenNote || ''}
                disabled={!canEdit}
                onChange={(e) => onUpdate({ amWartenNote: e.target.value })}
                onClick={(e) => e.stopPropagation()}
                className="h-7 cursor-text text-sm select-text"
              />
            }
          />

          </div>

          {/* Right column — who is on it. Ressourcen used to be a tab of its
              own; an operator asking "what is this and who is there" was made
              to click twice for one question, and the modal is wide enough to
              answer it in one look. */}
          <div className={tabColumnBreakClass}>
          {/* The modal's home for the banners: the same questions the card
              asks, in front of the control that answers them — the field
              reported «angekommen» / «beendet», and the next thing an operator
              does about it is move the card, which is «Status wechseln»
              directly below. The nudge's dismissal is shared with the card
              behind the modal (one external store in field-status-nudge.tsx),
              so the X only has to be clicked once. In the panel this same group
              sits under the tab bar instead — see `banners` above. */}
          {!dense && banners}

          {/* Status quick-change — one-click move across the board (drops the
              card at the top of the target column) instead of drag & drop. It
              opens this column because it is the most-used control on the tab
              and must not sit below a resource list of unpredictable length. */}
          {canEdit && onChangeStatus && (
          <div className="mb-5">
            <div className="flex items-center gap-2 mb-1.5">
              <ArrowRightLeft className="h-4 w-4 shrink-0 text-muted-foreground" />
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

          {/* No «Zugewiesene Ressourcen» heading: Reko, Mannschaft, Fahrzeuge and
              Material each carry their own label and count, so the line above
              them only named the column it already is. The Auftrag chip stays —
              it is the one thing those four labels do not say, namely that the
              resources belong to a route rather than to this incident. */}
          {auftrag && (
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-2xs font-medium text-muted-foreground"
                title={t('detail.viaAuftrag', { name: auftrag.name })}
              >
                <Waypoints className="h-3 w-3 shrink-0" />
                {t('detail.viaAuftrag', { name: auftrag.name })}
              </span>
            </div>
          )}

          {/* Ressourcen — Reko, Mannschaft, Fahrzeuge, Material. Reached
              directly by a click on the matching block of a kanban card, which
              is what the ref is for (see the scroll effect above). */}
          <div
            ref={resourcesRef}
            data-detail-section="resources"
            className={cn(
              // The drop ring sits OUTSIDE the block (`ring-offset`) so it reads
              // as "this whole list takes it" rather than as a field focus.
              "rounded-lg transition-colors",
              isResourceDropOver && "ring-2 ring-primary ring-offset-4 ring-offset-background bg-primary/5"
            )}
          >
            {/* Reko, as ONE line: who is out looking, since when — and a way
                through to the rest. The five controls that used to live here
                (zuweisen/wechseln, the two links, the event-wide transfer) are
                on the Reko tab now: they are used about once per incident, and
                they were taking a quarter of a column that also carries Status
                ändern, Mannschaft, Fahrzeuge and Material. The line stays a
                button rather than becoming plain text, because assigning a Reko
                happens at the busiest moment and must not go into hiding — it
                is one click from here, the same click the card's Reko block
                makes. */}
            <button
              type="button"
              // Unassigned, this line reads «Reko zuweisen» — so it does that,
              // rather than dropping the operator on a tab where they have to
              // find the button again. It still switches tabs first, so the
              // dialog closes onto the Reko-Auftrag block that now owns the
              // assignment and not onto the Übersicht they came from.
              onClick={() => {
                selectTab('reko')
                if (canEdit && !assignedRekoPersonnel) setRekoDialogOpen(true)
              }}
              className="group -mx-1 flex w-full items-center gap-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-muted/50"
              title={canEdit && !assignedRekoPersonnel ? t('card.assignReko') : t('detail.tabs.reko')}
            >
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="shrink-0 text-sm font-medium">{t('common.reko')}</span>
              {assignedRekoPersonnel ? (
                <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                  {assignedRekoPersonnel.name}
                  {operation.rekoArrivedAt && (
                    <> · {t('card.onSiteSince', { time: formatClockTime(operation.rekoArrivedAt) })}</>
                  )}
                </span>
              ) : (
                <span className="min-w-0 flex-1 truncate text-sm italic text-muted-foreground/60">
                  {canEdit ? t('card.assignReko') : t('common.noRekoAssigned')}
                </span>
              )}
              <ChevronRight className="size-4 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-foreground" />
            </button>

          {/* The resource sections bring their own `mt-4` rhythm, which is what
              spaces them from the Reko line above. */}
          <div>
          {/* Mannschaft / Fahrzeuge / Material. A grouped incident carries no
              resources itself — the Auftrag (route) owns them, so render the
              route's roll-up through the shared section UI (assign/remove target
              the Auftrag). A standalone incident shows its own resources inline. */}
          {auftrag ? (
            <RouteResourceSections
              resources={auftragResources ?? { vehicles: [], personnel: [], materials: [] }}
              viaLabel={viaAuftrag}
              // Same map the standalone-Einsatz chips below already use: an
              // Auftrag's vehicle is no more self-explanatory than an incident's.
              vehicleDrivers={vehicleDrivers}
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
                          <Footprints className="h-4 w-4 shrink-0" />
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
                                  <Truck className={cn("h-4 w-4 shrink-0", isAssigned ? "text-primary" : "text-muted-foreground")} />
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
                    <Footprints className="h-3.5 w-3.5 shrink-0" />
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
                              <span className="flex items-center gap-0.5"><MapPin className="h-3 w-3 shrink-0" /> {t('common.driverStays')}</span>
                            ) : (
                              <span className="flex items-center gap-0.5"><Undo2 className="h-3 w-3 shrink-0" /> {t('common.driverReturns')}</span>
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
                            {/* h-3.5 like the «Zu Fuss» chip's glyph: both sit
                                in a `text-sm` chip, and 12px next to 14px text
                                read as two different chip families. */}
                            <Layers className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
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
          </div>
          </TabsContent>

          {/* ----------------------------------------------------------- Reko */}
          {/* What somebody went to LOOK at, before the work — written once,
              amended over the radio, and read while deciding what to send. That
              is a different moment from everything below, which is why it is no
              longer stacked on top of it. */}
          <TabsContent value="reko" className={tabPanelClass}>
            <div className="space-y-4 py-4">
              {/* Der Reko-Auftrag: wer schaut es an, und alles, was daran
                  geändert wird. Moved here off Übersicht — Reko was split
                  across two tabs, with the tab NAMED Reko holding only the
                  report while every dispatch control sat in a column that also
                  carries Status ändern and three resource lists.
                  It also answers what this tab used to be before a report
                  exists: an empty box. Now the first thing an incident without
                  a Reko offers here is the way to assign one. */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="text-sm font-medium">{t('detail.rekoAuftrag')}</span>
                </div>
                {/* One wrapping row, so the 420px panel breaks it over two or
                    three lines instead of squeezing four controls onto one. */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {assignedRekoPersonnel ? (
                    <Badge variant="secondary" className="text-sm bg-info/10 text-info">
                      <Search className="mr-1 h-3 w-3 shrink-0" />
                      {assignedRekoPersonnel.name}
                    </Badge>
                  ) : (
                    <p className="text-sm text-muted-foreground/60 italic">{t('common.noRekoAssigned')}</p>
                  )}
                  {canEdit && (
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => setRekoDialogOpen(true)}
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
                    </Button>
                  )}
                  {/* The two links only exist once somebody is assigned — they
                      point the Reko person at this incident. */}
                  {canEdit && assignedRekoPersonnel && (
                    <>
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={handleCopyDirectRekoLink}
                        disabled={isCopyingRekoLink}
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
                        size="xs"
                        variant="outline"
                        onClick={handleCopyDashboardLink}
                        disabled={isCopyingRekoLink}
                      >
                        {rekoCopied === 'dashboard' ? (
                          <Check className="size-3.5 text-success" />
                        ) : (
                          <LayoutDashboard className="size-3.5" />
                        )}
                        {t('common.dashboard')}
                      </Button>
                    </>
                  )}
                </div>
                {/* Its own line: this one reaches beyond the incident on screen
                    (every open Reko of that person, event-wide), so it must not
                    read as a fourth button of the row above. */}
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
              </div>

              <div className="border-t border-border pt-4">
              <RekoReportSection
                incidentId={operation.id}
                canEdit={canEdit}
                // «Reko vor Ort» is a Funkmeldung ABOUT the reconnaissance, so
                // it sits with the reports in the data column — not across both,
                // where it read as a heading for the entry surface too.
                dataSlot={<FieldReportsRow operation={operation} canEdit={canEdit} only={['rekoArrived']} />}
                // Two columns where there is width: what was reported on the
                // left, what the operator writes on the right.
                layout={dense ? 'stacked' : 'split'}
                // Deep-linked with the entry form open. «Reko-Details öffnen»
                // in the completion gate answers "no Reko report was filled in",
                // so it has to land on the form, not on a tab with a button.
                openEditorNonce={
                  openOnTab?.tab === 'reko' && openOnTab.section === 'newReport' ? openOnTab.nonce : undefined
                }
                onRequestComplete={canEdit && onRequestComplete ? () => onRequestComplete(operation.id) : undefined}
              />
              </div>
            </div>
          </TabsContent>

          {/* ------------------------------------------- Feld & Rapport */}
          {/* `forceMount` on this one panel only: it is the sole tab holding an
              editing surface with its own state (the rapport form's autosave
              and the material return list). Unmounting it on every tab switch
              would refetch and re-restore the local draft mid-entry. The others
              are read-and-act surfaces where a remount costs nothing.
              `hidden` is set explicitly because Radix leaves visibility to the
              caller once forceMount is on. */}
          <TabsContent
            value="rapport"
            forceMount
            hidden={tab !== 'rapport'}
            className={tabPanelClass}
          >
          {/* One flow, split the same way the Reko tab is: what CAME IN on the
              left — the crew's sentences — and what the KP itself sets or fills
              in on the right. In the panel that becomes one column, top to
              bottom, because 420px has no second one to give. */}
          <div className={cn("py-4", dense ? "space-y-5" : "grid grid-cols-2 gap-6")}>
            {/* Left: what the Schadenplatz says. The two settable Funkmeldungen
                belong with the crew's own sentences — both answer «was ist
                gemeldet worden», and an operator taking a radio call reads and
                sets them in the same breath. */}
            <div className="space-y-5">
              {/* Feldmeldungen — KP parity (decision 28). Everything a crew taps
                  on /feld, an operator enters here from a radio message.
                  «Reko vor Ort» lives on the Reko tab with the rest of the
                  reconnaissance. */}
              <FieldReportsRow operation={operation} canEdit={canEdit} only={['pickup']} />

              {/* Everything the crew said, plus the two reports that used to be
                  toggles (§18.19). Before this thread existed a Meldung became a
                  notification and an audit entry and showed up on the incident
                  nowhere at all — dismiss the bell and it was gone. */}
              <FieldMessageThread
                operation={operation}
                events={timeline.events}
                isLoading={timeline.isLoading}
                failed={timeline.failed}
                onRetry={timeline.reload}
              />

              {/* «Material zurück – freigeben» — the KP's own to-do, and it
                  belongs on this side: it answers the same «was ist draussen
                  passiert» as the Abholung row and the crew's messages above,
                  and it is a list to work through rather than a form to fill
                  in. Mounted here rather than inside the rapport section (which
                  opts out via `showMaterialReturn`), on the same condition it
                  had there: only once a rapport has actually been FILED, since
                  the list is empty for a draft by definition and every detail
                  opening would otherwise pay for a request that answers
                  "nothing". */}
              {(operation.hasSchadenplatzRapport || materialReturnKey > 0) && (
                <MaterialReturnList
                  incidentId={operation.id}
                  canEdit={canEdit}
                  refreshKey={materialReturnKey}
                />
              )}
            </div>

            {/* Right: the one thing that is written rather than reported. */}
            <div className={cn("space-y-5", !dense && "border-l border-border pl-6")}>
            {/* The Schadenplatz-Rapport itself, as a FULL editing surface: the KP
                must be able to file one for an incident that never had any field
                contact. Same form component /feld mounts, different transport. */}
            <SchadenplatzRapportSection
              incidentId={operation.id}
              canEdit={canEdit}
              boxed={false}
              hasRapport={operation.hasSchadenplatzRapport}
              // The release list lives in the left column, next to the rest of
              // what came in from the field — so the section must not render a
              // second copy, and has to say when it filed one.
              showMaterialReturn={false}
              onFiled={() => setMaterialReturnKey((key) => key + 1)}
              // Only when the detail was OPENED on this tab — from Offene
              // Rapporte or a notification, i.e. somebody was sent here to write
              // it. Clicking «Rapport» by hand leaves the cursor alone: stealing
              // focus from someone who came to read is its own bug.
              autoFocusKurzbericht={openOnTab?.tab === 'rapport'}
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
        {/* Every action on one row, no ⋯. The overflow menu had been reduced to
            «Löschen» (plus Divera where it is configured), i.e. a button behind a
            button — and in the 420px panel its content opened downwards into the
            board footer, where it was clipped.
            The panel has no room for four labelled controls, so there the icons
            stand alone and the label arrives ON HOVER — see `ActionBarButton`,
            which uses the app's tooltip rather than the browser's delayed
            `title`. Löschen is pushed to the far end by `ml-auto`, away from the
            things that are merely useful. */}
        <div className="flex-shrink-0 flex items-center gap-2 pt-3 mt-auto border-t">
          <ActionBarButton
            icon={MessageCircle}
            label={t('detail.copyWhatsapp')}
            visibleLabel={isCopyingWhatsApp ? t('common.copying') : undefined}
            dense={dense}
            disabled={isCopyingWhatsApp}
            onClick={handleCopyWhatsApp}
          />

          {canEdit && (
            <ActionBarButton
              icon={ArrowRightLeft}
              label={t('common.transferResources')}
              dense={dense}
              onClick={handleOpenTransfer}
            />
          )}

          {canEdit && onDistributeToAuftrag && (
            <ActionBarButton
              icon={Waypoints}
              label={t('common.distributeToAuftrag')}
              dense={dense}
              onClick={() => onDistributeToAuftrag(operation.id)}
            />
          )}

          {canEdit && diveraEnabled && onSendDivera && operation && (
            <ActionBarButton
              icon={Siren}
              label={t('detail.diveraAlarm')}
              dense={dense}
              onClick={() => onSendDivera(operation)}
            />
          )}

          {canEdit && onDelete && (
            <ActionBarButton
              icon={Trash2}
              label={t('common.delete')}
              // Always icon-only: it is the one control here nobody should reach
              // for by accident, and a red word invites the eye to it.
              dense
              variant="ghost"
              className="ml-auto text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => setShowDeleteConfirm(true)}
            />
          )}
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
        onAssigned={() => {
          // The dialog no longer closes itself on success — see `onAssigned`.
          setRekoDialogOpen(false)
          void refreshOperations()
        }}
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
