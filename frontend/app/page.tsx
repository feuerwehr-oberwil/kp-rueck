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
import Link from "next/link"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Search, Plus, Clock, Package, QrCode, Copy, Check, CircleCheck, Sparkles, ClipboardCheck, Truck, Printer, MonitorDown, Siren, ChevronDown, CalendarDays, ChevronLeft, ChevronRight, Waypoints } from 'lucide-react'
import { Kbd } from "@/components/ui/kbd"
import { ProtectedRoute } from "@/components/protected-route"
import { PageNavigation } from "@/components/page-navigation"
import { MobileBottomNavigation } from "@/components/mobile-bottom-navigation"
import { toast } from "sonner"
import { QrShareSheet } from "@/components/kanban/qr-share-sheet"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useOperations, type Person, type Operation, type Material, type PersonRole, type OperationStatus, type RekoSummary } from "@/lib/contexts/operations-context"
import { useGroups } from "@/lib/contexts/groups-context"
import { AuftraegeSheet } from "@/components/kanban/auftraege-sheet"
import { toMirrorStatus } from "@/components/map/route-stop-list"
import { RoutenEditorModal } from "@/components/kanban/routen-editor-modal"
import { useMaterials } from "@/lib/contexts/materials-context"
import { useEvent } from "@/lib/contexts/event-context"
import { apiClient } from "@/lib/api-client"
import { IncidentPickerDialog } from "@/components/kanban/incident-picker-dialog"
import { AuftragPickerDialog } from "@/components/kanban/auftrag-picker-dialog"
import { ClosedStopDialog } from "@/components/kanban/closed-stop-dialog"
import { useClosedStopGuard } from "@/lib/hooks/use-closed-stop-guard"
import { QRCodeSVG } from 'qrcode.react'
import { useRekoNotifications } from "@/lib/hooks/use-reko-notifications"
import { useNotifications } from "@/lib/contexts/notification-context"
import { useOperationHandlers } from "@/lib/hooks/use-operation-handlers"
import { useKanbanDragDrop } from "@/lib/hooks/use-kanban-drag-drop"
import { useResourceFiltering } from "@/lib/hooks/use-resource-filtering"
import { useDoubleBookedPersons } from "@/lib/hooks/use-double-booked-persons"
import { useCurrentTime } from "@/lib/hooks/use-current-time"
import { useGPrefixNavigation } from "@/lib/hooks/use-g-prefix-navigation"
import { useKanbanShortcuts } from "@/lib/hooks/use-kanban-shortcuts"
import { useCommandPaletteHint } from "@/lib/hooks/use-is-mac"
import { usePrintJobToast } from "@/lib/hooks/use-print-job-toast"
import { useAuth } from "@/lib/contexts/auth-context"
import { useCommandPalette } from "@/lib/contexts/command-palette-context"
import { columns, findAuftragForStop } from "@/lib/kanban-utils"
import { useToggleDriverStay } from "@/lib/hooks/use-driver-stay"
import { getIncidentTypeLabel, getIncidentRefLabel } from "@/lib/incident-types"
import { DraggablePerson } from "@/components/kanban/draggable-person"
import { DraggableMaterial } from "@/components/kanban/draggable-material"
import { MaterialGroupBlock } from "@/components/kanban/material-group-block"
import { DroppableColumn } from "@/components/kanban/droppable-column"
import { OperationDetailModal } from "@/components/kanban/operation-detail-modal"
import { ResourceAssignmentDialog } from "@/components/kanban/resource-assignment-dialog"
import { NewEmergencyModal } from "@/components/kanban/new-emergency-modal"
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog"
import { useIsMobile } from "@/components/ui/use-mobile"
import { EventSetupChecklist } from "@/components/event-setup-checklist"
import { summarizeEventChecklist } from "@/lib/checklist-tasks"
import { useCrossWindowSync } from "@/lib/hooks/use-cross-window-sync"
import { VehicleStatusSheet } from "@/components/vehicle-status-sheet"
import { EventSelectionEmptyState } from "@/components/empty-states/event-selection-empty-state"
import { SidePanel } from "@/components/kanban/side-panel"
import { SIDE_PANEL_BREAKPOINT } from "@/lib/layout-breakpoints"
import { MobileIncidentListView } from "@/components/mobile/mobile-incident-list-view"
import { MobilePersonnelSheet } from "@/components/mobile/mobile-personnel-sheet"
import { PrintOptionsModal } from "@/components/print/print-options-modal"
import { ThermoOptionsSheet, type ThermoPrintOptions } from "@/components/print/thermo-options-sheet"
import { AssignRekoDialog } from "@/components/incidents/assign-reko-dialog"
import { TransferIncidentDialog } from "@/components/incidents/transfer-incident-dialog"
import type { Incident } from "@/lib/types/incidents"
import { DiveraSendDialog } from "@/components/divera/divera-send-dialog"
import {
  IncidentStatusWorkflowDialogs,
  useIncidentStatusWorkflow,
} from "@/components/kanban/incident-status-workflow"
import { cn } from "@/lib/utils"
import type { LucideIcon } from "lucide-react"

/**
 * One footer-toolbar pill: icon + label, highlighted when the sheet/dialog it
 * opens is active. Replaces ~8 hand-rolled, near-identical `<Button>` blocks
 * that only differed in icon/label/state — each with its own template-literal
 * className doing the same active/inactive ternary.
 */
function ToolbarToggle({
  icon: Icon,
  label,
  active,
  disabled,
  title,
  onActivate,
}: {
  icon: LucideIcon
  label: string
  active: boolean
  disabled?: boolean
  title?: string
  onActivate: () => void
}) {
  return (
    <Button
      size="xs"
      variant="ghost"
      className={cn(
        // Explicit px: these sit in a gap-less row, so the button's own padding
        // is the only thing keeping one item's label off the next item's icon.
        "px-2.5 transition-colors",
        active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground",
      )}
      onPointerDown={(e) => {
        e.stopPropagation()
        onActivate()
      }}
      disabled={disabled}
      title={title}
    >
      <Icon className="size-3.5" />
      <span className="text-xs">{label}</span>
    </Button>
  )
}

/**
 * Sidebar filter: show only what can be assigned right now.
 *
 * Icon-only and 32px square so it sits flush with the 32px search field. The
 * check glyph is the same one the resource cards use for "verfügbar", so the
 * button reads as "keep the green ones" rather than as a generic funnel.
 */
