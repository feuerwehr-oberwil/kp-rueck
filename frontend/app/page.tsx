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
import { SearchInput } from "@/components/ui/search-input"
import { EventClock } from "@/components/ui/event-clock"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Plus, Package, QrCode, MonitorDown, Copy, Check, CircleCheck, Sparkles, ClipboardCheck, Truck, Printer, ChevronDown, CalendarDays, ChevronLeft, ChevronRight, Waypoints, Users, FileText, PanelRight, Loader2 } from 'lucide-react'
import { Kbd } from "@/components/ui/kbd"
import { ProtectedRoute } from "@/components/protected-route"
import { PageNavigation } from "@/components/page-navigation"
import { MobileBottomNavigation } from "@/components/mobile-bottom-navigation"
import { toast } from "sonner"
import { QrShareSheet } from "@/components/kanban/qr-share-sheet"
import { LinksQrSheet } from "@/components/kanban/links-qr-sheet"
import { AttendanceModal } from "@/components/kanban/attendance-modal"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useOperations, type Person, type Operation, type Material, type PersonRole, type OperationStatus, type RekoSummary } from "@/lib/contexts/operations-context"
import { useGroups } from "@/lib/contexts/groups-context"
import { AuftraegeSheet } from "@/components/kanban/auftraege-sheet"
import { RapportBacklogSheet, selectFiledRapports, selectOpenRapports } from "@/components/kanban/rapport-backlog-sheet"
import { MaterialOnSitePanel, selectMaterialOnSite } from "@/components/kanban/material-on-site-panel"
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
import type { OperationDetailSection, OperationDetailTab } from "@/lib/hooks/use-operation-detail-shortcuts"
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
import { CardViewMenu } from "@/components/kanban/card-view-menu"
import { ToolbarOverflow } from "@/components/kanban/toolbar-overflow"
import { useCardView } from "@/lib/card-view"
import { OperationDetailModal } from "@/components/kanban/operation-detail-modal"
import { ResourceAssignmentDialog } from "@/components/kanban/resource-assignment-dialog"
import { NewEmergencyModal } from "@/components/kanban/new-emergency-modal"
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog"
import { useIsMobile } from "@/components/ui/use-mobile"
import { EventSetupChecklist } from "@/components/event-setup-checklist"
import { DiveraMessageDialog } from "@/components/divera/divera-message-dialog"
import { summarizeEventChecklist } from "@/lib/checklist-tasks"
import { useCrossWindowSync } from "@/lib/hooks/use-cross-window-sync"
import { VehicleStatusSheet } from "@/components/vehicle-status-sheet"
import { EventSelectionEmptyState } from "@/components/empty-states/event-selection-empty-state"
import { SidePanel } from "@/components/kanban/side-panel"
import { SIDE_PANEL_BREAKPOINT } from "@/lib/layout-breakpoints"
import { useVehicleDrivers } from "@/lib/hooks/use-vehicle-drivers"
import { filterIncidents } from "@/lib/incident-search"
import { storeFieldNudgeConfirmation } from "@/components/kanban/field-status-nudge"
import { MobileIncidentListView } from "@/components/mobile/mobile-incident-list-view"
import { MobilePersonnelSheet } from "@/components/mobile/mobile-personnel-sheet"
import { PrintHubSheet, type ThermoPrintOptions } from "@/components/print/print-hub-sheet"
import { AssignRekoDialog } from "@/components/incidents/assign-reko-dialog"
import { TransferIncidentDialog } from "@/components/incidents/transfer-incident-dialog"
import type { Incident } from "@/lib/types/incidents"
import { DiveraSendDialog } from "@/components/divera/divera-send-dialog"
import {
  IncidentStatusWorkflowDialogs,
  useIncidentStatusWorkflow,
} from "@/components/kanban/incident-status-workflow"
import { cn } from "@/lib/utils"
import { usePersistedState } from "@/lib/hooks/use-persisted-state"
import { isStringArray } from "@/lib/utils/safe-storage"
import type { LucideIcon } from "lucide-react"

/**
 * Per-device layout memory. Folding a sidebar away is a deliberate act; walking
 * to the Karte and back used to undo it, which made the fold worthless. Keys
 * follow the `kp-board-*` family the other board preferences already use.
 */
const LEFT_SIDEBAR_KEY = "kp-board-leftSidebarOpen"
const RIGHT_SIDEBAR_KEY = "kp-board-rightSidebarOpen"
const SIDE_PANEL_MODE_KEY = "kp-board-sidePanelMode"
/** Events whose Bereitschaft checklist the operator has closed — see the auto-open effect. */
const CHECKLIST_DISMISSED_KEY = "kp-board-checklistDismissedEvents"
/** How many dismissals to keep; enough for a season of Einsätze, bounded on purpose. */
const CHECKLIST_DISMISSED_LIMIT = 30

const isBoolean = (value: unknown): value is boolean => typeof value === "boolean"

type SidePanelMode = 'detail' | 'collapsed'
const isSidePanelMode = (value: unknown): value is SidePanelMode =>
  value === 'detail' || value === 'collapsed'

/**
 * One footer-toolbar pill: icon + label, highlighted when the sheet/dialog it
 * opens is active. Replaces ~8 hand-rolled, near-identical `<Button>` blocks
 * that only differed in icon/label/state — each with its own template-literal
 * className doing the same active/inactive ternary.
 *
 * **The label is hidden below `xl`.** The centre group grew to nine entries and
 * a row of nine labelled pills is wider than a 1280px window; because a footer
 * cannot shrink below its content, that width was pushing the whole application
 * sideways — board, sidebars and header together — rather than just itself.
 * Dropping to icons is the option that keeps every control one click away: an
 * overflow menu hides half of them behind a second click, and a scrolling bar
 * hides them behind a gesture nobody looks for in a 40px strip. The name stays
 * reachable as a tooltip and as the accessible name, which is unchanged for a
 * screen reader either way.
 */
function ToolbarToggle({
  icon: Icon,
  label,
  active,
  disabled,
  title,
  count,
  onActivate,
}: {
  icon: LucideIcon
  label: string
  active: boolean
  disabled?: boolean
  title?: string
  /** Optional count badge. It survives the icon-only collapse below `xl`, for the
   *  same reason the Bereitschaft badge does: the number IS the information, and
   *  an icon on its own does not carry it. */
  count?: number
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
      // The tooltip carries the name at every width, so the icon-only mode is
      // never a control nobody can identify.
      title={title ?? label}
      aria-label={label}
    >
      <Icon className="size-3.5" />
      <span className="hidden text-xs xl:inline">{label}</span>
      {count !== undefined && (
        <Badge variant="secondary" className="h-4 px-1.5 text-[11px] font-medium tabular-nums">
          {count}
        </Badge>
      )}
    </Button>
  )
}

