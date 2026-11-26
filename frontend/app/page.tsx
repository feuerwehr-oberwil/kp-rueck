"use client"

/**
 * The operations board.
 *
 * A `viewer` reaches it on a phone only (the phone shell, read-only – lib/role-home.ts);
 * anywhere wider `ProtectedRoute` sends it to `/display/board`. So the `isEditor` checks
 * below are constant-true on the desk and live on the phone – see the note in
 * `components/protected-route.tsx` for what actually enforces the role.
 *
 * The page owns the state only it shows (searches, open dialogs, sidebar views) and
 * wires the board hooks in `components/board/`, which read the board contexts
 * themselves: `useBoardSelection` (which card is open, and where), `useBoardSheets`,
 * `useBoardCardActions`, `useBoardDrops`, `useBoardDispatch` (⌘K),
 * `useBoardDialogActions` and `useBoardCommandHandlers` (palette + keys).
 */

import { useState, useEffect, useCallback, useMemo } from "react"
import { useEffectEvent } from "@/lib/hooks/use-effect-event"
import { useTranslations } from "next-intl"
import { useRouter } from "next/navigation"
import { topLoading } from "@/components/ui/top-loading-bar"
import { LoadingStatus } from "@/components/ui/shell-loader"
import { ChevronLeft, ChevronRight, PanelRight } from 'lucide-react'
import { summarizeMaterials } from "@/lib/resource-status"
import { ProtectedRoute } from "@/components/protected-route"
import { useBootGate } from "@/lib/boot-cover"
import { TrainingBand } from "@/components/training-mode-chrome"
import { toast } from "sonner"
import { useOperations } from "@/lib/contexts/operations-context"
import { useGroups } from "@/lib/contexts/groups-context"
import { useReleaseUndo } from "@/lib/hooks/use-release-undo"
import { selectFiledRapports, selectOpenRapports } from "@/components/kanban/rapport-backlog-sheet"
import { selectMaterialOnSite } from "@/components/kanban/material-on-site-panel"
import { useMaterials } from "@/lib/contexts/materials-context"
import { usePersonnel } from "@/lib/contexts/personnel-context"
import { useEvent } from "@/lib/contexts/event-context"
import { useClosedStopGuard } from "@/lib/hooks/use-closed-stop-guard"
import { useStationCapabilities } from "@/lib/hooks/use-station-capabilities"
import { useVehicleShortcuts } from "@/lib/contexts/operations/use-vehicle-shortcuts"
import { useNotifications } from "@/lib/contexts/notification-context"
import { useResourceFiltering } from "@/lib/hooks/use-resource-filtering"
import { useDoubleBookedPersons } from "@/lib/hooks/use-double-booked-persons"
import { usePersonEngagements } from "@/lib/hooks/use-person-engagements"
import { usePersonPlaces } from "@/lib/hooks/use-person-matcher"
import { useCurrentTime } from "@/lib/hooks/use-current-time"
import { useCommandPaletteHint } from "@/lib/hooks/use-is-mac"
import { usePrintBoard } from "@/lib/hooks/use-print-board"
import { useCollapsedSections } from "@/lib/hooks/use-collapsed-sections"
import { ShortcutTooltip } from "@/components/ui/shortcut-tooltip"
import { useAuth } from "@/lib/contexts/auth-context"
import { useStandby } from "@/lib/contexts/standby-context"
import { columns, BOARD_COLUMN_COLLAPSE_KEY, DEFAULT_COLLAPSED_COLUMN_IDS } from "@/lib/kanban-utils"
import { DroppableColumn } from "@/components/kanban/droppable-column"
import { useBoardEdgeOverflow } from "@/components/kanban/board-edge-chips"
import { useCardView } from "@/lib/card-view"
import { useIsMobile } from "@/components/ui/use-mobile"
import { EventSelectionEmptyState } from "@/components/empty-states/event-selection-empty-state"
import { BoardLoadErrorPanel } from "@/components/board-load-error"
import { SidePanel } from "@/components/kanban/side-panel"
import { useVehicleDrivers } from "@/lib/hooks/use-vehicle-drivers"
import { filterIncidents } from "@/lib/incident-search"
import { MobileIncidentListView } from "@/components/mobile/mobile-incident-list-view"
import { IncidentDialogs, useIncidentDialogs } from "@/components/kanban/incident-dialogs"
import { cn } from "@/lib/utils"
import { useBoardLayoutPrefs } from "@/lib/hooks/use-board-layout-prefs"
import { usePersistedState } from "@/lib/hooks/use-persisted-state"
import { DEFAULT_PERSONNEL_VIEW, isPersonnelViewPrefs, PERSONNEL_VIEW_KEY } from "@/lib/personnel-view"
import { DEFAULT_MATERIAL_VIEW, isMaterialViewPrefs, MATERIAL_VIEW_KEY } from "@/lib/material-view"
import type { BindingsPopoverState } from "@/lib/board-sidebar"
import { PersonnelSidebar } from "@/components/board/personnel-sidebar"
import { MaterialSidebar } from "@/components/board/material-sidebar"
import { SlideRail } from "@/components/ui/slide-rail"
import { useResizableWidth } from "@/lib/hooks/use-resizable-width"
import { BoardFooter } from "@/components/board/board-footer"
import { BoardHeader } from "@/components/board/board-header"
import { BoardDialogs } from "@/components/board/board-dialogs"
import { useBoardDialogActions } from "@/components/board/use-board-dialog-actions"
import { useBoardDispatch } from "@/components/board/use-board-dispatch"
import { useBoardDrops } from "@/components/board/use-board-drops"
import { useBoardSelection } from "@/components/board/use-board-selection"
import { useBoardSheets } from "@/components/board/use-board-sheets"
import { useMaterialClicks } from "@/components/board/use-material-clicks"
import { useResourceBindings } from "@/components/board/use-resource-bindings"
import { useBoardChecklist } from "@/components/board/use-board-checklist"
import { StationSetupStrip } from "@/components/station-setup-strip"
import { useBoardCommandHandlers } from "@/components/board/use-board-command-handlers"
import { useBoardCardActions } from "@/components/board/use-board-card-actions"
import { onAppEvent } from "@/lib/app-events"

