"use client"

/**
 * The operations board.
 *
 * Reached only by editors and admins: `ProtectedRoute` sends every `viewer` to
 * `/display/board` before this renders. The `isEditor` checks below are therefore
 * constant-true today — kept deliberately, see the note in
 * `components/protected-route.tsx` for why and for what actually enforces the role.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { useTranslations } from "next-intl"
import { useSearchParams, useRouter } from "next/navigation"
import { topLoading } from "@/components/ui/top-loading-bar"
import { LoadingStatus } from "@/components/ui/shell-loader"
import { SearchInput } from "@/components/ui/search-input"
import { EventClock } from "@/components/ui/event-clock"
import { Badge } from "@/components/ui/badge"
import { Plus, ChevronDown, CalendarDays, ChevronLeft, ChevronRight, PanelRight } from 'lucide-react'
import { materialResourceState, summarizeMaterials, summarizeRoster } from "@/lib/resource-status"
import { Kbd } from "@/components/ui/kbd"
import { ProtectedRoute } from "@/components/protected-route"
import { useBootGate } from "@/lib/boot-cover"
import { TrainingBand, TrainingBadge } from "@/components/training-mode-chrome"
import { PageNavigation } from "@/components/page-navigation"
import { toast } from "sonner"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useOperations, type Operation, type Material, type OperationStatus, type RekoSummary } from "@/lib/contexts/operations-context"
import { useGroups } from "@/lib/contexts/groups-context"
import { useReleaseUndo } from "@/lib/hooks/use-release-undo"
import { selectFiledRapports, selectOpenRapports } from "@/components/kanban/rapport-backlog-sheet"
import { selectMaterialOnSite } from "@/components/kanban/material-on-site-panel"
import { useMaterials } from "@/lib/contexts/materials-context"
import { usePersonnel } from "@/lib/contexts/personnel-context"
import { useEvent } from "@/lib/contexts/event-context"
import { apiClient, type GroupResourceType } from "@/lib/api-client"
import { useClosedStopGuard } from "@/lib/hooks/use-closed-stop-guard"
import { useRekoNotifications } from "@/lib/hooks/use-reko-notifications"
import { useNotifications } from "@/lib/contexts/notification-context"
import { useKanbanDragDrop } from "@/lib/hooks/use-kanban-drag-drop"
import type { DispatchCommand } from "@/lib/hooks/use-command-dispatch"
import type { DispatchResource, DispatchVocabulary } from "@/lib/command-dispatch"
import { useResourceFiltering } from "@/lib/hooks/use-resource-filtering"
import { useDoubleBookedPersons } from "@/lib/hooks/use-double-booked-persons"
import { usePersonEngagements } from "@/lib/hooks/use-person-engagements"
import { useIncidentHighlightListener } from "@/lib/hooks/use-incident-highlight-listener"
import type { IncidentHighlightOptions } from "@/lib/notification-highlight"
import { useCurrentTime } from "@/lib/hooks/use-current-time"
import { useGPrefixNavigation } from "@/lib/hooks/use-g-prefix-navigation"
import { useKanbanShortcuts } from "@/lib/hooks/use-kanban-shortcuts"
import { isDetailTab, type OperationDetailSection, type OperationDetailTab } from "@/lib/hooks/use-operation-detail-shortcuts"
import { useCommandPaletteHint } from "@/lib/hooks/use-is-mac"
import { usePrintJobToast } from "@/lib/hooks/use-print-job-toast"
import { useAuth } from "@/lib/contexts/auth-context"
import { useCommandPalette } from "@/lib/contexts/command-palette-context"
import { columns } from "@/lib/kanban-utils"
import { useToggleDriverStay } from "@/lib/hooks/use-driver-stay"
import { getIncidentRefLabel } from "@/lib/incident-types"
import { DroppableColumn } from "@/components/kanban/droppable-column"
import { useCardView } from "@/lib/card-view"
import { useIsMobile } from "@/components/ui/use-mobile"
import { useCrossWindowSync } from "@/lib/hooks/use-cross-window-sync"
import { EventSelectionEmptyState } from "@/components/empty-states/event-selection-empty-state"
import { BoardLoadErrorPanel } from "@/components/board-load-error"
import { SidePanel } from "@/components/kanban/side-panel"
import { SIDE_PANEL_BREAKPOINT } from "@/lib/layout-breakpoints"
import { boardDetailSurface, isPhoneViewport } from "@/lib/incident-detail"
import { useVehicleDrivers } from "@/lib/hooks/use-vehicle-drivers"
import { filterIncidents } from "@/lib/incident-search"
import { storeFieldNudgeConfirmation } from "@/components/kanban/field-status-nudge"
import { MobileIncidentListView } from "@/components/mobile/mobile-incident-list-view"
import type { ThermoPrintOptions } from "@/components/print/print-hub-sheet"
import type { Incident } from "@/lib/types/incidents"
import { useIncidentStatusWorkflow } from "@/components/kanban/incident-status-workflow"
import { cn } from "@/lib/utils"
import { useBoardLayoutPrefs } from "@/lib/hooks/use-board-layout-prefs"
import { isNavigableBinding, soleDestination, type BindingsPopoverState, type ResourceBinding } from "@/lib/board-sidebar"
import { PersonnelSidebar } from "@/components/board/personnel-sidebar"
import { MaterialSidebar } from "@/components/board/material-sidebar"
import { BoardFooter, type FooterSheet } from "@/components/board/board-footer"
import { BoardDialogs } from "@/components/board/board-dialogs"
import { useBoardDialogActions } from "@/components/board/use-board-dialog-actions"
import { useBoardDispatch } from "@/components/board/use-board-dispatch"
import { useResourceBindings } from "@/components/board/use-resource-bindings"
import { useBoardChecklist } from "@/components/board/use-board-checklist"
import { useBoardCommandHandlers } from "@/components/board/use-board-command-handlers"
import { useBoardCardActions } from "@/components/board/use-board-card-actions"

export default function FireStationDashboard() {
  const {
    personnel: rosterPersonnel,
    materials,
    operations,
    setOperations,
    formatLocation,
    refreshOperations,
    removeCrew,
    removeMaterial,
    removeVehicle,
    removeReko,
    updateOperation,
    reorderColumn,
    changeStatusToTop,
    setBoardDragging,
    createOperation,
    mergeOperationInto,
    assignPersonToOperation,
    assignRekoPersonToOperation,
    assignMaterialToOperation,
    assignVehicleToOperation,
    requestResourceConflict,
    resourceConflict,
    vehicleNeedingDriver,
    isAssignmentSettling,
    vehicles: fleet,
    outOfServiceVehicleIds,
    deleteOperation,
    materialOnSite,
    isLoading,
    isLoaded,
    boardNeverLoaded,
  } = useOperations()
  // The board's roster is "everybody checked in", so the Appell writing an
  // attendance row changes it — see `onAttendanceChange` on the modal below.
  const { refreshPersonnel } = usePersonnel()
  const {
    groups,
    addStops: addStopsToGroup,
    assignResource: assignGroupResource,
    unassignResource: unassignGroupResource,
    getGroupResources,
    createGroup,
    occupiedResourceIds,
  } = useGroups()
  // The operator's own releases (card chips, detail panel, shortcut toggle) get
  // «… gelöst · Rückgängig»; internal releases keep the raw context functions.
  const release = useReleaseUndo()
  // ⌘K type-to-dispatch, registered with the palette early and filled in below
  // where the bindings and drop wrappers it needs exist (see «Type-to-dispatch»).
  const dispatchRef = useRef<{
    vocabulary: () => DispatchVocabulary
    run: (command: DispatchCommand) => void
    jump: (target: DispatchResource) => void
  }>({ vocabulary: () => ({ incidents: [], persons: [], vehicles: [], materials: [] }), run: () => {}, jump: () => {} })

  /**
   * The roster the board draws, with «steht auf einem Auftrag» folded in.
   *
   * This is the ONE place that can: a route's crew is held on the group, and
   * `GroupsProvider` sits inside `OperationsProvider`, so the event-scoped
   * reconciliation that produces `status` never sees a group assignment. Without
   * this, a Sturm route with five people on it left all five drawn emerald in the
   * sidebar and counted in «verfügbar» over it — the same bug `isReko` was given
   * `personResourceState` to fix, one source of assignment later.
   */
  const personnel = useMemo(
    () =>
      rosterPersonnel.map((person) =>
        occupiedResourceIds.personnel.has(person.id) ? { ...person, isOnAuftrag: true } : person,
      ),
    [rosterPersonnel, occupiedResourceIds],
  )

  // Attaching an already-closed incident as a stop is allowed, but never silent.
  const closedStopGuard = useClosedStopGuard(operations)

  // Keep the top progress bar visible for the whole pre-ready window — auth
  // check, event resolution and the first data load — so there's never a blank
  // gap without feedback and never a premature empty state before content lands.
  useEffect(() => {
    if (isLoaded) return
    topLoading.start()
    return () => topLoading.done()
  }, [isLoaded])

  // Distinct PLACES, not just crew rows: an Auftrag membership and the
  // whereabouts of a driven vehicle both commit a person — the Fahrer who was
  // also on an Auftrag used to stand double-committed with no warning.
  const groupEngagements = useMemo(
    () =>
      groups.map((group) => {
        const resources = getGroupResources(group.id)
        return {
          id: group.id,
          personnelNames: resources.personnel.map((p) => p.name),
          vehicleNames: resources.vehicles.map((v) => v.name),
        }
      }),
    [groups, getGroupResources],
  )
  const driverEngagements = useMemo(
    () =>
      personnel
        .filter((person) => person.isDriver && person.driverVehicleName)
        .map((person) => ({ name: person.name, vehicleName: person.driverVehicleName! })),
    [personnel],
  )
  const doubleBookedPersons = useDoubleBookedPersons(operations, groupEngagements, driverEngagements)
  // Where each person actually is, for the sidebar card's tooltip (§P3.5) —
  // computed once here, passed down, so the memoized cards stay cheap.
  const personEngagements = usePersonEngagements()

  const { materialGroups, setMaterialOutOfService } = useMaterials()
  const { selectedEvent, isEventLoaded, events, setSelectedEvent } = useEvent()
  const { isEditor, isAuthenticated } = useAuth()
  const { toggleSidebar: toggleNotificationSidebar, registerNavigateHandler, registerFieldActionHandler, registerAssignHandler, closeSidebar: closeNotificationSidebar, settings: notificationSettings } = useNotifications()
  // «Personalermüdung (Std.)» — where the crew's time-on-duty figures turn amber.
  const fatigueHours = notificationSettings.fatigue_hours
  const { registerHandlers, clearHandlers } = useCommandPalette()
  const searchParams = useSearchParams()
  const router = useRouter()
  const highlightParam = searchParams.get("highlight")
  const openDetailParam = searchParams.get("detail") === "1"
  // Which detail tab the deep link meant («Angekommen» clicked away from the
  // board lands on Rapport, not Übersicht). Unknown values fall back to none.
  const rawTabParam = searchParams.get("tab")
  const tabParam = isDetailTab(rawTabParam) ? rawTabParam : undefined
  const isMobile = useIsMobile()

  const tCommon = useTranslations('kanban.common')
  const tDash = useTranslations('kanban.dashboard')
  const tRes = useTranslations('kanban.resources')
  const tPrint = useTranslations('print.toasts')
  const tSidePanel = useTranslations('kanban.sidePanel')
  const trackPrint = usePrintJobToast()

  // Ref for highlight timeout cleanup
  const highlightTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const spotlightTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  // Render-time mirrors for `scrollToCard`, which stays dependency-free: the
  // operations list (to find the card's column) and the column expander
  // (declared further down, next to the other board-layout state).
  const operationsRef = useRef(operations)
  operationsRef.current = operations
  const expandColumnRef = useRef<(id: string) => void>(() => {})
  // Spotlight: for the first moment of a highlight the REST of the board steps
  // back instead of the card shouting. It is a separate, shorter window than the
  // highlight itself — the dim lifts, the accent ring stays for the remainder.
  const [spotlightActive, setSpotlightActive] = useState(false)

  // Scroll to and highlight a card by operation ID
  const scrollToCard = useCallback((operationId: string) => {
    // Unfold the card's column FIRST: a spotlight inside a folded column is a
    // spotlight nobody sees — the card is not even in the DOM to scroll to.
    // Refs, not deps: this callback stays stable while operations churn.
    const op = operationsRef.current.find((candidate) => candidate.id === operationId)
    if (op) expandColumnRef.current(op.status)

    // Clear any existing highlight timeout
    if (highlightTimeoutRef.current) {
      clearTimeout(highlightTimeoutRef.current)
    }
    if (spotlightTimeoutRef.current) {
      clearTimeout(spotlightTimeoutRef.current)
    }

    // Set highlight immediately
    setHighlightedOperationId(operationId)
    setSpotlightActive(true)

    spotlightTimeoutRef.current = setTimeout(() => {
      setSpotlightActive(false)
    }, 1200)

    // Clear highlight after 3 seconds
    highlightTimeoutRef.current = setTimeout(() => {
      setHighlightedOperationId(null)
    }, 3000)

    // Scroll after short delay for DOM readiness
    setTimeout(() => {
      const card = document.querySelector(`[data-incident-id="${operationId}"]`) as HTMLElement
      if (!card) return

      const mainContainer = document.getElementById('kanban-main')
      const column = card.closest('[data-column]') as HTMLElement

      if (mainContainer && column) {
        const columnsContainer = mainContainer.querySelector('.flex.h-full') as HTMLElement
        if (columnsContainer) {
          // Calculate column position
          let columnLeft = 0
          const columns = columnsContainer.children
          for (let i = 0; i < columns.length; i++) {
            if (columns[i] === column) break
            columnLeft += (columns[i] as HTMLElement).offsetWidth + 12 // 12px = gap-3
          }

          const columnWidth = column.offsetWidth
          const containerWidth = mainContainer.clientWidth
          const scrollLeft = columnLeft - (containerWidth / 2) + (columnWidth / 2)

          // Centring is right until the column cannot be centred — the first and
          // last columns clamp to an edge, and there the card ends up flush
          // against it with its highlight ring half cut off. A gutter costs
          // nothing when the column really is centred (the clamp never bites).
          const EDGE_GUTTER = 16
          const maxScroll = Math.max(0, mainContainer.scrollWidth - containerWidth)
          const gutteredLeft = Math.min(
            Math.max(scrollLeft, columnLeft + columnWidth + EDGE_GUTTER - containerWidth),
            columnLeft - EDGE_GUTTER,
          )

          mainContainer.scrollTo({
            left: Math.min(Math.max(0, gutteredLeft), maxScroll),
            behavior: 'smooth'
          })
        }
      }

      // Vertical scroll after horizontal completes
      setTimeout(() => {
        card.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
          inline: 'nearest'
        })
      }, 300)
    }, 100)
  }, [])

  // Update operation REKO summary when new report arrives
  const handleUpdateOperationReko = useCallback((incidentId: string, rekoSummary: RekoSummary) => {
    setOperations(prev => prev.map(op => {
      if (op.id !== incidentId) return op
      const updates: Partial<Operation> = { hasCompletedReko: true, rekoSummary }
      // Auto-transition reko → reko_done when reko form is submitted
      if (op.status === "reko") {
        updates.status = "reko_done"
        updates.statusChangedAt = new Date()
      }
      return { ...op, ...updates }
    }))
  }, [setOperations])

  // The header clock ticks inside <EventClock/> now; this is only the mount flag
  // the rest of the board hangs SSR-sensitive rendering off.
  const { isMounted } = useCurrentTime()
  // A launch onto the board stays behind the snail (components/boot-cover.tsx) until the
  // board's first load is in — incidents, crew and material in one go — or there is no
  // Ereignis to load. No «Wird geladen …» and no top bar under it on a launch.
  const tBoot = useTranslations('common.bootScreen')
  useBootGate('board', isMounted && isEventLoaded && isLoaded, tBoot('loadingBoard'))
  const [searchQuery, setSearchQuery] = useState("")
  const [personnelSearchQuery, setPersonnelSearchQuery] = useState("")
  const [materialSearchQuery, setMaterialSearchQuery] = useState("")
  // Sidebar "nur verfügbare" toggles. Per-list on purpose: crew and material are
  // picked at different moments, so one shared switch would keep surprising the
  // other list.
  const [personnelAvailableOnly, setPersonnelAvailableOnly] = useState(false)
  const [materialsAvailableOnly, setMaterialsAvailableOnly] = useState(false)
  const [selectedOperationId, setSelectedOperationId] = useState<string | null>(null)
  const [detailModalOpen, setDetailModalOpen] = useState(false)
  // Derive current operation from operations array to get real-time updates
  const selectedOperation = useMemo(() => {
    if (!selectedOperationId) return null
    return operations.find(op => op.id === selectedOperationId) || null
  }, [selectedOperationId, operations])
  const [newEmergencyModalOpen, setNewEmergencyModalOpen] = useState(false)
  const [hoveredOperationId, setHoveredOperationId] = useState<string | null>(null)
  const [highlightedOperationId, setHighlightedOperationId] = useState<string | null>(null)
  // Both sidebars and the detail panel, remembered per device.
  const {
    sidePanelMode,
    setSidePanelMode,
    showLeftSidebar,
    setShowLeftSidebar,
    showRightSidebar,
    setShowRightSidebar,
  } = useBoardLayoutPrefs(isMobile)
  // "Open the detail on THIS tab" — set by whoever pointed at one specific
  // thing: a notification, the Rapport-Backlog, or a click on one BLOCK of a
  // kanban card (its Reko part, its resource rows). A click on the card as a
  // whole names no tab, clears this, and lands on the tab the operator was last
  // working in. The nonce makes a repeat click a new event; the panel does not
  // remount for an incident that is already selected.
  const [openDetailOnTab, setOpenDetailOnTab] = useState<{ tab: OperationDetailTab; nonce: number; section?: OperationDetailSection } | null>(null)

  /** `section` narrows the landing further than the tab does — today only
   *  Übersicht's Ressourcen block, which the panel has to scroll to. */
  // The phone list's «open this sheet» request (see openIncidentDetail).
  const [mobileOpenRequest, setMobileOpenRequest] = useState<{ incidentId: string; nonce: number } | null>(null)
  const openIncidentDetail = useCallback((
    operationId: string,
    tab?: OperationDetailTab,
    section?: OperationDetailSection,
    { allowModal = true }: { allowModal?: boolean } = {},
  ) => {
    setOpenDetailOnTab(tab ? { tab, nonce: Date.now(), section } : null)
    setSelectedOperationId(operationId)
    setHoveredOperationId(operationId)
    // Narrow viewport: only a notification earns an overlay. A sidebar binding would bury the
    // list the operator is working through, and its answer — «this device is on THAT card» — is
    // the ring, not a modal. On a phone the overlay is the phone Einsatz sheet, never the
    // desktop modal (lib/incident-detail.ts).
    const surface = boardDetailSurface({
      phone: isPhoneViewport(),
      wide: typeof window !== 'undefined' && window.innerWidth >= SIDE_PANEL_BREAKPOINT,
      allowModal,
    })
    if (surface === 'side-panel') {
      setDetailModalOpen(false)
      setSidePanelMode('detail')
    } else if (surface === 'phone-sheet') {
      setMobileOpenRequest({ incidentId: operationId, nonce: Date.now() })
    } else if (surface === 'modal') {
      setDetailModalOpen(true)
    }
    // `setSidePanelMode` comes from `usePersistedState`; it is the plain
    // `useState` setter and therefore stable, but eslint cannot see that.
  }, [setSidePanelMode])

  const handleOpenIncidentFromNotification = useCallback((incidentId: string) => {
    if (operations.some((operation) => operation.id === incidentId)) openIncidentDetail(incidentId)
  }, [openIncidentDetail, operations])

  // Anything that points at a card — a notification row, a device or person
  // binding in the sidebar — scrolls to it, rings it AND opens its detail. A ring
  // on its own was half an answer: the operator clicked the thing in order to
  // look at it, then had to open the detail by hand. On the desktop that always
  // means the side panel beside the board; `allowModal` decides only what a
  // narrow viewport does, and only a notification may take over the screen
  // (see notification-highlight.ts). A caller that named a tab lands on it;
  // one that did not gets the tab that card was last left on.
  useIncidentHighlightListener(
    useCallback(
      (incidentId: string, { tab, allowModal }: IncidentHighlightOptions) => {
        scrollToCard(incidentId)
        openIncidentDetail(incidentId, tab, undefined, { allowModal })
      },
      [scrollToCard, openIncidentDetail],
    ),
  )

  useRekoNotifications(handleOpenIncidentFromNotification, handleUpdateOperationReko)
  const [vehicleTypes, setVehicleTypes] = useState<Array<{ key: string; name: string; id: string; type: string; status: string }>>([])
  // Single state for footer sheets - only one can be open at a time
  // `'print'` is the one print/export sheet: thermal slip, A4 status print and
  // per-event file export live in it together (`PrintHubSheet`).
  const [activeFooterSheet, setActiveFooterSheet] = useState<FooterSheet | null>(null)
  // When the Aufträge sheet is opened from a board chip, expand/scroll to this group.
  const [auftraegeFocusGroupId, setAuftraegeFocusGroupId] = useState<string | null>(null)
  // Which sidebar row is currently showing its bindings, or null. One at a time
  // — the popover answers «wo ist die Person gerade?», and two answers at once
  // would be two questions.
  const [bindingsPopover, setBindingsPopover] = useState<BindingsPopoverState | null>(null)
  // When "+ Stop" opens the New-Emergency modal, the created incident attaches here.
  const [newEmergencyGroupId, setNewEmergencyGroupId] = useState<string | null>(null)
  // Routen-Editor modal: the Auftrag being edited + an optional stop to centre on.
  const [routenEditorGroupId, setRoutenEditorGroupId] = useState<string | null>(null)
  const [routenEditorFocusIncidentId, setRoutenEditorFocusIncidentId] = useState<string | null>(null)
  // "+ Stop" incident picker: the route existing incidents are added to as stops.
  const [stopPickerGroupId, setStopPickerGroupId] = useState<string | null>(null)
  // "An Auftrag verteilen" picker: the incident being distributed into a route.
  const [auftragPickerIncidentId, setAuftragPickerIncidentId] = useState<string | null>(null)
  // The ask-first for the two distribute moves without an undo: transferring a
  // stop out of another Auftrag, or folding a disponierter Einsatz into one.
  const [distributeConfirm, setDistributeConfirm] = useState<{
    groupId: string
    incidentId: string
    incidentLabel: string
    fromName: string | null
    dispatched: boolean
  } | null>(null)
  // Route-level resource assign: when set, the assignment dialog is scoped to the
  // ROUTE (Auftrag) rather than a single incident — assign/remove hit the group.
  const [routeAssign, setRouteAssign] = useState<{ groupId: string; resourceType: 'crew' | 'vehicles' | 'materials' } | null>(null)
  const [checkInUrl, setCheckInUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  // The Appell. Not a ninth footer sheet and not a tab inside the shared QR body — it is
  // opened from the check-in sheet's Anwesenheit row, and opening it closes that sheet.
  const [attendanceOpen, setAttendanceOpen] = useState(false)
  /** Body of the Divera-Mitteilung the Checkliste asked to send; null = closed. */
  const [diveraMessageText, setDiveraMessageText] = useState<string | null>(null)
  /** The Checkliste's «Reko-Offiziere wählen» picker. Page-owned like the Divera
   *  dialog — a modal mounted inside the checklist popover dies with it. */
  const [rekoPickerOpen, setRekoPickerOpen] = useState(false)

  // Auto-generate check-in QR code URL when no personnel are available
  useEffect(() => {
    if (!selectedEvent || checkInUrl || isLoading) return
    if (personnel.filter((p) => p.status === "available").length > 0) return
    apiClient.generateCheckInLink(selectedEvent.id).then((response) => {
      setCheckInUrl(`${window.location.origin}${response.link}`)
    }).catch(() => {})
  }, [selectedEvent, personnel, checkInUrl, isLoading])

  const gPrefix = useGPrefixNavigation(router, '/')
  const cmdHint = useCommandPaletteHint()
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [operationToDelete, setOperationToDelete] = useState<Operation | null>(null)
  // What the cards show. Per device (localStorage), not a station setting: one
  // workstation must be able to run Kompakt while the second screen runs Alles,
  // without either operator's click repainting the other's board mid-Einsatz.
  // The store keeps one stable object per value, so `cardView` can go straight
  // into the memoised column/card tree without a useMemo wrapper here.
  const { view: cardView, preset: cardViewPreset, applyPreset: applyCardViewPreset, toggleKey: toggleCardViewKey } = useCardView()
  // One global /feld link per Ereignis — the poster in the vehicle hall, not a
  // link per incident or per vehicle (plan 25, decision 1).
  const [mobilePersonnelSheetOpen, setMobilePersonnelSheetOpen] = useState(false)
  const [diveraDialogOp, setDiveraDialogOp] = useState<Operation | null>(null)
  // These dialogs hold a snapshot of the operation; derive the LIVE operation so a
  // resource assigned while the dialog is open (e.g. via the missing-resources
  // "Zuweisen" flow) shows up in the radio text and Divera recipients instead of
  // a stale "keine Person zugewiesen".
  const diveraDialogOpLive = useMemo(
    () => (diveraDialogOp ? operations.find(o => o.id === diveraDialogOp.id) ?? diveraDialogOp : null),
    [diveraDialogOp, operations]
  )
  // Resource transfer ("Ressourcen übertragen") opened from the card context menu.
  const [transferSourceOp, setTransferSourceOp] = useState<Operation | null>(null)
  const [transferAvailableIncidents, setTransferAvailableIncidents] = useState<Incident[]>([])
  const [isTransferring, setIsTransferring] = useState(false)
  const toggleDriverStay = useToggleDriverStay()

  const statusWorkflow = useIncidentStatusWorkflow({
    operations,
    materials,
    groups,
    changeStatusToTop,
    getGroupResources,
    removeMaterial,
    unassignGroupResource,
  })
  const {
    requestStatusChange,
    requestCompletion,
    triggerDisponiertDialog,
    triggerReturningVehicleCheck,
    triggerRekoCheck,
    triggerRekoFormCheck,
    promptMaterialDecision,
  } = statusWorkflow

  // Cross-window sync (bidirectional)
  const { broadcast } = useCrossWindowSync({
    onMessage: (msg) => {
      if (msg.type === "incident:selected" && msg.incidentId) {
        setSelectedOperationId(msg.incidentId)
        setHighlightedOperationId(msg.incidentId)
      }
    },
  })

  useEffect(() => {
    const handleResize = () => {
      // A phone has neither panel nor modal: its detail is the phone Einsatz sheet. Without this
      // a resize (the iOS URL bar collapsing, a rotation) promoted a remembered side-panel
      // detail into the desktop modal over the phone list.
      if (!selectedOperationId || isPhoneViewport()) return
      const usePanel = window.innerWidth >= SIDE_PANEL_BREAKPOINT
      if (usePanel && detailModalOpen) {
        setDetailModalOpen(false)
        setSidePanelMode('detail')
      } else if (!usePanel && sidePanelMode === 'detail' && !detailModalOpen) {
        setDetailModalOpen(true)
      }
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [detailModalOpen, selectedOperationId, sidePanelMode, setSidePanelMode])
  // Anything that moves the open card, or moves the board around it, must not
  // lose it: toggling a sidebar or the panel re-lays the board out, and
  // «Status ändern» drops the card into a different column — often one that is
  // scrolled off the right-hand edge. Bring it back. Quietly: no highlight, no
  // spotlight. This is not «look here», it is «stay where you were».
  const selectedStatus = selectedOperation?.status
  useEffect(() => {
    if (!selectedOperationId) return
    const timer = setTimeout(() => {
      document
        .querySelector(`[data-incident-id="${selectedOperationId}"]`)
        ?.scrollIntoView({ behavior: "smooth", inline: "nearest", block: "nearest" })
    }, 220)
    return () => clearTimeout(timer)
  }, [sidePanelMode, showLeftSidebar, showRightSidebar, selectedOperationId, selectedStatus])

  // Register notification click → scroll to card + open detail
  // Small screens: open modal overlay. Large screens (≥1536px): select in side panel.
  useEffect(() => {
    registerNavigateHandler((incidentId: string, tab?: OperationDetailTab) => {
      closeNotificationSidebar()
      scrollToCard(incidentId)
      // Open detail after scroll
      setTimeout(() => {
        const operation = operations.find(op => op.id === incidentId)
        if (operation) {
          // `tab` is what the notification was about (§18.27) — a rapport, a
          // Meldung, an arrival all live on Rapport now, and landing on
          // Übersicht made the operator hunt for the thing they were just told
          // about. Same call on both screen sizes; the detail decides whether
          // it renders as a modal or in the panel.
          openIncidentDetail(incidentId, tab)
        }
      }, 200)
    })
    return () => registerNavigateHandler(null)
  }, [registerNavigateHandler, closeNotificationSidebar, scrollToCard, operations, openIncidentDetail])

  // «Angekommen» / «Einsatz beendet» answered straight from the bell, without
  // finding the card first. It has to be the SAME move the card's own nudge
  // makes, and for a while it was not: this one ran `requestCompletion`, i.e.
  // the whole completion flow down to *Abgeschlossen*, while the nudge on the
  // card moved to *Beendet / Rückfahrt* and stopped. Two buttons that ask the
  // same question and answer it differently is worse than either answer — and
  // the nudge's is the right one (see `field-status-nudge.tsx`): a crew that
  // has packed up is not a Schadenplatz the KP has closed.
  useEffect(() => {
    if (!isEditor) return
    registerFieldActionHandler((incidentId, kind) => {
      storeFieldNudgeConfirmation(incidentId, kind)
      changeStatusToTop(incidentId, kind === "complete" ? "returning" : "active")
    })
    return () => registerFieldActionHandler(null)
  }, [isEditor, registerFieldActionHandler, changeStatusToTop])

  // Resource assignment dialog state
  const [assignmentDialogOpen, setAssignmentDialogOpen] = useState(false)
  const [assignmentResourceType, setAssignmentResourceType] = useState<'crew' | 'vehicles' | 'materials' | null>(null)
  const [assignmentOperationId, setAssignmentOperationId] = useState<string | null>(null)
  const [assignmentInitialSearch, setAssignmentInitialSearch] = useState<string | undefined>(undefined)
  const [rekoPersonnelNames, setRekoPersonnelNames] = useState<string[]>([])

  // Reko assignment dialog state (context menu)
  const [rekoAssignDialogOpen, setRekoAssignDialogOpen] = useState(false)
  const [rekoAssignOperationId, setRekoAssignOperationId] = useState<string | null>(null)

  // Who drives what, for the whole board. One roster call here rather than one
  // per card; the cards render the driver next to the Funkrufname.
  const vehicleDrivers = useVehicleDrivers(selectedEvent?.id ?? null)

  // Thermal printer state
  const [printerEnabled, setPrinterEnabled] = useState(false)
  const [diveraEnabled, setDiveraEnabled] = useState(false)
  const [isPrintingBoard, setIsPrintingBoard] = useState(false)
  const [funkrufname, setFunkrufname] = useState("Omega")

  // Fetch Reko personnel names when the crew assignment dialog opens
  // These personnel should be excluded from regular crew assignment (they're Reko only)
  useEffect(() => {
    async function fetchRekoPersonnel() {
      if (!assignmentDialogOpen || assignmentResourceType !== 'crew' || !selectedEvent) {
        setRekoPersonnelNames([])
        return
      }

      try {
        const specialFunctions = await apiClient.getEventSpecialFunctions(selectedEvent.id)
        const rekoFunctions = specialFunctions.filter(f => f.function_type === 'reko')
        const names = rekoFunctions
          .map(f => {
            const person = personnel.find(p => p.id === f.personnel_id)
            return person?.name
          })
          .filter((name): name is string => name !== undefined)
        setRekoPersonnelNames(names)
      } catch (error) {
        console.error('Failed to fetch Reko personnel:', error)
        setRekoPersonnelNames([])
      }
    }

    fetchRekoPersonnel()
  }, [assignmentDialogOpen, assignmentResourceType, selectedEvent, personnel])


  // Fetch printer status and settings once authenticated
  useEffect(() => {
    if (!isAuthenticated) return
    async function fetchPrinterStatus() {
      try {
        const status = await apiClient.getPrinterStatus()
        // Both, like the Divera check below: switched on AND an address the agent can
        // reach. On `enabled` alone the print buttons rendered for a station that had
        // never entered an IP — the job was accepted, queued, and never came out.
        setPrinterEnabled(status.enabled && Boolean(status.ip?.trim()))
      } catch {
        // Printer API might not be available (e.g., Railway deployment)
        setPrinterEnabled(false)
      }
    }
    async function fetchFunkrufname() {
      try {
        const settings = await apiClient.getAllSettings()
        if (settings.funkrufname) setFunkrufname(settings.funkrufname)
        // The send button needs both the setting AND a configured access key —
        // otherwise it would render and then 400 on send.
        if (settings['divera.alarm_enabled'] === 'true') {
          try {
            const status = await apiClient.getDiveraPollingStatus()
            setDiveraEnabled(status.configured === true)
          } catch {
            // Status endpoint unavailable — keep the old behavior (setting only)
            setDiveraEnabled(true)
          }
        } else {
          setDiveraEnabled(false)
        }
      } catch { /* ignore */ }
    }
    fetchPrinterStatus()
    fetchFunkrufname()
  }, [isAuthenticated])

  // Handle thermal board print
  const handlePrintBoard = useCallback(async (options?: ThermoPrintOptions) => {
    if (!selectedEvent || isPrintingBoard) return
    setIsPrintingBoard(true)
    try {
      const job = await apiClient.queueBoardPrint(selectedEvent.id, options ? {
        include_incidents: options.includeIncidents,
        include_completed: options.includeCompleted,
        include_vehicles: options.includeVehicles,
        include_personnel: options.includePersonnel,
      } : undefined)
      trackPrint(job.id, { sentTitle: tDash('boardPrintSent'), subject: tPrint('subjectBoard') })
      setActiveFooterSheet(null)
    } catch {
      toast.error(tCommon('printFailed'))
    } finally {
      setIsPrintingBoard(false)
    }
  }, [selectedEvent, isPrintingBoard, tCommon, tDash, tPrint, trackPrint])

  // QR-slip printing lives in the Links & QR sheet (and the Checkliste), which
  // queue the job themselves — the page no longer owns a print handler for it.

  // Use ref to track drag state more reliably
  const isDraggingOperationRef = useRef(false)

  const {
    setRouteStopStatus,
    collapsedColumns,
    handleColumnSort,
    handleOpenTransfer,
    handleTransfer,
    moveOperationRight,
    moveOperationLeft,
    toggleVehicleAssignment,
    setOperationPriority,
    toggleZuFuss,
    handleToggleDriverStay,
    handleRequestDelete,
    assignVehicleToGroupWithConflict,
    groupsHolding,
    releaseFromGroups,
    assignVehicleToIncidentWithConflict,
    askRouteConflict,
  } = useBoardCardActions({
    requestResourceConflict,
    operations,
    updateOperation,
    setOperations,
    reorderColumn,
    removeVehicle,
    assignVehicleToOperation,
    groups,
    unassignGroupResource,
    assignGroupResource,
    getGroupResources,
    release,
    selectedEvent,
    expandColumnRef,
    vehicleTypes,
    setDeleteDialogOpen,
    setOperationToDelete,
    setTransferSourceOp,
    transferSourceOp,
    setTransferAvailableIncidents,
    setIsTransferring,
    toggleDriverStay,
    triggerRekoFormCheck,
    triggerRekoCheck,
    promptMaterialDecision,
    triggerReturningVehicleCheck,
    triggerDisponiertDialog,
    requestStatusChange,
  })

  useBoardCommandHandlers({
    fleet,
    operations,
    materials,
    refreshOperations,
    outOfServiceVehicleIds,
    dispatchRef,
    personnel,
    isEditor,
    toggleNotificationSidebar,
    clearHandlers,
    registerHandlers,
    router,
    scrollToCard,
    selectedOperationId,
    setNewEmergencyModalOpen,
    setShowRightSidebar,
    setSidePanelMode,
    setShowLeftSidebar,
    openIncidentDetail,
    vehicleTypes,
    setActiveFooterSheet,
    setAuftraegeFocusGroupId,
    moveOperationRight,
    moveOperationLeft,
    toggleVehicleAssignment,
    setOperationPriority,
    toggleZuFuss,
    handleRequestDelete,
  })

  // Show empty state if no event is selected (removed automatic redirect)
  // useEffect(() => {
  //   if (isMounted && isEventLoaded && !selectedEvent) {
  //     router.push('/events')
  //   }
  // }, [isMounted, isEventLoaded, selectedEvent, router])

  const {
    checklistPopoverOpen,
    setChecklistOverridesVersion,
    handleChecklistOpenChange,
    checklistProgress,
  } = useBoardChecklist({
    selectedEvent,
    isMounted,
  })

  // Load vehicles from API to populate vehicle types for shortcuts
  useEffect(() => {
    const loadVehicles = async () => {
      try {
        const vehicles = await apiClient.getVehicles()
        // Sort vehicles by display_order and create vehicle types array with keyboard shortcuts
        const sortedVehicles = vehicles.sort((a, b) => a.display_order - b.display_order)
        const typesWithKeys = sortedVehicles.map((vehicle) => ({
          key: String(vehicle.display_order),
          name: vehicle.name,
          id: vehicle.id,
          type: vehicle.type,
          // The sidebar's Fahrzeuge section draws «nicht einsatzbereit» off this.
          status: vehicle.status,
        }))
        setVehicleTypes(typesWithKeys)
      } catch {
        // Silently fail - vehicles will load when backend is ready
      }
    }
    loadVehicles()
  }, [])

  // Refresh operations immediately when Kanban page loads
  useEffect(() => {
    refreshOperations()
  }, [])


  // Scroll to and highlight operation when navigating with ?highlight= param.
  // With `&detail=1` the card is also OPENED — that is the Karte page's
  // «Details anzeigen» arriving here: the incident detail lives on the board,
  // in the panel next to the columns, and a second copy of it over the map was
  // a second place to keep in step.
  useEffect(() => {
    if (highlightParam) {
      scrollToCard(highlightParam)
      if (openDetailParam) openIncidentDetail(highlightParam, tabParam)
      // Clear the URL param to prevent re-scroll on refresh
      router.replace('/', { scroll: false })
    }
  }, [highlightParam, openDetailParam, tabParam, scrollToCard, openIncidentDetail, router])

  useKanbanShortcuts(
    {
      modalOpen:
        detailModalOpen ||
        newEmergencyModalOpen ||
        assignmentDialogOpen ||
        // Vehicle, Aufträge, Drucken, Links, Rapporte, Tagebuch and Kennzahlen footers are non-modal
        // on desktop: keep their toggle keys (F / A / D / T / O / J / Z) able to close
        // them again. Every other shortcut still stops at an open sheet — it is
        // only the key that opened this one that stays live.
        (!!activeFooterSheet &&
          activeFooterSheet !== 'vehicles' &&
          activeFooterSheet !== 'auftraege' &&
          activeFooterSheet !== 'print' &&
          activeFooterSheet !== 'links' &&
          activeFooterSheet !== 'rapporte' &&
          activeFooterSheet !== 'journal' &&
          activeFooterSheet !== 'figures') ||
        deleteDialogOpen,
      hoveredOperationId,
      selectedOperationId,
      operations,
      vehicleTypes,
      gPrefix,
    },
    {
      onToggleVehicle: (vehicle, opId) => {
        // Recompute the target (route vs incident) from the operation — the
        // hook's `isAssigned` reflects only incident-level vehicles, which are
        // always empty on a grouped card.
        const operation = operations.find((op) => op.id === opId)
        if (operation) toggleVehicleAssignment(operation, vehicle)
      },
      // The only update a shortcut applies is the priority, and it toasts —
      // see `setOperationPriority`.
      onUpdateOperation: (opId, updates) => {
        if (updates.priority) setOperationPriority(opId, updates.priority)
        else updateOperation(opId, updates)
      },
      onMoveRight: moveOperationRight,
      onMoveLeft: moveOperationLeft,
      onToggleZuFuss: toggleZuFuss,
      onRefresh: refreshOperations,
      onOpenDetail: (op) => {
        openIncidentDetail(op.id)
      },
      onRequestDelete: (op) => handleRequestDelete(op.id),
      onOpenNewEmergency: () => setNewEmergencyModalOpen(true),
      onFocusSearch: () => document.getElementById('search-input')?.focus(),
      onFocusPersonnel: () => {
        setShowLeftSidebar(true)
        setTimeout(() => document.getElementById('personnel-search-input')?.focus(), 50)
      },
      onFocusMaterial: () => {
        setShowRightSidebar(true)
        setTimeout(() => document.getElementById('material-search-input')?.focus(), 50)
      },
      onToggleVehicleFooter: () =>
        setActiveFooterSheet((prev) => (prev === 'vehicles' ? null : 'vehicles')),
      onToggleAuftraege: () =>
        setActiveFooterSheet((prev) => {
          if (prev === 'auftraege') return null
          setAuftraegeFocusGroupId(null)
          return 'auftraege'
        }),
      onToggleLeftSidebar: () => setShowLeftSidebar((prev) => !prev),
      onToggleRightSidebar: () => setShowRightSidebar((prev) => !prev),
      onToggleSidePanel: () =>
        setSidePanelMode((prev) => (prev === 'collapsed' ? 'detail' : 'collapsed')),
      onSidePanelDetail: () => setSidePanelMode('detail'),
      onSidePanelMap: () => router.push(selectedOperationId ? `/map?highlight=${selectedOperationId}` : '/map'),
      onTogglePrint: () => setActiveFooterSheet((prev) => (prev === 'print' ? null : 'print')),
      onToggleLinks: () => setActiveFooterSheet((prev) => (prev === 'links' ? null : 'links')),
      onToggleRapporte: () => setActiveFooterSheet((prev) => (prev === 'rapporte' ? null : 'rapporte')),
      onToggleJournal: () => setActiveFooterSheet((prev) => (prev === 'journal' ? null : 'journal')),
      onToggleFigures: () => setActiveFooterSheet((prev) => (prev === 'figures' ? null : 'figures')),
      onToggleNotifications: toggleNotificationSidebar,
    },
  )

  // The highlight timer is cleaned up by its own scrollToCard effect; nothing else to do here.
  useEffect(() => {
    return () => {
      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current)
      }
      if (spotlightTimeoutRef.current) {
        clearTimeout(spotlightTimeoutRef.current)
      }
    }
  }, [])

  // The board's conflict-aware assigns — what a DROP onto a card or an Auftrag
  // calls. ⌘K's type-to-dispatch goes through the very same functions
  // (`applyResourceDrop` below), so a typed «14 meier» asks exactly what
  // dragging Meier onto Einsatz 14 asks.
  //
  // Person/Material onto an INCIDENT: if a route already holds them, ask the
  // same Doppelbelegung question vehicles have always asked instead of
  // refusing the drop outright.
  const boardAssignPerson = (personId: string, personName: string, operationId: string) => {
    const holders = groupsHolding("personnel", personId)
    if (holders.length === 0) {
      assignPersonToOperation(personId, personName, operationId)
      return
    }
    askRouteConflict({
      resourceType: "personnel",
      resourceId: personId,
      resourceName: personName,
      targetId: operationId,
      conflicts: holders.map((group) => ({ operationId: group.id, operationLabel: group.name })),
      releases: releaseFromGroups("personnel", personId, holders),
      assign: () => assignPersonToOperation(personId, personName, operationId),
    })
  }

  const boardAssignMaterial = (materialId: string, operationId: string) => {
    const holders = groupsHolding("material", materialId)
    if (holders.length === 0) {
      assignMaterialToOperation(materialId, operationId)
      return
    }
    const name = materials.find((m) => m.id === materialId)?.name ?? materialId
    askRouteConflict({
      resourceType: "material",
      resourceId: materialId,
      resourceName: name,
      targetId: operationId,
      conflicts: holders.map((group) => ({ operationId: group.id, operationLabel: group.name })),
      releases: releaseFromGroups("material", materialId, holders),
      assign: () => assignMaterialToOperation(materialId, operationId),
    })
  }

  const boardAssignGroupResource = (groupId: string, resourceType: GroupResourceType, resourceId: string) => {
    if (resourceType === "vehicle") {
      assignVehicleToGroupWithConflict(groupId, resourceId)
      return
    }
    // Onto ANOTHER Auftrag: same question again, «bisher» being the route that
    // holds them now. `exceptGroupId` keeps a drop onto the route a resource is
    // already on from asking about itself.
    const holders = groupsHolding(resourceType, resourceId, groupId)
    const name =
      resourceType === "personnel"
        ? personnel.find((p) => p.id === resourceId)?.name ?? resourceId
        : materials.find((m) => m.id === resourceId)?.name ?? resourceId
    // ALSO the Einsätze that hold it. A route conflict is not the only kind:
    // dropping somebody who is crew on «Bahnhofstrasse 12» onto an Auftrag used
    // to put them on both without a word, while the same drag with a vehicle
    // asked — `assignVehicleToGroupWithConflict` has always collected both.
    const incidentHolders =
      resourceType === "personnel"
        ? operations.filter((op) => op.crew.includes(name))
        : operations.filter((op) => op.materials.includes(resourceId))
    if (holders.length === 0 && incidentHolders.length === 0) {
      void assignGroupResource(groupId, resourceType, resourceId)
      return
    }
    askRouteConflict({
      resourceType,
      resourceId,
      resourceName: name,
      targetId: groupId,
      conflicts: [
        ...holders.map((group) => ({ operationId: group.id, operationLabel: group.name })),
        ...incidentHolders.map((op) => ({ operationId: op.id, operationLabel: getIncidentRefLabel(op) })),
      ],
      releases: [
        ...releaseFromGroups(resourceType, resourceId, holders),
        ...incidentHolders.map((op) => () =>
          resourceType === "personnel" ? removeCrew(op.id, name) : removeMaterial(op.id, resourceId),
        ),
      ],
      assign: () => assignGroupResource(groupId, resourceType, resourceId),
    })
  }

  // What a card arriving in a column asks — after a drag across, and after a
  // typed «14 einsatz» (⌘K), which is the same move.
  const afterStatusMove = (operationId: string, newStatus: OperationStatus, previousStatus: OperationStatus) => {
    if (newStatus === "enroute") triggerDisponiertDialog(operationId, previousStatus)
    if (newStatus === "reko") triggerRekoCheck(operationId, previousStatus)
    if (newStatus === "reko_done") triggerRekoFormCheck(operationId, previousStatus)
    if (newStatus === "returning") triggerReturningVehicleCheck(operationId, previousStatus)
    // Drag-to-ABGESCHLOSSEN already ran updateOperation(complete) inside the hook
    // (which keeps materials). Just prompt the material decision here.
    if (newStatus === "complete") promptMaterialDecision(operationId, previousStatus)
  }

  // Use shared drag-and-drop hook
  useKanbanDragDrop({
    isMounted,
    canEdit: isEditor,
    operations,
    setOperations,
    updateOperation,
    reorderColumn,
    assignPersonToOperation: boardAssignPerson,
    assignRekoPersonToOperation,
    assignMaterialToOperation: boardAssignMaterial,
    assignVehicleToOperation: assignVehicleToIncidentWithConflict,
    onOperationDrop: (operationId) => {
      // Auto-select dropped card in side panel
      setSelectedOperationId(operationId)
      setHoveredOperationId(operationId)
    },
    onStatusChange: afterStatusMove,
    // Aufträge (route) drop targets — see auftraege-sheet.tsx for the registered
    // drop-target data contract (`group-row` / `group-stop`).
    groups,
    // Dragging a card onto an Auftrag goes through the same closed-incident
    // confirmation as the stop picker — the drop is just another way to attach.
    addStopsToGroup: (groupId, incidentIds) => {
      closedStopGuard.guard(incidentIds, () => { void addStopsToGroup(groupId, incidentIds) })
    },
    assignGroupResource: boardAssignGroupResource,
  })

  // Board Auftrag chips signal the page via a window event (no prop threading
  // through the column/side-panel trees) to open the Aufträge sheet on that route.
  useEffect(() => {
    const handler = (e: Event) => {
      const groupId = (e as CustomEvent<{ groupId: string }>).detail?.groupId ?? null
      setAuftraegeFocusGroupId(groupId)
      setActiveFooterSheet('auftraege')
    }
    window.addEventListener('kp:open-auftraege', handler)
    return () => window.removeEventListener('kp:open-auftraege', handler)
  }, [])

  // Same channel for the Routen-Editor: a card's context menu opens its route
  // directly, with that stop focused, instead of detouring through the sheet.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ groupId: string; focusIncidentId?: string }>).detail
      if (!detail?.groupId) return
      setRoutenEditorGroupId(detail.groupId)
      setRoutenEditorFocusIncidentId(detail.focusIncidentId ?? null)
    }
    window.addEventListener('kp:open-routen-editor', handler)
    return () => window.removeEventListener('kp:open-routen-editor', handler)
  }, [])

  // Lock the board scroll while a non-modal footer slide-up sheet is open. These
  // desktop sheets don't dim/trap the screen, so the board would otherwise scroll
  // behind them (odd UI churn). The board has TWO scroll axes on separate
  // elements: `#kanban-main` scrolls horizontally, and each Kanban column body
  // (`[data-board-scroll]`) scrolls its cards vertically — locking only the outer
  // container left the columns scrollable. So we lock the outer container plus
  // every column scroller, and restore each element's prior overflow on close.
  // We never touch document.body, so Radix's own scroll-lock on modal sheets is
  // untouched. Mobile sheets are modal + full-screen, so this is desktop-only.
  useEffect(() => {
    if (isMobile || !activeFooterSheet) return
    const main = document.getElementById('kanban-main')
    if (!main) return
    const locked: Array<{ el: HTMLElement; prev: string }> = []
    const lock = (el: HTMLElement) => {
      locked.push({ el, prev: el.style.overflow })
      el.style.overflow = 'hidden'
    }
    lock(main)
    main.querySelectorAll<HTMLElement>('[data-board-scroll]').forEach(lock)
    return () => {
      locked.forEach(({ el, prev }) => {
        el.style.overflow = prev
      })
    }
  }, [activeFooterSheet, isMobile])

  // Use shared resource filtering hook — sidebar search takes priority, top search also filters
  const effectivePersonnelQuery = personnelSearchQuery || searchQuery
  const effectiveMaterialQuery = materialSearchQuery || searchQuery
  // `filtered*` are what the sidebars actually draw — the footer counters read
  // them so "0 von 17 sichtbar" can never disagree with the list above it.
  const { availabilityGroupedPersonnel, groupedMaterials, filteredPersonnel, filteredMaterials } = useResourceFiltering(
    personnel,
    materials,
    effectivePersonnelQuery,
    effectiveMaterialQuery,
    tRes('roleOther'),
    { personnel: personnelAvailableOnly, materials: materialsAvailableOnly },
  )

  // The two sidebar footers. One helper each, and it is the same predicate the
  // list above is filtered with — the counter and the list can no longer
  // disagree about who counts as free.
  const rosterSummary = useMemo(() => summarizeRoster(personnel), [personnel])
  const materialSummary = useMemo(() => summarizeMaterials(materials), [materials])

  // Memoize filtered operations to avoid unnecessary recalculations on every render.
  // The predicate itself lives in lib/incident-search so the /display board and
  // status page search exactly the same fields (§ display parity).
  // groupId → Auftrag name, so searching a route's name also turns up the
  // incidents that are stops on it. The operation itself only carries `groupId`,
  // so the name has to come from the groups context.
  const groupNames = useMemo(
    () => new Map(groups.map((group) => [group.id, group.name])),
    [groups],
  )

  const filteredOperations = useMemo(
    () => filterIncidents(operations, searchQuery, materials, groupNames),
    [operations, searchQuery, materials, groupNames],
  )

  /**
   * The event's normal case: the Einsatzart that a clear majority of the
   * board's incidents share. Cards suppress their type row when it matches —
   * in a storm, 14 of 15 cards saying «Elementarereignis» is a row of ink that
   * tells the operator nothing, and the one card that differs should be the
   * one that stands out. Unfiltered operations on purpose: a search must not
   * change what counts as normal. Null below 3 incidents — with two cards
   * there is no "normal case" to suppress against.
   */
  const dominantIncidentType = useMemo(() => {
    if (operations.length < 3) return null
    const counts = new Map<string, number>()
    for (const op of operations) counts.set(op.incidentType, (counts.get(op.incidentType) ?? 0) + 1)
    let best: string | null = null
    let bestCount = 0
    counts.forEach((count, type) => {
      if (count > bestCount) {
        best = type
        bestCount = count
      }
    })
    return bestCount > operations.length / 2 ? best : null
  }, [operations])

  const {
    collectPersonBindings,
    collectMaterialBindings,
    followBinding,
    handlePersonClick,
  } = useResourceBindings({
    operations,
    getGroupResources,
    groups,
    scrollToCard,
    setSearchQuery,
    openIncidentDetail,
    setActiveFooterSheet,
    setAuftraegeFocusGroupId,
    setBindingsPopover,
    groupNames,
    filteredOperations,
  })

  /** Right-click on a sidebar row → the same `{ out_of_service }` PUT the
   *  Materialverwaltung sends. Set or not set; no reason, no cause list. */
  const handleToggleMaterialOutOfService = useCallback((material: Material, outOfService: boolean) => {
    void setMaterialOutOfService(material.id, outOfService)
  }, [setMaterialOutOfService])

  /** The device row answers the same question the person row does, including
   *  «nirgends» — a free device used to be a click into the void as well. */
  const handleMaterialClick = (material: Material) => {
    const bindings = collectMaterialBindings(material)
    const only = soleDestination(bindings)
    if (only) {
      followBinding(only)
      return
    }
    // A device inside a module block is drawn by MaterialGroupBlock, which has no
    // anchor for the popover — there the click keeps jumping to the first
    // reachable binding rather than opening a list nothing could position.
    if (material.groupId) {
      const first = bindings.find(isNavigableBinding)
      if (first) followBinding(first)
      return
    }
    setBindingsPopover({
      kind: "material",
      id: material.id,
      title: material.name,
      subtitle: material.category,
      bindings,
    })
  }

  /** The aggregate row answers for the WHOLE bundle: every taken unit's
   *  bindings in one popover — «wo sind die anderen zwei Sauger?» must not
   *  need three clicks through three identical rows. */
  const handleAggregateMaterialClick = (units: Material[]) => {
    // Units share targets — two Sägen on one Auftrag are ONE place, so the
    // list carries each target once, with a ×n when several units are there.
    const merged = new Map<string, { binding: ResourceBinding; count: number }>()
    for (const binding of units.flatMap((unit) => collectMaterialBindings(unit))) {
      const entry = merged.get(binding.key)
      if (entry) entry.count += 1
      else merged.set(binding.key, { binding, count: 1 })
    }
    const bindings = [...merged.values()].map(({ binding, count }) =>
      count > 1 ? { ...binding, detail: tCommon('aggregateUnitCount', { count }) } : binding,
    )
    const free = units.filter((unit) => materialResourceState(unit) === 'available').length
    setBindingsPopover({
      kind: "material",
      id: units[0].id,
      title: units[0].name,
      subtitle: `${units[0].category} · ${tCommon('aggregateCountTitle', { free, total: units.length })}`,
      bindings,
    })
  }

  const {
    handleVehicleAssign,
    handleOperationDelete,
    handleVehicleRemove,
    handleOperationUpdate,
    handleCardClick,
    handleCardSelect,
  } = useBoardDispatch({
    removeReko,
    operations,
    outOfServiceVehicleIds,
    assignVehicleToOperation,
    materials,
    removeCrew,
    removeMaterial,
    removeVehicle,
    deleteOperation,
    resourceConflict,
    vehicleNeedingDriver,
    updateOperation,
    fleet,
    isAssignmentSettling,
    assignRekoPersonToOperation,
    getGroupResources,
    groups,
    unassignGroupResource,
    release,
    dispatchRef,
    personnel,
    operationsRef,
    setPersonnelSearchQuery,
    setMaterialSearchQuery,
    selectedOperation,
    setShowRightSidebar,
    setShowLeftSidebar,
    openIncidentDetail,
    setActiveFooterSheet,
    setAuftraegeFocusGroupId,
    broadcast,
    isDraggingOperationRef,
    assignVehicleToIncidentWithConflict,
    boardAssignPerson,
    boardAssignMaterial,
    boardAssignGroupResource,
    afterStatusMove,
    collectPersonBindings,
    collectMaterialBindings,
    followBinding,
  })

  // Derived state for convenience
  const vehicleStatusSheetOpen = activeFooterSheet === 'vehicles'
  const printSheetOpen = activeFooterSheet === 'print'
  const auftraegeSheetOpen = activeFooterSheet === 'auftraege'
  const rapportBacklogSheetOpen = activeFooterSheet === 'rapporte'
  const linksSheetOpen = activeFooterSheet === 'links'
  const figuresSheetOpen = activeFooterSheet === 'figures'
  const crewDutySheetOpen = activeFooterSheet === 'crew'

  // The rolling Schadenplatz-Rapport backlog — closed incidents whose rapport is
  // still missing, oldest first. Computed once: the footer pill shows the count,
  // the sheet shows the same list. Editors only — a viewer cannot fill a rapport,
  // so a backlog they cannot act on is pure noise.
  const openRapports = useMemo(
    () => (isEditor ? selectOpenRapports(operations) : []),
    [isEditor, operations],
  )

  // The archive half of the same sheet. Same editor gate as the backlog — it is
  // one control, and a pill a viewer can only half use is worse than no pill.
  const filedRapports = useMemo(
    () => (isEditor ? selectFiledRapports(operations) : []),
    [isEditor, operations],
  )

  // Material a crew left standing at a Schadenplatz, longest-standing first.
  // Not editor-gated: knowing that a pump is still in a stranger's cellar is a
  // read, and the person watching the board is not always the one holding the
  // mouse. The rows only navigate — nothing here releases anything.
  const materialOnSiteEntries = useMemo(
    () => selectMaterialOnSite(materialOnSite, materials),
    [materialOnSite, materials],
  )

  const {
    handleOpenRapport,
    openAttendance,
    assignmentLabelForPerson,
    checkInFromDivera,
    copyCheckInUrlToClipboard,
    handleOpenAssignmentDialog,
    handleConfirmAddStops,
    handleDistributeToAuftrag,
    performDistribute,
    handleChooseAuftrag,
    handleRemoveFromAuftrag,
    handleAssignRouteResource,
    handleOpenRekoAssignDialog,
    handleToggleNachbarhilfe,
    handleToggleAmWarten,
    handleToggleZuFuss,
    assignedResources,
    routeGroupResources,
    occupiedPersonnelIds,
    occupiedVehicleIds,
    occupiedMaterialIds,
    deleteReleaseHint,
    handleDeleteOperationConfirm,
  } = useBoardDialogActions({
    occupiedResourceIds,
    deleteOperation,
    operations,
    updateOperation,
    refreshPersonnel,
    getGroupResources,
    addStopsToGroup,
    groups,
    release,
    closedStopGuard,
    selectedEvent,
    isEditor,
    registerAssignHandler,
    openIncidentDetail,
    setActiveFooterSheet,
    stopPickerGroupId,
    setAuftragPickerIncidentId,
    auftragPickerIncidentId,
    setDistributeConfirm,
    routeAssign,
    setRouteAssign,
    checkInUrl,
    setCopied,
    setAttendanceOpen,
    setOperationToDelete,
    operationToDelete,
    setAssignmentDialogOpen,
    setAssignmentResourceType,
    setAssignmentOperationId,
    assignmentOperationId,
    setAssignmentInitialSearch,
    setRekoAssignDialogOpen,
    setRekoAssignOperationId,
  })

  // Don't render drag and drop until client-side to avoid hydration errors.
  // Inside ProtectedRoute like every other branch, so all three share ONE ProtectedRoute at
  // the root: on a cold start the server-rendered boot screen (snail, «KP RÜCK», phase) is
  // the same element that stays up until the session probe answers. It used to be a bare
  // «Wird geladen …» here, and the snail only mounted after hydration — a second stage.
  if (!isMounted) {
    return (
      <ProtectedRoute>
        <div className="flex h-full items-center justify-center bg-background text-foreground">
          <LoadingStatus size="surface" className="text-sm">{tDash('loading')}</LoadingStatus>
        </div>
      </ProtectedRoute>
    )
  }

  // Show empty state if no event is selected (after loading)
  if (isMounted && isEventLoaded && !selectedEvent) {
    return (
      <ProtectedRoute>
        <EventSelectionEmptyState />
      </ProtectedRoute>
    )
  }

  return (
    <ProtectedRoute>
      <div className="flex h-full flex-col bg-background text-foreground">
        {/* Übung: the same warning strip the wall display, the Karte and the
            Übungs-Steuerung carry, at the top edge of the WINDOW. Chrome, not
            content — it is fixed and out of flow, so it stays put while the board
            scrolls, lies over the Benachrichtigungen sidebar instead of pushing
            the board 3px below it, and never competes with a card's priority
            colour. */}
        {selectedEvent?.training_flag && <TrainingBand />}
        {/* Top header is desktop-only — on mobile everything routes through the
            bottom navbar (event switching lives in its "Mehr" sheet). */}
        <header className="hidden md:flex items-center justify-between border-b border-border bg-header px-4 md:px-6 py-2 min-h-14">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            {/* Event title doubles as an event switcher: switch events or create a
                new one without first hunting through the user menu → Ereignisse. */}
            <DropdownMenu>
              <DropdownMenuTrigger className="flex items-center gap-2 min-w-0 -ml-2 rounded-lg px-2 py-1 hover:bg-secondary/60 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
                <h1 className={`text-xl md:text-2xl font-bold tracking-tight truncate ${selectedEvent ? "" : "text-muted-foreground"}`}>
                  {selectedEvent ? selectedEvent.name : tDash('noEventSelected')}
                </h1>
                {/* Warning-coloured, always visible: the wall display, /alarm and
                    the mobile navigation all say «Übung» in this colour, and the
                    loudest signal must not sit where nobody types. */}
                {selectedEvent?.training_flag && <TrainingBadge label={tDash('training')} />}
                <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-64">
                <DropdownMenuLabel>{tDash('switchEvent')}</DropdownMenuLabel>
                {events
                  .filter((e) => !e.archived_at && e.id !== selectedEvent?.id)
                  .sort((a, b) => b.last_activity_at.getTime() - a.last_activity_at.getTime())
                  .slice(0, 6)
                  .map((event) => (
                    <DropdownMenuItem
                      key={event.id}
                      onClick={() => setSelectedEvent(event)}
                      className="cursor-pointer"
                    >
                      <span className="truncate">{event.name}</span>
                      {event.training_flag && (
                        <Badge variant="secondary" className="ml-auto text-2xs">{tDash('training')}</Badge>
                      )}
                    </DropdownMenuItem>
                  ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => router.push("/events?action=create")} className="cursor-pointer">
                  <Plus className="mr-2 h-4 w-4" />
                  {tDash('newEvent')}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => router.push("/events")} className="cursor-pointer">
                  <CalendarDays className="mr-2 h-4 w-4" />
                  {tDash('allEvents')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Desktop Navigation */}
          {!isMobile && (
            <div className="flex items-center gap-4">
              <SearchInput
                id="search-input"
                placeholder={tCommon('search')}
                value={searchQuery}
                onValueChange={setSearchQuery}
                className="w-72"
                hint={<Kbd>S</Kbd>}
              />

              <EventClock />

              <PageNavigation
                currentPage="kanban"
                hasSelectedEvent={!!selectedEvent}
                selectedIncidentId={selectedOperationId}
              />
            </div>
          )}
        </header>

        {/* Mobile View */}
        {isMobile ? (
          <MobileIncidentListView
            operations={filteredOperations}
            materials={materials}
            formatLocation={formatLocation}
            onUpdateOperation={updateOperation}
            isEditor={isEditor}
            isTraining={selectedEvent?.training_flag}
            isLoading={isLoading}
            onNewIncident={isEditor ? () => setNewEmergencyModalOpen(true) : undefined}
            openRequest={mobileOpenRequest}
          />
        ) : (
          /* Desktop View */
          <>
        <div className="relative flex flex-1 overflow-hidden">
          {/* `z-10` on both sidebars: their collapse handles straddle the inner
              edge, so half of each hangs over the board. `backdrop-blur-sm` makes
              an aside a stacking context, so a handle's own z-20 cannot lift it
              past a SIBLING — and the board block follows the LEFT sidebar in DOM
              order with an opaque background, which painted that half away. The
              right one only ever looked fine because it comes after the board. */}
          {showLeftSidebar && (
            <PersonnelSidebar
              setShowLeftSidebar={setShowLeftSidebar}
              personnelSearchQuery={personnelSearchQuery}
              setPersonnelSearchQuery={setPersonnelSearchQuery}
              setSearchQuery={setSearchQuery}
              isMobile={isMobile}
              personnelAvailableOnly={personnelAvailableOnly}
              setPersonnelAvailableOnly={setPersonnelAvailableOnly}
              isLoaded={isLoaded}
              boardNeverLoaded={boardNeverLoaded}
              personnel={personnel}
              checkInUrl={checkInUrl}
              copied={copied}
              copyCheckInUrlToClipboard={copyCheckInUrlToClipboard}
              filteredPersonnel={filteredPersonnel}
              effectivePersonnelQuery={effectivePersonnelQuery}
              availabilityGroupedPersonnel={availabilityGroupedPersonnel}
              bindingsPopover={bindingsPopover}
              setBindingsPopover={setBindingsPopover}
              handlePersonClick={handlePersonClick}
              doubleBookedPersons={doubleBookedPersons}
              personEngagements={personEngagements}
              followBinding={followBinding}
              rosterSummary={rosterSummary}
              eventId={selectedEvent?.id ?? null}
              canCheckIn={isEditor}
              onDiveraCheckIn={checkInFromDivera}
              onOpenCrewDuty={() => setActiveFooterSheet(prev => prev === 'crew' ? null : 'crew')}
            />
          )}

          {/* The board and its three reopen tabs share one containing block, so
              `left-1` / `right-1` mean the BOARD's edges — not the window's —
              whether or not the detail panel is open.

              Every tab is PINNED (absolute, z-20), never a flex item. A flex
              item reserves its width down the entire height of the board, so a
              48px tab left a 28px column of nothing running the full height
              beside the Material-Leiste: an empty band between a sliced-off card
              and the sidebar's border, which is what «die hässlichen Linien»
              were both times. Out of flow the board keeps the full width and the
              tab is what it looks like — a control pinned to the edge, opaque
              (`bg-card`) and shadowed so scrolled cards pass behind it. */}
          <div className="relative flex min-w-0 flex-1">
          {/* Main Kanban Board */}
          <main
            id="kanban-main"
            data-spotlight={spotlightActive ? 'on' : undefined}
            // No bottom padding: with `overflow-x-auto` the horizontal scrollbar
            // already sits below the columns, so a pb-4 underneath it drew a
            // second empty band between the board and the footer.
            //
            // The side that carries a reopen tab gets 8 instead of 4 — the tab is
            // pinned over the board, and the extra 16px is what keeps it off the
            // outer column at rest. It is the board's own margin, not a strip of
            // its own, so nothing is drawn beside the board.
            className={cn(
              "flex-1 overflow-x-auto overscroll-contain pt-4 pb-0 bg-muted/30 dark:bg-background",
              showLeftSidebar ? "pl-4" : "pl-8",
              !showRightSidebar
                ? "pr-8"
                // The detail tab only exists from SIDE_PANEL_BREAKPOINT up, so
                // neither does the room it needs.
                : sidePanelMode === 'collapsed' ? "pr-4 2xl:pr-8" : "pr-4",
            )}
          >
            {/* A board that never arrived gets the error panel, not seven
                empty columns counting «0» — see BoardLoadErrorPanel. */}
            {!isLoaded ? null : boardNeverLoaded ? (
              <BoardLoadErrorPanel />
            ) : (
              <div className="flex h-full gap-3 animate-in fade-in duration-300">
                {columns.map((column) => {
                  const columnOps = filteredOperations.filter((op) => column.status.includes(op.status))
                  return (
                    <DroppableColumn
                      key={column.id}
                      column={column}
                      operations={columnOps}
                      onRemoveCrew={release.releaseCrew}
                      onRemoveMaterial={release.releaseMaterial}
                      onRemoveVehicle={release.releaseVehicle}
                      onToggleDriverStay={handleToggleDriverStay}
                      onRemoveReko={removeReko}
                      onCardClick={handleCardClick}
                      onCardSelect={handleCardSelect}
                      onCardHover={setHoveredOperationId}
                      highlightedOperationId={highlightedOperationId}
                      selectedOperationId={selectedOperationId}
                      hoveredOperationId={hoveredOperationId}
                      isDraggingRef={isDraggingOperationRef}
                      materials={materials}
                      formatLocation={formatLocation}
                      onAssignResource={handleOpenAssignmentDialog}
                      onAssignReko={handleOpenRekoAssignDialog}
                      onToggleNachbarhilfe={handleToggleNachbarhilfe}
                      onToggleAmWarten={handleToggleAmWarten}
                      onToggleZuFuss={handleToggleZuFuss}
                      onRequestComplete={isEditor ? requestCompletion : undefined}
                      onRequestDelete={isEditor ? handleRequestDelete : undefined}
                      onTransfer={isEditor ? handleOpenTransfer : undefined}
                      onDistributeToAuftrag={isEditor ? handleDistributeToAuftrag : undefined}
                      cardView={cardView}
                      dominantIncidentType={dominantIncidentType}
                      printerEnabled={printerEnabled}
                      vehicleDrivers={vehicleDrivers}
                      doubleBookedCrewNames={doubleBookedPersons.names}
                      canDrag={isEditor}
                      onDragActiveChange={setBoardDragging}
                      onSort={isEditor ? handleColumnSort : undefined}
                      isCollapsed={collapsedColumns.isCollapsed(column.id)}
                      onToggleCollapsed={collapsedColumns.toggle}
                    />
                  )
                })}
              </div>
            )}
          </main>

          {/* Personen-Leiste reopen tab (shown when collapsed; "[" also toggles).
              The SAME pill as the collapse handle on the open sidebar, inset from
              the board edge instead of flush against it: a half-rounded tab with
              one border side removed reads as a control the window had cut in
              half. One shape, one size, going in and coming out. */}
          {!showLeftSidebar && (
            <button
              onClick={() => setShowLeftSidebar(true)}
              className="absolute left-1 top-1/2 z-20 flex h-12 w-5 min-w-0 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:bg-secondary/60 hover:text-foreground"
              title={`${tDash('toggleLeftSidebar')} ([)`}
              aria-label={tDash('toggleLeftSidebar')}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          )}

          {/* Einsatz-Detail reopen tab. `2xl:` is SIDE_PANEL_BREAKPOINT — below
              it the panel does not exist, so neither does its tab. */}
          {sidePanelMode === 'collapsed' && (
            <button
              onClick={() => setSidePanelMode('detail')}
              className="absolute right-1 top-3 z-20 hidden h-12 w-5 min-w-0 cursor-pointer items-center justify-center rounded-md border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:bg-secondary/60 hover:text-foreground 2xl:flex"
              title={`${tSidePanel('railLabel')} (\\)`}
              aria-label={tSidePanel('railLabel')}
            >
              <PanelRight className="h-4 w-4" />
            </button>
          )}

          {/* Material-Leiste reopen tab (shown when collapsed; "]" also toggles). */}
          {!showRightSidebar && (
            <button
              onClick={() => setShowRightSidebar(true)}
              className="absolute right-1 top-1/2 z-20 flex h-12 w-5 min-w-0 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:bg-secondary/60 hover:text-foreground"
              title={
                materialOnSiteEntries.length > 0
                  ? `${tDash('toggleRightSidebar')} (]) · ${tDash('materialOnSite.toggle', { count: materialOnSiteEntries.length })}`
                  : `${tDash('toggleRightSidebar')} (])`
              }
              aria-label={tDash('toggleRightSidebar')}
            >
              <ChevronLeft className="h-4 w-4" />
              {/* The «vor Ort» roll-up lives inside this panel, so a folded
                  panel would hide the one thing on the board that says a pump
                  is still in a stranger's cellar. A dot, not a number: it is a
                  "there is something behind this" mark, and the count is one
                  click and a tooltip away. */}
              {materialOnSiteEntries.length > 0 && (
                <span className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-warning" aria-hidden />
              )}
            </button>
          )}
          </div>

          {/* Side Panel for ultrawide monitors */}
          <SidePanel
            mode={sidePanelMode}
            onModeChange={setSidePanelMode}
            // Collapsed, the panel renders nothing here — its reopen tab lives
            // in the w-7 gutter above, beside the Material-Leiste's.
            selectedOperation={selectedOperation}
            onOpenOnMap={() =>
              router.push(selectedOperation ? `/map?highlight=${selectedOperation.id}` : '/map')
            }
            openOnTab={openDetailOnTab ?? undefined}
            materials={materials}
            onUpdate={(updates) => {
              if (selectedOperation) {
                updateOperation(selectedOperation.id, updates)
              }
            }}
            onDelete={isEditor ? async (operationId) => {
              try {
                await deleteOperation(operationId)
                setSelectedOperationId(null)
              } catch (error) {
                console.error('Failed to delete operation:', error)
                toast.error(tCommon('deleteFailed'))
              }
            } : undefined}
            onAssignVehicle={isEditor ? assignVehicleToOperation : undefined}
            onRemoveVehicle={isEditor ? release.releaseVehicle : undefined}
            onAssignResource={isEditor ? handleOpenAssignmentDialog : undefined}
            onRemoveCrew={isEditor ? release.releaseCrew : undefined}
            onRemoveMaterial={isEditor ? release.releaseMaterial : undefined}
            canEdit={isEditor}
            diveraEnabled={isEditor && diveraEnabled}
            onSendDivera={isEditor ? (op) => setDiveraDialogOp(op) : undefined}
            onChangeStatus={isEditor ? requestStatusChange : undefined}
            onRequestComplete={isEditor ? requestCompletion : undefined}
            onDistributeToAuftrag={isEditor ? handleDistributeToAuftrag : undefined}
          />

          {/* Same `z-10` as the left sidebar — see the note there. This side works
              on DOM order alone today; it carries the class so the handle does not
              depend on which side of the board its aside happens to sit. */}
          {showRightSidebar && (
            <MaterialSidebar
              setShowRightSidebar={setShowRightSidebar}
              materialSearchQuery={materialSearchQuery}
              setMaterialSearchQuery={setMaterialSearchQuery}
              setSearchQuery={setSearchQuery}
              isMobile={isMobile}
              materialsAvailableOnly={materialsAvailableOnly}
              setMaterialsAvailableOnly={setMaterialsAvailableOnly}
              materialOnSiteEntries={materialOnSiteEntries}
              openIncidentDetail={openIncidentDetail}
              isLoaded={isLoaded}
              boardNeverLoaded={boardNeverLoaded}
              isEditor={isEditor}
              materials={materials}
              materialGroups={materialGroups}
              groupedMaterials={groupedMaterials}
              filteredMaterials={filteredMaterials}
              effectiveMaterialQuery={effectiveMaterialQuery}
              handleMaterialClick={handleMaterialClick}
              handleAggregateMaterialClick={handleAggregateMaterialClick}
              handleToggleMaterialOutOfService={handleToggleMaterialOutOfService}
              bindingsPopover={bindingsPopover}
              setBindingsPopover={setBindingsPopover}
              followBinding={followBinding}
              materialSummary={materialSummary}
            />
          )}

        </div>

        <BoardFooter
          applyCardViewPreset={applyCardViewPreset}
          auftraegeSheetOpen={auftraegeSheetOpen}
          cardView={cardView}
          cardViewPreset={cardViewPreset}
          checklistPopoverOpen={checklistPopoverOpen}
          checklistProgress={checklistProgress}
          cmdHint={cmdHint}
          figuresSheetOpen={figuresSheetOpen}
          filedRapports={filedRapports}
          handleChecklistOpenChange={handleChecklistOpenChange}
          journalSheetOpen={activeFooterSheet === 'journal'}
          linksSheetOpen={linksSheetOpen}
          openRapports={openRapports}
          printSheetOpen={printSheetOpen}
          rapportBacklogSheetOpen={rapportBacklogSheetOpen}
          selectedEvent={selectedEvent}
          setActiveFooterSheet={setActiveFooterSheet}
          setAttendanceOpen={setAttendanceOpen}
          setAuftraegeFocusGroupId={setAuftraegeFocusGroupId}
          setChecklistOverridesVersion={setChecklistOverridesVersion}
          setDiveraMessageText={setDiveraMessageText}
          setNewEmergencyModalOpen={setNewEmergencyModalOpen}
          setRekoPickerOpen={setRekoPickerOpen}
          toggleCardViewKey={toggleCardViewKey}
          vehicleStatusSheetOpen={vehicleStatusSheetOpen}
        />
          </>
        )}
      </div>

      <BoardDialogs
        activeFooterSheet={activeFooterSheet}
        assignGroupResource={assignGroupResource}
        assignMaterialToOperation={assignMaterialToOperation}
        assignPersonToOperation={assignPersonToOperation}
        assignVehicleToGroupWithConflict={assignVehicleToGroupWithConflict}
        assignVehicleToIncidentWithConflict={assignVehicleToIncidentWithConflict}
        assignedResources={assignedResources}
        assignmentDialogOpen={assignmentDialogOpen}
        assignmentLabelForPerson={assignmentLabelForPerson}
        assignmentOperationId={assignmentOperationId}
        assignmentResourceType={assignmentResourceType}
        assignmentInitialSearch={assignmentInitialSearch}
        attendanceOpen={attendanceOpen}
        auftraegeFocusGroupId={auftraegeFocusGroupId}
        auftraegeSheetOpen={auftraegeSheetOpen}
        auftragPickerIncidentId={auftragPickerIncidentId}
        closedStopGuard={closedStopGuard}
        createGroup={createGroup}
        createOperation={createOperation}
        mergeOperationInto={mergeOperationInto}
        deleteDialogOpen={deleteDialogOpen}
        deleteReleaseHint={deleteReleaseHint}
        detailModalOpen={detailModalOpen}
        distributeConfirm={distributeConfirm}
        diveraDialogOp={diveraDialogOp}
        diveraDialogOpLive={diveraDialogOpLive}
        diveraEnabled={diveraEnabled}
        diveraMessageText={diveraMessageText}
        filedRapports={filedRapports}
        formatLocation={formatLocation}
        funkrufname={funkrufname}
        groups={groups}
        handleAssignRouteResource={handleAssignRouteResource}
        handleChooseAuftrag={handleChooseAuftrag}
        handleConfirmAddStops={handleConfirmAddStops}
        handleDeleteOperationConfirm={handleDeleteOperationConfirm}
        handleDistributeToAuftrag={handleDistributeToAuftrag}
        handleOpenAssignmentDialog={handleOpenAssignmentDialog}
        handleOpenIncidentFromNotification={handleOpenIncidentFromNotification}
        handleOpenRapport={handleOpenRapport}
        handleOperationDelete={handleOperationDelete}
        handleOperationUpdate={handleOperationUpdate}
        handlePrintBoard={handlePrintBoard}
        handleRemoveFromAuftrag={handleRemoveFromAuftrag}
        handleToggleZuFuss={handleToggleZuFuss}
        handleTransfer={handleTransfer}
        handleVehicleAssign={handleVehicleAssign}
        handleVehicleRemove={handleVehicleRemove}
        isEditor={isEditor}
        isPrintingBoard={isPrintingBoard}
        isTransferring={isTransferring}
        linksSheetOpen={linksSheetOpen}
        materials={materials}
        mobilePersonnelSheetOpen={mobilePersonnelSheetOpen}
        newEmergencyGroupId={newEmergencyGroupId}
        newEmergencyModalOpen={newEmergencyModalOpen}
        occupiedMaterialIds={occupiedMaterialIds}
        occupiedPersonnelIds={occupiedPersonnelIds}
        occupiedVehicleIds={occupiedVehicleIds}
        openAttendance={openAttendance}
        openDetailOnTab={openDetailOnTab}
        openIncidentDetail={openIncidentDetail}
        openRapports={openRapports}
        operationToDelete={operationToDelete}
        operations={operations}
        performDistribute={performDistribute}
        crewDutySheetOpen={crewDutySheetOpen}
        fatigueHours={fatigueHours}
        personEngagements={personEngagements}
        personnel={personnel}
        printSheetOpen={printSheetOpen}
        printerEnabled={printerEnabled}
        rapportBacklogSheetOpen={rapportBacklogSheetOpen}
        refreshOperations={refreshOperations}
        refreshPersonnel={refreshPersonnel}
        rekoAssignDialogOpen={rekoAssignDialogOpen}
        rekoAssignOperationId={rekoAssignOperationId}
        rekoPersonnelNames={rekoPersonnelNames}
        rekoPickerOpen={rekoPickerOpen}
        removeCrew={removeCrew}
        removeMaterial={removeMaterial}
        removeVehicle={removeVehicle}
        release={release}
        requestCompletion={requestCompletion}
        requestStatusChange={requestStatusChange}
        routeAssign={routeAssign}
        routeGroupResources={routeGroupResources}
        routenEditorFocusIncidentId={routenEditorFocusIncidentId}
        routenEditorGroupId={routenEditorGroupId}
        selectedEvent={selectedEvent}
        selectedOperation={selectedOperation}
        setActiveFooterSheet={setActiveFooterSheet}
        setAssignmentDialogOpen={setAssignmentDialogOpen}
        setAttendanceOpen={setAttendanceOpen}
        setAuftragPickerIncidentId={setAuftragPickerIncidentId}
        setDeleteDialogOpen={setDeleteDialogOpen}
        setDetailModalOpen={setDetailModalOpen}
        setDistributeConfirm={setDistributeConfirm}
        setDiveraDialogOp={setDiveraDialogOp}
        setDiveraMessageText={setDiveraMessageText}
        setMobilePersonnelSheetOpen={setMobilePersonnelSheetOpen}
        setNewEmergencyGroupId={setNewEmergencyGroupId}
        setNewEmergencyModalOpen={setNewEmergencyModalOpen}
        setRekoAssignDialogOpen={setRekoAssignDialogOpen}
        setRekoPickerOpen={setRekoPickerOpen}
        setRouteAssign={setRouteAssign}
        setRouteStopStatus={setRouteStopStatus}
        setRoutenEditorFocusIncidentId={setRoutenEditorFocusIncidentId}
        setRoutenEditorGroupId={setRoutenEditorGroupId}
        setStopPickerGroupId={setStopPickerGroupId}
        setTransferSourceOp={setTransferSourceOp}
        statusWorkflow={statusWorkflow}
        stopPickerGroupId={stopPickerGroupId}
        toggleDriverStay={toggleDriverStay}
        transferAvailableIncidents={transferAvailableIncidents}
        transferSourceOp={transferSourceOp}
        unassignGroupResource={unassignGroupResource}
        vehicleStatusSheetOpen={vehicleStatusSheetOpen}
        vehicleTypes={vehicleTypes}
      />
    </ProtectedRoute>
  )
}
