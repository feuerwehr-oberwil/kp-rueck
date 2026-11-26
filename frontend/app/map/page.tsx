"use client"

/**
 * The map view.
 *
 * A `viewer` reaches it on a phone only (the phone shell, read-only – lib/role-home.ts);
 * anywhere wider `ProtectedRoute` sends it to `/display/board`. So the `isEditor` checks
 * below are constant-true on the desk and live on the phone – see the note in
 * `components/protected-route.tsx` for what actually enforces the role.
 */

import { PhoneEventHead } from '@/components/mobile/phone-event-pill'
import { MapIncidentPeek } from '@/components/mobile/map-incident-peek'
import { nextPickupId, openPickups } from '@/lib/map-pickups'
import { useState, useMemo, useEffect, useRef, useCallback, useReducer } from "react"
import { useEffectEvent } from "@/lib/hooks/use-effect-event"
import dynamic from "next/dynamic"
import { useSearchParams, useRouter } from "next/navigation"

import { rekoColorOrder, rekoPersonColor } from "@/lib/kanban-utils"
import { getIncidentRefLabel } from "@/lib/incident-types"
import { useIncidents, useOperations } from "@/lib/contexts/operations-context"
import { useGroups } from "@/lib/contexts/groups-context"
import { useReleaseUndo } from "@/lib/hooks/use-release-undo"
import { useRoutePlanning } from "@/lib/hooks/use-route-planning"
import { RoutenplanungPanel } from "@/components/map/routenplanung-panel"
import { ResizeGrip } from "@/components/ui/resize-grip"
import { RekoModusPanel } from "@/components/map/reko-modus-panel"
import type { RekoRoute } from "@/components/map/reko-route"
import { openRekosByPerson, rekoEditorTap } from "@/lib/reko-order"
import { useEvent } from "@/lib/contexts/event-context"
import { useAuth } from "@/lib/contexts/auth-context"
import { ProtectedRoute } from "@/components/protected-route"
import { useBootGate } from "@/lib/boot-cover"
import { TrainingBand } from "@/components/training-mode-chrome"
import { MobileBottomNavigation } from "@/components/mobile-bottom-navigation"
import { OperationDetailModal } from "@/components/kanban/operation-detail-modal"
import { MobileIncidentDetailSheet } from "@/components/mobile/mobile-incident-detail-sheet"
import { incidentDetailTarget } from "@/lib/incident-detail"
import { type DetailTarget } from "@/lib/detail-target"
import type { OperationDetailSection, OperationDetailTab } from "@/lib/hooks/use-operation-detail-shortcuts"
import { IncidentDialogs, useIncidentDialogs } from "@/components/kanban/incident-dialogs"
import { toast } from "sonner"
import { useIsMobile } from "@/components/ui/use-mobile"
import { useOperationHandlers } from "@/lib/hooks/use-operation-handlers"
import { useStationCapabilities } from "@/lib/hooks/use-station-capabilities"
import { useVehicleShortcuts } from "@/lib/contexts/operations/use-vehicle-shortcuts"
import { useCrossWindowSync } from "@/lib/hooks/use-cross-window-sync"
import { useTranslations } from "next-intl"
import { translateOutsideReact } from "@/lib/i18n-messages"
import { LoadingStatus } from "@/components/ui/shell-loader"
import { AUFTRAGS_EDITOR_CLOSED, changeAuftragsEditor } from "./auftrags-editor"
import { PlanningAddConfirm, RekoOverwriteConfirm, type PlanningAddQuestion, type RekoOverwriteQuestion } from "./editor-confirms"
import { MapIncidentRail } from "./incident-rail"
import { MapPageHeader } from "./map-page-header"
import { useMapViewOptions } from "./map-view-options"
import { PhoneMapCountChip, PhoneMapSearch } from "./phone-map-chrome"
import { useMapIncidentLists } from "./use-map-incident-lists"
import { useMapShortcuts } from "./use-map-shortcuts"
import { MapViewMenu } from "./view-menu"
import { useMapNotificationHandlers } from "./use-map-notification-handlers"
import { useMarkerColors } from "./use-marker-colors"
import { useRailWidth } from "./use-rail-width"