/**
 * What a resource sidebar shows while the first load is still in flight.
 *
 * The point is not to look like the list — it is to stop the sidebar from
 * lying. Both used to render nothing while their footers asserted «0/0
 * verfügbar», i.e. that the station has no crew and no material, which is a
 * statement rather than an absence of one. A spinner plus the «–/–» counter
 * says «wait» without saying anything false.
 *
 * Deliberately not a skeleton: keeping placeholder rows in the true shape of
 * the list means maintaining a second copy of the layout, and it buys nothing
 * here beyond what a spinner already says.
 */
function SidebarLoading({ label }: { label: string }) {
  return (
    <div
      className="flex items-center justify-center py-10"
      aria-busy="true"
      aria-label={label}
    >
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  )
}

/**
 * A sidebar with nothing to list, and the reason why.
 *
 * One shape for all three of them — nothing checked in, nothing recorded yet,
 * nothing matching the search — because they are the same statement with
 * different causes, and the operator's next step is what differs. The action is
 * grey and underlined, never coloured: on this board colour means status and
 * priority, so an inline text action must not borrow it.
 */
function SidebarEmpty({
  message,
  action,
  onAction,
  actionHref,
}: {
  message: React.ReactNode
  action?: string
  onAction?: () => void
  actionHref?: string
}) {
  const actionClasses =
    'text-xs text-muted-foreground underline underline-offset-2 decoration-muted-foreground/50 transition-colors hover:text-foreground hover:decoration-foreground cursor-pointer'
  return (
    <div className="flex flex-col items-center gap-2 py-6 text-center animate-in fade-in duration-300">
      <p className="text-sm text-muted-foreground">{message}</p>
      {action && actionHref ? (
        <Link href={actionHref} className={actionClasses}>
          {action}
        </Link>
      ) : action && onAction ? (
        <button type="button" onClick={onAction} className={actionClasses}>
          {action}
        </button>
      ) : null}
    </div>
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
    requestResourceConflict,
    deleteOperation,
    materialOnSite,
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
  const { toggleSidebar: toggleNotificationSidebar, registerNavigateHandler, registerFieldActionHandler, closeSidebar: closeNotificationSidebar } = useNotifications()
  const { registerHandlers, clearHandlers } = useCommandPalette()
  const searchParams = useSearchParams()
  const router = useRouter()
  const highlightParam = searchParams.get("highlight")
  const openDetailParam = searchParams.get("detail") === "1"
  const isMobile = useIsMobile()

  const tCommon = useTranslations('kanban.common')
  const tDash = useTranslations('kanban.dashboard')
  const tRes = useTranslations('kanban.resources')
  const tAttendance = useTranslations('kanban.attendance')
  const tPrint = useTranslations('print.toasts')
  const tSidePanel = useTranslations('kanban.sidePanel')
  const trackPrint = usePrintJobToast()

  // Ref for highlight timeout cleanup
  const highlightTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const spotlightTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  // Spotlight: for the first moment of a highlight the REST of the board steps
  // back instead of the card shouting. It is a separate, shorter window than the
  // highlight itself — the dim lifts, the accent ring stays for the remainder.
  const [spotlightActive, setSpotlightActive] = useState(false)

  // Scroll to and highlight a card by operation ID
  const scrollToCard = useCallback((operationId: string) => {
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

  // The header clock ticks inside <EventClock/> now; this is only the mount flag
  // the rest of the board hangs SSR-sensitive rendering off.
  const { isMounted } = useCurrentTime()
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
  const [sidePanelMode, setSidePanelMode] = usePersistedState<SidePanelMode>(
    SIDE_PANEL_MODE_KEY,
    'collapsed',
    isSidePanelMode,
  )
  // "Open the detail on THIS tab" — set by whoever pointed at one specific
  // thing: a notification, the Rapport-Backlog, or a click on one BLOCK of a
  // kanban card (its Reko part, its resource rows). A click on the card as a
  // whole names no tab, clears this, and lands on the tab the operator was last
  // working in. The nonce makes a repeat click a new event; the panel does not
  // remount for an incident that is already selected.
  const [openDetailOnTab, setOpenDetailOnTab] = useState<{ tab: OperationDetailTab; nonce: number; section?: OperationDetailSection } | null>(null)

  /** `section` narrows the landing further than the tab does — today only
   *  Übersicht's Ressourcen block, which the panel has to scroll to. */
  const openIncidentDetail = useCallback((operationId: string, tab?: OperationDetailTab, section?: OperationDetailSection) => {
    setOpenDetailOnTab(tab ? { tab, nonce: Date.now(), section } : null)
    setSelectedOperationId(operationId)
    setHoveredOperationId(operationId)
    if (typeof window !== 'undefined' && window.innerWidth >= SIDE_PANEL_BREAKPOINT) {
      setDetailModalOpen(false)
      setSidePanelMode('detail')
    } else {
      setDetailModalOpen(true)
    }
    // `setSidePanelMode` comes from `usePersistedState`; it is the plain
    // `useState` setter and therefore stable, but eslint cannot see that.
  }, [setSidePanelMode])

  const handleOpenIncidentFromNotification = useCallback((incidentId: string) => {
    if (operations.some((operation) => operation.id === incidentId)) openIncidentDetail(incidentId)
  }, [openIncidentDetail, operations])

  useRekoNotifications(operations, handleOpenIncidentFromNotification, handleUpdateOperationReko)
  const [draggingItem, setDraggingItem] = useState<Person | Material | Operation | null>(null)
  const [vehicleTypes, setVehicleTypes] = useState<Array<{ key: string; name: string; id: string; type: string }>>([])
  const [showLeftSidebar, setShowLeftSidebar] = usePersistedState(LEFT_SIDEBAR_KEY, true, isBoolean)
  const [showRightSidebar, setShowRightSidebar] = usePersistedState(RIGHT_SIDEBAR_KEY, true, isBoolean)
  // Single state for footer sheets - only one can be open at a time
  // `'print'` is the one print/export sheet: thermal slip, A4 status print and
  // per-event file export live in it together (`PrintHubSheet`).
  const [activeFooterSheet, setActiveFooterSheet] = useState<'links' | 'checkin' | 'display' | 'vehicles' | 'print' | 'auftraege' | 'rapporte' | null>(null)
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
  // The Appell. Not a ninth footer sheet and not a tab inside the shared QR body — it is
  // opened from the check-in sheet's Anwesenheit row, and opening it closes that sheet.
  const [attendanceOpen, setAttendanceOpen] = useState(false)
  /** Body of the Divera-Mitteilung the Checkliste asked to send; null = closed. */
  const [diveraMessageText, setDiveraMessageText] = useState<string | null>(null)
  const [attendanceCounts, setAttendanceCounts] = useState<{ present: number; total: number } | null>(null)

  // Auto-generate check-in QR code URL when no personnel are available
  useEffect(() => {
    if (!selectedEvent || checkInUrl || isLoading) return
    if (personnel.filter((p) => p.status === "available").length > 0) return
    apiClient.generateCheckInLink(selectedEvent.id).then((response) => {
      setCheckInUrl(`${window.location.origin}${response.link}`)
    }).catch(() => {})
  }, [selectedEvent, personnel, checkInUrl, isLoading])

  // The Anwesenheit row's count. Only fetched while the sheet that shows it is open —
  // it is a label, not live state, and the Appell refreshes it on every write anyway.
  useEffect(() => {
    if (activeFooterSheet !== 'checkin' || !selectedEvent) return
    let cancelled = false
    apiClient
      .getEventCheckInStats(selectedEvent.id)
      .then((stats) => {
        if (!cancelled) setAttendanceCounts({ present: stats.checked_in, total: stats.total_available })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [activeFooterSheet, selectedEvent])

  const gPrefix = useGPrefixNavigation(router)
  const cmdHint = useCommandPaletteHint()
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [operationToDelete, setOperationToDelete] = useState<Operation | null>(null)
  // What the cards show. Per device (localStorage), not a station setting: one
  // workstation must be able to run Kompakt while the second screen runs Alles,
  // without either operator's click repainting the other's board mid-Einsatz.
  // The store keeps one stable object per value, so `cardView` can go straight
  // into the memoised column/card tree without a useMemo wrapper here.
  const { view: cardView, preset: cardViewPreset, applyPreset: applyCardViewPreset, toggleKey: toggleCardViewKey } = useCardView()
  const [displayToken, setDisplayToken] = useState<string | null>(null)
  const [displayView, setDisplayView] = useState<'board' | 'map' | 'status'>('board')
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
  // finding the card first. The move is the SAME one the card's own nudge makes
  // — including the completion gate — and it records the same answer, so the
  // question does not come back on the card a second later.
  useEffect(() => {
    if (!isEditor) return
    registerFieldActionHandler((incidentId, kind) => {
      storeFieldNudgeConfirmation(incidentId, kind)
      if (kind === "complete") requestCompletion(incidentId)
      else changeStatusToTop(incidentId, "active")
    })
    return () => registerFieldActionHandler(null)
  }, [isEditor, registerFieldActionHandler, requestCompletion, changeStatusToTop])

  // Resource assignment dialog state
  const [assignmentDialogOpen, setAssignmentDialogOpen] = useState(false)
  const [assignmentResourceType, setAssignmentResourceType] = useState<'crew' | 'vehicles' | 'materials' | null>(null)
  const [assignmentOperationId, setAssignmentOperationId] = useState<string | null>(null)
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
    requestResourceConflict({
      resourceType: "vehicle",
      resourceId: vehicleId,
      resourceName: vehicle.name,
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
  }, [vehicleTypes, groups, operations, requestResourceConflict, assignGroupResource, unassignGroupResource, removeVehicle])

  const assignVehicleToIncidentWithConflict = useCallback((vehicleId: string, vehicleName: string, operationId: string) => {
    const groupConflicts = groups.filter((group) =>
      group.assignments.some((a) => a.resourceType === "vehicle" && a.resourceId === vehicleId),
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
  }, [groups, requestResourceConflict, unassignGroupResource, assignVehicleToOperation])

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
      onTogglePrint: () => setActiveFooterSheet(prev => prev === 'print' ? null : 'print'),
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
      onSidePanelMap: () => router.push(selectedOperationId ? `/map?highlight=${selectedOperationId}` : '/map'),
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

  // Hide sidebars on mobile by default. Runs after the persisted state has been
  // restored (`isMobile` only turns true once its own mount effect has measured
  // the window), so a remembered «offen» never survives on a phone — mobile wins.
  useEffect(() => {
    if (isMobile) {
      setShowLeftSidebar(false)
      setShowRightSidebar(false)
    }
  }, [isMobile, setShowLeftSidebar, setShowRightSidebar])

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
  // What is remembered is the DISMISSAL, per event — not whether the popover
  // happened to be open. A checklist the operator closed stays closed for that
  // Einsatz across navigation and reload; a genuinely new event may still
  // auto-open once. The popover itself always starts closed, since restoring an
  // open overlay on load is not what «bleibt zu» means.
  const [dismissedChecklistEvents, setDismissedChecklistEvents] = usePersistedState<string[]>(
    CHECKLIST_DISMISSED_KEY,
    [],
    isStringArray,
  )

  const handleChecklistOpenChange = useCallback(
    (open: boolean) => {
      setChecklistPopoverOpen(open)
      if (open || !selectedEvent) return
      setDismissedChecklistEvents((previous) =>
        previous.includes(selectedEvent.id)
          ? previous
          : [...previous, selectedEvent.id].slice(-CHECKLIST_DISMISSED_LIMIT),
      )
    },
    [selectedEvent, setDismissedChecklistEvents],
  )

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
  // never re-nags after the user has dismissed it — not this session (the ref)
  // and not on the next reload either (the persisted dismissal). The dismissal
  // list is read from localStorage on mount, well before `checklistProgress`
  // arrives from the API, so it always gets the first word.
  useEffect(() => {
    if (!selectedEvent || !isMounted) return
    if (checklistProgress.total === 0) return
    if (checklistProgress.completed >= checklistProgress.total) return
    if (autoOpenedEventRef.current === selectedEvent.id) return
    if (dismissedChecklistEvents.includes(selectedEvent.id)) return
    autoOpenedEventRef.current = selectedEvent.id
    setChecklistPopoverOpen(true)
  }, [selectedEvent, isMounted, checklistProgress, dismissedChecklistEvents])

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


  // Scroll to and highlight operation when navigating with ?highlight= param.
  // With `&detail=1` the card is also OPENED — that is the Karte page's
  // «Details anzeigen» arriving here: the incident detail lives on the board,
  // in the panel next to the columns, and a second copy of it over the map was
  // a second place to keep in step.
  useEffect(() => {
    if (highlightParam) {
      scrollToCard(highlightParam)
      if (openDetailParam) openIncidentDetail(highlightParam)
      // Clear the URL param to prevent re-scroll on refresh
      router.replace('/', { scroll: false })
    }
  }, [highlightParam, openDetailParam, scrollToCard, openIncidentDetail, router])

  useKanbanShortcuts(
    {
      modalOpen:
        detailModalOpen ||
        newEmergencyModalOpen ||
        assignmentDialogOpen ||
        // Vehicle, Aufträge and Drucken footers are non-modal on desktop: keep
        // their toggle keys (F / A / D) able to close them again. Every other
        // shortcut still stops at an open sheet — it is only the key that opened
        // this one that stays live.
        (!!activeFooterSheet &&
          activeFooterSheet !== 'vehicles' &&
          activeFooterSheet !== 'auftraege' &&
          activeFooterSheet !== 'print') ||
        deleteDialogOpen,
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
      onSidePanelMap: () => router.push(selectedOperationId ? `/map?highlight=${selectedOperationId}` : '/map'),
      onTogglePrint: () => setActiveFooterSheet((prev) => (prev === 'print' ? null : 'print')),
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
  // `filtered*` are what the sidebars actually draw — the footer counters read
  // them so "0 von 17 sichtbar" can never disagree with the list above it.
  const { groupedPersonnel, groupedMaterials, filteredPersonnel, filteredMaterials } = useResourceFiltering(
    personnel,
    materials,
    effectivePersonnelQuery,
    effectiveMaterialQuery,
    tRes('roleOther'),
    { personnel: personnelAvailableOnly, materials: materialsAvailableOnly },
  )

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

  // `tab`/`section` come from the card and say which BLOCK was clicked — the
  // card routes into the detail rather than always landing on one tab. Both
  // handlers just forward them; the card decides which of the two it calls
  // (modal below the side-panel breakpoint, selection above it).
  const handleCardClick = (operation: Operation, tab?: OperationDetailTab, section?: OperationDetailSection) => {
    // Don't open modal if we just finished dragging
    if (isDraggingOperationRef.current) {
      return
    }
    openIncidentDetail(operation.id, tab, section)
    broadcast("incident:selected", operation.id)
  }

  const handleCardSelect = (operation: Operation, tab?: OperationDetailTab, section?: OperationDetailSection) => {
    openIncidentDetail(operation.id, tab, section)
  }

  // Derived state for convenience
  const qrDialogOpen = activeFooterSheet === 'checkin'
  const displaySheetOpen = activeFooterSheet === 'display'
  // One share token, three targets — the sheet toggles which view the QR/URL point at.
  const displayUrl = displayToken
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/display/${displayView}?token=${displayToken}`
    : null
  const vehicleStatusSheetOpen = activeFooterSheet === 'vehicles'
  const printSheetOpen = activeFooterSheet === 'print'
  const auftraegeSheetOpen = activeFooterSheet === 'auftraege'
  const rapportBacklogSheetOpen = activeFooterSheet === 'rapporte'
  const linksSheetOpen = activeFooterSheet === 'links'

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

  const handleOpenRapport = useCallback((operationId: string) => {
    setActiveFooterSheet(null)
    openIncidentDetail(operationId, 'rapport')
  }, [openIncidentDetail])

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

  /** Opening the Appell closes the sheet underneath it — two stacked layers for one job
   *  is one too many. */
  const openAttendance = () => {
    setActiveFooterSheet(null)
    setAttendanceOpen(true)
  }

  /** Where this person is still assigned, so a check-out can warn instead of surprising.
   *  Never used to block, and never to release the assignment. */
  const assignmentLabelForPerson = useCallback(
    (person: { name: string }) =>
      operations.find((op) => op.status !== 'complete' && op.crew.includes(person.name))?.location ?? null,
    [operations]
  )

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

  // The Reko trupp's link is the field link now — `/reko-dashboard` is gone
  // (plan 26, decision 24) and `/feld` absorbed everything it did.

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
            <aside className="relative z-10 w-64 border-r border-border bg-card/30 backdrop-blur-sm flex flex-col">
              {/* Collapse handle — small chevron centered on the sidebar's inner edge */}
              <button
                onClick={() => setShowLeftSidebar(false)}
                className="absolute right-0 top-1/2 translate-x-1/2 z-20 flex h-12 w-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:bg-secondary/60 hover:text-foreground"
                title={`${tDash('toggleLeftSidebar')} ([)`}
                aria-label={tDash('toggleLeftSidebar')}
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              {/* Search */}
              <div className="flex items-center gap-1.5 px-3 pt-3 pb-2">
                <SearchInput
                  id="personnel-search-input"
                  size="sm"
                  containerClassName="flex-1 min-w-0"
                  placeholder={tDash('personnelSearch')}
                  value={personnelSearchQuery}
                  onValueChange={setPersonnelSearchQuery}
                  className="h-8 text-sm"
                  hint={!isMobile ? <Kbd className="h-5 text-xs">P</Kbd> : undefined}
                />
                <AvailableOnlyToggle
                  active={personnelAvailableOnly}
                  onToggle={() => setPersonnelAvailableOnly((v) => !v)}
                  label={personnelAvailableOnly ? tDash('showAll') : tDash('showAvailableOnly')}
                />
              </div>
              {/* Scrollable content */}
              <div className="flex-1 overflow-y-auto overscroll-y-contain pl-4 pr-2 pt-1 pb-3">
                {!isLoaded ? (
                  <SidebarLoading label={tDash('personnelLoading')} />
                ) : personnel.length === 0 ? (
                  /* Nobody is checked in for this Ereignis — the QR is the way in.
                     The test used to be "nobody is *available*", which meant a board
                     where every checked-in person was already assigned (or driving,
                     or on Reko) replaced the whole crew list with «Keine Personen
                     verfügbar» and a check-in QR — hiding the very people the
                     operator had just checked in, and telling them to check in
                     again. Assigned people belong in the list, drawn as assigned. */
                  <div className="flex flex-col items-center gap-3 py-4 animate-in fade-in duration-300">
                    <p className="text-sm text-muted-foreground text-center">
                      {tDash('noPersonnelCheckedIn')}
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
                ) : Object.keys(groupedPersonnel).length === 0 ? (
                  /* Nothing to list although people ARE checked in: the search or
                     the «nur Verfügbare» filter is hiding all of them. Which of
                     the two it is decides what the way out is, so it decides the
                     wording — a search that matches nothing used to leave a blank
                     box under a footer still claiming «10/17». */
                  effectivePersonnelQuery ? (
                    <SidebarEmpty
                      message={tDash.rich('noPersonnelMatch', {
                        query: effectivePersonnelQuery,
                        term: (chunks) => <span className="text-foreground">{chunks}</span>,
                      })}
                      action={tDash('resetSearch')}
                      // Clear whichever field is actually driving this: the
                      // sidebar's own search wins over the board's (see
                      // `effectivePersonnelQuery`), so clearing the board's
                      // while the sidebar holds a term would change nothing.
                      onAction={() => {
                        if (personnelSearchQuery) setPersonnelSearchQuery('')
                        else setSearchQuery('')
                      }}
                    />
                  ) : (
                    <SidebarEmpty
                      message={tDash('noneAvailableFiltered')}
                      action={tDash('showAll')}
                      onAction={() => setPersonnelAvailableOnly(false)}
                    />
                  )
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
              {/* Fixed availability counter at bottom. No rule above it: the
                  slightly lighter bar and its own padding already read as a
                  separate strip, and a line there was just chrome. */}
              <div className="px-4 py-2 bg-card/50 backdrop-blur-sm">
                <p className="text-xs text-muted-foreground text-center">
                  {/* Three states, three sentences. The counter used to render
                      «0/0 verfügbar» before the roster had arrived and «10/17»
                      over a list showing nothing — both of them assertions about
                      the station that were not true at the moment they were made.
                      While loading it says nothing («–/–»); while a search is
                      narrowing the list it counts what is on screen. */}
                  {!isLoaded
                    ? tCommon('counterLoading')
                    : effectivePersonnelQuery
                      ? tCommon('visibleCounter', { shown: filteredPersonnel.length, total: personnel.length })
                      : tCommon('availableCounter', { available: personnel.filter((p) => p.status === "available").length, total: personnel.length })}
                </p>
              </div>
            </aside>
          )}

          {/* Left sidebar reopen tab (shown when collapsed; "[" also toggles).
              The SAME pill as the collapse handle above, inset from the window
              edge instead of flush against it. A half-rounded tab with one
              border side removed reads as a control the window had cut in half,
              and it changed shape, z-layer and background every time a sidebar
              was collapsed. One shape, one size, going in and coming out. */}
          {!showLeftSidebar && (
            <button
              onClick={() => setShowLeftSidebar(true)}
              className="absolute left-1 top-1/2 z-20 flex h-12 w-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:bg-secondary/60 hover:text-foreground"
              title={`${tDash('toggleLeftSidebar')} ([)`}
              aria-label={tDash('toggleLeftSidebar')}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          )}

          {/* The board and the Material-Leiste's reopen tab share one containing
              block so the tab can be pinned to the BOARD's right edge rather than
              held in the flow between the board and the detail panel — where it
              reserved an empty 28px column the full height of the window. */}
          <div className="relative flex min-w-0 flex-1">
          {/* Main Kanban Board */}
          <main
            id="kanban-main"
            data-spotlight={spotlightActive ? 'on' : undefined}
            // No bottom padding: with `overflow-x-auto` the horizontal scrollbar
            // already sits below the columns, so a pb-4 underneath it drew a
            // second empty band between the board and the footer.
            className="flex-1 overflow-x-auto overscroll-contain px-4 pt-4 pb-0 bg-muted/30 dark:bg-background"
          >
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
                      cardView={cardView}
                      printerEnabled={printerEnabled}
                      vehicleDrivers={vehicleDrivers}
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

          {/* Reopen the Einsatz-Detail panel. Drawn HERE, not by `SidePanel`,
              and pinned rather than in the flow: a flex item reserves its width
              down the whole height of the board, so a 48px tab left a 20px
              column of nothing running beside the Material-Leiste. Inside the
              board's own box it lands on the board's right edge whether or not
              that sidebar is open. `2xl:` is SIDE_PANEL_BREAKPOINT (1536px) —
              below it the panel does not exist, so neither does its tab. */}
          {sidePanelMode === 'collapsed' && (
            <button
              onClick={() => setSidePanelMode('detail')}
              className="absolute right-1 top-3 z-20 hidden h-12 w-5 cursor-pointer items-center justify-center rounded-md border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:bg-secondary/60 hover:text-foreground 2xl:flex"
              title={`${tSidePanel('railLabel')} (\\)`}
              aria-label={tSidePanel('railLabel')}
            >
              <PanelRight className="h-4 w-4" />
            </button>
          )}

          {/* Right sidebar reopen tab (shown when collapsed; "]" also toggles).
              Mirrors the Personen-Leiste's tab on the left: `absolute right-1`,
              out of flow, so it costs the board no width — and, sitting inside
              the board's own containing block, it lands on the board's right
              edge whether or not the detail panel is open beside it. */}
          {!showRightSidebar && (
            <button
              onClick={() => setShowRightSidebar(true)}
              className="absolute right-1 top-1/2 z-20 flex h-12 w-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:bg-secondary/60 hover:text-foreground"
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
            // Same trick the Personen-Leiste's reopen tab uses on the left: out
            // of flow, so a folded panel costs the board no width. Only while
            // the Material-Leiste is folded too — otherwise there IS something
            // at this edge and the tab belongs beside it, not on top of it.
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

          {/* Same `z-10` as the left sidebar — see the note there. This side works
              on DOM order alone today; it carries the class so the handle does not
              depend on which side of the board its aside happens to sit. */}
          {showRightSidebar && (
            <aside className="relative z-10 w-64 border-l border-border bg-card/30 backdrop-blur-sm flex flex-col">
              {/* Collapse handle — small chevron centered on the sidebar's inner edge */}
              <button
                onClick={() => setShowRightSidebar(false)}
                className="absolute left-0 top-1/2 -translate-x-1/2 z-20 flex h-12 w-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:bg-secondary/60 hover:text-foreground"
                title={`${tDash('toggleRightSidebar')} (])`}
                aria-label={tDash('toggleRightSidebar')}
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              {/* Search */}
              <div className="flex items-center gap-1.5 px-3 pt-3 pb-2">
                <SearchInput
                  id="material-search-input"
                  size="sm"
                  containerClassName="flex-1 min-w-0"
                  placeholder={tDash('materialSearch')}
                  value={materialSearchQuery}
                  onValueChange={setMaterialSearchQuery}
                  className="h-8 text-sm"
                  hint={!isMobile ? <Kbd className="h-5 text-xs">M</Kbd> : undefined}
                />
                <AvailableOnlyToggle
                  active={materialsAvailableOnly}
                  onToggle={() => setMaterialsAvailableOnly((v) => !v)}
                  label={materialsAvailableOnly ? tDash('showAll') : tDash('showAvailableOnly')}
                />
              </div>
              {/* «Vor Ort» roll-up — above the scroll area on purpose, so neither
                  the search nor «nur verfügbare» (which hides everything that is
                  assigned, i.e. exactly this material) can filter the answer to
                  "what is still out there" away. Renders nothing at zero. */}
              <MaterialOnSitePanel entries={materialOnSiteEntries} onOpenIncident={openIncidentDetail} />
              {/* Scrollable content */}
              <div className="flex-1 overflow-y-auto overscroll-y-contain pl-4 pr-2 pt-1 pb-3">
                {!isLoaded ? (
                  <SidebarLoading label={tDash('materialLoading')} />
                ) : materials.length === 0 ? (
                  /* A fresh station: no Gerät has ever been recorded. The same
                     shape the Personal sidebar has always had for «niemand
                     angemeldet», down to naming the next step — the material
                     sidebar used to leave a bare box here. The link is for
                     editors: the section it points at is editor-only. */
                  <SidebarEmpty
                    message={tDash('noMaterialYet')}
                    action={isEditor ? tDash('createMaterialInSettings') : undefined}
                    actionHref="/settings?section=materials"
                  />
                ) : Object.keys(groupedMaterials).length === 0 ? (
                  effectiveMaterialQuery ? (
                    <SidebarEmpty
                      message={tDash.rich('noMaterialMatch', {
                        query: effectiveMaterialQuery,
                        term: (chunks) => <span className="text-foreground">{chunks}</span>,
                      })}
                      action={tDash('resetSearch')}
                      onAction={() => {
                        if (materialSearchQuery) setMaterialSearchQuery('')
                        else setSearchQuery('')
                      }}
                    />
                  ) : (
                    <SidebarEmpty
                      message={tDash('noneAvailableFiltered')}
                      action={tDash('showAll')}
                      onAction={() => setMaterialsAvailableOnly(false)}
                    />
                  )
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
              {/* Fixed availability counter at bottom — see the left sidebar,
                  including why it has three states. */}
              <div className="px-4 py-2 bg-card/50 backdrop-blur-sm">
                <p className="text-xs text-muted-foreground text-center">
                  {!isLoaded
                    ? tCommon('counterLoading')
                    : effectiveMaterialQuery
                      ? tCommon('visibleCounter', { shown: filteredMaterials.length, total: materials.length })
                      : tCommon('availableCounter', { available: materials.filter((m) => m.status === "available").length, total: materials.length })}
                </p>
              </div>
            </aside>
          )}

        </div>

        {/* Desktop Footer.

            `z-[60]` keeps it above the footer-sheet layer (z-50), so a sheet
            slides up from behind it instead of sweeping across it. Going UNDER
            a modal dialog is no longer this element's business: it used to be a
            hand-kept list of three modals here, which left the other ~20
            dialogs with a bright, inert toolbar over a dimmed board. The rule
            now keys off the dialog overlay itself — see the
            `body:has([data-slot='dialog-overlay'])` block at the end of
            app/globals.css. */}
        <footer className="relative z-[60] bg-background/95 backdrop-blur-sm px-4 md:px-6 py-2 shadow-[0_-1px_3px_rgba(0,0,0,0.05)] border-t border-border">
          {/* `min-w-0` on the row and on the middle group is what actually keeps
              the page from scrolling sideways. A flex item defaults to
              `min-width: auto`, i.e. it refuses to shrink below its content —
              so a toolbar wider than the window made the whole column wider
              than the window, and `<main>`'s own `overflow-auto` then scrolled
              the board, both sidebars and the header together. The label
              collapse below is what makes it fit at 1024; this is what makes it
              *impossible* for it not to.

              Labels come back in two stages, because measurement says one
              breakpoint cannot serve both cases (widths from Chrome, de-DE):

                fully labelled, training event ....... 1414px needed
                fully labelled, live event ........... 1262px needed

              A single `xl` (1280) therefore clipped every training board — the
              middle strip overflowed by 78px at 1280 and 35px at 1366 — while a
              single `2xl` (1536) would have made a 1366 and even a 1440 laptop
              icon-only on live boards that fit their labels comfortably today.
              So:

                xl  (1280) — the nine tool pills + Ansicht (unchanged)
                2xl (1536) — "Bereitschaft" and "Übungs-Steuerung"

              which leaves 1280 needing 1217px and 1536 needing 1414px. Both fit,
              with the 2xl stage sized off the real 1414 rather than off a guess. */}
          <div className="flex min-w-0 items-center justify-between gap-4">
            {/* Left: Primary action.
                "Neuer Einsatz" keeps its label at every width on purpose. It is
                the only control down here that *creates* something, it is what
                gets reached for under time pressure, and a bare "+" next to a
                board that has add affordances on every column is genuinely
                ambiguous. It costs 134px — the two labels below give back more
                than that, so the primary action never has to pay. */}
            <div className="flex shrink-0 items-center gap-3">
              <Button size="sm" className="gap-2 shadow-sm" onClick={() => setNewEmergencyModalOpen(true)}>
                <Plus className="size-3.5" />
                {tCommon('newIncident')}
              </Button>

              {/* Event Setup Checklist — shown only while setup is incomplete; disappears once done */}
              {selectedEvent && checklistProgress.total > 0 && checklistProgress.completed < checklistProgress.total && (
                <Popover open={checklistPopoverOpen} onOpenChange={handleChecklistOpenChange}>
                  <PopoverTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-2"
                      // Icon-only below 2xl, so the tooltip has to carry the name —
                      // same contract as `ToolbarToggle`.
                      title={`${tDash('readiness')} ${checklistProgress.completed}/${checklistProgress.total}`}
                      aria-label={`${tDash('readiness')} ${checklistProgress.completed}/${checklistProgress.total}`}
                    >
                      <ClipboardCheck className="size-3.5" />
                      {/* The word collapses like every other footer label; the
                          badge never does — `n/m` is the informative half, and
                          the clipboard icon alone does not carry a count. */}
                      <span className="hidden 2xl:inline">{tDash('readiness')}</span>
                      <Badge variant="secondary" className="h-5 px-1.5 text-xs font-medium tabular-nums">
                        {checklistProgress.completed}/{checklistProgress.total}
                      </Badge>
                    </Button>
                  </PopoverTrigger>
                  {/* Same offset as CardViewMenu at the other end of the row,
                      and for the same reason: the trigger sits inside the
                      toolbar, so the offset has to clear the toolbar and not
                      just the button. 10 left ~1px, and none at all while the
                      button is still badge-less ("Checkliste wird geladen…"),
                      which put the panel's bottom edge under the toolbar. */}
                  <PopoverContent
                    className="w-[600px] p-0"
                    align="start"
                    side="top"
                    sideOffset={20}
                  >
                    <EventSetupChecklist
                      eventId={selectedEvent.id}
                      eventName={selectedEvent.name}
                      onDismiss={() => handleChecklistOpenChange(false)}
                      onAllTasksComplete={() => handleChecklistOpenChange(false)}
                      onOpenVehicles={() => setActiveFooterSheet('vehicles')}
                      onOpenAttendance={() => setAttendanceOpen(true)}
                      onSendDiveraMessage={(text) => setDiveraMessageText(text)}
                    />
                  </PopoverContent>
                </Popover>
              )}
            </div>

            {/* Center: Secondary actions, in order, with whatever does not fit
                behind «Mehr».

                The strip used to rely on the label collapse alone, and the
                measurements above were the proof that one row of pills cannot be
                made to fit by choosing breakpoints: with the Meldungs-Leiste open
                at 1280 four controls fell off the end entirely and a fifth
                rendered as «Ansic». `ToolbarOverflow` measures instead of
                guessing — see the note there. The label collapse stays: it is
                still the cheapest width saving, and every control it does not
                save is reachable in the panel.

                Order is the contract. Items overflow from the end, so the pills
                an operator reaches for on a live board (Check-In, Reko, Feld,
                Display, Alarm) are the last to go. */}
            <ToolbarOverflow
              moreLabel={tDash('more')}
              moreTitle={(count) => tDash('moreTitle', { count })}
              items={[
                {
                  // Every link the board hands out, in one sheet (decision 29).
                  // Was five pills — Check-In, Reko, Feld, Anzeige, Alarm —
                  // each opening its own sheet that did the same three things.
                  // It is three now rather than one, because two of those
                  // sheets turned out to do MORE than share a link; see below.
                  key: 'links',
                  node: (
                    <ToolbarToggle
                      icon={QrCode}
                      label={tDash('linksAndQr')}
                      active={linksSheetOpen}
                      onActivate={() => setActiveFooterSheet(linksSheetOpen ? null : 'links')}
                    />
                  ),
                },
                {
                  // Not folded in: this sheet also carries the Appell, which is
                  // the only way into the roll call. A tidier footer is not
                  // worth losing a feature.
                  key: 'checkin',
                  node: (
                    <ToolbarToggle
                      icon={QrCode}
                      label={tDash('checkIn')}
                      active={qrDialogOpen}
                      onActivate={generateCheckInQR}
                    />
                  ),
                },
                {
                  // Same reason: this one picks WHICH display the token opens
                  // (Board · Karte · Status), which a link row cannot do.
                  key: 'display',
                  node: (
                    <ToolbarToggle
                      icon={MonitorDown}
                      label={tDash('display')}
                      active={displaySheetOpen}
                      onActivate={generateDisplayShare}
                    />
                  ),
                },
                {
                  key: 'vehicles',
                  separatorBefore: true,
                  node: (
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
                  ),
                },
                {
                  key: 'auftraege',
                  node: (
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
                  ),
                },
                /* Schadenplatz-Rapporte, offen und erfasst. Absent only when
                   there is NEITHER: the Bereitschaft button next door sets the
                   precedent — a control with nothing to say leaves the row.
                   An empty backlog on its own is no longer that case, because
                   the sheet's second tab still answers "was haben wir letzte
                   Woche geschrieben?". The badge is omitted at zero rather
                   than shown as «0»: it counts OFFEN and nothing else. */
                ...(openRapports.length > 0 || filedRapports.length > 0
                  ? [{
                      key: 'rapporte',
                      node: (
                        <ToolbarToggle
                          icon={FileText}
                          label={tDash('rapporte')}
                          active={rapportBacklogSheetOpen}
                          count={openRapports.length > 0 ? openRapports.length : undefined}
                          title={tDash('rapportBacklog.toggleTitle', { count: openRapports.length })}
                          onActivate={() => setActiveFooterSheet(rapportBacklogSheetOpen ? null : 'rapporte')}
                        />
                      ),
                    }]
                  : []),
                /* One pill for every way onto paper. "Drucken" and "Thermo"
                   used to sit here as two near-identical printer icons; they
                   are now two columns inside the one sheet. */
                {
                  key: 'print',
                  node: (
                    <ToolbarToggle
                      icon={Printer}
                      label={tDash('print')}
                      active={printSheetOpen}
                      disabled={!selectedEvent}
                      title={tDash('printTitle')}
                      onActivate={() => {
                        if (!selectedEvent) return
                        setActiveFooterSheet(printSheetOpen ? null : 'print')
                      }}
                    />
                  ),
                },
                ...(selectedEvent?.training_flag
                  ? [{
                      key: 'training',
                      separatorBefore: true,
                      node: (
                        <Link href="/training" className="shrink-0">
                          <Button
                            size="xs"
                            variant="ghost"
                            className="text-warning-foreground hover:text-warning-foreground hover:bg-warning/10"
                            title={tDash('trainingControl')}
                            aria-label={tDash('trainingControl')}
                          >
                            <Sparkles className="size-3.5" />
                            {/* Second collapse stage, at 2xl rather than xl. This is the
                                longest label in the row (143px) and the only pill that
                                is not part of the everyday live board — dropping its
                                word first buys the most width for the least loss. */}
                            <span className="hidden font-medium 2xl:inline">{tDash('trainingControl')}</span>
                          </Button>
                        </Link>
                      ),
                    }]
                  : []),
                {
                  key: 'cardview',
                  separatorBefore: true,
                  // One control where the two pills used to be. The pills only
                  // ever reached two of the nine card blocks — and never the long
                  // ones (Mannschaft, Fahrzeuge, Material) that decide whether
                  // forty cards fit on the screen.
                  node: (
                    <CardViewMenu
                      view={cardView}
                      preset={cardViewPreset}
                      onApplyPreset={applyCardViewPreset}
                      onToggleKey={toggleCardViewKey}
                    />
                  ),
                  // `data-keep-open`: this one opens a popover of its own from
                  // inside the panel, so the panel must not close under it.
                  panelNode: (
                    <div data-keep-open>
                      <CardViewMenu
                        view={cardView}
                        preset={cardViewPreset}
                        onApplyPreset={applyCardViewPreset}
                        onToggleKey={toggleCardViewKey}
                      />
                    </div>
                  ),
                },
              ]}
            />

            {/* Right: Help hint */}
            <div className="flex shrink-0 items-center gap-3">
              <button
                onClick={() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))}
                className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground/70 hover:text-muted-foreground transition-colors"
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
        openOnTab={openDetailOnTab ?? undefined}
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
          : ((personId: string, personName: string, operationId: string) =>
              // force: the dialog has its own «Doppelbelegung? Trotzdem zuweisen»
              // confirm with the label of where the person already is. Asking
              // again through the shared prompt would be the same question twice.
              assignPersonToOperation(personId, personName, operationId, true))}
        onAssignVehicle={routeAssign
          ? (vehicleId) => assignVehicleToGroupWithConflict(routeAssign.groupId, vehicleId)
          : assignVehicleToIncidentWithConflict}
        onAssignMaterial={routeAssign
          ? (materialId) => assignGroupResource(routeAssign.groupId, 'material', materialId)
          : ((materialId: string, operationId: string) =>
              assignMaterialToOperation(materialId, operationId, true))}
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


      {/* Check-In QR Code Sheet.
          The Anwesenheit row rides in through the existing `children` seam — the same one
          the Anzeige sheet uses for its view selector — rather than QrShareSheet growing a
          special case for one of its five callers. The count IS the entry: it says why one
          would click. */}
      {/* The one sheet the footer opens now. The four QrShareSheets below it
          stay mounted for the deep links and the printer flows that still name
          them individually — they are simply no longer how an operator gets
          there. */}
      <LinksQrSheet
        open={linksSheetOpen}
        onOpenChange={(open) => !open && activeFooterSheet === 'links' && setActiveFooterSheet(null)}
        eventId={selectedEvent?.id ?? null}
        printerEnabled={printerEnabled}
      />

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
      >
        {selectedEvent && (
          <div className="mb-3 flex items-center gap-3 rounded-md border bg-muted/40 px-3 py-2">
            <Users className="size-4 shrink-0 text-muted-foreground" />
            <span className="text-sm font-medium">{tAttendance('rowLabel')}</span>
            <span className="flex-1 text-sm text-muted-foreground">
              {attendanceCounts
                ? tAttendance('rowCount', { present: attendanceCounts.present, total: attendanceCounts.total })
                : ''}
            </span>
            <Button size="sm" variant="outline" onClick={openAttendance}>
              {tAttendance('open')}
            </Button>
          </div>
        )}
      </QrShareSheet>

      {/* The Appell itself */}
      {selectedEvent && (
        <AttendanceModal
          open={attendanceOpen}
          onOpenChange={setAttendanceOpen}
          eventId={selectedEvent.id}
          eventName={selectedEvent.name}
          assignmentLabelFor={assignmentLabelForPerson}
        />
      )}


      {/* Feld (Schadenplatz-Rapport) QR Code Sheet — one global link per Ereignis */}

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

      {/* Offene Schadenplatz-Rapporte — the rolling backlog, oldest first */}
      <RapportBacklogSheet
        open={rapportBacklogSheetOpen}
        onOpenChange={(open) => !open && activeFooterSheet === 'rapporte' && setActiveFooterSheet(null)}
        rapports={openRapports}
        filed={filedRapports}
        onOpenRapport={handleOpenRapport}
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

      {/* Divera-Mitteilung from the Checkliste. Mounted here, not inside the
          checklist popover: opening it closes that popover, which would take a
          dialog rendered in there down with it (same reason as the driver
          prompt). Nothing is sent until it is confirmed, and its group picker
          starts empty — «alle» is a choice, never a default. */}
      <DiveraMessageDialog
        open={diveraMessageText !== null}
        onOpenChange={(open) => !open && setDiveraMessageText(null)}
        defaultText={diveraMessageText ?? ''}
      />

      {/* Thermal slip, A4 status print and per-event file export in one sheet */}
      <PrintHubSheet
        open={printSheetOpen}
        onOpenChange={(open) => !open && activeFooterSheet === 'print' && setActiveFooterSheet(null)}
        onThermoPrint={handlePrintBoard}
        isThermoPrinting={isPrintingBoard}
        printerEnabled={printerEnabled}
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
        />
      )}

      {/* Mobile Personnel Sheet */}
      <MobilePersonnelSheet
        open={mobilePersonnelSheetOpen}
        onOpenChange={setMobilePersonnelSheetOpen}
        personnel={personnel}
        operations={operations}
      />

      {/* Mobile Bottom Navigation. No separate Thermo entry any more: the one
          print sheet carries the thermal column itself, gated on the same
          `printerEnabled` it is still handed here. */}
      <MobileBottomNavigation
        currentPage="kanban"
        hasSelectedEvent={!!selectedEvent}
        onLinks={() => setActiveFooterSheet(linksSheetOpen ? null : 'links')}
        onPersonnel={() => setMobilePersonnelSheetOpen(true)}
        onVehicleStatus={() => setActiveFooterSheet('vehicles')}
        onPrint={() => setActiveFooterSheet(printSheetOpen ? null : 'print')}
        printerEnabled={printerEnabled}
      />
    </ProtectedRoute>
  )
}
