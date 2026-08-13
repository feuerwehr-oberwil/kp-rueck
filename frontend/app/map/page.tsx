"use client"

/**
 * The map view.
 *
 * Reached only by editors and admins: `ProtectedRoute` sends every `viewer` to
 * `/display/board` before this renders. The `isEditor` checks below are therefore
 * constant-true today — kept deliberately, see the note in
 * `components/protected-route.tsx` for why and for what actually enforces the role.
 */

import { useState, useMemo, useEffect, useRef, useCallback } from "react"
import { useNotifications } from "@/lib/contexts/notification-context"
import { storeFieldNudgeConfirmation } from "@/components/kanban/field-status-nudge"
import dynamic from "next/dynamic"
import Link from "next/link"
import { useSearchParams, useRouter } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { SearchInput } from "@/components/ui/search-input"
import { Card } from "@/components/ui/card"
import { FileText, Clock, Users, Package, Truck, Siren, Loader2, Check, Milestone, Binoculars, Layers, ChevronDown, Wrench, ArrowLeft } from "lucide-react"
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { colorGroupFor, COLOR_BY_STORAGE_KEY, COLOR_NONE, type ColorByDimension, type ColorGroup } from "@/lib/kanban-utils"
import { IncidentTimeRow } from "@/components/ui/incident-time"
import { incidentTimeSource } from "@/lib/incident-time"
import { type Priority, PRIORITY_DOT_CLASSES } from "@/lib/priority"
import { getIncidentRefLabel } from "@/lib/incident-types"
import { useIncidents, useOperations, type Operation } from "@/lib/contexts/operations-context"
import { useGroups } from "@/lib/contexts/groups-context"
import { useRoutePlanning } from "@/lib/hooks/use-route-planning"
import { RoutenplanungPanel } from "@/components/map/routenplanung-panel"
import { RekoModusPanel } from "@/components/map/reko-modus-panel"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { useEvent } from "@/lib/contexts/event-context"
import { useAuth } from "@/lib/contexts/auth-context"
import { ProtectedRoute } from "@/components/protected-route"
import { PageNavigation } from "@/components/page-navigation"
import { MobileBottomNavigation } from "@/components/mobile-bottom-navigation"
import { OperationDetailModal } from "@/components/kanban/operation-detail-modal"
import { ResourceAssignmentDialog } from "@/components/kanban/resource-assignment-dialog"
import { AuftragPickerDialog } from "@/components/kanban/auftrag-picker-dialog"
import { DiveraSendDialog } from "@/components/divera/divera-send-dialog"
import {
  IncidentStatusWorkflowDialogs,
  useIncidentStatusWorkflow,
} from "@/components/kanban/incident-status-workflow"
import type { Incident } from "@/lib/types/incidents"
import { STATUS_LABELS, INCIDENT_TYPE_LABELS, STATUS_TO_GROUP, type StatusGroup, type IncidentStatus } from "@/lib/types/incidents"
import { Kbd } from "@/components/ui/kbd"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { apiClient } from "@/lib/api-client"
import { toast } from "sonner"
import { useToggleDriverStay } from "@/lib/hooks/use-driver-stay"
import { useIsMobile } from "@/components/ui/use-mobile"
import { useOperationHandlers } from "@/lib/hooks/use-operation-handlers"
// The board's shortcut hook owns the canonical "should this keystroke reach the
// page?" rules; the map answers the same questions and reuses them.
import { isActivationTarget, isOverlayOpen, isTypingTarget } from "@/lib/hooks/use-kanban-shortcuts"
import { useCrossWindowSync } from "@/lib/hooks/use-cross-window-sync"
import { useCommandPalette } from "@/lib/contexts/command-palette-context"
import { useTranslations } from "next-intl"
import { translateOutsideReact } from "@/lib/i18n-messages"

// Dynamically import map to avoid SSR issues with Leaflet
const MapView = dynamic(() => import("@/components/map-view"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex flex-col items-center justify-center gap-3 bg-muted rounded-lg">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      <div className="text-sm text-muted-foreground">{translateOutsideReact('map.page.loading')}</div>
    </div>
  ),
})