export default function FireStationDashboard() {
  const {
    operations,
    formatLocation,
    refreshOperations,
    removeReko,
    updateOperation,
    setBoardDragging,
    createOperation,
    mergeOperationInto,
    assignVehicleToOperation,
    deleteOperation,
    materialOnSite,
    isLoading,
    isLoaded,
    boardNeverLoaded,
  } = useOperations()
  // The board's roster is "everybody checked in", so the Appell writing an
  // attendance row changes it — see `onAttendanceChange` on the modal below.
  const { personnel, refreshPersonnel } = usePersonnel()
  const { groups, getGroupResources } = useGroups()
  // The operator's own releases (card chips, detail panel) get
  // «… freigegeben · Rückgängig»; internal releases keep the raw context functions.
  const release = useReleaseUndo()

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
          personnelIds: resources.personnel.map((p) => p.resourceId),
          vehicleIds: resources.vehicles.map((v) => v.resourceId),
        }
      }),
    [groups, getGroupResources],
  )
  const driverEngagements = useMemo(
    () =>
      personnel
        .flatMap((person) =>
          person.isDriver && person.driverVehicleId ? [{ personnelId: person.id, vehicleId: person.driverVehicleId }] : [],
        ),
    [personnel],
  )
  const doubleBookedPersons = useDoubleBookedPersons(operations, groupEngagements, driverEngagements)
  // Where each person actually is, for the sidebar card's tooltip (§P3.5) —
  // computed once here, passed down, so the memoized cards stay cheap.
  const personEngagements = usePersonEngagements()
  // …and the same as search terms, so the sidebar search finds «12» or «Sturmholz».
  const personPlaces = usePersonPlaces()

  // The depot with BOTH deployments folded in – Einsätze and Aufträge – so the
  // material sidebar, its counter and every drop read one frei/gebunden.
  const { materials, materialGroups } = useMaterials()
  const { selectedEvent, isEventLoaded } = useEvent()
  // `isEditor` is off for a viewer and on a standby-led Ereignis.
  const { isEditor } = useAuth()
  // While a standby box leads the open Ereignis this board is look-only, but new things – an
  // Einsatz, a Verlauf line – may still be added (`StandbyProvider`).
  const { canAddNew } = useStandby()
  const canAdd = isEditor || canAddNew
  // «Personalermüdung (Std.)» — where the crew's time-on-duty figures turn amber.
  const fatigueHours = useNotifications().settings.fatigue_hours
  const router = useRouter()
  const isMobile = useIsMobile()
  // The desktop board's horizontal scroller (`#kanban-main`) – state, not a ref, so the
  // edge chips in the header start watching once it mounts (it is desktop-only).
  const [boardScroller, setBoardScroller] = useState<HTMLElement | null>(null)
  const boardEdge = useBoardEdgeOverflow(boardScroller)

  const tCommon = useTranslations('kanban.common')
  const tDash = useTranslations('kanban.dashboard')
  const tSidePanel = useTranslations('kanban.sidePanel')
  const tPanels = useTranslations('panels')

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
  // Each sidebar's «Filter & Sortierung», remembered per browser. Per-list on purpose: crew
  // and material are picked at different moments, so one shared switch would keep surprising
  // the other list.
  const [personnelView, setPersonnelView] = usePersistedState(PERSONNEL_VIEW_KEY, DEFAULT_PERSONNEL_VIEW, isPersonnelViewPrefs)
  const [materialView, setMaterialView] = usePersistedState(MATERIAL_VIEW_KEY, DEFAULT_MATERIAL_VIEW, isMaterialViewPrefs)
  const [newEmergencyModalOpen, setNewEmergencyModalOpen] = useState(false)
  // Both sidebars and the detail panel, remembered per device.
  const layout = useBoardLayoutPrefs(isMobile)
  const {
    sidePanelMode,
    setSidePanelMode,
    showLeftSidebar,
    setShowLeftSidebar,
    showRightSidebar,
    setShowRightSidebar,
  } = layout
  // Both sidebars' widths are the operator's, dragged by their inner edge and remembered on this
  // device (owner pick 09.11.2026). 256 = the w-64 they always had, and also the floor: any
  // narrower and «Person suchen …» / «Material suchen …» no longer fit beside their key hint
  // and toggle, while the rows already end in «Baumann Mi…».
  const personnelWidth = useResizableWidth({
    storageKey: 'kp-board-personnelWidth',
    defaultWidth: 256,
    min: 256,
    max: 384,
    side: 'right',
  })
  const materialWidth = useResizableWidth({
    storageKey: 'kp-board-materialWidth',
    defaultWidth: 256,
    min: 256,
    max: 384,
    side: 'left',
  })
  // Which columns this screen has folded away. Seven columns do not fit on
  // every command-post monitor, and the two that matter right now must not be
  // behind a horizontal scrollbar. Per DEVICE, not per operator account: the
  // fold answers «how wide is this monitor», which nobody wants inherited on
  // the next machine — same hook, same reasoning as both wall boards.
  const collapsedColumns = useCollapsedSections(BOARD_COLUMN_COLLAPSE_KEY, DEFAULT_COLLAPSED_COLUMN_IDS)

  const selection = useBoardSelection({ layout, expandColumn: collapsedColumns.expand })
  const {
    selectedOperationId,
    setSelectedOperationId,
    selectedOperation,
    hoveredOperationId,
    setHoveredOperationId,
    highlightedOperationId,
    spotlightActive,
    detailModalOpen,
    setDetailModalOpen,
    openDetailOnTab,
    mobileOpenRequest,
    openIncidentDetail,
    handleOpenIncidentFromNotification,
    scrollToCard,
    isDraggingOperationRef,
    handleCardClick,
    handleCardSelect,
    handleOperationUpdate,
    handleVehicleAssign,
    handleOperationDelete,
  } = selection

  const vehicleTypes = useVehicleShortcuts()
  const sheets = useBoardSheets()
  const { activeFooterSheet, setActiveFooterSheet, journalCompose, auftraegeFocusGroupId, setAuftraegeFocusGroupId } = sheets
  // Which sidebar row is currently showing its bindings, or null. One at a time
  // — the popover answers «wo ist die Person gerade?», and two answers at once
  // would be two questions.
  const [bindingsPopover, setBindingsPopover] = useState<BindingsPopoverState | null>(null)
  // When "+ Stop" opens the New-Emergency modal, the created incident attaches here.
  const [newEmergencyGroupId, setNewEmergencyGroupId] = useState<string | null>(null)
  // Auftrags-Editor modal: the Auftrag being edited + an optional stop to centre on.
  const [routenEditorGroupId, setRoutenEditorGroupId] = useState<string | null>(null)
  const [routenEditorFocusIncidentId, setRoutenEditorFocusIncidentId] = useState<string | null>(null)
  /** Body of the Divera-Mitteilung the Checkliste asked to send; null = closed. */
  const [diveraMessageText, setDiveraMessageText] = useState<string | null>(null)
  /** The Checkliste's «Reko-Personen wählen» picker. Page-owned like the Divera
   *  dialog — a modal mounted inside the checklist popover dies with it. */
  const [rekoPickerOpen, setRekoPickerOpen] = useState(false)

  const cmdHint = useCommandPaletteHint()
  // What the cards show. Per device (localStorage), not a station setting: one
  // workstation must be able to run Kompakt while the second screen runs Alles,
  // without either operator's click repainting the other's board mid-Einsatz.
  // The store keeps one stable object per value, so `cardView` can go straight
  // into the memoised column/card tree without a useMemo wrapper here.
  const { view: cardView, preset: cardViewPreset, applyPreset: applyCardViewPreset, toggleKey: toggleCardViewKey } = useCardView()

  // The Einsatz dialogs this page shares with the Lagekarte (assignment, Auftrag
  // picker, transfer, Divera, the status gates) – see incident-dialogs.tsx.
  const dialogs = useIncidentDialogs()
  const statusWorkflow = dialogs.statusWorkflow

  // Who drives what, for the whole board. One roster call here rather than one
  // per card; the cards render the driver next to the Funkrufname.
  const vehicleDrivers = useVehicleDrivers()

  // Thermal printer, Divera and the Funkrufname – what the buttons may offer.
  const { printerEnabled, diveraEnabled, funkrufname } = useStationCapabilities()
  // Thermal board print; the print sheet closes once the job is queued – unless the operator
  // has moved on to another sheet meanwhile.
  const closePrintSheet = useCallback(() => setActiveFooterSheet((prev) => (prev === 'print' ? null : prev)), [setActiveFooterSheet])
  const { print: handlePrintBoard, printing: isPrintingBoard } = usePrintBoard(selectedEvent?.id ?? null, closePrintSheet)

  const cardActions = useBoardCardActions(statusWorkflow)
  const {
    setRouteStopStatus,
    handleColumnSort,
    moveInColumn,
    handleToggleDriverStay,
    handleRequestDelete,
  } = cardActions

  const {
    checklistPopoverOpen,
    setChecklistOverridesVersion,
    handleChecklistOpenChange,
    checklistProgress,
  } = useBoardChecklist({
    selectedEvent,
    isMounted,
  })
  // One footer sheet at a time: another one opening (a pill, a shortcut, the Dienstzeiten
  // button) closes the Checkliste's. Opening the Checkliste closes the others (board-footer).
  const closeChecklistSheet = useEffectEvent(() => {
    if (checklistPopoverOpen) handleChecklistOpenChange(false)
  })
  useEffect(() => {
    if (activeFooterSheet) closeChecklistSheet()
  }, [activeFooterSheet])

  // Refresh operations immediately when Kanban page loads – once, whatever identity
  // `refreshOperations` has later.
  const refreshOnMount = useEffectEvent(() => refreshOperations())
  useEffect(() => {
    refreshOnMount()
  }, [])

  const drops = useBoardDrops({
    cardActions,
    statusWorkflow,
    closedStopGuard,
    isMounted,
    onOperationDrop: (operationId) => {
      // Auto-select dropped card in side panel
      setSelectedOperationId(operationId)
      setHoveredOperationId(operationId)
    },
  })

  // A card's context menu opens its route in the Auftrags-Editor directly, with
  // that stop focused, instead of detouring through the Aufträge sheet.
  useEffect(
    () =>
      onAppEvent('kp:open-routen-editor', ({ groupId, focusIncidentId }) => {
        setRoutenEditorGroupId(groupId)
        setRoutenEditorFocusIncidentId(focusIncidentId ?? null)
      }),
    [],
  )

  // No scroll lock while a footer sheet is open. There used to be one here
  // (`overflow: hidden` on `#kanban-main` and every column body), from when the
  // sheet's backdrop let the pointer through. The backdrop absorbs the pointer
  // now — wheel and drag over the board land on it, not on the board — so the
  // lock had nothing left to stop, and what it still did was hide the board's
  // horizontal scrollbar: the board grew by the bar's 10px under every open
  // sheet and left a bare strip at the bottom-right (owner, 10.10.2026).

  // Use shared resource filtering hook — sidebar search takes priority, top search also filters
  const effectivePersonnelQuery = personnelSearchQuery || searchQuery
  const effectiveMaterialQuery = materialSearchQuery || searchQuery
  // `filtered*` are what the searches leave; each sidebar's «Filter & Sortierung» narrows
  // that further and counts what it draws, so «0 von 17 sichtbar» never disagrees with it.
  const { filteredPersonnel, filteredMaterials } = useResourceFiltering(
    personnel,
    materials,
    effectivePersonnelQuery,
    effectiveMaterialQuery,
    personPlaces,
  )

  // The material sidebar's footer, from the same predicate its list is filtered
  // with — the counter and the list can no longer disagree about what counts as
  // free. The crew sidebar counts what it shows itself (`personnel-sidebar.tsx`).
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

  const resourceBindings = useResourceBindings({
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
  const { collectPersonPlaces, followBinding, followPersonNow, handlePersonClick } = resourceBindings
  const {
    handleMaterialClick,
    handleModuleMaterialClick,
    handleAggregateMaterialClick,
    handleToggleMaterialOutOfService,
  } = useMaterialClicks({ resourceBindings, setBindingsPopover })

  const dispatchRef = useBoardDispatch({
    drops,
    holdStatusMove: statusWorkflow.holdStatusMove,
    resourceBindings,
    layout,
    sheets,
    setPersonnelSearchQuery,
    setMaterialSearchQuery,
  })

  // Derived state for convenience
  const vehicleStatusSheetOpen = activeFooterSheet === 'vehicles'
  const printSheetOpen = activeFooterSheet === 'print'
  const auftraegeSheetOpen = activeFooterSheet === 'auftraege'
  const rapportBacklogSheetOpen = activeFooterSheet === 'rapporte'
  const linksSheetOpen = activeFooterSheet === 'links'
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

  const dialogActions = useBoardDialogActions({
    openIncidentDetail,
    sheets,
    closedStopGuard,
    openAssignment: dialogs.openAssignment,
  })
  const {
    stopPickerGroupId,
    setStopPickerGroupId,
    checkInUrl,
    copied,
    attendanceOpen,
    setAttendanceOpen,
    rekoAssignDialogOpen,
    setRekoAssignDialogOpen,
    rekoAssignOperationId,
    handleOpenRapport,
    openAttendance,
    assignmentLabelForPerson,
    checkInFromDivera,
    copyCheckInUrlToClipboard,
    handleConfirmAddStops,
    handleOpenRekoAssignDialog,
    handleToggleNachbarhilfe,
    handleToggleAmWarten,
    handleToggleZuFuss,
  } = dialogActions

  useBoardCommandHandlers({
    selection,
    layout,
    sheets,
    cardActions,
    dialogs,
    dialogActions,
    dispatchRef,
    openChecklist: () => handleChecklistOpenChange(true),
    newEmergencyModalOpen,
    setNewEmergencyModalOpen,
    printerEnabled,
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
        <BoardHeader
          isMobile={isMobile}
          boardEdge={boardEdge}
          filteredOperations={filteredOperations}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          selectedOperationId={selectedOperationId}
        />
        {/* What a freshly claimed station still has to set up – admin only, gone once done. */}
        <StationSetupStrip className="mx-4 mt-3 hidden shrink-0 md:block md:mx-6" />

        {/* Mobile View */}
        {isMobile ? (
          <MobileIncidentListView
            operations={filteredOperations}
            materials={materials}
            formatLocation={formatLocation}
            isEditor={isEditor}
            isTraining={selectedEvent?.training_flag}
            isLoading={isLoading}
            onNewIncident={canAdd ? () => setNewEmergencyModalOpen(true) : undefined}
            openRequest={mobileOpenRequest}
          />
        ) : (
          /* Desktop View */
          <>
        <div className="relative flex flex-1 overflow-hidden">
          {/* Each sidebar stands in a SlideRail: the drag width, the 110 ms slide that moves the
              board with it, and the `z-raised` layer their collapse handles need – a handle
              straddles the inner edge, so half of it hangs over the board, and the board block
              follows the LEFT sidebar in DOM order with an opaque background, which painted
              that half away while the layer was missing. The right one only ever looked fine
              because it comes after the board. */}
          <SlideRail
            open={showLeftSidebar}
            dock="left"
            resize={personnelWidth}
            gripLabel={tPanels('resize.personnel')}
            gripHint={tPanels('resizeHint')}
          >
            <PersonnelSidebar
              setShowLeftSidebar={setShowLeftSidebar}
              personnelSearchQuery={personnelSearchQuery}
              setPersonnelSearchQuery={setPersonnelSearchQuery}
              setSearchQuery={setSearchQuery}
              isMobile={isMobile}
              personnelView={personnelView}
              setPersonnelView={setPersonnelView}
              isLoaded={isLoaded}
              boardNeverLoaded={boardNeverLoaded}
              personnel={personnel}
              checkInUrl={checkInUrl}
              copied={copied}
              copyCheckInUrlToClipboard={copyCheckInUrlToClipboard}
              filteredPersonnel={filteredPersonnel}
              effectivePersonnelQuery={effectivePersonnelQuery}
              bindingsPopover={bindingsPopover}
              setBindingsPopover={setBindingsPopover}
              handlePersonClick={handlePersonClick}
              collectPersonPlaces={collectPersonPlaces}
              release={release}
              doubleBookedPersons={doubleBookedPersons}
              personEngagements={personEngagements}
              followBinding={followBinding}
              eventId={selectedEvent?.id ?? null}
              canCheckIn={isEditor}
              onDiveraCheckIn={checkInFromDivera}
              onOpenCrewDuty={() => setActiveFooterSheet(prev => prev === 'crew' ? null : 'crew')}
              onOpenAttendance={openAttendance}
            />
          </SlideRail>

          {/* The board and its three reopen tabs share one containing block, so
              `left-1` / `right-1` mean the BOARD's edges — not the window's —
              whether or not the detail panel is open.

              Every tab is PINNED (absolute, `z-pinned`), never a flex item. A flex
              item reserves its width down the entire height of the board, so a
              48px tab left a 28px column of nothing running the full height
              beside the Material-Leiste: an empty band between a sliced-off card
              and the sidebar's border, which is what «die hässlichen Linien»
              were both times. Out of flow the board keeps the full width and the
              tab is what it looks like — a control pinned to the edge, opaque
              (`bg-card`) and shadowed so scrolled cards pass behind it. */}
          {/* `min-w-64`: the room the board keeps when the rails beside it were dragged wide –
              they yield first (SlideRail), down to their own minimum. */}
          <div className="relative flex min-w-64 flex-1">
          {/* Main Kanban Board */}
          <main
            id="kanban-main"
            ref={setBoardScroller}
            data-spotlight={spotlightActive ? 'on' : undefined}
            // No bottom padding: with `overflow-x-auto` the horizontal scrollbar
            // already sits below the columns, so a pb-4 underneath it drew a
            // second empty band between the board and the footer.
            //
            // The side that carries a reopen tab gets 8 instead of 4 — the tab is
            // pinned over the board, and the extra 16px is what keeps it off the
            // outer column at rest. It is the board's own margin, not a strip of
            // its own, so nothing is drawn beside the board.
            //
            // `@container` + `--board-pr`: the columns size themselves from this box and
            // its right padding (droppable-column.tsx, «five open columns»).
            className={cn(
              "@container flex-1 overflow-x-auto overscroll-contain pt-4 pb-0 pr-(--board-pr) bg-muted/30 dark:bg-background",
              showLeftSidebar ? "pl-4" : "pl-8",
              showRightSidebar ? "[--board-pr:1rem]" : "[--board-pr:2rem]",
            )}
          >
            {/* A board that never arrived gets the error panel, not seven
                empty columns counting «0» — see BoardLoadErrorPanel. */}
            {!isLoaded ? null : boardNeverLoaded ? (
              <BoardLoadErrorPanel />
            ) : (
              <div className="flex h-full gap-3 animate-in fade-in duration-300">
                {columns.map((column) => {
                  const columnOps = filteredOperations.filter((op) => column.id === op.status)
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
                      onAssignResource={dialogs.openAssignment}
                      onAssignReko={handleOpenRekoAssignDialog}
                      onToggleNachbarhilfe={handleToggleNachbarhilfe}
                      onToggleAmWarten={handleToggleAmWarten}
                      onToggleZuFuss={handleToggleZuFuss}
                      onRequestComplete={isEditor ? statusWorkflow.requestCompletion : undefined}
                      onRequestDelete={isEditor ? handleRequestDelete : undefined}
                      onMoveInColumn={isEditor ? moveInColumn : undefined}
                      onTransfer={isEditor ? dialogs.openTransfer : undefined}
                      onDistributeToAuftrag={isEditor ? dialogs.openAuftragPicker : undefined}
                      onRepeatRadio={isEditor ? dialogs.statusWorkflow.repeatDisponiert : undefined}
                      cardView={cardView}
                      dominantIncidentType={dominantIncidentType}
                      printerEnabled={printerEnabled}
                      vehicleDrivers={vehicleDrivers}
                      doubleBookedCrewIds={doubleBookedPersons.ids}
                      canDrag={isEditor}
                      onDragActiveChange={setBoardDragging}
                      onSort={isEditor ? handleColumnSort : undefined}
                      isCollapsed={collapsedColumns.isCollapsed(column.id)}
                      onToggleCollapsed={collapsedColumns.toggle}
                      searchActive={searchQuery.trim() !== ""}
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
            <ShortcutTooltip label={tDash('toggleLeftSidebar')} keys={['Q']} side="right">
              <button
                onClick={() => setShowLeftSidebar(true)}
                className="absolute hit-area left-1 top-1/2 z-pinned flex h-12 w-5 min-w-0 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:bg-secondary/60 hover:text-foreground"
                aria-label={tDash('toggleLeftSidebar')}
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </ShortcutTooltip>
          )}

          {/* Einsatz-Detail reopen tab — only while the Material-Leiste is folded
              too; with the Leiste open the control leads its search row instead
              (material-sidebar.tsx), off the board. `2xl:` is SIDE_PANEL_BREAKPOINT
              — below it the panel does not exist, so neither does its tab. */}
          {sidePanelMode === 'collapsed' && !showRightSidebar && (
            <ShortcutTooltip label={tSidePanel('railLabel')} keys={['I']} side="left">
              <button
                onClick={() => setSidePanelMode('detail')}
                className="absolute hit-area right-1 top-3 z-pinned hidden h-12 w-5 min-w-0 cursor-pointer items-center justify-center rounded-md border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:bg-secondary/60 hover:text-foreground 2xl:flex"
                aria-label={tSidePanel('railLabel')}
              >
                <PanelRight className="h-4 w-4" />
              </button>
            </ShortcutTooltip>
          )}

          {/* Material-Leiste reopen tab (shown when collapsed; "]" also toggles). */}
          {!showRightSidebar && (
            <ShortcutTooltip
              label={
                materialOnSiteEntries.length > 0
                  ? `${tDash('toggleRightSidebar')} · ${tDash('materialOnSite.toggle', { count: materialOnSiteEntries.length })}`
                  : tDash('toggleRightSidebar')
              }
              keys={['W']}
              side="left"
            >
              <button
                onClick={() => setShowRightSidebar(true)}
                className="absolute hit-area right-1 top-1/2 z-pinned flex h-12 w-5 min-w-0 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:bg-secondary/60 hover:text-foreground"
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
            </ShortcutTooltip>
          )}
          </div>

          {/* Side Panel for ultrawide monitors */}
          <SidePanel
            mode={sidePanelMode}
            onModeChange={setSidePanelMode}
            // Collapsed, the panel renders nothing here — its reopen control
            // leads the Material-Leiste's search row (or, with the Leiste folded
            // too, is a tab pinned in the board's corner above).
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
            onRemoveCrew={isEditor ? release.releaseCrew : undefined}
            onRemoveMaterial={isEditor ? release.releaseMaterial : undefined}
            canEdit={isEditor}
            diveraEnabled={isEditor && diveraEnabled}
            {...dialogs.detailActions}
          />

          {/* Same SlideRail as the left sidebar — see the note there. While the detail is
              folded its reopen control leads the search row, and the rail grows by its 2rem
              (`--rail-extra`) from SIDE_PANEL_BREAKPOINT (2xl) up, where that control exists. */}
          <SlideRail
            open={showRightSidebar}
            dock="right"
            resize={materialWidth}
            gripLabel={tPanels('resize.material')}
            gripHint={tPanels('resizeHint')}
            className={sidePanelMode === 'collapsed' ? '2xl:[--rail-extra:2rem]' : undefined}
          >
            <MaterialSidebar
              setShowRightSidebar={setShowRightSidebar}
              materialSearchQuery={materialSearchQuery}
              setMaterialSearchQuery={setMaterialSearchQuery}
              setSearchQuery={setSearchQuery}
              isMobile={isMobile}
              materialView={materialView}
              setMaterialView={setMaterialView}
              materialOnSiteEntries={materialOnSiteEntries}
              openIncidentDetail={openIncidentDetail}
              isLoaded={isLoaded}
              boardNeverLoaded={boardNeverLoaded}
              isEditor={isEditor}
              materials={materials}
              materialGroups={materialGroups}
              filteredMaterials={filteredMaterials}
              effectiveMaterialQuery={effectiveMaterialQuery}
              handleMaterialClick={handleMaterialClick}
              handleModuleMaterialClick={handleModuleMaterialClick}
              handleAggregateMaterialClick={handleAggregateMaterialClick}
              handleToggleMaterialOutOfService={handleToggleMaterialOutOfService}
              bindingsPopover={bindingsPopover}
              setBindingsPopover={setBindingsPopover}
              followBinding={followBinding}
              materialSummary={materialSummary}
              onOpenSidePanel={sidePanelMode === 'collapsed' ? () => setSidePanelMode('detail') : undefined}
            />
          </SlideRail>

        </div>

        <BoardFooter
          applyCardViewPreset={applyCardViewPreset}
          auftraegeSheetOpen={auftraegeSheetOpen}
          cardView={cardView}
          cardViewPreset={cardViewPreset}
          checklistPopoverOpen={checklistPopoverOpen}
          checklistProgress={checklistProgress}
          cmdHint={cmdHint}
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
        assignmentLabelForPerson={assignmentLabelForPerson}
        attendanceOpen={attendanceOpen}
        auftraegeFocusGroupId={auftraegeFocusGroupId}
        auftraegeSheetOpen={auftraegeSheetOpen}
        closedStopGuard={closedStopGuard}
        createOperation={createOperation}
        mergeOperationInto={mergeOperationInto}
        detailModalOpen={detailModalOpen}
        dialogs={dialogs}
        diveraEnabled={diveraEnabled}
        diveraMessageText={diveraMessageText}
        filedRapports={filedRapports}
        funkrufname={funkrufname}
        groups={groups}
        handleConfirmAddStops={handleConfirmAddStops}
        handleOpenIncidentFromNotification={handleOpenIncidentFromNotification}
        journalCompose={journalCompose}
        handleOpenRapport={handleOpenRapport}
        handleOperationDelete={handleOperationDelete}
        handleOperationUpdate={handleOperationUpdate}
        handlePrintBoard={handlePrintBoard}
        handleVehicleAssign={handleVehicleAssign}
        isEditor={isEditor}
        isPrintingBoard={isPrintingBoard}
        linksSheetOpen={linksSheetOpen}
        materials={materials}
        newEmergencyGroupId={newEmergencyGroupId}
        newEmergencyModalOpen={newEmergencyModalOpen}
        openAttendance={openAttendance}
        openDetailOnTab={openDetailOnTab}
        openIncidentDetail={openIncidentDetail}
        openRapports={openRapports}
        operations={operations}
        crewDutySheetOpen={crewDutySheetOpen}
        followPersonNow={followPersonNow}
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
        rekoPickerOpen={rekoPickerOpen}
        release={release}
        routenEditorFocusIncidentId={routenEditorFocusIncidentId}
        routenEditorGroupId={routenEditorGroupId}
        selectedEvent={selectedEvent}
        selectedOperation={selectedOperation}
        setActiveFooterSheet={setActiveFooterSheet}
        setAttendanceOpen={setAttendanceOpen}
        setDetailModalOpen={setDetailModalOpen}
        setDiveraMessageText={setDiveraMessageText}
        setNewEmergencyGroupId={setNewEmergencyGroupId}
        setNewEmergencyModalOpen={setNewEmergencyModalOpen}
        setRekoAssignDialogOpen={setRekoAssignDialogOpen}
        setRekoPickerOpen={setRekoPickerOpen}
        setRouteStopStatus={setRouteStopStatus}
        setRoutenEditorFocusIncidentId={setRoutenEditorFocusIncidentId}
        setRoutenEditorGroupId={setRoutenEditorGroupId}
        setStopPickerGroupId={setStopPickerGroupId}
        stopPickerGroupId={stopPickerGroupId}
        vehicleStatusSheetOpen={vehicleStatusSheetOpen}
      />
      <IncidentDialogs
        dialogs={dialogs}
        vehicles={vehicleTypes}
        printerEnabled={printerEnabled}
        funkrufname={funkrufname}
        diveraEnabled={diveraEnabled}
        onOpenDetail={openIncidentDetail}
        onShowCheckIn={() => setActiveFooterSheet('links')}
      />
    </ProtectedRoute>
  )
}