// Dynamically import map to avoid SSR issues – MapLibre GL needs a browser (WebGL, workers)
const MapView = dynamic(() => import("@/components/map/map-view"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-muted rounded-lg">
      <LoadingStatus size="surface" className="text-sm">{translateOutsideReact('map.page.loading')}</LoadingStatus>
    </div>
  ),
})


export default function MapPage() {
  const t = useTranslations('map')
  const tKanban = useTranslations('kanban')
  const { incidents, formatLocation, refreshIncidents } = useIncidents()
  const {
    operations,
    personnel,
    materials,
    updateOperation,
    changeStatusToTop,
    assignVehicleToOperation,
    assignRekoPersonToOperation,
    removeReko,
    deleteOperation,
    isLoaded: operationsLoaded,
    specialFunctions,
  } = useOperations()
  const { selectedEvent, isEventLoaded } = useEvent()
  // A launch onto the Lagekarte stays behind the snail until the incidents are in AND the map
  // has drawn its first frame (`idle`: style, tiles and markers) — not an empty grey box.
  const [mapIdle, setMapIdle] = useState(false)
  const tBoot = useTranslations('map.page')
  const tPanels = useTranslations('panels')
  useBootGate('map', operationsLoaded && mapIdle, tBoot('loading'))
  // vehicle id → driver name, live — the rail's vehicle chips carry the same
  // «Name · Funkrufname (Fahrer)» line the board card shows.
  const { isEditor } = useAuth()
  const {
    groups,
    createGroup,
    addStops,
    getGroupResources,
  } = useGroups()
  // The operator's own releases get «… freigegeben · Rückgängig» (lib/release-undo.ts).
  const release = useReleaseUndo()
  const searchParams = useSearchParams()
  const router = useRouter()
  const highlightParam = searchParams.get("highlight")
  const isMobile = useIsMobile()
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(
    highlightParam
  )
  const [selectedOperationId, setSelectedOperationId] = useState<string | null>(null)
  const [detailModalOpen, setDetailModalOpen] = useState(false)
  // Which tab (and block inside it) the modal should land on when something
  // pointed at more than "this incident" — the completion gate's «Reko-Details
  // öffnen», for one. The nonce is what makes a second deep link to the SAME
  // incident move the tab again.
  const [detailOnTab, setDetailOnTab] = useState<
    { tab: OperationDetailTab; nonce: number; section?: OperationDetailSection } | null
  >(null)
  const { printerEnabled, diveraEnabled, funkrufname } = useStationCapabilities()
  // Derive current operation from operations array to get real-time updates
  const selectedOperation = useMemo(() => {
    if (!selectedOperationId) return null
    return operations.find(op => op.id === selectedOperationId) || null
  }, [selectedOperationId, operations])
  const [resetZoomTrigger, setResetZoomTrigger] = useState(0)
  // Flies the map to the selected Einsatz again although the selection did not change – the
  // phone sheet's «Auf Karte anzeigen» after the map was panned away from it.
  const [panTrigger, setPanTrigger] = useState(0)
  const [searchQuery, setSearchQuery] = useState("")
  // «Ansicht»: status groups, layers and «Färben nach» – one object, one change function.
  const [view, changeView] = useMapViewOptions()
  const { statusFilters, colorBy } = view
  // The board's numbering (display_order), so «3» is the same truck on both screens.
  const vehicleTypes = useVehicleShortcuts()
  // Zuweisungslinien and Distanz are drawn from vehicle GPS positions. Without
  // GPS (a station without Traccar, the demo) they can never show anything, so
  // the map reports what it knows and the options disappear rather than lie.
  const [gpsAvailable, setGpsAvailable] = useState(false)
  // «Wetter»: the radar layer. Offered only when the backend serves weather (WEATHER_ENABLED);
  // the map reports that, like GPS above.
  const [weatherAvailable, setWeatherAvailable] = useState(false)
  // Editor-only Auftrags-Editor mode: off, open without an Auftrag, or open on a route.
  const [editor, changeEditor] = useReducer(changeAuftragsEditor, AUFTRAGS_EDITOR_CLOSED)
  const planningActive = editor.kind !== 'off'
  const route = editor.kind === 'route' ? editor : null
  const focusStop = (stopId: string | null) => changeEditor({ type: 'focusStop', stopId })
  // Reko-Editor — editor-only reko dispatching from the map (panel + marker taps).
  const [rekoModeActive, setRekoModeActive] = useState(false)
  const [rekoPersonId, setRekoPersonId] = useState<string | null>(null)
  // Tap on an incident that already has a different reko person → confirm
  // before replacing them (guards against stray taps in dispatch mode).
  const [rekoOverwrite, setRekoOverwrite] = useState<RekoOverwriteQuestion | null>(null)
  const rekoOverwriteIncident = rekoOverwrite ? operations.find((op) => op.id === rekoOverwrite.operationId) : undefined
  // Shared routing hook — active only while planning a selected group.
  const planning = useRoutePlanning(route?.groupId ?? null)
  // Desktop: the right rail's width, dragged by its left edge (use-rail-width.ts).
  const { railWidth, railRef } = useRailWidth()
  // id → Operation lookup for the GroupRoutes overlay (stops are real incidents).
  const operationsById = useMemo(
    () => new Map(operations.map((op) => [op.id, op] as const)),
    [operations],
  )
  const [focusVehicleName, setFocusVehicleName] = useState<string | null>(null)
  const [focusVehicleTrigger, setFocusVehicleTrigger] = useState(0)
  // Stable (setters only): the shortcuts hook registers them with the command palette.
  const focusVehicle = useCallback((vehicleName: string) => {
    setFocusVehicleName(vehicleName)
    setFocusVehicleTrigger((prev) => prev + 1)
  }, [])
  const resetZoom = useCallback(() => {
    setResetZoomTrigger((prev) => prev + 1)
    setSelectedIncidentId(null)
  }, [])

  // Cross-window sync (bidirectional)
  const { broadcast } = useCrossWindowSync({
    onMessage: (msg) => {
      if (msg.type === "incident:selected") {
        setSelectedIncidentId(msg.incidentId)
      }
    },
  })

  // Ask-first for a planning add without an undo — see handleIncidentClick.
  const [planningAddConfirm, setPlanningAddConfirm] = useState<PlanningAddQuestion | null>(null)

  const handleIncidentClick = (incidentId: string) => {
    // In Auftrags-Editor mode with a selected route, clicking an incident marker
    // adds that incident to the route instead of selecting it on the map.
    if (route) {
      const group = groups.find((g) => g.id === route.groupId)
      if (group?.stopIds.includes(incidentId)) {
        toast.info(t('planning.stopAlreadyOnRoute'))
      } else {
        // Two adds that cannot be taken back ask first (no undo yet): pulling
        // a stop OUT of another Auftrag, and folding an already disponierten
        // Einsatz into the route. Same guard as the board's picker.
        const op = operations.find((candidate) => candidate.id === incidentId)
        const otherGroup =
          op?.groupId && op.groupId !== route.groupId
            ? groups.find((g) => g.id === op.groupId)
            : undefined
        const dispatched = !!op && ['enroute', 'active', 'returning'].includes(op.status)
        if (otherGroup || dispatched) {
          setPlanningAddConfirm({
            incidentId,
            incidentLabel: op ? getIncidentRefLabel(op, 40) : '',
            fromName: otherGroup?.name ?? null,
            groupId: route.groupId,
            toName: group?.name ?? '',
          })
          return
        }
        void addStops(route.groupId, [incidentId]).then((ok) => {
          if (ok) toast.success(t('planning.stopAdded'))
        })
      }
      return
    }
    // In Reko-Editor with a selected person, tapping a marker toggles that
    // person's reko assignment on the incident instead of selecting it.
    if (rekoModeActive && rekoPersonId) {
      const person = personnel.find((p) => p.id === rekoPersonId)
      const operation = operations.find((op) => op.id === incidentId)
      if (!person || !operation) return
      const tap = rekoEditorTap(operation, rekoPersonId)
      if (tap.kind === "release") removeReko(incidentId)
      else if (tap.kind === "saving") toast.info(tKanban('common.rekoStillSaving', { name: person.name }))
      else if (tap.kind === "replace") {
        setRekoOverwrite({
          operationId: incidentId,
          currentName: tap.current.name,
          nextId: person.id,
          nextName: person.name,
        })
      } else assignRekoPersonToOperation(person.id, person.name, incidentId)
      return
    }
    if (incidentId === selectedIncidentId) {
      // Toggle: the second click deselects, which also closes the pinned
      // detail card on the marker.
      setSelectedIncidentId(null)
    } else {
      // Different incident - update selection
      setSelectedIncidentId(incidentId)
      broadcast("incident:selected", incidentId)
    }
  }

  // Enter/exit Auftrags-Editor; entering forces the route overlay on.
  // Both modes clear the current selection so no stale highlight competes
  // with the mode's own map emphasis.
  const enterPlanning = () => {
    exitRekoMode()
    setSelectedIncidentId(null)
    changeEditor({ type: 'open', firstGroupId: groups[0]?.id ?? null })
  }
  const exitPlanning = () => changeEditor({ type: 'close' })

  // Enter/exit Reko-Editor; mutually exclusive with Auftrags-Editor (both swap the
  // sidebar). Entering auto-colours markers by reko person so each person's
  // work reads apart on the map; exit restores the previous dimension.
  const enterRekoMode = () => {
    exitPlanning()
    setSelectedIncidentId(null)
    changeView({ type: 'rekoColors', on: true })
    setRekoModeActive(true)
  }
  const exitRekoMode = () => {
    setRekoModeActive(false)
    setRekoPersonId(null)
    changeView({ type: 'rekoColors', on: false })
  }

  // `?mode=reko` — the Setup-Checkliste's "Reko-Editor öffnen" links here rather
  // than telling the operator where to look. Once only: leaving the mode must
  // not be undone by a re-render, and the URL is not the state.
  // `enterRekoMode` is re-created every render; the URL is what decides here.
  const rekoDeepLinkRef = useRef(false)
  const enterRekoModeFromLink = useEffectEvent(enterRekoMode)
  useEffect(() => {
    if (rekoDeepLinkRef.current || searchParams.get('mode') !== 'reko') return
    rekoDeepLinkRef.current = true
    enterRekoModeFromLink()
  }, [searchParams])

  // The phone has no Routenplanung and no Reko-Modus (owner, 24.11.2026): both are KP-desk
  // tools that swap the whole list for their panel. A `?mode=reko` link opened on a phone, or a
  // window narrowed below `md` mid-mode, leaves them – set during render, React's pattern for
  // state that follows another value, so no effect has to catch up. A question either mode had
  // open goes with it: confirmed afterwards, it would still change the route or the Reko.
  if (isMobile && (planningActive || rekoModeActive)) {
    exitPlanning()
    exitRekoMode()
    setPlanningAddConfirm(null)
    setRekoOverwrite(null)
  }

  // Create a new Auftrag from the panel and select it for planning.
  const handleCreatePlanningGroup = async (name: string, color: string) => {
    const created = await createGroup({ name, color })
    if (created) changeEditor({ type: 'pickGroup', groupId: created.id })
  }

  // Empty-map click while "Stop hinzufügen" is active → append a geocoded stop.
  const handleMapAddStop = (lat: number, lng: number) => {
    void planning.addStopAtLatLng(lat, lng)
  }

  // Selecting an incident (marker tap, cross-window sync, ?highlight=) scrolls
  // its card into view in the Einsätze panel so the expanded details are
  // visible without hunting. 'nearest' keeps an already-visible card still.
  useEffect(() => {
    if (!selectedIncidentId) return
    document
      .getElementById(`map-incident-card-${selectedIncidentId}`)
      ?.scrollIntoView({ behavior: "smooth", block: "nearest" })
  }, [selectedIncidentId])

  /**
   * «Open this Einsatz» — the ONE function behind every entry point on the map: the desk's list
   * row (double-click), its «Details anzeigen» icon, the E/Enter shortcut, a marker double-click
   * and the phone peek's «Alle Details». Where it goes is `incidentDetailTarget`
   * (lib/incident-detail.ts):
   *
   * - desktop: back to the board, into its detail side panel — the detail belongs next to the
   *   columns, and a second copy over the map meant two surfaces mounting the same forms;
   * - phone: the standard phone Einsatz sheet, right here over the Lagekarte. The board link
   *   landed a phone on the board's narrow fallback (the desktop modal in a centred box) and off
   *   the map (owner, 03.10.).
   *
   * The incident stays selected: a double-click is two clicks first, and the second one would
   * otherwise have toggled the selection off again. Selecting flies the map to it, so on the
   * phone the sheet opens over a map that already shows the Einsatz. `target` is for a pointer
   * that names a tab (a notification): the board panel opens on it, the phone sheet scrolls to
   * its block.
   */
  const [phoneDetailId, setPhoneDetailId] = useState<string | null>(null)
  const [phoneDetailTarget, setPhoneDetailTarget] = useState<DetailTarget | undefined>(undefined)
  const phoneDetailOperation = useMemo(
    () => (phoneDetailId ? operations.find((op) => op.id === phoneDetailId) ?? null : null),
    [phoneDetailId, operations],
  )
  const openIncidentDetail = useCallback((incidentId: string, detailTarget?: DetailTarget) => {
    setSelectedIncidentId(incidentId)
    const target = incidentDetailTarget(incidentId, { phone: isMobile, target: detailTarget })
    if (target.kind === 'phone-sheet') {
      setPhoneDetailId(target.incidentId)
      setPhoneDetailTarget(detailTarget)
    } else router.push(target.href)
  }, [router, isMobile])
  // The phone sheet's «Auf Karte anzeigen» from here: the Lagekarte is this page, so it closes
  // the sheet and flies to the marker instead of loading `/map?highlight=` over itself.
  // It also rides the filter exception below, so an Einsatz that turned «Beendet» while the
  // sheet was open still shows when the map flies to it.
  const [showOnMapId, setShowOnMapId] = useState<string | null>(null)
  const showPhoneDetailOnMap = useCallback((incidentId: string) => {
    setPhoneDetailId(null)
    setSelectedIncidentId(incidentId)
    setShowOnMapId(incidentId)
    setPanTrigger((n) => n + 1)
  }, [])
  // The phone's other ways to an Einsatz on the map – a search hit, the Abholung chip: select it
  // (its peek opens), fly there although it may be selected already, show it whatever the status
  // filters say, and tell the other windows, as a marker tap does.
  const focusOnPhoneMap = (incidentId: string) => {
    if (incidentId !== selectedIncidentId) broadcast("incident:selected", incidentId)
    showPhoneDetailOnMap(incidentId)
  }

  // Use shared operation handlers hook
  const { handleOperationUpdate, handleOperationDelete } = useOperationHandlers({
    selectedOperation,
    updateOperation,
    assignVehicleToOperation,
    deleteOperation,
  })

  // The Einsatz dialogs this page shares with the board (assignment, Auftrag
  // picker, transfer, Divera, the status gates) – see incident-dialogs.tsx.
  const dialogs = useIncidentDialogs()

  // The bell and its toasts: the phone opens its sheet here, the field buttons work here.
  useMapNotificationHandlers({ isMobile, isEditor, openIncidentDetail, changeStatusToTop })

  // Reko-Editor data: reko-marked people and their open (reko not yet done)
  // incidents, each list in the person's order (`lib/reko-order.ts`). The selected
  // person's Rekos become enlarged, numbered pins on a dotted line in their colour,
  // so proximity between their work and unassigned incidents reads off the map.
  const rekoPeople = useMemo(() => personnel.filter((p) => p.isReko), [personnel])
  const rekoOpenByPerson = useMemo(() => openRekosByPerson(operations), [operations])
  const rekoOrder = useMemo(() => rekoColorOrder(specialFunctions), [specialFunctions])
  const rekoColors = useMemo(
    () => new Map(rekoPeople.map((p) => [p.id, rekoPersonColor(p.id, rekoOrder)])),
    [rekoPeople, rekoOrder],
  )
  const rekoRoute = useMemo<RekoRoute | null>(() => {
    if (!rekoModeActive || !rekoPersonId) return null
    const open = rekoOpenByPerson.get(rekoPersonId) ?? []
    return { color: rekoPersonColor(rekoPersonId, rekoOrder), incidentIds: open.map((op) => op.id) }
  }, [rekoModeActive, rekoPersonId, rekoOpenByPerson, rekoOrder])

  const { markerAccents, colorLegend } = useMarkerColors({ operations, colorBy, groups, rekoOrder })

  // «Auf der Karte öffnen» on an abgeschlossener Einsatz: the deep-linked
  // incident must show even when its status group (Beendet, hidden by default)
  // is filtered out. It rides as a one-time exception ON TOP of the filters —
  // the filter toggles themselves stay untouched (Bastian's decided behavior).
  // The exception lasts exactly as long as that incident stays selected;
  // picking anything else lets the normal filters take over again. The phone sheet's
  // «Auf Karte anzeigen» (`showOnMapId`) is the same act without the URL.
  const deepLinkExceptionId =
    [highlightParam, showOnMapId].find((id) => id && id === selectedIncidentId) ?? null

  const { statusGroupCounts, shownIncidents, activeIncidents, sections, searchHits } = useMapIncidentLists({
    incidents,
    statusFilters,
    exceptionId: deepLinkExceptionId,
    searchQuery,
  })

  // The phone Lagekarte (owner pick 3A, 24.11.2026): the map fills the screen. The list is the
  // Einsätze tab; here the search answers with hits in a panel under the field (every status, as
  // the rail's sections hold them – a hit that is filtered out still shows when picked), and a
  // pick flies there and opens its peek. The hits close on a pick and on a tap on the map.
  const [searchHitsOpen, setSearchHitsOpen] = useState(false)
  // The count chip's Abholungen – every open one, also on an Einsatz the filters hide: the crew
  // is still standing at the address.
  const pickups = useMemo(() => openPickups(operations), [operations])
  // The selected Einsatz's peek (phone only) – while its pin is on the map: a status group
  // switched off in «Ansicht» takes the pin and its peek away together.
  const peekOperation =
    isMobile && selectedIncidentId && shownIncidents.some((inc) => inc.id === selectedIncidentId)
      ? operationsById.get(selectedIncidentId)
      : undefined


  // Refresh incidents immediately when map page loads
  useEffect(() => {
    refreshIncidents()
  }, [refreshIncidents])

  useEffect(() => {
    if (highlightParam) {
      setSelectedIncidentId(highlightParam)
    }
  }, [highlightParam])

  // Redirect to events page if no event is selected (only after event is loaded from localStorage)
  useEffect(() => {
    if (isEventLoaded && !selectedEvent) {
      router.push('/events')
    }
  }, [isEventLoaded, selectedEvent, router])

  useMapShortcuts({
    selectedIncidentId,
    incidents,
    gpsAvailable,
    vehicleTypes,
    refreshIncidents,
    openIncidentDetail,
    changeView,
    resetZoom,
    focusVehicle,
  })

  // Ansicht: on the rail's heading row on the desk, beside the search on the phone.
  const viewMenu = (
    <MapViewMenu
      options={view}
      changeView={changeView}
      gpsAvailable={gpsAvailable}
      weatherAvailable={weatherAvailable}
      isMobile={isMobile}
      statusGroupCounts={statusGroupCounts}
      colorLegend={colorLegend}
    />
  )
  // The phone Lagekarte's floating chrome (owner pick 3A, 24.11.2026; MapView `floating`).
  const phoneSearchRow = (
    <PhoneMapSearch
      query={searchQuery}
      onQueryChange={setSearchQuery}
      hitsOpen={searchHitsOpen}
      onHitsOpenChange={setSearchHitsOpen}
      hits={searchHits}
      onPick={focusOnPhoneMap}
      viewMenu={viewMenu}
      formatLocation={formatLocation}
    />
  )
  const nextPickup = nextPickupId(pickups, selectedIncidentId)
  const phoneCountChip = (
    <PhoneMapCountChip
      shownCount={shownIncidents.length}
      pickupCount={pickups.length}
      nextPickup={nextPickup ? operationsById.get(nextPickup) : undefined}
      onFocusIncident={focusOnPhoneMap}
    />
  )
  const phonePeek = peekOperation ? (
    <MapIncidentPeek
      operation={peekOperation}
      formatLocation={formatLocation}
      onClose={() => setSelectedIncidentId(null)}
      onOpenDetail={() => openIncidentDetail(peekOperation.id)}
    />
  ) : undefined

  return (
    <ProtectedRoute>
      <div className="flex h-full flex-col bg-background text-foreground">
        {/* Übung: the same warning strip the board and the wall display carry, at
            the top edge of the window. Chrome, not content — it is fixed and out
            of flow, so it stays put while the map and the rail scroll, and it
            never competes with a marker's priority colour. Outside the header on
            purpose: the header is desktop-only, and the strip has to survive on
            mobile too. */}
        {selectedEvent?.training_flag && <TrainingBand />}
        <MapPageHeader
          training={!!selectedEvent?.training_flag}
          shownCount={activeIncidents.length}
          hasSelectedEvent={!!selectedEvent}
          selectedIncidentId={selectedIncidentId}
          isMobile={isMobile}
        />

        {/* The phone frame's head: the Ereignis pill (owner pick 1A). */}
        <PhoneEventHead />

        <div className={`flex flex-1 overflow-hidden ${isMobile ? 'flex-col' : 'flex-row'}`}>
          {/* The map: beside the rail on the desk. On the phone it fills the screen from under the
              Ereignis pill to the bottom nav (`--nav-reserve`), edge to edge, with its controls
              floating on it (owner pick 3A, 24.11.2026) – the Einsätze list is the Einsätze tab. */}
          <main className={isMobile ? 'mt-3 min-h-0 flex-1 border-t border-border pb-(--nav-reserve)' : 'flex-1 p-4'}>
            <MapView
              onFirstIdle={() => setMapIdle(true)}
              selectedIncidentId={selectedIncidentId}
              panTrigger={panTrigger}
              onMarkerClick={handleIncidentClick}
              // Not in the tap-modes: there a marker tap edits the route / the Reko, and a
              // double tap must not open a sheet on top of that.
              onMarkerDoubleClick={planningActive || rekoModeActive ? undefined : openIncidentDetail}
              resetZoomTrigger={resetZoomTrigger}
              statusFilters={statusFilters}
              filterExceptionId={deepLinkExceptionId}
              showAssignmentLines={view.showAssignmentLines}
              showDistances={view.showDistances}
              showLabels={view.showLabels}
              focusVehicleName={focusVehicleName}
              focusVehicleTrigger={focusVehicleTrigger}
              markerAccents={markerAccents}
              rekoRoute={rekoRoute}
              colorBy={colorBy}
              colorGroups={colorLegend}
              showGroupRoutes={view.showGroupRoutes || planningActive}
              groups={groups}
              groupResourcesFor={getGroupResources}
              operationsById={operationsById}
              focusGroupId={route?.groupId ?? null}
              highlightGroupStopId={route?.focusStopId ?? null}
              onGroupStopMarkerClick={planningActive ? focusStop : handleIncidentClick}
              // Tap-modes: the hover card must not swap in under the finger —
              // that DOM churn ate the first tap of a Reko un-assign. The phone: the
              // peek tells the Einsatz, the pin keeps its short label.
              hoverCardsDisabled={isMobile || planningActive || rekoModeActive}
              onGpsAvailabilityChange={setGpsAvailable}
              showWeather={view.showWeather}
              onWeatherAvailabilityChange={setWeatherAvailable}
              // The phone: a tap on empty map closes the peek and the search hits.
              onMapClick={
                isMobile
                  ? () => {
                      setSelectedIncidentId(null)
                      setSearchHitsOpen(false)
                    }
                  : route?.addMode ? handleMapAddStop : undefined
              }
              topRightControls={isMobile ? phoneCountChip : undefined}
              floating={isMobile ? { top: phoneSearchRow, foot: phonePeek } : undefined}
            />
          </main>

          {/* Active Emergencies - sidebar on desktop, bottom section on mobile.
              Flex column with its own inner scroller: in list mode the header
              (title → search) sits outside the scroll container, so it can
              never move — no sticky, no overscroll spring. */}
          {/* Back at 320px (Bastian's second field round): the one-line rows
              were right, the narrower rail was not — addresses truncated and
              the mode panels burst their headers. The operator drags it between
              280 and 560 (the grip on its left edge), in every mode. `@container/rail`:
              the panels fit their headers to the rail's width, not the window's. */}
          {!isMobile && (
          <>
          <ResizeGrip
            resize={railWidth}
            side="left"
            label={tPanels('resize.mapRail')}
            hint={tPanels('resizeHint')}
          />
          <aside
            ref={railRef}
            className="@container/rail bg-card/30 backdrop-blur-sm flex flex-col overflow-hidden border-l border-border flex-shrink-0 w-(--rail-w)"
            // Capped by the measured row (railMax above), so a rail dragged to 560 never pushes
            // its own exit button off a narrow screen.
            style={railWidth.style}
          >
            <div className={`${planningActive || rekoModeActive ? 'p-4 flex-1 min-h-0' : 'flex flex-col flex-1 min-h-0'}`}>
              {planningActive ? (
                <RoutenplanungPanel
                  groups={groups}
                  groupId={editor.groupId}
                  onGroupIdChange={(groupId) => changeEditor({ type: 'pickGroup', groupId })}
                  onCreateGroup={handleCreatePlanningGroup}
                  addMode={route?.addMode ?? false}
                  onAddModeChange={(on) => changeEditor({ type: 'addMode', on })}
                  focusStopId={route?.focusStopId ?? null}
                  onFocusStopChange={focusStop}
                  planning={planning}
                  onExit={exitPlanning}
                  canEdit={isEditor}
                  onRequestStatus={dialogs.statusWorkflow.requestStatusChange}
                />
              ) : rekoModeActive ? (
                <RekoModusPanel
                  people={rekoPeople}
                  openByPerson={rekoOpenByPerson}
                  colors={rekoColors}
                  selectedPersonId={rekoPersonId}
                  onSelectPerson={setRekoPersonId}
                  onExit={exitRekoMode}
                />
              ) : (
              <MapIncidentRail
                viewMenu={viewMenu}
                isEditor={isEditor}
                onEnterPlanning={enterPlanning}
                onEnterReko={enterRekoMode}
                searchQuery={searchQuery}
                onSearchQueryChange={setSearchQuery}
                sections={sections}
                statusFilters={statusFilters}
                onToggleStatusGroup={(group) => changeView({ type: 'statusGroup', group })}
                statusGroupCounts={statusGroupCounts}
                shownCount={activeIncidents.length}
                selectedIncidentId={selectedIncidentId}
                operationsById={operationsById}
                formatLocation={formatLocation}
                onIncidentClick={handleIncidentClick}
                onOpenDetail={openIncidentDetail}
              />
              )}
            </div>
          </aside>
          </>
          )}
        </div>

        {/* The phone's Einsatz detail (see openIncidentDetail) — the same sheet the board's phone
            list opens. */}
        {isMobile && (
          <MobileIncidentDetailSheet
            operation={phoneDetailOperation}
            open={!!phoneDetailOperation}
            onOpenChange={(open) => { if (!open) setPhoneDetailId(null) }}
            target={phoneDetailTarget}
            onShowOnMap={showPhoneDetailOnMap}
            materials={materials}
            formatLocation={formatLocation}
          />
        )}

        {/* Operation Detail Modal — only for the status workflow's «… öffnen» (it needs a tab and
            a section, and the half-done Abschluss lives on this page). */}
        <OperationDetailModal
          operation={selectedOperation}
          open={detailModalOpen}
          onOpenChange={setDetailModalOpen}
          openOnTab={detailOnTab ?? undefined}
          onUpdate={handleOperationUpdate}
          onDelete={isEditor ? handleOperationDelete : undefined}
          materials={materials}
          onRemoveVehicle={isEditor ? release.releaseVehicle : undefined}
          onRemoveCrew={isEditor ? release.releaseCrew : undefined}
          onRemoveMaterial={isEditor ? release.releaseMaterial : undefined}
          canEdit={isEditor}
          diveraEnabled={isEditor && diveraEnabled}
          {...dialogs.detailActions}
        />

        <IncidentDialogs
          dialogs={dialogs}
          vehicles={vehicleTypes}
          printerEnabled={printerEnabled}
          funkrufname={funkrufname}
          diveraEnabled={diveraEnabled}
          onOpenDetail={(operationId, tab, section) => {
            setSelectedOperationId(operationId)
            setDetailOnTab(tab ? { tab, section, nonce: Date.now() } : null)
            setDetailModalOpen(true)
          }}
        />

        <PlanningAddConfirm
          question={planningAddConfirm}
          auftragName={groups.find((g) => g.id === editor.groupId)?.name ?? ''}
          onClose={() => setPlanningAddConfirm(null)}
          onConfirm={(question) => {
            void addStops(question.groupId, [question.incidentId]).then((ok) => {
              if (ok) toast.success(t('planning.stopAdded'))
            })
          }}
        />
        <RekoOverwriteConfirm
          question={rekoOverwrite}
          incident={rekoOverwriteIncident}
          onClose={() => setRekoOverwrite(null)}
          onConfirm={(question) => assignRekoPersonToOperation(question.nextId, question.nextName, question.operationId)}
        />
      </div>

      {/* Mobile Bottom Navigation */}

      <MobileBottomNavigation currentPage="map" hasSelectedEvent={!!selectedEvent} />

    </ProtectedRoute>
  )
}