export default function MapPage() {
  const t = useTranslations('map')
  const tKanban = useTranslations('kanban')
  const tIncidents = useTranslations('incidents')
  const { incidents, formatLocation, refreshIncidents } = useIncidents()
  const {
    operations,
    personnel,
    materials,
    updateOperation,
    changeStatusToTop,
    removeCrew,
    removeMaterial,
    removeVehicle: removeVehicleFromOperation,
    assignPersonToOperation,
    assignMaterialToOperation,
    assignVehicleToOperation,
    assignRekoPersonToOperation,
    removeReko,
    requestResourceConflict,
    deleteOperation
  } = useOperations()
  const { selectedEvent, isEventLoaded } = useEvent()
  const { isAuthenticated, isEditor } = useAuth()
  const {
    groups,
    createGroup,
    addStops,
    removeStop,
    assignResource: assignGroupResource,
    unassignResource: unassignGroupResource,
    getGroupResources,
    occupiedResourceIds,
  } = useGroups()
  const searchParams = useSearchParams()
  const router = useRouter()
  const highlightParam = searchParams.get("highlight")
  const isMobile = useIsMobile()
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(
    highlightParam
  )
  const [selectedOperationId, setSelectedOperationId] = useState<string | null>(null)
  const [detailModalOpen, setDetailModalOpen] = useState(false)
  const [assignmentDialogOpen, setAssignmentDialogOpen] = useState(false)
  const [assignmentResourceType, setAssignmentResourceType] = useState<'crew' | 'vehicles' | 'materials' | null>(null)
  const [assignmentOperationId, setAssignmentOperationId] = useState<string | null>(null)
  const [routeAssign, setRouteAssign] = useState<{ groupId: string; resourceType: 'crew' | 'vehicles' | 'materials' } | null>(null)
  const [rekoPersonnelNames, setRekoPersonnelNames] = useState<string[]>([])
  const [auftragPickerIncidentId, setAuftragPickerIncidentId] = useState<string | null>(null)
  const [diveraEnabled, setDiveraEnabled] = useState(false)
  const [diveraDialogOp, setDiveraDialogOp] = useState<Operation | null>(null)
  const [printerEnabled, setPrinterEnabled] = useState(false)
  const [funkrufname, setFunkrufname] = useState("Omega")
  // Derive current operation from operations array to get real-time updates
  const selectedOperation = useMemo(() => {
    if (!selectedOperationId) return null
    return operations.find(op => op.id === selectedOperationId) || null
  }, [selectedOperationId, operations])
  const [resetZoomTrigger, setResetZoomTrigger] = useState(0)
  const [panTrigger, setPanTrigger] = useState(0)
  const [searchQuery, setSearchQuery] = useState("")
  const [statusFilters, setStatusFilters] = useState<Record<StatusGroup, boolean>>({
    open: true,
    active: true,
    completed: false, // Hidden by default (matches current behavior)
  })
  const [vehicleTypes, setVehicleTypes] = useState<Array<{ key: string; name: string; id: string; type: string }>>([])
  const [showAssignmentLines, setShowAssignmentLines] = useState(true)
  const [showDistances, setShowDistances] = useState(false)
  const [showLabels, setShowLabels] = useState(true)
  // Zuweisungslinien and Distanz are drawn from vehicle GPS positions. Without
  // GPS (a station without Traccar, the demo) they can never show anything, so
  // the map reports what it knows and the options disappear rather than lie.
  const [gpsAvailable, setGpsAvailable] = useState(false)
  // Aufträge route display (all viewers) + editor-only Routenplanung mode.
  const [showGroupRoutes, setShowGroupRoutes] = useState(false)
  const [planningActive, setPlanningActive] = useState(false)
  const [planningGroupId, setPlanningGroupId] = useState<string | null>(null)
  const [planningAddMode, setPlanningAddMode] = useState(false)
  const [planningFocusStopId, setPlanningFocusStopId] = useState<string | null>(null)
  // Reko-Modus — editor-only reko dispatching from the map (panel + marker taps).
  const [rekoModeActive, setRekoModeActive] = useState(false)
  const [rekoPersonId, setRekoPersonId] = useState<string | null>(null)
  // Tap on an incident that already has a different reko person → confirm
  // before replacing them (guards against stray taps in dispatch mode).
  const [rekoOverwrite, setRekoOverwrite] = useState<{
    operationId: string
    currentName: string
    nextId: string
    nextName: string
  } | null>(null)
  // Shared routing hook — active only while planning a selected group.
  const planning = useRoutePlanning(planningActive ? planningGroupId : null)
  // id → Operation lookup for the GroupRoutes overlay (stops are real incidents).
  const operationsById = useMemo(
    () => new Map(operations.map((op) => [op.id, op] as const)),
    [operations],
  )
  // Marker coloring ("Färben nach") — defaults to priority (the original styling).
  const [colorBy, setColorBy] = useState<ColorByDimension>('priority')
  useEffect(() => {
    const saved = localStorage.getItem(COLOR_BY_STORAGE_KEY)
    if (saved === 'reko' || saved === 'vehicle' || saved === 'type' || saved === 'priority' || saved === 'auftrag') setColorBy(saved)
  }, [])
  const setColorByPersisted = (value: ColorByDimension) => {
    setColorBy(value)
    if (typeof window !== 'undefined') localStorage.setItem(COLOR_BY_STORAGE_KEY, value)
  }
  // Remembers the coloring active before "Aufträge anzeigen" auto-switched to
  // color-by-Auftrag, so turning routes back off restores the prior dimension.
  const preRoutesColorByRef = useRef<ColorByDimension>('priority')
  // Turning route display ON auto-colours markers by Auftrag (non-persisted, so a
  // reload with routes hidden doesn't get stuck on it); OFF reverts the dimension.
  const toggleGroupRoutes = () => {
    setShowGroupRoutes((prev) => {
      const next = !prev
      if (next) {
        preRoutesColorByRef.current = colorBy
        setColorBy('auftrag')
      } else if (colorBy === 'auftrag') {
        setColorBy(preRoutesColorByRef.current)
      }
      return next
    })
  }
  const [focusVehicleName, setFocusVehicleName] = useState<string | null>(null)
  const [focusVehicleTrigger, setFocusVehicleTrigger] = useState(0)
  const [gPrefixActive, setGPrefixActive] = useState(false)
  const gPrefixTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const [currentTime, setCurrentTime] = useState<Date | null>(null)
  const [isMounted, setIsMounted] = useState(false)

  // Cross-window sync (bidirectional)
  const { broadcast } = useCrossWindowSync({
    onMessage: (msg) => {
      if (msg.type === "incident:selected") {
        setSelectedIncidentId(msg.incidentId)
      }
    },
  })

  const handleIncidentClick = (incidentId: string) => {
    // In Routenplanung mode with a selected route, clicking an incident marker
    // adds that incident to the route instead of selecting it on the map.
    if (planningActive && planningGroupId) {
      const group = groups.find((g) => g.id === planningGroupId)
      if (group?.stopIds.includes(incidentId)) {
        toast.info(t('planning.stopAlreadyOnRoute'))
      } else {
        void addStops(planningGroupId, [incidentId]).then((ok) => {
          if (ok) toast.success(t('planning.stopAdded'))
        })
      }
      return
    }
    // In Reko-Modus with a selected person, tapping a marker toggles that
    // person's reko assignment on the incident instead of selecting it.
    if (rekoModeActive && rekoPersonId) {
      const person = personnel.find((p) => p.id === rekoPersonId)
      const operation = operations.find((op) => op.id === incidentId)
      if (!person || !operation) return
      if (operation.assignedReko?.id === rekoPersonId) {
        removeReko(incidentId)
      } else if (operation.assignedReko) {
        setRekoOverwrite({
          operationId: incidentId,
          currentName: operation.assignedReko.name,
          nextId: person.id,
          nextName: person.name,
        })
      } else {
        assignRekoPersonToOperation(person.id, person.name, incidentId)
      }
      return
    }
    if (incidentId === selectedIncidentId) {
      // Re-clicking same incident - trigger pan
      setPanTrigger(prev => prev + 1)
    } else {
      // Different incident - update selection
      setSelectedIncidentId(incidentId)
      broadcast("incident:selected", incidentId)
    }
  }

  // Enter/exit Routenplanung; entering forces the route overlay on.
  // Both modes clear the current selection so no stale highlight competes
  // with the mode's own map emphasis.
  const enterPlanning = () => {
    exitRekoMode()
    setSelectedIncidentId(null)
    setPlanningActive(true)
    setPlanningGroupId((prev) => prev ?? groups[0]?.id ?? null)
  }
  const exitPlanning = () => {
    setPlanningActive(false)
    setPlanningAddMode(false)
    setPlanningFocusStopId(null)
  }

  // Enter/exit Reko-Modus; mutually exclusive with Routenplanung (both swap the
  // sidebar). Entering auto-colours markers by reko person so each person's
  // work reads apart on the map; exit restores the previous dimension.
  const preRekoColorByRef = useRef<ColorByDimension>('priority')
  const enterRekoMode = () => {
    exitPlanning()
    setSelectedIncidentId(null)
    preRekoColorByRef.current = colorBy
    setColorBy('reko')
    setRekoModeActive(true)
  }
  const exitRekoMode = () => {
    setRekoModeActive(false)
    setRekoPersonId(null)
    setColorBy((current) => (current === 'reko' ? preRekoColorByRef.current : current))
  }

  // `?mode=reko` — the Setup-Checkliste's "Reko-Modus öffnen" links here rather
  // than telling the operator where to look. Once only: leaving the mode must
  // not be undone by a re-render, and the URL is not the state.
  const rekoDeepLinkRef = useRef(false)
  useEffect(() => {
    if (rekoDeepLinkRef.current || searchParams.get('mode') !== 'reko') return
    rekoDeepLinkRef.current = true
    enterRekoMode()
    // `enterRekoMode` is re-created every render; the URL is what decides here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  // Create a new Auftrag from the panel and select it for planning.
  const handleCreatePlanningGroup = async (name: string, color: string) => {
    const created = await createGroup({ name, color })
    if (created) setPlanningGroupId(created.id)
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
   * «Details anzeigen» hands the incident back to the board.
   *
   * The detail belongs where the work is: next to the columns, in the panel or
   * the modal the board already owns. Opening a second copy of it on top of the
   * map meant two surfaces mounting the same forms — and the operator ending up
   * on the map with a rapport open and no board behind it.
   */
  const handleDetailsClick = useCallback((incident: Incident) => {
    router.push(`/?highlight=${incident.id}&detail=1`)
  }, [router])

  // Zoom in on a vehicle by its 1-5 shortcut number
  const focusVehicleByNumber = (vehicleNumber: number) => {
    const vehicle = vehicleTypes[vehicleNumber - 1]
    if (vehicle) {
      setFocusVehicleName(vehicle.name)
      setFocusVehicleTrigger((prev) => prev + 1)
    }
  }

  // Register command palette (Cmd+K) handlers for the map view
  const { registerHandlers, clearHandlers } = useCommandPalette()
  useEffect(() => {
    registerHandlers({
      onRefresh: () => refreshIncidents(),
      onToggleMapLabels: () => setShowLabels((prev) => !prev),
      onToggleMapLines: () => setShowAssignmentLines((prev) => !prev),
      onFocusVehicle: focusVehicleByNumber,
      onMapResetZoom: () => {
        setResetZoomTrigger((prev) => prev + 1)
        setSelectedIncidentId(null)
      },
      mapVehicleNames: vehicleTypes.map((v) => v.name),
      onFocusIncidentSearch: () => document.getElementById('map-search-input')?.focus(),
    })
    return () => clearHandlers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registerHandlers, clearHandlers, refreshIncidents, vehicleTypes])

  // Use shared operation handlers hook
  const { handleOperationUpdate, handleVehicleRemove, handleOperationDelete } = useOperationHandlers({
    selectedOperation,
    updateOperation,
    removeVehicle: removeVehicleFromOperation,
    assignVehicleToOperation,
    deleteOperation,
  })

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

  // The bell's «angekommen» / «beendet» button works here too — the map is a
  // full operating surface, and the move has to run through this page's own
  // workflow gates rather than a second copy of them.
  //
  // Depends on `requestCompletion`, NOT on the workflow object: that object is
  // rebuilt on every render, so depending on it re-registered the handler every
  // render — and registering is a setState in the notification context, which
  // renders again. That loop froze the whole Karte page, back button included.
  const { registerFieldActionHandler } = useNotifications()
  const { requestCompletion } = statusWorkflow
  useEffect(() => {
    if (!isEditor) return
    registerFieldActionHandler((incidentId, kind) => {
      storeFieldNudgeConfirmation(incidentId, kind)
      if (kind === "complete") requestCompletion(incidentId)
      else changeStatusToTop(incidentId, "active")
    })
    return () => registerFieldActionHandler(null)
  }, [isEditor, registerFieldActionHandler, requestCompletion, changeStatusToTop])

  const handleAssignRouteResource = (
    resourceType: 'crew' | 'vehicles' | 'materials',
    groupId: string,
  ) => {
    setRouteAssign({ groupId, resourceType })
    setAssignmentResourceType(resourceType)
    setAssignmentOperationId(null)
    setAssignmentDialogOpen(true)
  }

  const handleOpenAssignmentDialog = (
    resourceType: 'crew' | 'vehicles' | 'materials',
    operationId: string,
  ) => {
    const operation = operations.find((item) => item.id === operationId)
    if (operation?.groupId) {
      handleAssignRouteResource(resourceType, operation.groupId)
      return
    }
    setRouteAssign(null)
    setAssignmentResourceType(resourceType)
    setAssignmentOperationId(operationId)
    setAssignmentDialogOpen(true)
  }

  const assignVehicleToGroupWithConflict = (groupId: string, vehicleId: string) => {
    const vehicle = vehicleTypes.find((item) => item.id === vehicleId)
    if (!vehicle) return

    const groupConflicts = groups.filter((group) =>
      group.id !== groupId
      && group.assignments.some((assignment) => assignment.resourceType === 'vehicle' && assignment.resourceId === vehicleId),
    )
    const incidentConflicts = operations.filter((operation) => operation.vehicles.includes(vehicle.name))
    if (groupConflicts.length === 0 && incidentConflicts.length === 0) {
      void assignGroupResource(groupId, 'vehicle', vehicleId)
      return
    }

    requestResourceConflict({
      resourceType: "vehicle",
      resourceId: vehicleId,
      resourceName: vehicle.name,
      targetOperationId: groupId,
      conflicts: [
        ...groupConflicts.map((group) => ({ operationId: group.id, operationLabel: group.name })),
        ...incidentConflicts.map((operation) => ({ operationId: operation.id, operationLabel: getIncidentRefLabel(operation) })),
      ],
      customResolve: async (action) => {
        if (action === 'move') {
          const groupResults = await Promise.all(groupConflicts.map((group) => {
            const assignment = group.assignments.find((item) => item.resourceType === 'vehicle' && item.resourceId === vehicleId)
            return assignment ? unassignGroupResource(group.id, assignment.id) : true
          }))
          const incidentResults = await Promise.all(
            incidentConflicts.map((operation) => removeVehicleFromOperation(operation.id, vehicle.name)),
          )
          if ([...groupResults, ...incidentResults].some((ok) => !ok)) return
        }
        await assignGroupResource(groupId, 'vehicle', vehicleId)
      },
    })
  }

  const assignVehicleToIncidentWithConflict = (
    vehicleId: string,
    vehicleName: string,
    operationId: string,
  ) => {
    const groupConflicts = groups.filter((group) =>
      group.assignments.some((assignment) => assignment.resourceType === 'vehicle' && assignment.resourceId === vehicleId),
    )
    if (groupConflicts.length === 0) {
      assignVehicleToOperation(vehicleId, vehicleName, operationId)
      return
    }

    requestResourceConflict({
      resourceType: "vehicle",
      resourceId: vehicleId,
      resourceName: vehicleName,
      targetOperationId: operationId,
      conflicts: groupConflicts.map((group) => ({ operationId: group.id, operationLabel: group.name })),
      customResolve: async (action) => {
        if (action === 'move') {
          const results = await Promise.all(groupConflicts.map((group) => {
            const assignment = group.assignments.find((item) => item.resourceType === 'vehicle' && item.resourceId === vehicleId)
            return assignment ? unassignGroupResource(group.id, assignment.id) : true
          }))
          if (results.some((ok) => !ok)) return
        }
        assignVehicleToOperation(vehicleId, vehicleName, operationId)
      },
    })
  }

  const handleChooseAuftrag = async (groupId: string) => {
    if (!auftragPickerIncidentId) return
    const ok = await addStops(groupId, [auftragPickerIncidentId])
    if (ok) {
      const group = groups.find((item) => item.id === groupId)
      toast.success(tKanban('dashboard.distributedToast', { name: group?.name ?? '' }))
    }
  }

  const handleRemoveFromAuftrag = async () => {
    if (!auftragPickerIncidentId) return
    const operation = operations.find((item) => item.id === auftragPickerIncidentId)
    if (!operation?.groupId) return
    const ok = await removeStop(operation.groupId, operation.id)
    if (ok) toast.success(tKanban('dashboard.removedFromAuftragToast'))
  }

  const assignmentOperation = assignmentOperationId
    ? operations.find((operation) => operation.id === assignmentOperationId) ?? null
    : null
  const assignedResources = assignmentOperation
    ? {
        assignedPersonnel: assignmentOperation.crew,
        assignedVehicles: assignmentOperation.vehicles,
        assignedMaterials: assignmentOperation.materials,
      }
    : { assignedPersonnel: [], assignedVehicles: [], assignedMaterials: [] }
  const routeGroupResources = routeAssign ? getGroupResources(routeAssign.groupId) : null
  const routeOwnIds = routeAssign
    ? new Set(
        groups
          .find((group) => group.id === routeAssign.groupId)
          ?.assignments.map((assignment) => `${assignment.resourceType}:${assignment.resourceId}`) ?? [],
      )
    : new Set<string>()
  const occupiedPersonnelIds = new Set(
    [...occupiedResourceIds.personnel].filter((id) => !routeOwnIds.has(`personnel:${id}`)),
  )
  const occupiedVehicleIds = new Set(
    [...occupiedResourceIds.vehicle].filter((id) => !routeOwnIds.has(`vehicle:${id}`)),
  )
  const occupiedMaterialIds = new Set(
    [...occupiedResourceIds.material].filter((id) => !routeOwnIds.has(`material:${id}`)),
  )
  const diveraDialogOpLive = diveraDialogOp
    ? operations.find((operation) => operation.id === diveraDialogOp.id) ?? diveraDialogOp
    : null

  // Count incidents by status group (before filtering)
  const statusGroupCounts = useMemo(() => {
    const counts: Record<StatusGroup, number> = { open: 0, active: 0, completed: 0 }
    incidents.forEach((inc) => {
      const group = STATUS_TO_GROUP[inc.status as IncidentStatus]
      if (group) counts[group]++
    })
    return counts
  }, [incidents])

  // Reko-Modus data: reko-marked people and their open (reko not yet done)
  // incidents. The selected person's open incidents get enlarged markers so
  // proximity between their work and unassigned incidents reads off the map.
  const rekoPeople = useMemo(() => personnel.filter((p) => p.isReko), [personnel])
  const rekoOpenByPerson = useMemo(() => {
    const byPerson = new Map<string, Operation[]>()
    for (const op of operations) {
      if (!op.assignedReko || op.hasCompletedReko || op.status === 'complete') continue
      const list = byPerson.get(op.assignedReko.id)
      if (list) list.push(op)
      else byPerson.set(op.assignedReko.id, [op])
    }
    return byPerson
  }, [operations])
  const rekoHighlightIds = useMemo(() => {
    if (!rekoModeActive || !rekoPersonId) return undefined
    return new Set((rekoOpenByPerson.get(rekoPersonId) ?? []).map((op) => op.id))
  }, [rekoModeActive, rekoPersonId, rekoOpenByPerson])

  // "Färben nach": map each incident id → accent colour, plus a legend. Uses the
  // full operations (which carry reko/vehicle/type) rather than the lighter
  // incident markers.
  const markerAccents = useMemo(() => {
    // Priority uses the markers' built-in priority fill — no override.
    if (colorBy === 'priority') return undefined
    const m = new Map<string, string>()
    for (const op of operations) {
      const g = colorGroupFor(op, colorBy, groups)
      m.set(op.id, g ? g.color : COLOR_NONE) // grey when nothing assigned yet
    }
    return m
  }, [operations, colorBy, groups])

  const colorLegend = useMemo<ColorGroup[]>(() => {
    // Priority falls back to the static legend section in MapLegend.
    if (colorBy === 'priority') return []
    const map = new Map<string, ColorGroup>()
    let hasNone = false
    for (const op of operations) {
      const g = colorGroupFor(op, colorBy, groups)
      if (g) { if (!map.has(g.key)) map.set(g.key, g) }
      else hasNone = true
    }
    const arr = [...map.values()]
    // Empty/none state: surface incidents without a value in this dimension.
    if (hasNone) {
      const noneLabel = colorBy === 'auftrag' ? t('common.noAuftrag') : t('common.noAssignment')
      arr.push({ key: '__none__', label: noneLabel, color: COLOR_NONE })
    }
    return arr
  }, [operations, colorBy, groups, t])

  // Filter incidents based on status group filters and search query
  const activeIncidents = useMemo(
    () => {
      // Filter by status group
      const filtered = incidents.filter((inc) => {
        const group = STATUS_TO_GROUP[inc.status as IncidentStatus]
        return group && statusFilters[group]
      })

      // Filter by search query
      if (!searchQuery) return filtered

      const lowerQuery = searchQuery.toLowerCase()
      return filtered.filter((inc) =>
        (inc.location_address && inc.location_address.toLowerCase().includes(lowerQuery)) ||
        (inc.title && inc.title.toLowerCase().includes(lowerQuery)) ||
        (inc.type in INCIDENT_TYPE_LABELS && tIncidents(`types.${inc.type}`).toLowerCase().includes(lowerQuery)) ||
        (inc.status in STATUS_LABELS && tKanban(`statusLabels.${inc.status}`).toLowerCase().includes(lowerQuery))
      )
    },
    [incidents, searchQuery, statusFilters, tIncidents, tKanban]
  )

  // Toggle status filter
  const toggleStatusFilter = (group: StatusGroup) => {
    setStatusFilters(prev => ({ ...prev, [group]: !prev[group] }))
  }

  useEffect(() => {
    if (!assignmentDialogOpen || assignmentResourceType !== 'crew' || !selectedEvent) {
      setRekoPersonnelNames([])
      return
    }

    let cancelled = false
    apiClient.getEventSpecialFunctions(selectedEvent.id)
      .then((functions) => {
        if (cancelled) return
        const names = functions
          .filter((item) => item.function_type === 'reko')
          .map((item) => personnel.find((person) => person.id === item.personnel_id)?.name)
          .filter((name): name is string => name !== undefined)
        setRekoPersonnelNames(names)
      })
      .catch((error) => {
        console.error('Failed to load Reko personnel:', error)
        if (!cancelled) setRekoPersonnelNames([])
      })

    return () => {
      cancelled = true
    }
  }, [assignmentDialogOpen, assignmentResourceType, personnel, selectedEvent])

  // Load all vehicles for detail assignment while retaining the first five as
  // numbered map shortcuts. Resolve Divera capability through the same settings
  // checks as the board so a non-functional send button is never shown.
  useEffect(() => {
    if (!isAuthenticated) return
    const loadVehicles = async () => {
      try {
        const vehicles = await apiClient.getVehicles()
        const typesWithKeys = vehicles.map((vehicle, index) => ({
          key: String(index + 1),
          name: vehicle.name,
          id: vehicle.id,
          type: vehicle.type,
        }))
        setVehicleTypes(typesWithKeys)
      } catch (error) {
        console.error('Failed to load vehicles:', error)
      }
    }
    const loadDiveraCapability = async () => {
      try {
        const settings = await apiClient.getAllSettings()
        if (settings.funkrufname) setFunkrufname(settings.funkrufname)
        if (settings['divera.alarm_enabled'] !== 'true') {
          setDiveraEnabled(false)
          return
        }
        try {
          const status = await apiClient.getDiveraPollingStatus()
          setDiveraEnabled(status.configured === true)
        } catch {
          setDiveraEnabled(true)
        }
      } catch {
        setDiveraEnabled(false)
      }
    }
    const loadPrinterCapability = async () => {
      try {
        const status = await apiClient.getPrinterStatus()
        setPrinterEnabled(status.enabled)
      } catch {
        setPrinterEnabled(false)
      }
    }
    void loadVehicles()
    void loadDiveraCapability()
    void loadPrinterCapability()
  }, [isAuthenticated])

  // Refresh incidents immediately when map page loads
  useEffect(() => {
    refreshIncidents()
  }, [refreshIncidents])

  // Clock update
  useEffect(() => {
    setIsMounted(true)
    setCurrentTime(new Date())
    const timer = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

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

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      // Esc to blur input or cancel g-prefix mode
      if (e.key === 'Escape') {
        if (gPrefixActive) {
          setGPrefixActive(false)
          if (gPrefixTimeoutRef.current) {
            clearTimeout(gPrefixTimeoutRef.current)
            gPrefixTimeoutRef.current = null
          }
          return
        }
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
          (e.target as HTMLElement).blur()
          return
        }
      }

      // Ignore if typing in a field, and stand down while an overlay is up.
      // Every overlay on this page is modal (detail modal, Ressourcen- and
      // Auftrag-Dialoge, the Ansicht/Modus menus), so an open one owns the
      // keyboard outright — without this, `l` both walked the open menu's
      // typeahead and toggled the marker labels behind it.
      if (isTypingTarget(e.target)) return
      if (isOverlayOpen()) return

      // Handle g-prefix navigation
      if (gPrefixActive) {
        e.preventDefault()
        setGPrefixActive(false)
        if (gPrefixTimeoutRef.current) {
          clearTimeout(gPrefixTimeoutRef.current)
          gPrefixTimeoutRef.current = null
        }

        if (e.key === 'k' || e.key === 'K') {
          router.push('/')
          return
        } else if (e.key === 'm' || e.key === 'M') {
          // Already on Map, do nothing
          return
        } else if (e.key === 'e' || e.key === 'E') {
          router.push('/events')
          return
        } else if (e.key === 's' || e.key === 'S') {
          router.push('/settings')
          return
        } else if (e.key === 'h' || e.key === 'H') {
          router.push('/help')
          return
        }
        return
      }

      // Activate g-prefix mode
      if (e.key === 'g' || e.key === 'G') {
        e.preventDefault()
        setGPrefixActive(true)
        // Reset g-prefix mode after 1.5 seconds
        if (gPrefixTimeoutRef.current) {
          clearTimeout(gPrefixTimeoutRef.current)
        }
        gPrefixTimeoutRef.current = setTimeout(() => {
          setGPrefixActive(false)
          gPrefixTimeoutRef.current = null
        }, 1500)
        return
      }

      // '/' or 'S' key to focus search (S for Suche - Swiss-German keyboard friendly)
      if (e.key === '/' || ((e.key === 's' || e.key === 'S') && !e.metaKey && !e.ctrlKey)) {
        e.preventDefault()
        document.getElementById('map-search-input')?.focus()
      }
      // 'z' key to reset zoom
      else if ((e.key === 'z' || e.key === 'Z') && !e.metaKey && !e.ctrlKey) {
        // Only prevent default if no modifier keys (allows cmd+z/ctrl+z for undo)
        e.preventDefault()
        setResetZoomTrigger((prev) => prev + 1)
        setSelectedIncidentId(null)
      }
      // 'e' or 'Enter' key to open details for selected incident. Enter is the
      // activation key of whatever has focus, so it only means "open details"
      // while focus is not on a button or link — same rule as the board.
      else if (
        (((e.key === 'e' || e.key === 'E') && !e.metaKey && !e.ctrlKey) ||
          (e.key === 'Enter' && !isActivationTarget(e.target))) &&
        selectedIncidentId
      ) {
        e.preventDefault()
        const incident = incidents.find(inc => inc.id === selectedIncidentId)
        if (incident) {
          handleDetailsClick(incident)
        }
      }
      // 'r' or 'F5' key to refresh data
      else if ((e.key === 'r' || e.key === 'R' || e.key === 'F5') && !e.metaKey && !e.ctrlKey) {
        // Only prevent default if no modifier keys are pressed
        // This allows cmd+r / ctrl+r to work normally for browser refresh
        e.preventDefault()
        refreshIncidents()
      }
      // 'l' key to toggle marker labels
      else if ((e.key === 'l' || e.key === 'L') && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        setShowLabels((prev) => !prev)
      }
      // 'i' key to toggle assignment lines (only with GPS — see gpsAvailable)
      else if ((e.key === 'i' || e.key === 'I') && !e.metaKey && !e.ctrlKey && gpsAvailable) {
        e.preventDefault()
        setShowAssignmentLines((prev) => !prev)
      }
      // '1'-'5' keys to zoom in on the corresponding vehicle
      else if (e.key >= '1' && e.key <= '5' && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
        const vehicle = vehicleTypes.find((v) => v.key === e.key)
        if (vehicle) {
          e.preventDefault()
          setFocusVehicleName(vehicle.name)
          setFocusVehicleTrigger((prev) => prev + 1)
        }
      }
      // Arrow keys to pan map (placeholder - would need to integrate with Leaflet map)
      // Note: Actual map panning would require access to the Leaflet map instance
      // For now, this is documented but not fully implemented
    }

    window.addEventListener('keydown', handleKeyPress)
    return () => {
      window.removeEventListener('keydown', handleKeyPress)
      // Clean up timeout on unmount
      if (gPrefixTimeoutRef.current) {
        clearTimeout(gPrefixTimeoutRef.current)
      }
    }
  }, [gPrefixActive, selectedIncidentId, incidents, refreshIncidents, router, handleDetailsClick, vehicleTypes, gpsAvailable])

  return (
    <ProtectedRoute>
      <div className="flex h-full flex-col bg-background text-foreground">
        {/* Top header is desktop-only — mobile uses the bottom navbar. */}
        <header className="hidden md:flex items-center justify-between border-b border-border bg-card/50 backdrop-blur-sm px-4 md:px-6 py-2 min-h-14">
          <div className="flex items-center gap-3">
            {/* Arrived from the board with an incident in hand — say how to go
                back, in words. The nav icons top right can do it too, but a
                labelled way back belongs where the eye already is, and the
                incident travels along so the board lands on the same card. */}
            {highlightParam && (
              <Link
                href={`/?highlight=${highlightParam}`}
                className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
              >
                <ArrowLeft className="size-3.5" />
                {t('page.backToBoard')}
              </Link>
            )}
            <h1 className="text-xl md:text-2xl font-bold tracking-tight">{t('page.title')}</h1>
            <Badge variant="secondary" className="hidden sm:inline-flex">
              {t('page.activeBadge', { count: activeIncidents.length })}
            </Badge>
          </div>

          {/* Desktop Navigation */}
          {!isMobile && (
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 rounded-lg bg-secondary/50 px-3 py-1.5">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span className="font-mono text-base font-semibold tabular-nums">
                  {isMounted && currentTime ? currentTime.toLocaleTimeString("de-CH") : "--:--:--"}
                </span>
              </div>
              <PageNavigation
                currentPage="map"
                hasSelectedEvent={!!selectedEvent}
                selectedIncidentId={selectedIncidentId}
              />
            </div>
          )}

        </header>

        <div className={`flex flex-1 overflow-hidden ${isMobile ? 'flex-col' : 'flex-row'}`}>
          {/* Map - full height on desktop, ~45vh on mobile so the incident list gets real room */}
          <main className={`p-4 ${isMobile ? 'h-[45vh] flex-shrink-0' : 'flex-1'}`}>
            <MapView
              selectedIncidentId={selectedIncidentId}
              onMarkerClick={handleIncidentClick}
              resetZoomTrigger={resetZoomTrigger}
              panTrigger={panTrigger}
              statusFilters={statusFilters}
              showAssignmentLines={showAssignmentLines}
              showDistances={showDistances}
              showLabels={showLabels}
              focusVehicleName={focusVehicleName}
              focusVehicleTrigger={focusVehicleTrigger}
              markerAccents={markerAccents}
              highlightIncidentIds={rekoHighlightIds}
              colorBy={colorBy}
              colorGroups={colorLegend}
              showGroupRoutes={showGroupRoutes || planningActive}
              groups={groups}
              groupResourcesFor={getGroupResources}
              operationsById={operationsById}
              focusGroupId={planningActive ? planningGroupId : null}
              highlightGroupStopId={planningActive ? planningFocusStopId : null}
              onGroupStopMarkerClick={planningActive ? setPlanningFocusStopId : handleIncidentClick}
              onGpsAvailabilityChange={setGpsAvailable}
              onMapClick={
                planningActive && planningAddMode && planningGroupId ? handleMapAddStop : undefined
              }
            />
          </main>

          {/* Active Emergencies - sidebar on desktop, bottom section on mobile.
              Flex column with its own inner scroller: in list mode the header
              (title → search) sits outside the scroll container, so it can
              never move — no sticky, no overscroll spring. */}
          <aside className={`bg-card/30 backdrop-blur-sm flex flex-col overflow-hidden ${
            isMobile
              ? 'flex-1 border-t border-border'
              : 'w-80 border-l border-border flex-shrink-0'
          }`}>
            <div className={`${planningActive || rekoModeActive ? 'p-4 flex-1 min-h-0' : 'flex flex-col flex-1 min-h-0'}`}>
              {planningActive ? (
                <RoutenplanungPanel
                  groups={groups}
                  groupId={planningGroupId}
                  onGroupIdChange={setPlanningGroupId}
                  onCreateGroup={handleCreatePlanningGroup}
                  addMode={planningAddMode}
                  onAddModeChange={setPlanningAddMode}
                  focusStopId={planningFocusStopId}
                  onFocusStopChange={setPlanningFocusStopId}
                  planning={planning}
                  onExit={exitPlanning}
                  canEdit={isEditor}
                />
              ) : rekoModeActive ? (
                <RekoModusPanel
                  people={rekoPeople}
                  openByPerson={rekoOpenByPerson}
                  legendColors={new Map(colorLegend.map((g) => [g.key, g.color]))}
                  selectedPersonId={rekoPersonId}
                  onSelectPerson={setRekoPersonId}
                  onExit={exitRekoMode}
                />
              ) : (
              <>
              {/* Fixed header: title through search live outside the scroll
                  container below, so they simply never move. */}
              <div className="flex-shrink-0 p-4 pb-3 border-b border-border/50">
              <h2 className="text-lg font-bold mb-3">
                {t('page.incidentsHeading', { count: activeIncidents.length })}
              </h2>

              {/* Status filters — the only pill-style control: they change which
                  incidents show (list + map). View options and modes live behind
                  their own buttons below so three control families read apart. */}
              <div className="inline-flex rounded-lg border border-border overflow-hidden mb-2">
                {(['open', 'active', 'completed'] as StatusGroup[]).map((group, index) => (
                  <button
                    key={group}
                    onClick={() => toggleStatusFilter(group)}
                    className={`px-3 py-1.5 text-xs font-medium transition-colors ${index > 0 ? 'border-l border-border' : ''} ${
                      statusFilters[group]
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted/50 text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    {t(`statusGroups.${group}`)} ({statusGroupCounts[group]})
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap gap-2 mb-4">
                {/* Ansicht — every map display option in one popover. The button
                    lights up subtly when any option differs from the defaults. */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors flex items-center gap-1.5 ${
                        !showLabels || (gpsAvailable && (!showAssignmentLines || showDistances)) || showGroupRoutes || colorBy !== 'priority'
                          ? 'border-primary/50 bg-secondary/50 text-foreground'
                          : 'bg-muted/50 text-muted-foreground border-border hover:bg-muted'
                      }`}
                      title={t('page.viewMenuLabel')}
                    >
                      <Layers className="h-3 w-3" />
                      {t('page.view')}
                      <ChevronDown className="h-3 w-3 opacity-60" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" collisionPadding={8} className="w-60">
                    <DropdownMenuLabel>{t('page.viewMenuLabel')}</DropdownMenuLabel>
                    {/* e.preventDefault keeps the menu open so several options can
                        be flipped in one visit (and the legend updates live). */}
                    <DropdownMenuCheckboxItem
                      checked={showLabels}
                      onSelect={(e) => { e.preventDefault(); setShowLabels(!showLabels) }}
                    >
                      <span className="flex-1">{t('page.labels')}</span>
                      {!isMobile && <Kbd className="text-2xs">L</Kbd>}
                    </DropdownMenuCheckboxItem>
                    {/* Both are drawn from vehicle GPS — without it they are dead
                        switches, so they only exist when GPS does. */}
                    {gpsAvailable && (
                      <>
                        <DropdownMenuCheckboxItem
                          checked={showAssignmentLines}
                          onSelect={(e) => { e.preventDefault(); setShowAssignmentLines(!showAssignmentLines) }}
                        >
                          <span className="flex-1">{t('page.lines')}</span>
                          {!isMobile && <Kbd className="text-2xs">I</Kbd>}
                        </DropdownMenuCheckboxItem>
                        <DropdownMenuCheckboxItem
                          checked={showDistances}
                          onSelect={(e) => { e.preventDefault(); setShowDistances(!showDistances) }}
                        >
                          <span className="flex-1">{t('page.distance')}</span>
                        </DropdownMenuCheckboxItem>
                      </>
                    )}
                    {/* Switching this on also forces "Färben nach" to Auftrag.
                        Silently taking over another control is the kind of thing
                        that reads as a bug at 3am, so both ends say so: the cause
                        here, the effect under the Färben-nach label below. */}
                    <DropdownMenuCheckboxItem
                      checked={showGroupRoutes}
                      onSelect={(e) => { e.preventDefault(); toggleGroupRoutes() }}
                      className="items-start"
                    >
                      <span className="flex-1">
                        {t('page.groupRoutes')}
                        <span className="block text-[11px] leading-snug text-muted-foreground">
                          {t('page.groupRoutesColorHint')}
                        </span>
                      </span>
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>{t('common.colorByMenuLabel')}</DropdownMenuLabel>
                    {showGroupRoutes && colorBy === 'auftrag' && (
                      <p className="px-2 pb-1.5 text-[11px] leading-snug text-muted-foreground">
                        {t('page.colorByRoutesOverride')}
                      </p>
                    )}
                    {(['priority', 'reko', 'vehicle', 'type', 'auftrag'] as ColorByDimension[]).map((dim) => (
                      <DropdownMenuItem
                        key={dim}
                        onSelect={(e) => { e.preventDefault(); setColorByPersisted(dim) }}
                        className="cursor-pointer justify-between"
                      >
                        {t(`colorBy.${dim}`)}
                        {colorBy === dim && <Check className="h-3.5 w-3.5" />}
                      </DropdownMenuItem>
                    ))}
                    {colorLegend.length > 0 && (
                      <>
                        <DropdownMenuSeparator />
                        <div className="px-2 py-1.5 space-y-1 max-h-48 overflow-y-auto overscroll-contain">
                          {colorLegend.map((g) => (
                            <div key={g.key} className="flex items-center gap-2 text-xs">
                              <span className="h-3 w-3 rounded-sm flex-shrink-0" style={{ backgroundColor: g.color }} />
                              <span className="truncate">{g.label}</span>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>

                {/* Modus — editor tools that change what tapping the map does.
                    Deliberately rounded-md (not pill) so tools read apart from
                    filters; both modes swap the sidebar for their panel. */}
                {isEditor && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        className="px-3 py-1.5 text-xs font-medium rounded-md border border-border bg-muted/50 text-muted-foreground hover:bg-muted transition-colors flex items-center gap-1.5"
                        title={t('page.modes')}
                      >
                        <Wrench className="h-3 w-3" />
                        {t('page.modes')}
                        <ChevronDown className="h-3 w-3 opacity-60" />
                      </button>
                    </DropdownMenuTrigger>
                    {/* The sidebar hugs the right screen edge — right-align the
                        menu to its trigger so it can't clip off-screen. */}
                    <DropdownMenuContent align="end" collisionPadding={8} className="w-52">
                      <DropdownMenuItem onSelect={() => enterPlanning()} className="cursor-pointer">
                        <Milestone className="h-4 w-4" />
                        {t('page.routePlanning')}
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => enterRekoMode()} className="cursor-pointer">
                        <Binoculars className="h-4 w-4" />
                        {t('rekoMode.title')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>

              {/* Search bar */}
              <SearchInput
                id="map-search-input"
                placeholder={t('page.searchPlaceholder')}
                value={searchQuery}
                onValueChange={setSearchQuery}
                hint={!isMobile ? <Kbd className="text-xs">S</Kbd> : undefined}
              />
              </div>

              {/* On mobile the fixed bottom navbar overlays the page, so pad the
                  scrollable list past it (nav height + safe-area) — otherwise the
                  last incidents sit behind the bar and can't be scrolled into view. */}
              <div className={`flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 pt-3 ${isMobile ? 'pb-[calc(env(safe-area-inset-bottom)+5rem)]' : ''}`}>
              <div className="space-y-3">
                {activeIncidents.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    {t('common.noActiveIncidents')}
                  </p>
                ) : (
                  activeIncidents.map((incident) => {
                    const isExpanded = selectedIncidentId === incident.id
                    return (
                      <Card
                        key={incident.id}
                        id={`map-incident-card-${incident.id}`}
                        className={`p-4 cursor-pointer transition-all hover:border-border ${
                          isExpanded
                            ? "border-primary ring-2 ring-primary/20 scale-[1.02]"
                            : ""
                        }`}
                        onClick={() => handleIncidentClick(incident.id)}
                        onDoubleClick={() => handleDetailsClick(incident)}
                      >
                        <div className="space-y-3">
                          {/* Location and Details button */}
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-start gap-2 min-w-0 flex-1">
                              <div
                                className={`h-2.5 w-2.5 rounded-full flex-shrink-0 mt-1 ${
                                  PRIORITY_DOT_CLASSES[(incident.priority ?? "low") as Priority]
                                }`}
                                title={incident.priority === "high" ? t('common.priorityHigh') : incident.priority === "medium" ? t('common.priorityMedium') : t('common.priorityLow')}
                              />
                              <div className="min-w-0 flex-1">
                                <h3 className="font-bold text-base leading-tight">
                                  {incident.location_address ? formatLocation(incident.location_address) : incident.title}
                                </h3>
                                {incident.title && incident.title !== incident.location_address && (
                                  <p className="text-xs text-muted-foreground mt-0.5">
                                    {incident.title}
                                  </p>
                                )}
                              </div>
                            </div>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleDetailsClick(incident)
                                  }}
                                  className="p-1.5 rounded-md hover:bg-muted transition-colors flex-shrink-0"
                                >
                                  <FileText className="h-4 w-4 text-muted-foreground" />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent>{t('page.showDetails')}</TooltipContent>
                            </Tooltip>
                          </div>

                          {/* Incident Type */}
                          <div className="flex items-center gap-2">
                            <Siren className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                            <span className="text-sm text-muted-foreground">{incident.type in INCIDENT_TYPE_LABELS ? tIncidents(`types.${incident.type}`) : incident.type}</span>
                          </div>

                          {/* Time and Status. The list used to count from the alarm
                              while the board counted from the last status change —
                              the same-looking chip, two different answers. Both are
                              the shared IncidentTime chip now. */}
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <IncidentTimeRow operation={incidentTimeSource(incident)} />
                            <Badge variant="outline" className="text-xs">
                              {incident.status in STATUS_LABELS ? tKanban(`statusLabels.${incident.status}`) : incident.status}
                            </Badge>
                          </div>

                          {/* Description (only when expanded) */}
                          {isExpanded && incident.description && (
                            <p className="text-sm text-muted-foreground">
                              {incident.description}
                            </p>
                          )}

                          {/* Assigned Vehicles (only when expanded) */}
                          {isExpanded && incident.assigned_vehicles && incident.assigned_vehicles.length > 0 && (
                            <div className="flex items-start gap-2">
                              <Truck className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                              <div className="flex flex-wrap gap-1.5 flex-1">
                                {incident.assigned_vehicles.map((vehicle, idx) => (
                                  <Badge
                                    key={idx}
                                    variant="secondary"
                                    className="text-xs"
                                  >
                                    {vehicle.name}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Assigned Crew (only when expanded) */}
                          {isExpanded && incident.assigned_personnel && incident.assigned_personnel.length > 0 && (
                            <div className="flex items-start gap-2">
                              <Users className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                              <div className="flex flex-wrap gap-1.5 flex-1">
                                {incident.assigned_personnel.map((person, idx) => (
                                  <Badge
                                    key={idx}
                                    variant="secondary"
                                    className="text-xs"
                                  >
                                    {person.name.split(" ")[0][0]}.{person.name.split(" ")[1]?.[0] || ""}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Assigned Materials (only when expanded) */}
                          {isExpanded && incident.assigned_materials && incident.assigned_materials.length > 0 && (
                            <div className="flex items-start gap-2">
                              <Package className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                              <div className="flex flex-wrap gap-1.5 flex-1">
                                {incident.assigned_materials.map((material, idx) => (
                                  <Badge
                                    key={idx}
                                    variant="outline"
                                    className="text-xs"
                                  >
                                    {material.name.substring(0, 15)}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </Card>
                    )
                  })
                )}
              </div>
              </div>
              </>
              )}
            </div>
          </aside>
        </div>

        {/* Operation Detail Modal */}
        <OperationDetailModal
          operation={selectedOperation}
          open={detailModalOpen}
          onOpenChange={setDetailModalOpen}
          onUpdate={handleOperationUpdate}
          onDelete={isEditor ? handleOperationDelete : undefined}
          materials={materials}
          onAssignVehicle={isEditor ? assignVehicleToIncidentWithConflict : undefined}
          onRemoveVehicle={isEditor ? handleVehicleRemove : undefined}
          onAssignResource={isEditor ? handleOpenAssignmentDialog : undefined}
          onRemoveCrew={isEditor ? removeCrew : undefined}
          onRemoveMaterial={isEditor ? removeMaterial : undefined}
          canEdit={isEditor}
          diveraEnabled={isEditor && diveraEnabled}
          onSendDivera={isEditor ? setDiveraDialogOp : undefined}
          onChangeStatus={isEditor ? statusWorkflow.requestStatusChange : undefined}
          onRequestComplete={isEditor ? statusWorkflow.requestCompletion : undefined}
          onDistributeToAuftrag={isEditor ? setAuftragPickerIncidentId : undefined}
        />

        <ResourceAssignmentDialog
          open={assignmentDialogOpen}
          onOpenChange={(open) => {
            setAssignmentDialogOpen(open)
            if (!open) {
              setRouteAssign(null)
              setAssignmentOperationId(null)
              statusWorkflow.resumeGateAfterAssignment()
            }
          }}
          resourceType={assignmentResourceType}
          operationId={routeAssign ? routeAssign.groupId : assignmentOperationId}
          assignTarget={routeAssign ? 'route' : 'incident'}
          routeName={routeAssign ? groups.find((group) => group.id === routeAssign.groupId)?.name : undefined}
          personnel={personnel}
          vehicles={vehicleTypes}
          materials={materials}
          assignedPersonnel={routeGroupResources ? routeGroupResources.personnel.map((person) => person.name) : assignedResources.assignedPersonnel}
          assignedVehicles={routeGroupResources ? routeGroupResources.vehicles.map((vehicle) => vehicle.name) : assignedResources.assignedVehicles}
          assignedMaterials={routeGroupResources ? routeGroupResources.materials.map((material) => material.resourceId) : assignedResources.assignedMaterials}
          rekoPersonnelNames={routeAssign ? [] : rekoPersonnelNames}
          onAssignPerson={routeAssign
            ? (personId) => void assignGroupResource(routeAssign.groupId, 'personnel', personId)
            : ((personId: string, personName: string, operationId: string) =>
              // force: the dialog has its own «Doppelbelegung? Trotzdem zuweisen»
              // confirm with the label of where the person already is. Asking
              // again through the shared prompt would be the same question twice.
              assignPersonToOperation(personId, personName, operationId, true))}
          onAssignVehicle={routeAssign
            ? (vehicleId) => assignVehicleToGroupWithConflict(routeAssign.groupId, vehicleId)
            : assignVehicleToIncidentWithConflict}
          onAssignMaterial={routeAssign
            ? (materialId) => void assignGroupResource(routeAssign.groupId, 'material', materialId)
            : ((materialId: string, operationId: string) =>
              assignMaterialToOperation(materialId, operationId, true))}
          onRemovePerson={routeAssign
            ? (_operationId, personName) => {
                const assignment = routeGroupResources?.personnel.find((person) => person.name === personName)
                if (assignment) void unassignGroupResource(routeAssign.groupId, assignment.assignmentId)
              }
            : removeCrew}
          onRemoveVehicle={routeAssign
            ? (_operationId, vehicleName) => {
                const assignment = routeGroupResources?.vehicles.find((vehicle) => vehicle.name === vehicleName)
                if (assignment) void unassignGroupResource(routeAssign.groupId, assignment.assignmentId)
              }
            : removeVehicleFromOperation}
          onRemoveMaterial={routeAssign
            ? (_operationId, materialId) => {
                const assignment = routeGroupResources?.materials.find((material) => material.resourceId === materialId)
                if (assignment) void unassignGroupResource(routeAssign.groupId, assignment.assignmentId)
              }
            : removeMaterial}
          zuFuss={assignmentOperation?.zuFuss ?? false}
          onToggleZuFuss={assignmentOperation
            ? () => updateOperation(assignmentOperation.id, { zuFuss: !assignmentOperation.zuFuss })
            : undefined}
          occupiedPersonnelIds={occupiedPersonnelIds}
          occupiedVehicleIds={occupiedVehicleIds}
          occupiedMaterialIds={occupiedMaterialIds}
          vehicleDriverStay={routeAssign ? undefined : assignmentOperation?.vehicleDriverStay}
          onToggleDriverStay={!routeAssign && assignmentOperation
            ? (vehicleName) => toggleDriverStay(assignmentOperation.id, vehicleName)
            : undefined}
        />

        <AuftragPickerDialog
          open={auftragPickerIncidentId !== null}
          onOpenChange={(open) => !open && setAuftragPickerIncidentId(null)}
          groups={groups}
          currentGroupId={
            auftragPickerIncidentId
              ? operations.find((operation) => operation.id === auftragPickerIncidentId)?.groupId ?? null
              : null
          }
          onChoose={handleChooseAuftrag}
          onCreate={(name) => createGroup({ name })}
          onRemoveFromCurrent={handleRemoveFromAuftrag}
        />

        <DiveraSendDialog
          open={diveraDialogOp !== null}
          onOpenChange={(open) => !open && setDiveraDialogOp(null)}
          operation={diveraDialogOpLive}
          materials={materials}
        />

        <IncidentStatusWorkflowDialogs
          controller={statusWorkflow}
          printerEnabled={printerEnabled}
          funkrufname={funkrufname}
          diveraEnabled={diveraEnabled}
          onOpenAssignment={handleOpenAssignmentDialog}
          onOpenDetail={(operationId) => {
            setSelectedOperationId(operationId)
            setDetailModalOpen(true)
          }}
          onSendDivera={setDiveraDialogOp}
          onRefresh={refreshIncidents}
        />

        {/* Reko-Modus: replacing another person's reko needs a confirm */}
        <ConfirmDialog
          open={rekoOverwrite !== null}
          onOpenChange={(open) => { if (!open) setRekoOverwrite(null) }}
          title={t('rekoMode.overwriteTitle')}
          description={
            rekoOverwrite
              ? t('rekoMode.overwriteDescription', {
                  current: rekoOverwrite.currentName,
                  next: rekoOverwrite.nextName,
                })
              : ''
          }
          confirmText={t('rekoMode.overwriteConfirm')}
          onConfirm={() => {
            if (!rekoOverwrite) return
            assignRekoPersonToOperation(
              rekoOverwrite.nextId,
              rekoOverwrite.nextName,
              rekoOverwrite.operationId,
            )
            setRekoOverwrite(null)
          }}
        />
      </div>

      {/* Mobile Bottom Navigation */}

      <MobileBottomNavigation currentPage="map" hasSelectedEvent={!!selectedEvent} />

    </ProtectedRoute>
  )
}