function AvailableOnlyToggle({
  active,
  onToggle,
  label,
}: {
  active: boolean
  onToggle: () => void
  label: string
}) {
  return (
    <Button
      size="icon-xs"
      variant={active ? "secondary" : "ghost"}
      onClick={onToggle}
      aria-pressed={active}
      title={label}
      aria-label={label}
      className={cn(
        "flex-shrink-0 border",
        active
          ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      <CircleCheck className="size-4" />
    </Button>
  )
}

export default function FireStationDashboard() {
  const {
    personnel,
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
    assignPersonToOperation,
    assignRekoPersonToOperation,
    assignMaterialToOperation,
    assignVehicleToOperation,
    requestVehicleConflict,
    deleteOperation,
    isLoading,
    isLoaded
  } = useOperations()
  const {
    groups,
    addStops: addStopsToGroup,
    assignResource: assignGroupResource,
    unassignResource: unassignGroupResource,
    getGroupResources,
    createGroup,
    removeStop: removeStopFromGroup,
    occupiedResourceIds,
  } = useGroups()

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

  const doubleBookedPersons = useDoubleBookedPersons(operations)

  const { materialGroups } = useMaterials()
  const { selectedEvent, isEventLoaded, events, setSelectedEvent } = useEvent()
  const { isEditor, isAuthenticated } = useAuth()
  const { toggleSidebar: toggleNotificationSidebar, registerNavigateHandler, closeSidebar: closeNotificationSidebar } = useNotifications()
  const { registerHandlers, clearHandlers } = useCommandPalette()
  const searchParams = useSearchParams()
  const router = useRouter()
  const highlightParam = searchParams.get("highlight")
  const isMobile = useIsMobile()

  const tCommon = useTranslations('kanban.common')
  const tDash = useTranslations('kanban.dashboard')
  const tRes = useTranslations('kanban.resources')
  const tPrint = useTranslations('print.toasts')
  const trackPrint = usePrintJobToast()

  // Ref for highlight timeout cleanup
  const highlightTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Scroll to and highlight a card by operation ID
  const scrollToCard = useCallback((operationId: string) => {
    // Clear any existing highlight timeout
    if (highlightTimeoutRef.current) {
      clearTimeout(highlightTimeoutRef.current)
    }

    // Set highlight immediately
    setHighlightedOperationId(operationId)

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

          mainContainer.scrollTo({
            left: Math.max(0, scrollLeft),
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

  const { currentTime, isMounted } = useCurrentTime()
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
  // Modal and panel intentionally share one incident identity; only presentation
  // changes at the external-monitor breakpoint.
  const [panToNonce, setPanToNonce] = useState(0)
  const [sidePanelMode, setSidePanelMode] = useState<'detail' | 'map' | 'collapsed'>('collapsed')
  const openIncidentDetail = useCallback((operationId: string) => {
    setSelectedOperationId(operationId)
    setHoveredOperationId(operationId)
    if (typeof window !== 'undefined' && window.innerWidth >= SIDE_PANEL_BREAKPOINT) {
      setDetailModalOpen(false)
      setPanToNonce((value) => value + 1)
      setSidePanelMode('detail')
    } else {
      setDetailModalOpen(true)
    }
  }, [])

  const handleOpenIncidentFromNotification = useCallback((incidentId: string) => {
    if (operations.some((operation) => operation.id === incidentId)) openIncidentDetail(incidentId)
  }, [openIncidentDetail, operations])

  useRekoNotifications(operations, handleOpenIncidentFromNotification, handleUpdateOperationReko)
  const [draggingItem, setDraggingItem] = useState<Person | Material | Operation | null>(null)
  const [vehicleTypes, setVehicleTypes] = useState<Array<{ key: string; name: string; id: string; type: string }>>([])
  const [showLeftSidebar, setShowLeftSidebar] = useState(true)
  const [showRightSidebar, setShowRightSidebar] = useState(true)
  // Single state for footer sheets - only one can be open at a time
  const [activeFooterSheet, setActiveFooterSheet] = useState<'checkin' | 'reko' | 'display' | 'alarm' | 'vehicles' | 'print' | 'thermo' | 'auftraege' | null>(null)
  // When the Aufträge sheet is opened from a board chip, expand/scroll to this group.
  const [auftraegeFocusGroupId, setAuftraegeFocusGroupId] = useState<string | null>(null)
  // When "+ Stop" opens the New-Emergency modal, the created incident attaches here.
  const [newEmergencyGroupId, setNewEmergencyGroupId] = useState<string | null>(null)
  // Routen-Editor modal: the Auftrag being edited + an optional stop to centre on.
  const [routenEditorGroupId, setRoutenEditorGroupId] = useState<string | null>(null)
  const [routenEditorFocusIncidentId, setRoutenEditorFocusIncidentId] = useState<string | null>(null)
  // "+ Stop" incident picker: the route existing incidents are added to as stops.
  const [stopPickerGroupId, setStopPickerGroupId] = useState<string | null>(null)
  // "An Auftrag verteilen" picker: the incident being distributed into a route.
  const [auftragPickerIncidentId, setAuftragPickerIncidentId] = useState<string | null>(null)
  // Route-level resource assign: when set, the assignment dialog is scoped to the
  // ROUTE (Auftrag) rather than a single incident — assign/remove hit the group.
  const [routeAssign, setRouteAssign] = useState<{ groupId: string; resourceType: 'crew' | 'vehicles' | 'materials' } | null>(null)
  const [checkInUrl, setCheckInUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Auto-generate check-in QR code URL when no personnel are available
  useEffect(() => {
    if (!selectedEvent || checkInUrl || isLoading) return
    if (personnel.filter((p) => p.status === "available").length > 0) return
    apiClient.generateCheckInLink(selectedEvent.id).then((response) => {
      setCheckInUrl(`${window.location.origin}${response.link}`)
    }).catch(() => {})
  }, [selectedEvent, personnel, checkInUrl, isLoading])

  const gPrefix = useGPrefixNavigation(router)
  const cmdHint = useCommandPaletteHint()
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [operationToDelete, setOperationToDelete] = useState<Operation | null>(null)
  const [showMeldung, setShowMeldung] = useState(() => {
    if (typeof window !== 'undefined') {
      // Migration: force showMeldung=true for existing users (v2 key)
      if (!localStorage.getItem('showMeldung_v2')) {
        localStorage.setItem('showMeldung_v2', '1')
        localStorage.setItem('showMeldung', 'true')
        return true
      }
      return localStorage.getItem('showMeldung') === 'true'
    }
    return true
  })
  const [rekoDashboardUrl, setRekoDashboardUrl] = useState<string | null>(null)
  const [displayToken, setDisplayToken] = useState<string | null>(null)
  const [displayView, setDisplayView] = useState<'board' | 'map' | 'status'>('board')
  const [alarmUrl, setAlarmUrl] = useState<string | null>(null)
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

  // Persist showMeldung to localStorage
  useEffect(() => {
    localStorage.setItem('showMeldung', String(showMeldung))
  }, [showMeldung])

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
      if (!selectedOperationId) return
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
  }, [detailModalOpen, selectedOperationId, sidePanelMode])
  // Register notification click → scroll to card + open detail
  // Small screens: open modal overlay. Large screens (≥1536px): select in side panel.
  useEffect(() => {
    registerNavigateHandler((incidentId: string) => {
      closeNotificationSidebar()
      scrollToCard(incidentId)
      // Open detail after scroll
      setTimeout(() => {
        const operation = operations.find(op => op.id === incidentId)
        if (operation) {
          const isLargeScreen = window.innerWidth >= SIDE_PANEL_BREAKPOINT
          if (isLargeScreen) {
            // Side panel selection (same as onCardSelect / handleCardSelect)
            openIncidentDetail(incidentId)
          } else {
            // Modal overlay (same as onCardClick / handleCardClick)
            openIncidentDetail(incidentId)
          }
        }
      }, 200)
    })
    return () => registerNavigateHandler(null)
  }, [registerNavigateHandler, closeNotificationSidebar, scrollToCard, operations, openIncidentDetail])

  // Resource assignment dialog state
  const [assignmentDialogOpen, setAssignmentDialogOpen] = useState(false)
  const [assignmentResourceType, setAssignmentResourceType] = useState<'crew' | 'vehicles' | 'materials' | null>(null)
  const [assignmentOperationId, setAssignmentOperationId] = useState<string | null>(null)
  const [rekoPersonnelNames, setRekoPersonnelNames] = useState<string[]>([])

  // Reko assignment dialog state (context menu)
  const [rekoAssignDialogOpen, setRekoAssignDialogOpen] = useState(false)
  const [rekoAssignOperationId, setRekoAssignOperationId] = useState<string | null>(null)

  // Thermal printer state
  const [printerEnabled, setPrinterEnabled] = useState(false)
  const [diveraEnabled, setDiveraEnabled] = useState(false)
  const [isPrintingBoard, setIsPrintingBoard] = useState(false)
  const [isPrintingQR, setIsPrintingQR] = useState(false)
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
        setPrinterEnabled(status.enabled)
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

  // Handle thermal QR-code slip print (Check-In / Reko / Viewer / Walk-In links)
  const handlePrintQR = useCallback(async (qrContent: string, title: string, subtitle?: string) => {
    if (!printerEnabled || !qrContent || isPrintingQR) return
    setIsPrintingQR(true)
    try {
      const job = await apiClient.queueQRCodePrint({
        qr_content: qrContent,
        title,
        subtitle,
        event_id: selectedEvent?.id,
      })
      trackPrint(job.id, { sentTitle: tDash('qrPrintSent'), subject: tPrint('subjectQr') })
    } catch {
      toast.error(tCommon('printFailed'))
    } finally {
      setIsPrintingQR(false)
    }
  }, [printerEnabled, isPrintingQR, selectedEvent, tCommon, tDash, tPrint, trackPrint])

  // Use ref to track drag state more reliably
  const isDraggingOperationRef = useRef(false)

  const setRouteStopStatus = useCallback((operationId: string, newStatus: OperationStatus) => {
    const operation = operations.find((op) => op.id === operationId)
    if (!operation || operation.status === "complete") return
    // The stop control shows a lossy MIRROR of the real status: reko + reko_done
    // both read as "Offen" (incoming). Re-selecting the bucket the incident is
    // already in must be a no-op — otherwise writing "incoming" back regresses a
    // reko/reko-done incident all the way to eingegangen, discarding its progress.
    if (toMirrorStatus(operation) === newStatus) return
    requestStatusChange(operationId, newStatus)
  }, [operations, requestStatusChange])

  // One-shot column sort: persist the chosen column's order without turning off
  // manual drag-and-drop ordering afterwards.
  const handleColumnSort = useCallback((columnId: string, key: 'priority' | 'age' | 'auftrag' | 'type') => {
    const column = columns.find((candidate) => candidate.id === columnId)
    if (!column) return

    const priorityRank: Record<string, number> = { high: 0, medium: 1, low: 2 }
    const byAge = (a: Operation, b: Operation) => a.dispatchTime.getTime() - b.dispatchTime.getTime()
    const groupName = (id: string | null) => (id ? groups.find((g) => g.id === id)?.name ?? '' : '')
    const cmp = (a: Operation, b: Operation): number => {
      switch (key) {
        case 'priority':
          return (priorityRank[a.priority] - priorityRank[b.priority]) || byAge(a, b)
        case 'type':
          return getIncidentTypeLabel(a.incidentType).localeCompare(getIncidentTypeLabel(b.incidentType)) || byAge(a, b)
        case 'auftrag':
          // Cluster grouped stops together (by route name, then stop order);
          // ungrouped cards fall after, oldest first.
          if (!!a.groupId !== !!b.groupId) return a.groupId ? -1 : 1
          if (a.groupId && b.groupId && a.groupId !== b.groupId) {
            return groupName(a.groupId).localeCompare(groupName(b.groupId))
          }
          if (a.groupId && b.groupId) return a.groupPosition - b.groupPosition
          return byAge(a, b)
        default:
          return byAge(a, b)
      }
    }
    const columnOperations = operations.filter((op) => column.status.includes(op.status)).sort(cmp)
    const ordered = columnOperations.map((op) => op.id)

    // Replace only this column's slots so every other column keeps its order.
    setOperations((prev) => {
      let nextIndex = 0
      return prev.map((op) => column.status.includes(op.status) ? columnOperations[nextIndex++] : op)
    })
    reorderColumn(ordered)
    toast.success(tDash('sort.applied'))
  }, [operations, groups, setOperations, reorderColumn, tDash])

  // Open the "Ressourcen übertragen" dialog from the card context menu. Loads the
  // event's incidents as transfer targets (mirrors side-panel's handleOpenTransfer).
  const handleOpenTransfer = useCallback(async (operationId: string) => {
    const op = operations.find(o => o.id === operationId)
    if (!op || !selectedEvent) {
      toast.error(tCommon('error'), { description: tCommon('noEventSelected') })
      return
    }
    try {
      const apiIncidents = await apiClient.getIncidents(selectedEvent.id)
      const incidents: Incident[] = apiIncidents.map(inc => {
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
          assigned_vehicles: assigned_vehicles.map(v => ({ ...v, assigned_at: new Date(v.assigned_at) })),
        }
      })
      setTransferAvailableIncidents(incidents)
      setTransferSourceOp(op)
    } catch (error) {
      console.error("Failed to load incidents:", error)
      toast.error(tCommon('loadFailed'))
    }
  }, [operations, selectedEvent, tCommon])

  // Perform the transfer. The backend returns a specific German reason on failure.
  const handleTransfer = useCallback(async (targetIncidentId: string) => {
    if (!transferSourceOp) return
    try {
      setIsTransferring(true)
      await apiClient.transferAssignments(transferSourceOp.id, targetIncidentId)
      setTransferSourceOp(null)
      toast.success(tCommon('transferResources'))
    } catch (error) {
      toast.error(tCommon('transferFailed'), {
        description: (error instanceof Error && error.message) || tCommon('transferFailedDescription'),
      })
    } finally {
      setIsTransferring(false)
    }
  }, [transferSourceOp, tCommon])

  const moveOperationRight = useCallback((operationId: string) => {
    const operation = operations.find(op => op.id === operationId)
    if (!operation) return

    const currentColumnIndex = columns.findIndex((col) => col.status.includes(operation.status))
    if (currentColumnIndex < columns.length - 1) {
      const nextColumn = columns[currentColumnIndex + 1]
      const newStatus = nextColumn.status[0] as OperationStatus
      const previousStatus = operation.status
      updateOperation(operationId, { status: newStatus })
      if (newStatus === "enroute") triggerDisponiertDialog(operationId, previousStatus)
      if (newStatus === "reko") triggerRekoCheck(operationId, previousStatus)
      if (newStatus === "reko_done") triggerRekoFormCheck(operationId, previousStatus)
      if (newStatus === "returning") triggerReturningVehicleCheck(operationId, previousStatus)
      if (newStatus === "complete") promptMaterialDecision(operationId, previousStatus)
    }
  }, [operations, updateOperation, triggerDisponiertDialog, triggerRekoCheck, triggerRekoFormCheck, triggerReturningVehicleCheck, promptMaterialDecision])

  const moveOperationLeft = useCallback((operationId: string) => {
    const operation = operations.find(op => op.id === operationId)
    if (!operation) return

    const currentColumnIndex = columns.findIndex((col) => col.status.includes(operation.status))
    if (currentColumnIndex > 0) {
      const prevColumn = columns[currentColumnIndex - 1]
      const newStatus = prevColumn.status[0] as OperationStatus
      const previousStatus = operation.status
      updateOperation(operationId, { status: newStatus })
      if (newStatus === "enroute") triggerDisponiertDialog(operationId, previousStatus)
    }
  }, [operations, updateOperation, triggerDisponiertDialog])

  // Quick-assign (number keys / command palette) toggle of a vehicle onto an
  // incident. For a GROUPED incident the route owns resources, so route the
  // assign/unassign to the Auftrag — otherwise a per-incident row would be
  // created that never renders on a grouped card (a hidden assignment).
  const toggleVehicleAssignment = useCallback(
    (op: Operation, vehicle: { id: string; name: string }) => {
      if (op.groupId) {
        const existing = getGroupResources(op.groupId).vehicles.find((v) => v.resourceId === vehicle.id)
        if (existing) unassignGroupResource(op.groupId, existing.assignmentId)
        else assignGroupResource(op.groupId, "vehicle", vehicle.id)
        return
      }
      if (op.vehicles.includes(vehicle.name)) removeVehicle(op.id, vehicle.name)
      else assignVehicleToOperation(vehicle.id, vehicle.name, op.id)
    },
    [getGroupResources, unassignGroupResource, assignGroupResource, removeVehicle, assignVehicleToOperation],
  )

  const assignVehicleToGroupWithConflict = useCallback((groupId: string, vehicleId: string) => {
    const vehicle = vehicleTypes.find((item) => item.id === vehicleId)
    if (!vehicle) return
    const groupConflicts = groups
      .filter((group) => group.id !== groupId && group.assignments.some((a) => a.resourceType === "vehicle" && a.resourceId === vehicleId))
    const incidentConflicts = operations.filter((op) => op.vehicles.includes(vehicle.name))
    if (groupConflicts.length === 0 && incidentConflicts.length === 0) {
      void assignGroupResource(groupId, "vehicle", vehicleId)
      return
    }
    requestVehicleConflict({
      vehicleId,
      vehicleName: vehicle.name,
      targetOperationId: groupId,
      conflicts: [
        ...groupConflicts.map((group) => ({ operationId: group.id, operationLabel: group.name })),
        ...incidentConflicts.map((op) => ({ operationId: op.id, operationLabel: getIncidentRefLabel(op) })),
      ],
      customResolve: async (action) => {
        if (action === "move") {
          const groupResults = await Promise.all(groupConflicts.map((group) => {
            const assignment = group.assignments.find((a) => a.resourceType === "vehicle" && a.resourceId === vehicleId)
            return assignment ? unassignGroupResource(group.id, assignment.id) : true
          }))
          const incidentResults = await Promise.all(incidentConflicts.map((op) => removeVehicle(op.id, vehicle.name)))
          if ([...groupResults, ...incidentResults].some((ok) => !ok)) return
        }
        await assignGroupResource(groupId, "vehicle", vehicleId)
      },
    })
  }, [vehicleTypes, groups, operations, requestVehicleConflict, assignGroupResource, unassignGroupResource, removeVehicle])

  const assignVehicleToIncidentWithConflict = useCallback((vehicleId: string, vehicleName: string, operationId: string) => {
    const groupConflicts = groups.filter((group) =>
      group.assignments.some((a) => a.resourceType === "vehicle" && a.resourceId === vehicleId),
    )
    if (groupConflicts.length === 0) {
      assignVehicleToOperation(vehicleId, vehicleName, operationId)
      return
    }
    requestVehicleConflict({
      vehicleId,
      vehicleName,
      targetOperationId: operationId,
      conflicts: groupConflicts.map((group) => ({ operationId: group.id, operationLabel: group.name })),
      customResolve: async (action) => {
        if (action === "move") {
          const results = await Promise.all(groupConflicts.map((group) => {
            const assignment = group.assignments.find((a) => a.resourceType === "vehicle" && a.resourceId === vehicleId)
            return assignment ? unassignGroupResource(group.id, assignment.id) : true
          }))
          if (results.some((ok) => !ok)) return
        }
        assignVehicleToOperation(vehicleId, vehicleName, operationId)
      },
    })
  }, [groups, requestVehicleConflict, unassignGroupResource, assignVehicleToOperation])

  // Register command palette handlers
  useEffect(() => {
    registerHandlers({
      onNewOperation: () => setNewEmergencyModalOpen(true),
      onRefresh: () => {
        refreshOperations()
      },
      onToggleLeftSidebar: () => setShowLeftSidebar(prev => !prev),
      onToggleRightSidebar: () => setShowRightSidebar(prev => !prev),
      onToggleVehicleStatus: () => setActiveFooterSheet(prev => prev === 'vehicles' ? null : 'vehicles'),
      onToggleAuftraege: () => setActiveFooterSheet(prev => {
        if (prev === 'auftraege') return null
        setAuftraegeFocusGroupId(null)
        return 'auftraege'
      }),
      onOpenAuftrag: (groupId: string) => {
        setAuftraegeFocusGroupId(groupId)
        setActiveFooterSheet('auftraege')
      },
      onToggleNotifications: toggleNotificationSidebar,
      onToggleSidePanel: () =>
        setSidePanelMode(prev => (prev === 'collapsed' ? 'detail' : 'collapsed')),
      onSidePanelDetail: () => setSidePanelMode('detail'),
      onSidePanelMap: () => setSidePanelMode('map'),
      onToggleZuFuss: () => {
        if (hoveredOperationId) {
          const op = operations.find(o => o.id === hoveredOperationId)
          if (op) updateOperation(hoveredOperationId, { zuFuss: !op.zuFuss })
        }
      },
      onSearchPersonnel: () => {
        setShowLeftSidebar(true)
        setTimeout(() => document.getElementById('personnel-search-input')?.focus(), 50)
      },
      onSearchMaterial: () => {
        setShowRightSidebar(true)
        setTimeout(() => document.getElementById('material-search-input')?.focus(), 50)
      },
      hasSelectedIncident: !!hoveredOperationId,
      onEditIncident: () => {
        if (hoveredOperationId) {
          const operation = operations.find(op => op.id === hoveredOperationId)
          if (operation) {
            openIncidentDetail(operation.id)
          }
        }
      },
      onDeleteIncident: () => {
        if (hoveredOperationId) {
          const operation = operations.find(op => op.id === hoveredOperationId)
          if (operation) {
            setOperationToDelete(operation)
            setDeleteDialogOpen(true)
          }
        }
      },
      onMoveStatusForward: () => {
        if (hoveredOperationId) {
          moveOperationRight(hoveredOperationId)
        }
      },
      onMoveStatusBackward: () => {
        if (hoveredOperationId) {
          moveOperationLeft(hoveredOperationId)
        }
      },
      onSetPriority: (priority) => {
        if (hoveredOperationId) {
          updateOperation(hoveredOperationId, { priority })
        }
      },
      onAssignVehicle: (vehicleNumber) => {
        if (hoveredOperationId) {
          const vehicleType = vehicleTypes[vehicleNumber - 1]
          if (vehicleType) {
            const operation = operations.find(op => op.id === hoveredOperationId)
            if (operation) toggleVehicleAssignment(operation, vehicleType)
          }
        }
      },
    })
    return () => clearHandlers()
  }, [
    registerHandlers,
    clearHandlers,
    refreshOperations,
    toggleNotificationSidebar,
    hoveredOperationId,
    operations,
    vehicleTypes,
    moveOperationRight,
    moveOperationLeft,
    updateOperation,
    toggleVehicleAssignment,
    openIncidentDetail,
  ])

  // Hide sidebars on mobile by default
  useEffect(() => {
    if (isMobile) {
      setShowLeftSidebar(false)
      setShowRightSidebar(false)
    }
  }, [isMobile])

  // Show empty state if no event is selected (removed automatic redirect)
  // useEffect(() => {
  //   if (isMounted && isEventLoaded && !selectedEvent) {
  //     router.push('/events')
  //   }
  // }, [isMounted, isEventLoaded, selectedEvent, router])

  // Checklist popover state and live readiness progress (persistent reference)
  const [checklistPopoverOpen, setChecklistPopoverOpen] = useState(false)
  const [checklistProgress, setChecklistProgress] = useState({ completed: 0, total: 0 })
  const autoOpenedEventRef = useRef<string | null>(null)

  // The setup checklist is an operational aid for real callouts (printer, real
  // check-in workflow, offline maps). It's noise in the public demo, so hide it
  // there entirely. Fetched once — demo mode never changes mid-session.
  const [isDemo, setIsDemo] = useState(false)
  useEffect(() => {
    apiClient.getDemoStatus().then((s) => setIsDemo(!!s?.demo)).catch(() => {})
  }, [])

  // Poll readiness progress so the persistent "Bereitschaft" badge stays live
  // even while the popover is closed. Rare users forget the steps, not the app —
  // keeping "what still needs doing" visible at a glance, every callout.
  useEffect(() => {
    if (!selectedEvent || !isMounted) return
    // Disabled in the demo — keep progress empty so the badge/popover never show.
    if (isDemo) {
      setChecklistProgress({ completed: 0, total: 0 })
      return
    }
    let cancelled = false
    const load = async () => {
      try {
        const summary = await summarizeEventChecklist(selectedEvent.id)
        if (!cancelled) setChecklistProgress(summary)
      } catch {
        // ignore — badge keeps its last-known value
      }
    }
    load()
    const interval = setInterval(load, 5000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [selectedEvent, isMounted, isDemo])

  // Auto-open the checklist once per event whenever setup is still incomplete
  // (regardless of event age), then hand off to the persistent button so it
  // never re-nags after the user has dismissed it.
  useEffect(() => {
    if (!selectedEvent || !isMounted) return
    if (checklistProgress.total === 0) return
    if (checklistProgress.completed >= checklistProgress.total) return
    if (autoOpenedEventRef.current === selectedEvent.id) return
    autoOpenedEventRef.current = selectedEvent.id
    setChecklistPopoverOpen(true)
  }, [selectedEvent, isMounted, checklistProgress])

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
          type: vehicle.type
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


  // Scroll to and highlight operation when navigating with ?highlight= param
  useEffect(() => {
    if (highlightParam) {
      scrollToCard(highlightParam)
      // Clear the URL param to prevent re-scroll on refresh
      router.replace('/', { scroll: false })
    }
  }, [highlightParam, scrollToCard, router])

  useKanbanShortcuts(
    {
      modalOpen:
        detailModalOpen ||
        newEmergencyModalOpen ||
        assignmentDialogOpen ||
        // Vehicle + Aufträge footers are non-modal on desktop: keep their toggle
        // keys (F / A) able to close them again.
        (!!activeFooterSheet && activeFooterSheet !== 'vehicles' && activeFooterSheet !== 'auftraege') ||
        deleteDialogOpen,
      sidePanelOpen: sidePanelMode !== 'collapsed',
      hoveredOperationId,
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
      onUpdateOperation: updateOperation,
      onMoveRight: moveOperationRight,
      onMoveLeft: moveOperationLeft,
      onToggleZuFuss: (opId) => {
        const op = operations.find((o) => o.id === opId)
        if (op) updateOperation(opId, { zuFuss: !op.zuFuss })
      },
      onRefresh: refreshOperations,
      onOpenDetail: (op) => {
        openIncidentDetail(op.id)
      },
      onRequestDelete: (op) => {
        setOperationToDelete(op)
        setDeleteDialogOpen(true)
      },
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
      onSidePanelMap: () => setSidePanelMode('map'),
      onToggleNotifications: toggleNotificationSidebar,
    },
  )

  // The highlight timer is cleaned up by its own scrollToCard effect; nothing else to do here.
  useEffect(() => {
    return () => {
      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current)
      }
    }
  }, [])

  // Use shared drag-and-drop hook
  useKanbanDragDrop({
    isMounted,
    canEdit: isEditor,
    operations,
    setOperations,
    updateOperation,
    reorderColumn,
    assignPersonToOperation,
    assignRekoPersonToOperation,
    assignMaterialToOperation,
    assignVehicleToOperation: assignVehicleToIncidentWithConflict,
    setDraggingItem,
    onOperationDrop: (operationId) => {
      // Auto-select dropped card in side panel
      setSelectedOperationId(operationId)
      setHoveredOperationId(operationId)
    },
    onStatusChange: (operationId, newStatus, previousStatus) => {
      if (newStatus === "enroute") triggerDisponiertDialog(operationId, previousStatus)
      if (newStatus === "reko") triggerRekoCheck(operationId, previousStatus)
      if (newStatus === "reko_done") triggerRekoFormCheck(operationId, previousStatus)
      if (newStatus === "returning") triggerReturningVehicleCheck(operationId, previousStatus)
      // Drag-to-ABGESCHLOSSEN already ran updateOperation(complete) inside the hook
      // (which keeps materials). Just prompt the material decision here.
      if (newStatus === "complete") promptMaterialDecision(operationId, previousStatus)
    },
    // Aufträge (route) drop targets — see auftraege-sheet.tsx for the registered
    // drop-target data contract (`group-row` / `group-stop`).
    groups,
    // Dragging a card onto an Auftrag goes through the same closed-incident
    // confirmation as the stop picker — the drop is just another way to attach.
    addStopsToGroup: (groupId, incidentIds) => {
      closedStopGuard.guard(incidentIds, () => { void addStopsToGroup(groupId, incidentIds) })
    },
    assignGroupResource: (groupId, resourceType, resourceId) => {
      if (resourceType === "vehicle") assignVehicleToGroupWithConflict(groupId, resourceId)
      else void assignGroupResource(groupId, resourceType, resourceId)
    },
    occupiedGroupResourceIds: occupiedResourceIds,
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
  const { groupedPersonnel, groupedMaterials } = useResourceFiltering(
    personnel,
    materials,
    effectivePersonnelQuery,
    effectiveMaterialQuery,
    tRes('roleOther'),
    { personnel: personnelAvailableOnly, materials: materialsAvailableOnly },
  )

  // Memoize filtered operations to avoid unnecessary recalculations on every render
  const filteredOperations = useMemo(() => {
    if (!searchQuery.trim()) {
      return operations
    }

    const query = searchQuery.toLowerCase()

    return operations.filter((op) => {
      // Search through all relevant fields
      return (
        // Location
        op.location.toLowerCase().includes(query) ||
        // Incident type
        op.incidentType.toLowerCase().includes(query) ||
        getIncidentTypeLabel(op.incidentType).toLowerCase().includes(query) ||
        // Priority
        op.priority.toLowerCase().includes(query) ||
        // Vehicles (legacy field and array)
        (op.vehicle && op.vehicle.toLowerCase().includes(query)) ||
        op.vehicles.some(v => v.toLowerCase().includes(query)) ||
        // Crew members
        op.crew.some(crew => crew.toLowerCase().includes(query)) ||
        // Materials
        op.materials.some(materialId => {
          const material = materials.find(m => m.id === materialId)
          return material && material.name.toLowerCase().includes(query)
        }) ||
        // Notes
        op.notes.toLowerCase().includes(query) ||
        // Contact
        op.contact.toLowerCase().includes(query) ||
        // Status
        op.status.toLowerCase().includes(query) ||
        // Reko personnel
        (op.assignedReko && op.assignedReko.name.toLowerCase().includes(query)) ||
        // Reko status
        (op.hasCompletedReko && 'reko'.includes(query))
      )
    })
  }, [operations, searchQuery, materials])

  const handlePersonClick = async (person: Person) => {
    if (person.status === "assigned") {
      // First try to find operation where person is directly assigned to crew
      let assignedOp = operations.find(op => op.crew.includes(person.name))

      // If not found directly assigned, check if they're a driver for a vehicle
      if (!assignedOp && selectedEvent) {
        try {
          const specialFunctions = await apiClient.getPersonnelSpecialFunctions(selectedEvent.id, person.id)
          const driverFunction = specialFunctions.find(f => f.function_type === 'driver')

          if (driverFunction && driverFunction.vehicle_name) {
            // Find operation that has this vehicle assigned
            assignedOp = operations.find(op => op.vehicles.includes(driverFunction.vehicle_name!))
          }
        } catch (error) {
          console.error('Failed to load special functions for personnel:', error)
        }
      }

      if (assignedOp) {
        scrollToCard(assignedOp.id)
      }
    }
  }

  const handleMaterialClick = (material: Material) => {
    if (material.status === "assigned") {
      // Find the operation this material is assigned to
      const assignedOp = operations.find(op => op.materials.includes(material.id))
      if (assignedOp) {
        scrollToCard(assignedOp.id)
      }
    }
  }

  // Use shared operation handlers hook
  const { handleOperationUpdate, handleVehicleRemove, handleVehicleAssign, handleOperationDelete } = useOperationHandlers({
    selectedOperation,
    updateOperation,
    removeVehicle,
    assignVehicleToOperation,
    deleteOperation,
  })

  const handleCardClick = (operation: Operation) => {
    // Don't open modal if we just finished dragging
    if (isDraggingOperationRef.current) {
      return
    }
    openIncidentDetail(operation.id)
    broadcast("incident:selected", operation.id)
  }

  const handleCardSelect = (operation: Operation) => {
    openIncidentDetail(operation.id)
  }

  // Derived state for convenience
  const qrDialogOpen = activeFooterSheet === 'checkin'
  const rekoQrDialogOpen = activeFooterSheet === 'reko'
  const displaySheetOpen = activeFooterSheet === 'display'
  // One share token, three targets — the sheet toggles which view the QR/URL point at.
  const displayUrl = displayToken
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/display/${displayView}?token=${displayToken}`
    : null
  const alarmQrDialogOpen = activeFooterSheet === 'alarm'
  const vehicleStatusSheetOpen = activeFooterSheet === 'vehicles'
  const printModalOpen = activeFooterSheet === 'print'
  const thermoSheetOpen = activeFooterSheet === 'thermo'
  const auftraegeSheetOpen = activeFooterSheet === 'auftraege'

  const generateCheckInQR = async () => {
    // Toggle behavior: if already open, just close
    if (qrDialogOpen) {
      setActiveFooterSheet(null)
      return
    }

    if (!selectedEvent) {
      toast.error(tCommon('error'), {
        description: tDash('selectEventFirst'),
      })
      return
    }

    try {
      const response = await apiClient.generateCheckInLink(selectedEvent.id)
      // Build full URL for QR code
      const fullUrl = `${window.location.origin}${response.link}`
      setCheckInUrl(fullUrl)
      setActiveFooterSheet('checkin')
    } catch (error) {
      console.error('Failed to generate check-in link:', error)
      toast.error(tCommon('error'), {
        description: tDash('qrGenerateFailed'),
      })
    }
  }

  const copyCheckInUrlToClipboard = async () => {
    if (!checkInUrl) return

    try {
      const { copyToClipboard } = await import('@/lib/utils')
      await copyToClipboard(checkInUrl)
      setCopied(true)
      toast.success(tCommon('linkCopied'))
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error(tCommon('copyFailed'))
    }
  }

  const generateRekoDashboardQR = async () => {
    // Toggle behavior: if already open, just close
    if (rekoQrDialogOpen) {
      setActiveFooterSheet(null)
      return
    }

    if (!selectedEvent) {
      toast.error(tCommon('error'), {
        description: tDash('selectEventFirst'),
      })
      return
    }

    try {
      const response = await apiClient.generateRekoDashboardLink(selectedEvent.id)
      // Build full URL for QR code
      const fullUrl = `${window.location.origin}${response.link}`
      setRekoDashboardUrl(fullUrl)
      setActiveFooterSheet('reko')
    } catch (error) {
      console.error('Failed to generate Reko Dashboard link:', error)
      toast.error(tCommon('error'), {
        description: tDash('rekoLinkFailed'),
      })
    }
  }

  const generateDisplayShare = async () => {
    // Toggle behavior: if already open, just close
    if (displaySheetOpen) {
      setActiveFooterSheet(null)
      return
    }

    if (!selectedEvent) {
      toast.error(tCommon('error'), {
        description: tDash('selectEventFirst'),
      })
      return
    }

    try {
      // Reuse the read-only share token; point it at the display board so a
      // recipient sees the shared read-only board without logging in.
      const response = await apiClient.generateViewerLink(selectedEvent.id)
      setDisplayToken(response.token)
      setDisplayView('board')
      setActiveFooterSheet('display')
    } catch (error) {
      console.error('Failed to generate display share link:', error)
      toast.error(tCommon('error'), {
        description: tDash('displayLinkFailed'),
      })
    }
  }

  const generateAlarmQR = async () => {
    // Toggle behavior: if already open, just close
    if (alarmQrDialogOpen) {
      setActiveFooterSheet(null)
      return
    }

    if (!selectedEvent) {
      toast.error(tCommon('error'), {
        description: tDash('selectEventFirst'),
      })
      return
    }

    try {
      const response = await apiClient.generateAlarmLink(selectedEvent.id)
      const fullUrl = `${window.location.origin}${response.link}`
      setAlarmUrl(fullUrl)
      setActiveFooterSheet('alarm')
    } catch (error) {
      console.error('Failed to generate alarm link:', error)
      toast.error(tCommon('error'), {
        description: tDash('alarmLinkFailed'),
      })
    }
  }

  // Handle resource assignment dialog. A grouped incident owns no resources of its
  // own — the Auftrag (route) does — so assigning from its card buttons or the
  // detail modal edits the route instead of the single stop.
  const handleOpenAssignmentDialog = (resourceType: 'crew' | 'vehicles' | 'materials', operationId: string) => {
    const op = operations.find((o) => o.id === operationId)
    // A stop's resources belong to the Auftrag, never to the stop — including
    // when the «es fehlt noch etwas» modal is what sent us here. Resolved via
    // the routes, because a just-added stop has no groupId of its own yet.
    const auftrag = findAuftragForStop(groups, op)
    if (auftrag) {
      handleAssignRouteResource(resourceType, auftrag.id)
      return
    }
    setAssignmentResourceType(resourceType)
    setAssignmentOperationId(operationId)
    setAssignmentDialogOpen(true)
  }

  // "+ Stop" — pick EXISTING event incidents to add to a route as stops. Picking
  // an incident already in another route MOVES it (addStops reassigns group_id).
  const handleConfirmAddStops = (incidentIds: string[]) => {
    if (!stopPickerGroupId || incidentIds.length === 0) return
    const groupId = stopPickerGroupId
    closedStopGuard.guard(incidentIds, async () => {
      const ok = await addStopsToGroup(groupId, incidentIds)
      if (ok) toast.success(tDash('stopsAddedToast', { count: incidentIds.length }))
    })
  }

  // "An Auftrag verteilen" — open the route picker for a single incident.
  const handleDistributeToAuftrag = (operationId: string) => {
    setAuftragPickerIncidentId(operationId)
  }

  const handleChooseAuftrag = (groupId: string) => {
    if (!auftragPickerIncidentId) return
    const incidentId = auftragPickerIncidentId
    closedStopGuard.guard([incidentId], async () => {
      const ok = await addStopsToGroup(groupId, [incidentId])
      if (ok) {
        const group = groups.find((g) => g.id === groupId)
        toast.success(tDash('distributedToast', { name: group?.name ?? '' }))
      }
    })
  }

  // "Aus Auftrag entfernen" — detach the incident from its current route (it
  // stays on the board, ungrouped). Only offered when it's already in a route.
  const handleRemoveFromAuftrag = async () => {
    if (!auftragPickerIncidentId) return
    const op = operations.find((o) => o.id === auftragPickerIncidentId)
    if (!op?.groupId) return
    const ok = await removeStopFromGroup(op.groupId, auftragPickerIncidentId)
    if (ok) toast.success(tDash('removedFromAuftragToast'))
  }

  // Route-level resource assign: open the standard assignment dialog scoped to the
  // ROUTE (Auftrag). Assign/remove hit the group directly, so it works even with
  // zero stops — the route owns the resources, not any single incident.
  const handleAssignRouteResource = (resourceType: 'crew' | 'vehicles' | 'materials', groupId: string) => {
    setRouteAssign({ groupId, resourceType })
    setAssignmentResourceType(resourceType)
    setAssignmentDialogOpen(true)
  }

  // Handle Reko assignment dialog (from context menu)
  const handleOpenRekoAssignDialog = (operationId: string) => {
    setRekoAssignOperationId(operationId)
    setRekoAssignDialogOpen(true)
  }

  // Handle toggling Nachbarhilfe status (from context menu)
  const handleToggleNachbarhilfe = (operationId: string) => {
    const operation = operations.find(op => op.id === operationId)
    if (operation) {
      updateOperation(operationId, { nachbarhilfe: !operation.nachbarhilfe })
    }
  }

  // Handle toggling Am Warten status (from context menu)
  const handleToggleAmWarten = (operationId: string) => {
    const operation = operations.find(op => op.id === operationId)
    if (operation) {
      updateOperation(operationId, { amWarten: !operation.amWarten })
    }
  }

  // Handle toggling Zu Fuss status (from context menu or badge removal)
  const handleToggleZuFuss = (operationId: string) => {
    const operation = operations.find(op => op.id === operationId)
    if (operation) {
      updateOperation(operationId, { zuFuss: !operation.zuFuss })
    }
  }

  // Get assigned resources for selected operation
  const getAssignedResourcesForOperation = (operationId: string) => {
    const operation = operations.find(op => op.id === operationId)
    if (!operation) {
      return {
        assignedPersonnel: [],
        assignedVehicles: [],
        assignedMaterials: []
      }
    }

    return {
      assignedPersonnel: operation.crew,
      assignedVehicles: operation.vehicles,
      assignedMaterials: operation.materials
    }
  }

  const assignedResources = assignmentOperationId
    ? getAssignedResourcesForOperation(assignmentOperationId)
    : { assignedPersonnel: [], assignedVehicles: [], assignedMaterials: [] }

  // When the assignment dialog is scoped to a ROUTE, its assigned lists +
  // assign/remove callbacks target the Auftrag's resources instead of a stop.
  const routeGroupResources = routeAssign ? getGroupResources(routeAssign.groupId) : null
  const routeOwnIds = routeAssign
    ? new Set(groups.find((group) => group.id === routeAssign.groupId)?.assignments.map((a) => `${a.resourceType}:${a.resourceId}`) ?? [])
    : new Set<string>()
  const occupiedPersonnelIds = new Set([...occupiedResourceIds.personnel].filter((id) => !routeOwnIds.has(`personnel:${id}`)))
  const occupiedVehicleIds = new Set([...occupiedResourceIds.vehicle].filter((id) => !routeOwnIds.has(`vehicle:${id}`)))
  const occupiedMaterialIds = new Set([...occupiedResourceIds.material].filter((id) => !routeOwnIds.has(`material:${id}`)))

  // Handle operation deletion from keyboard shortcut
  const handleDeleteOperationConfirm = async () => {
    if (!operationToDelete) return
    try {
      await deleteOperation(operationToDelete.id)
    } catch (error) {
      console.error('Failed to delete operation:', error)
      toast.error(tCommon('deleteFailed'))
    } finally {
      setOperationToDelete(null)
    }
  }

  // Don't render drag and drop until client-side to avoid hydration errors
  if (!isMounted) {
    return (
      <div className="flex h-full items-center justify-center bg-background text-foreground">
        <div className="text-muted-foreground">{tDash('loading')}</div>
      </div>
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
        {/* Top header is desktop-only — on mobile everything routes through the
            bottom navbar (event switching lives in its "Mehr" sheet). */}
        <header className="hidden md:flex items-center justify-between border-b border-border bg-card/50 backdrop-blur-sm px-4 md:px-6 py-2 min-h-14">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            {/* Event title doubles as an event switcher: switch events or create a
                new one without first hunting through the user menu → Ereignisse. */}
            <DropdownMenu>
              <DropdownMenuTrigger className="flex items-center gap-2 min-w-0 -ml-2 rounded-lg px-2 py-1 hover:bg-secondary/60 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/50">
                <h1 className={`text-xl md:text-2xl font-bold tracking-tight truncate ${selectedEvent ? "" : "text-muted-foreground"}`}>
                  {selectedEvent ? selectedEvent.name : tDash('noEventSelected')}
                </h1>
                {selectedEvent?.training_flag && (
                  <Badge variant="secondary" className="hidden sm:inline-flex flex-shrink-0">{tDash('training')}</Badge>
                )}
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
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="search-input"
                  type="text"
                  placeholder={tCommon('search')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-72 pl-9"
                />
                <div className="absolute right-3 top-0 bottom-0 flex items-center pointer-events-none">
                  <Kbd>S</Kbd>
                </div>
              </div>

              <div className="flex items-center gap-2 rounded-lg bg-secondary/50 px-3 py-1.5">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span className="font-mono text-base font-semibold tabular-nums">
                  {isMounted && currentTime ? currentTime.toLocaleTimeString("de-CH") : "--:--:--"}
                </span>
              </div>

              <PageNavigation
                currentPage="kanban"
                hasSelectedEvent={!!selectedEvent}
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
          />
        ) : (
          /* Desktop View */
          <>
        <div className="relative flex flex-1 overflow-hidden">
          {showLeftSidebar && (
            <aside className="relative w-64 border-r border-border bg-card/30 backdrop-blur-sm flex flex-col">
              {/* Collapse handle — small chevron centered on the sidebar's inner edge */}
              <button
                onClick={() => setShowLeftSidebar(false)}
                className="absolute right-0 top-1/2 z-20 flex h-12 w-5 -translate-y-1/2 cursor-pointer translate-x-1/2 items-center justify-center rounded-md border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:bg-secondary/60 hover:text-foreground"
                title={`${tDash('toggleLeftSidebar')} ([)`}
                aria-label={tDash('toggleLeftSidebar')}
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              {/* Search */}
              <div className="flex items-center gap-1.5 px-3 pt-3 pb-2">
                <div className="relative flex-1 min-w-0">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    id="personnel-search-input"
                    placeholder={tDash('personnelSearch')}
                    value={personnelSearchQuery}
                    onChange={(e) => setPersonnelSearchQuery(e.target.value)}
                    className="h-8 pl-8 pr-8 text-sm"
                  />
                  {!isMobile && (
                    <div className="absolute right-2 top-0 bottom-0 flex items-center pointer-events-none">
                      <Kbd className="h-5 text-xs">P</Kbd>
                    </div>
                  )}
                </div>
                <AvailableOnlyToggle
                  active={personnelAvailableOnly}
                  onToggle={() => setPersonnelAvailableOnly((v) => !v)}
                  label={personnelAvailableOnly ? tDash('showAll') : tDash('showAvailableOnly')}
                />
              </div>
              {/* Scrollable content */}
              <div className="flex-1 overflow-y-auto px-4 pt-1 pb-3">
                {!isLoaded ? null : personnel.filter((p) => p.status === "available").length === 0 ? (
                  /* Show QR code when no available personnel */
                  <div className="flex flex-col items-center gap-3 py-4 animate-in fade-in duration-300">
                    <p className="text-sm text-muted-foreground text-center">
                      {tDash('noPersonnelAvailable')}
                    </p>
                    {checkInUrl ? (
                      <div className="flex flex-col items-center gap-2">
                        <div className="rounded-lg border p-2 bg-white">
                          <QRCodeSVG
                            value={checkInUrl}
                            size={120}
                            level="M"
                            includeMargin={false}
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <p className="text-xs text-muted-foreground text-center">
                            {tDash('scanCheckInQr')}
                          </p>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={copyCheckInUrlToClipboard}
                            title={tCommon('copyLink')}
                          >
                            {copied ? (
                              <Check className="size-3.5 text-success" />
                            ) : (
                              <Copy className="size-3.5" />
                            )}
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : personnelAvailableOnly && Object.keys(groupedPersonnel).length === 0 ? (
                  /* Filter hides everything — say so, otherwise the sidebar just
                     looks broken. */
                  <div className="py-6 text-center animate-in fade-in duration-300">
                    <p className="text-sm italic text-muted-foreground/60">{tDash('noneAvailableFiltered')}</p>
                    <Button variant="link" size="xs" onClick={() => setPersonnelAvailableOnly(false)}>
                      {tDash('showAll')}
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-4 animate-in fade-in duration-300">
                    {Object.keys(groupedPersonnel).map((role) => (
                      <div key={role}>
                        <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground tracking-wide">{role}</h3>
                        <div className="space-y-2">
                          {groupedPersonnel[role as PersonRole]?.map((person) => (
                            <DraggablePerson
                              key={person.id}
                              person={person}
                              onClick={() => handlePersonClick(person)}
                              assignmentCount={doubleBookedPersons.counts.get(person.name)}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {/* Fixed availability counter at bottom */}
              <div className="border-t border-border px-4 py-2 bg-card/50 backdrop-blur-sm">
                <p className="text-xs text-muted-foreground text-center">
                  {tCommon('availableCounter', { available: personnel.filter((p) => p.status === "available").length, total: personnel.length })}
                </p>
              </div>
            </aside>
          )}

          {/* Left sidebar reopen tab (shown when collapsed; "[" also toggles) */}
          {!showLeftSidebar && (
            <button
              onClick={() => setShowLeftSidebar(true)}
              className="absolute left-0 top-1/2 z-10 flex h-12 w-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded-r-md border border-l-0 border-border bg-card/90 text-muted-foreground shadow-sm transition-colors hover:bg-secondary/60 hover:text-foreground"
              title={`${tDash('toggleLeftSidebar')} ([)`}
              aria-label={tDash('toggleLeftSidebar')}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          )}

          {/* Main Kanban Board */}
          <main id="kanban-main" className="flex-1 overflow-x-auto p-4 bg-muted/30 dark:bg-background">
            {!isLoaded ? null : (
              <div className="flex h-full gap-3 animate-in fade-in duration-300">
                {columns.map((column) => {
                  const columnOps = filteredOperations.filter((op) => column.status.includes(op.status))
                  return (
                    <DroppableColumn
                      key={column.id}
                      column={column}
                      operations={columnOps}
                      onRemoveCrew={removeCrew}
                      onRemoveMaterial={removeMaterial}
                      onRemoveVehicle={removeVehicle}
                      onToggleDriverStay={toggleDriverStay}
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
                      onTransfer={isEditor ? handleOpenTransfer : undefined}
                      onDistributeToAuftrag={isEditor ? handleDistributeToAuftrag : undefined}
                      showMeldung={showMeldung}
                      printerEnabled={printerEnabled}
                      doubleBookedCrewNames={doubleBookedPersons.names}
                      canDrag={isEditor}
                      onDragActiveChange={setBoardDragging}
                      onSort={isEditor ? handleColumnSort : undefined}
                    />
                  )
                })}
              </div>
            )}
          </main>

          {/* Side Panel for ultrawide monitors */}
          <SidePanel
            mode={sidePanelMode}
            onModeChange={setSidePanelMode}
            selectedOperation={selectedOperation}
            panToNonce={panToNonce}
            operations={filteredOperations}
            materials={materials}
            onSelectOperation={(op) => {
              setSelectedOperationId(op.id)
              setDetailModalOpen(false)
              setPanToNonce((n) => n + 1) // Recenter on every marker/list click too
              setHoveredOperationId(op.id)
            }}
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
            onRemoveVehicle={isEditor ? removeVehicle : undefined}
            onAssignResource={isEditor ? handleOpenAssignmentDialog : undefined}
            onRemoveCrew={isEditor ? removeCrew : undefined}
            onRemoveMaterial={isEditor ? removeMaterial : undefined}
            canEdit={isEditor}
            diveraEnabled={isEditor && diveraEnabled}
            onSendDivera={isEditor ? (op) => setDiveraDialogOp(op) : undefined}
            onChangeStatus={isEditor ? requestStatusChange : undefined}
            onRequestComplete={isEditor ? requestCompletion : undefined}
            onDistributeToAuftrag={isEditor ? handleDistributeToAuftrag : undefined}
          />

          {showRightSidebar && (
            <aside className="relative w-64 border-l border-border bg-card/30 backdrop-blur-sm flex flex-col">
              {/* Collapse handle — small chevron centered on the sidebar's inner edge */}
              <button
                onClick={() => setShowRightSidebar(false)}
                className="absolute left-0 top-1/2 z-20 flex h-12 w-5 -translate-y-1/2 cursor-pointer -translate-x-1/2 items-center justify-center rounded-md border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:bg-secondary/60 hover:text-foreground"
                title={`${tDash('toggleRightSidebar')} (])`}
                aria-label={tDash('toggleRightSidebar')}
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              {/* Search */}
              <div className="flex items-center gap-1.5 px-3 pt-3 pb-2">
                <div className="relative flex-1 min-w-0">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    id="material-search-input"
                    placeholder={tDash('materialSearch')}
                    value={materialSearchQuery}
                    onChange={(e) => setMaterialSearchQuery(e.target.value)}
                    className="h-8 pl-8 pr-8 text-sm"
                  />
                  {!isMobile && (
                    <div className="absolute right-2 top-0 bottom-0 flex items-center pointer-events-none">
                      <Kbd className="h-5 text-xs">M</Kbd>
                    </div>
                  )}
                </div>
                <AvailableOnlyToggle
                  active={materialsAvailableOnly}
                  onToggle={() => setMaterialsAvailableOnly((v) => !v)}
                  label={materialsAvailableOnly ? tDash('showAll') : tDash('showAvailableOnly')}
                />
              </div>
              {/* Scrollable content */}
              <div className="flex-1 overflow-y-auto px-4 pt-1 pb-3">
                {!isLoaded ? null : materialsAvailableOnly && Object.keys(groupedMaterials).length === 0 ? (
                  <div className="py-6 text-center animate-in fade-in duration-300">
                    <p className="text-sm italic text-muted-foreground/60">{tDash('noneAvailableFiltered')}</p>
                    <Button variant="link" size="xs" onClick={() => setMaterialsAvailableOnly(false)}>
                      {tDash('showAll')}
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-4 animate-in fade-in duration-300">
                    {Object.entries(groupedMaterials).map(([category, items]) => {
                      // Separate grouped vs ungrouped materials
                      const ungroupedItems = items.filter(m => !m.groupId)
                      const groupedItems = new Map<string, Material[]>()
                      for (const m of items.filter(m => m.groupId)) {
                        const group = materialGroups.find(g => g.id === m.groupId)
                        if (group) {
                          if (!groupedItems.has(group.id)) groupedItems.set(group.id, [])
                          groupedItems.get(group.id)!.push(m)
                        } else {
                          ungroupedItems.push(m)
                        }
                      }
                      return (
                        <div key={category}>
                          <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground tracking-wide">{category}</h3>
                          <div className="space-y-2">
                            {/* Material groups/blocks */}
                            {Array.from(groupedItems.entries()).map(([groupId, groupMaterials]) => {
                              const group = materialGroups.find(g => g.id === groupId)!
                              const allAvailable = groupMaterials.every(m => m.status === 'available')
                              const someAssigned = groupMaterials.some(m => m.status === 'assigned')
                              const allAssigned = groupMaterials.every(m => m.status === 'assigned')
                              return (
                                <MaterialGroupBlock
                                  key={groupId}
                                  group={group}
                                  materials={groupMaterials}
                                  allAvailable={allAvailable}
                                  someAssigned={someAssigned}
                                  allAssigned={allAssigned}
                                  onMaterialClick={handleMaterialClick}
                                />
                              )
                            })}
                            {/* Ungrouped materials */}
                            {ungroupedItems.map((material) => (
                              <DraggableMaterial
                                key={material.id}
                                material={material}
                                onClick={() => handleMaterialClick(material)}
                              />
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
              {/* Fixed availability counter at bottom */}
              <div className="border-t border-border px-4 py-2 bg-card/50 backdrop-blur-sm">
                <p className="text-xs text-muted-foreground text-center">
                  {tCommon('availableCounter', { available: materials.filter((m) => m.status === "available").length, total: materials.length })}
                </p>
              </div>
            </aside>
          )}

          {/* Right sidebar reopen tab (shown when collapsed; "]" also toggles) */}
          {!showRightSidebar && (
            <button
              onClick={() => setShowRightSidebar(true)}
              className="absolute right-0 top-1/2 z-10 flex h-12 w-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded-l-md border border-r-0 border-border bg-card/90 text-muted-foreground shadow-sm transition-colors hover:bg-secondary/60 hover:text-foreground"
              title={`${tDash('toggleRightSidebar')} (])`}
              aria-label={tDash('toggleRightSidebar')}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Desktop Footer - z-index lowered when modals open so dialog overlay covers it */}
        <footer className={`relative bg-background/95 backdrop-blur-sm px-4 md:px-6 py-2 shadow-[0_-1px_3px_rgba(0,0,0,0.05)] border-t border-border ${detailModalOpen || newEmergencyModalOpen || statusWorkflow.disponiertOperation ? 'z-40' : 'z-[60]'}`}>
          <div className="flex items-center justify-between gap-4">
            {/* Left: Primary action */}
            <div className="flex items-center gap-3">
              <Button size="sm" className="gap-2 shadow-sm" onClick={() => setNewEmergencyModalOpen(true)}>
                <Plus className="size-3.5" />
                {tCommon('newIncident')}
              </Button>

              {/* Event Setup Checklist — shown only while setup is incomplete; disappears once done */}
              {selectedEvent && checklistProgress.total > 0 && checklistProgress.completed < checklistProgress.total && (
                <Popover open={checklistPopoverOpen} onOpenChange={setChecklistPopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button size="sm" variant="outline" className="gap-2">
                      <ClipboardCheck className="size-3.5" />
                      {tDash('readiness')}
                      <Badge variant="secondary" className="h-5 px-1.5 text-xs font-medium tabular-nums">
                        {checklistProgress.completed}/{checklistProgress.total}
                      </Badge>
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    className="w-[600px] p-0"
                    align="start"
                    side="top"
                    sideOffset={10}
                  >
                    <EventSetupChecklist
                      eventId={selectedEvent.id}
                      eventName={selectedEvent.name}
                      onDismiss={() => setChecklistPopoverOpen(false)}
                      onAllTasksComplete={() => setChecklistPopoverOpen(false)}
                    />
                  </PopoverContent>
                </Popover>
              )}
            </div>

            {/* Center: Secondary actions grouped */}
            <div className="flex items-center gap-1">
              {/* QR/Access group */}
              <div className="flex items-center gap-0.5">
                <ToolbarToggle
                  icon={QrCode}
                  label={tDash('checkIn')}
                  active={qrDialogOpen}
                  onActivate={generateCheckInQR}
                />
                <ToolbarToggle
                  icon={Search}
                  label={tCommon('reko')}
                  active={rekoQrDialogOpen}
                  onActivate={generateRekoDashboardQR}
                />
                <ToolbarToggle
                  icon={MonitorDown}
                  label={tDash('display')}
                  active={displaySheetOpen}
                  onActivate={generateDisplayShare}
                />
                <ToolbarToggle
                  icon={Siren}
                  label={tDash('alarm')}
                  active={alarmQrDialogOpen}
                  onActivate={generateAlarmQR}
                />
              </div>

              <div className="h-4 w-px bg-border mx-1" />

              {/* Status/Tools group */}
              <div className="flex items-center gap-0.5">
                <ToolbarToggle
                  icon={Truck}
                  label={tDash('vehicles')}
                  active={vehicleStatusSheetOpen}
                  disabled={!selectedEvent}
                  onActivate={() => {
                    if (!selectedEvent) return
                    setActiveFooterSheet(vehicleStatusSheetOpen ? null : 'vehicles')
                  }}
                />
                <ToolbarToggle
                  icon={Waypoints}
                  label={tDash('auftraege')}
                  active={auftraegeSheetOpen}
                  disabled={!selectedEvent}
                  onActivate={() => {
                    if (!selectedEvent) return
                    if (!auftraegeSheetOpen) setAuftraegeFocusGroupId(null)
                    setActiveFooterSheet(auftraegeSheetOpen ? null : 'auftraege')
                  }}
                />
                <ToolbarToggle
                  icon={Printer}
                  label={tDash('print')}
                  active={printModalOpen}
                  disabled={!selectedEvent}
                  onActivate={() => {
                    if (!selectedEvent) return
                    setActiveFooterSheet(printModalOpen ? null : 'print')
                  }}
                />
                {printerEnabled && (
                  <ToolbarToggle
                    icon={Printer}
                    label={tDash('thermo')}
                    active={thermoSheetOpen}
                    disabled={!selectedEvent}
                    title={tDash('thermoTitle')}
                    onActivate={() => {
                      if (!selectedEvent) return
                      setActiveFooterSheet(thermoSheetOpen ? null : 'thermo')
                    }}
                  />
                )}
              </div>

              {selectedEvent?.training_flag && (
                <>
                  <div className="h-4 w-px bg-border mx-1" />
                  <Link href="/training">
                    <Button size="xs" variant="ghost" className="text-warning-foreground hover:text-warning-foreground hover:bg-warning/10">
                      <Sparkles className="size-3.5" />
                      <span className="font-medium">{tDash('trainingControl')}</span>
                    </Button>
                  </Link>
                </>
              )}

              <div className="h-4 w-px bg-border mx-1" />

              {/* Toggle styled as a compact pill */}
              <button
                onClick={() => setShowMeldung(!showMeldung)}
                className={`flex items-center gap-1.5 h-7 px-2.5 rounded-full text-xs transition-colors ${
                  showMeldung
                    ? 'bg-primary/10 text-primary border border-primary/20'
                    : 'bg-muted/50 text-muted-foreground hover:bg-muted'
                }`}
              >
                <div className={`h-1.5 w-1.5 rounded-full ${showMeldung ? 'bg-primary' : 'bg-muted-foreground/50'}`} />
                {tCommon('meldung')}
              </button>
            </div>

            {/* Right: Help hint */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))}
                className="flex items-center gap-1.5 text-xs text-muted-foreground/70 hover:text-muted-foreground transition-colors"
              >
                <Kbd className="h-5 text-2xs px-1.5">{cmdHint}</Kbd>
                <span className="hidden lg:inline">{tDash('commands')}</span>
              </button>
            </div>
          </div>
        </footer>
          </>
        )}
      </div>

      {/* Drag Preview Overlay */}
      {draggingItem && (
        <div
          style={{
            position: 'fixed',
            pointerEvents: 'none',
            zIndex: 9999,
            left: 0,
            top: 0,
          }}
        >
          {"role" in draggingItem ? (
            <Card className="cursor-move border border-primary bg-card p-3 shadow-2xl opacity-80">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-emerald-500" />
                <span className="font-medium text-sm text-foreground">{draggingItem.name}</span>
              </div>
            </Card>
          ) : "category" in draggingItem ? (
            <Card className="cursor-move border border-primary bg-card p-3 shadow-2xl opacity-80">
              <div className="flex items-center gap-2">
                <Package className="h-4 w-4 text-primary" />
                <span className="font-medium text-sm text-foreground">{draggingItem.name}</span>
              </div>
            </Card>
          ) : (
            <Card className="cursor-move border-2 border-primary p-4 shadow-2xl bg-card/90 backdrop-blur opacity-80">
              <div className="flex items-center gap-2">
                <span className="font-bold text-foreground">{draggingItem.location}</span>
              </div>
            </Card>
          )}
        </div>
      )}

      <OperationDetailModal
        operation={selectedOperation}
        open={detailModalOpen}
        onOpenChange={setDetailModalOpen}
        onUpdate={handleOperationUpdate}
        onDelete={isEditor ? handleOperationDelete : undefined}
        materials={materials}
        onAssignVehicle={isEditor ? handleVehicleAssign : undefined}
        onRemoveVehicle={isEditor ? handleVehicleRemove : undefined}
        onAssignResource={isEditor ? handleOpenAssignmentDialog : undefined}
        onRemoveCrew={isEditor ? removeCrew : undefined}
        onRemoveMaterial={isEditor ? removeMaterial : undefined}
        canEdit={isEditor}
        diveraEnabled={isEditor && diveraEnabled}
        onSendDivera={isEditor ? (op) => setDiveraDialogOp(op) : undefined}
        onChangeStatus={isEditor ? requestStatusChange : undefined}
        onRequestComplete={isEditor ? requestCompletion : undefined}
        onDistributeToAuftrag={isEditor ? handleDistributeToAuftrag : undefined}
      />

      <NewEmergencyModal
        open={newEmergencyModalOpen}
        onOpenChange={(open) => {
          setNewEmergencyModalOpen(open)
          if (!open) setNewEmergencyGroupId(null)
        }}
        onCreateOperation={createOperation}
        defaultGroupId={newEmergencyGroupId}
      />

      {/* Resource Assignment Dialog */}
      <ResourceAssignmentDialog
        open={assignmentDialogOpen}
        onOpenChange={(open) => {
          setAssignmentDialogOpen(open)
          if (!open) {
            // Route-scoped assign is over — drop back to per-incident mode.
            setRouteAssign(null)
            statusWorkflow.resumeGateAfterAssignment()
          }
        }}
        resourceType={assignmentResourceType}
        operationId={routeAssign ? routeAssign.groupId : assignmentOperationId}
        assignTarget={routeAssign ? 'route' : 'incident'}
        routeName={routeAssign ? groups.find((g) => g.id === routeAssign.groupId)?.name : undefined}
        personnel={personnel}
        vehicles={vehicleTypes}
        materials={materials}
        assignedPersonnel={routeGroupResources ? routeGroupResources.personnel.map(p => p.name) : assignedResources.assignedPersonnel}
        assignedVehicles={routeGroupResources ? routeGroupResources.vehicles.map(v => v.name) : assignedResources.assignedVehicles}
        assignedMaterials={routeGroupResources ? routeGroupResources.materials.map(m => m.resourceId) : assignedResources.assignedMaterials}
        rekoPersonnelNames={routeAssign ? [] : rekoPersonnelNames}
        onAssignPerson={routeAssign
          ? (personId) => assignGroupResource(routeAssign.groupId, 'personnel', personId)
          : assignPersonToOperation}
        onAssignVehicle={routeAssign
          ? (vehicleId) => assignVehicleToGroupWithConflict(routeAssign.groupId, vehicleId)
          : assignVehicleToIncidentWithConflict}
        onAssignMaterial={routeAssign
          ? (materialId) => assignGroupResource(routeAssign.groupId, 'material', materialId)
          : assignMaterialToOperation}
        onRemovePerson={routeAssign
          ? (_op, personName) => {
              const item = routeGroupResources?.personnel.find(p => p.name === personName)
              if (item) unassignGroupResource(routeAssign.groupId, item.assignmentId)
            }
          : removeCrew}
        onRemoveVehicle={routeAssign
          ? (_op, vehicleName) => {
              const item = routeGroupResources?.vehicles.find(v => v.name === vehicleName)
              if (item) unassignGroupResource(routeAssign.groupId, item.assignmentId)
            }
          : removeVehicle}
        onRemoveMaterial={routeAssign
          ? (_op, materialId) => {
              const item = routeGroupResources?.materials.find(m => m.resourceId === materialId)
              if (item) unassignGroupResource(routeAssign.groupId, item.assignmentId)
            }
          : removeMaterial}
        zuFuss={!routeAssign && assignmentOperationId ? operations.find(op => op.id === assignmentOperationId)?.zuFuss ?? false : false}
        onToggleZuFuss={!routeAssign && assignmentOperationId ? () => handleToggleZuFuss(assignmentOperationId) : undefined}
        occupiedPersonnelIds={occupiedPersonnelIds}
        occupiedVehicleIds={occupiedVehicleIds}
        occupiedMaterialIds={occupiedMaterialIds}
        // Incident-scoped only: the flag lives on the incident's assignment, and
        // a route assignment has no endpoint to patch it through (see the Auftrag
        // case in RouteResourceSections, which has no toggle either).
        vehicleDriverStay={!routeAssign && assignmentOperationId
          ? operations.find(op => op.id === assignmentOperationId)?.vehicleDriverStay
          : undefined}
        onToggleDriverStay={!routeAssign && assignmentOperationId
          ? (vehicleName) => toggleDriverStay(assignmentOperationId, vehicleName)
          : undefined}
      />


      {/* Check-In QR Code Sheet */}
      <QrShareSheet
        open={qrDialogOpen}
        onOpenChange={(open) => !open && activeFooterSheet === 'checkin' && setActiveFooterSheet(null)}
        url={checkInUrl}
        title={tDash('checkInSheetTitle')}
        description={tDash('checkInSheetDescription')}
        hint={tDash('checkInSheetHint')}
        printerEnabled={printerEnabled}
        isPrinting={isPrintingQR}
        onPrint={checkInUrl ? () => handlePrintQR(checkInUrl, tDash('checkInSheetTitle'), tDash('checkInSheetHint')) : undefined}
      />

      {/* Reko Dashboard QR Code Sheet */}
      <QrShareSheet
        open={rekoQrDialogOpen}
        onOpenChange={(open) => !open && activeFooterSheet === 'reko' && setActiveFooterSheet(null)}
        url={rekoDashboardUrl}
        title={tDash('rekoSheetTitle')}
        description={tDash('rekoSheetDescription')}
        hint={tDash('rekoSheetHint')}
        printerEnabled={printerEnabled}
        isPrinting={isPrintingQR}
        onPrint={rekoDashboardUrl ? () => handlePrintQR(rekoDashboardUrl, tDash('rekoSheetTitle'), tDash('rekoSheetHint')) : undefined}
      />

      {/* Display share QR Code Sheet */}
      <QrShareSheet
        open={displaySheetOpen}
        onOpenChange={(open) => !open && activeFooterSheet === 'display' && setActiveFooterSheet(null)}
        url={displayUrl}
        title={tDash('displaySheetTitle')}
        description={tDash('displaySheetDescription')}
        hint={tDash('displaySheetHint')}
        printerEnabled={printerEnabled}
        isPrinting={isPrintingQR}
        onPrint={displayUrl ? () => handlePrintQR(displayUrl, tDash('displaySheetTitle'), tDash('displaySheetHint')) : undefined}
      >
        {/* View selector — one token, three display targets */}
        <div className="flex gap-1.5 mb-3">
          {(['board', 'map', 'status'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setDisplayView(v)}
              className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors ${
                displayView === v
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background text-muted-foreground border-border hover:bg-muted'
              }`}
            >
              {tDash(`displayView.${v}`)}
            </button>
          ))}
        </div>
      </QrShareSheet>

      {/* Alarm Intake Link Sheet */}
      <QrShareSheet
        open={alarmQrDialogOpen}
        onOpenChange={(open) => !open && activeFooterSheet === 'alarm' && setActiveFooterSheet(null)}
        url={alarmUrl}
        title={tDash('alarmSheetTitle')}
        description={tDash('alarmSheetDescription')}
        hint={tDash('alarmSheetHint')}
        printerEnabled={printerEnabled}
        isPrinting={isPrintingQR}
        onPrint={alarmUrl ? () => handlePrintQR(alarmUrl, tDash('alarmSheetTitle'), tDash('alarmSheetHint')) : undefined}
      />

      {/* Vehicle Status Sheet */}
      <VehicleStatusSheet
        open={vehicleStatusSheetOpen}
        onOpenChange={(open) => !open && activeFooterSheet === 'vehicles' && setActiveFooterSheet(null)}
        eventId={selectedEvent?.id || null}
      />

      {/* Aufträge (multi-stop route) Sheet */}
      <AuftraegeSheet
        open={auftraegeSheetOpen}
        onOpenChange={(open) => !open && activeFooterSheet === 'auftraege' && setActiveFooterSheet(null)}
        focusGroupId={auftraegeFocusGroupId}
        onAddStop={(groupId) => setStopPickerGroupId(groupId)}
        onAssignRouteResource={handleAssignRouteResource}
        onOpenDetail={handleOpenIncidentFromNotification}
        onOpenRoutenEditor={(groupId, focusIncidentId) => {
          setRoutenEditorGroupId(groupId)
          setRoutenEditorFocusIncidentId(focusIncidentId ?? null)
        }}
        canEdit={isEditor}
        onSetStopStatus={isEditor ? setRouteStopStatus : undefined}
        funkrufname={funkrufname}
      />

      {/* Routen-Editor (map-first multi-stop route editing for one Auftrag) */}
      <RoutenEditorModal
        open={routenEditorGroupId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRoutenEditorGroupId(null)
            setRoutenEditorFocusIncidentId(null)
          }
        }}
        groupId={routenEditorGroupId}
        focusIncidentId={routenEditorFocusIncidentId}
        canEdit={isEditor}
        onSetStopStatus={isEditor ? setRouteStopStatus : undefined}
      />

      {/* "+ Stop" — pick existing incidents to add as stops to a route */}
      {isEditor && <IncidentPickerDialog
        open={stopPickerGroupId !== null}
        onOpenChange={(open) => !open && setStopPickerGroupId(null)}
        operations={operations}
        groups={groups}
        targetGroupId={stopPickerGroupId}
        onConfirm={handleConfirmAddStops}
        onCreateNew={() => {
          setNewEmergencyGroupId(stopPickerGroupId)
          setNewEmergencyModalOpen(true)
        }}
      />}

      {/* "An Auftrag verteilen" — distribute one incident into a route */}
      <AuftragPickerDialog
        open={auftragPickerIncidentId !== null}
        onOpenChange={(open) => !open && setAuftragPickerIncidentId(null)}
        groups={groups}
        currentGroupId={
          auftragPickerIncidentId
            ? operations.find((op) => op.id === auftragPickerIncidentId)?.groupId ?? null
            : null
        }
        onChoose={handleChooseAuftrag}
        onCreate={(name) => createGroup({ name })}
        onRemoveFromCurrent={handleRemoveFromAuftrag}
      />

      {/* «Dieser Einsatz ist abgeschlossen. Trotzdem als Stop hinzufügen?» */}
      <ClosedStopDialog
        prompt={closedStopGuard.prompt}
        onProceed={closedStopGuard.proceed}
        onCancel={closedStopGuard.dismiss}
      />

      {/* Delete Operation Confirmation Dialog */}
      <DeleteConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title={tCommon('deleteIncidentTitle')}
        description={tCommon('deleteIncidentDescription', { name: operationToDelete ? (formatLocation(operationToDelete.location ?? '') || getIncidentTypeLabel(operationToDelete.incidentType)) : '' })}
        onConfirm={handleDeleteOperationConfirm}
      />

      {/* Reko Assignment Dialog (from context menu) */}
      {rekoAssignOperationId && (
        <AssignRekoDialog
          open={rekoAssignDialogOpen}
          onOpenChange={setRekoAssignDialogOpen}
          incidentId={rekoAssignOperationId}
          incidentTitle={operations.find(op => op.id === rekoAssignOperationId)?.location || ''}
          onAssigned={() => {
            refreshOperations()
            setRekoAssignDialogOpen(false)
          }}
        />
      )}

      {/* Print Options Modal */}
      <PrintOptionsModal
        open={printModalOpen}
        onOpenChange={(open) => !open && activeFooterSheet === 'print' && setActiveFooterSheet(null)}
      />

      {/* Thermo Print Options Sheet */}
      <ThermoOptionsSheet
        open={thermoSheetOpen}
        onOpenChange={(open) => !open && activeFooterSheet === 'thermo' && setActiveFooterSheet(null)}
        onPrint={handlePrintBoard}
        isPrinting={isPrintingBoard}
      />

      <IncidentStatusWorkflowDialogs
        controller={statusWorkflow}
        printerEnabled={printerEnabled}
        funkrufname={funkrufname}
        diveraEnabled={diveraEnabled}
        onOpenAssignment={handleOpenAssignmentDialog}
        onOpenDetail={(operationId) => {
          openIncidentDetail(operationId)
        }}
        onSendDivera={setDiveraDialogOp}
        onRefresh={refreshOperations}
      />

      <DiveraSendDialog
        open={!!diveraDialogOp}
        onOpenChange={(open) => !open && setDiveraDialogOp(null)}
        operation={diveraDialogOpLive}
        materials={materials}
      />

      {/* Resource transfer dialog — opened from the card context menu */}
      {transferSourceOp && (
        <TransferIncidentDialog
          open={!!transferSourceOp}
          onOpenChange={(open) => !open && setTransferSourceOp(null)}
          sourceIncident={transferSourceOp as unknown as Incident}
          sourceName={transferSourceOp?.location}
          availableIncidents={transferAvailableIncidents}
          onTransfer={handleTransfer}
          isTransferring={isTransferring}
          resourceSummary={{
            crew: transferSourceOp.crew.length,
            vehicles: transferSourceOp.vehicles.length,
            materials: transferSourceOp.materials.length,
          }}
        />
      )}

      {/* Mobile Personnel Sheet */}
      <MobilePersonnelSheet
        open={mobilePersonnelSheetOpen}
        onOpenChange={setMobilePersonnelSheetOpen}
        personnel={personnel}
        operations={operations}
      />

      {/* Mobile Bottom Navigation */}
      <MobileBottomNavigation
        currentPage="kanban"
        hasSelectedEvent={!!selectedEvent}
        onCheckIn={generateCheckInQR}
        onReko={generateRekoDashboardQR}
        onDisplay={generateDisplayShare}
        onPersonnel={() => setMobilePersonnelSheetOpen(true)}
        onVehicleStatus={() => setActiveFooterSheet('vehicles')}
        onPrint={() => setActiveFooterSheet(printModalOpen ? null : 'print')}
        onThermo={() => setActiveFooterSheet(thermoSheetOpen ? null : 'thermo')}
        printerEnabled={printerEnabled}
      />
    </ProtectedRoute>
  )
}
