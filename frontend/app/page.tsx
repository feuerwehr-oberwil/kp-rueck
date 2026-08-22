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
import { SearchInput } from "@/components/ui/search-input"
import { EventClock } from "@/components/ui/event-clock"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Plus, QrCode, Copy, Check, CircleCheck, Sparkles, ClipboardCheck, Truck, Printer, ChevronDown, CalendarDays, ChevronLeft, ChevronRight, Waypoints, FileText, PanelRight, Loader2, Ban, ArrowRight, ArrowUpRight, Package2 } from 'lucide-react'
import { ContextMenu, ContextMenuCheckboxItem, ContextMenuContent, ContextMenuTrigger } from "@/components/ui/context-menu"
import { summarizeMaterials, summarizeRoster } from "@/lib/resource-status"
import { Kbd } from "@/components/ui/kbd"
import { ProtectedRoute } from "@/components/protected-route"
import { TrainingBand, TrainingBadge } from "@/components/training-mode-chrome"
import { PageNavigation } from "@/components/page-navigation"
import { MobileBottomNavigation } from "@/components/mobile-bottom-navigation"
import { toast } from "sonner"
import { LinksQrSheet } from "@/components/kanban/links-qr-sheet"
import { AttendanceModal } from "@/components/kanban/attendance-modal"
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useOperations, type Person, type Operation, type Material, type PersonRole, type OperationStatus, type RekoSummary } from "@/lib/contexts/operations-context"
import { useGroups } from "@/lib/contexts/groups-context"
import { AuftraegeSheet } from "@/components/kanban/auftraege-sheet"
import { RapportBacklogSheet, selectFiledRapports, selectOpenRapports } from "@/components/kanban/rapport-backlog-sheet"
import { MaterialOnSitePanel, selectMaterialOnSite } from "@/components/kanban/material-on-site-panel"
import { toMirrorStatus } from "@/components/map/route-stop-list"
import { RoutenEditorModal } from "@/components/kanban/routen-editor-modal"
import { useMaterials } from "@/lib/contexts/materials-context"
import { usePersonnel } from "@/lib/contexts/personnel-context"
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
import { usePersonEngagements } from "@/lib/hooks/use-person-engagements"
import { useIncidentHighlightListener } from "@/lib/hooks/use-incident-highlight-listener"
import type { IncidentHighlightOptions } from "@/lib/notification-highlight"
import { useCurrentTime } from "@/lib/hooks/use-current-time"
import { useGPrefixNavigation } from "@/lib/hooks/use-g-prefix-navigation"
import { useKanbanShortcuts } from "@/lib/hooks/use-kanban-shortcuts"
import type { OperationDetailSection, OperationDetailTab } from "@/lib/hooks/use-operation-detail-shortcuts"
import { useCommandPaletteHint } from "@/lib/hooks/use-is-mac"
import { usePrintJobToast } from "@/lib/hooks/use-print-job-toast"
import { useAuth } from "@/lib/contexts/auth-context"
import { useCommandPalette } from "@/lib/contexts/command-palette-context"
import { columns, findAuftragForStop, BOARD_COLUMN_COLLAPSE_KEY, DEFAULT_COLLAPSED_COLUMN_IDS } from "@/lib/kanban-utils"
import { useCollapsedSections } from "@/lib/hooks/use-collapsed-sections"
import { useToggleDriverStay } from "@/lib/hooks/use-driver-stay"
import { getIncidentLocationLabel, getIncidentTypeLabel, getIncidentRefLabel } from "@/lib/incident-types"
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
import { EventSetupChecklist, RekoPickerDialog } from "@/components/event-setup-checklist"
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

/**
 * One place a resource is held right now.
 *
 * The board asked this question with `operations.find(...)` — the FIRST hit —
 * which meant a person on two Schadenplätze could never be followed to the
 * second one, and a Magaziner or Telefondienst (bound, but on no incident at
 * all) produced a click that did nothing whatsoever.
 */
interface ResourceBinding {
  key: string
  /** 'incident' scrolls to a card, 'route' opens the Auftrag sheet,
   *  'function' has nowhere to go and says so. */
  kind: "incident" | "route" | "function"
  /** Incident id, Auftrag id, or null for a station function. */
  targetId: string | null
  label: string
  /** Second line — the Auftrag a stop belongs to, or «Sonderfunktion · kein Einsatz». */
  detail: string
}

/** What the bindings popover is currently answering for. */
interface BindingsPopoverState {
  kind: "person" | "material"
  id: string
  title: string
  subtitle: string
  bindings: ResourceBinding[]
}

/** Can this binding actually be followed? A station function has nowhere to go,
 *  and neither has anything that lost its target. */
const isNavigableBinding = (binding: ResourceBinding): boolean =>
  binding.kind !== 'function' && !!binding.targetId

/**
 * Every binding of one busy resource, with a way to reach each.
 *
 * Deliberately shown only when there is something to choose: exactly one
 * incident binding still jumps straight there, which is the common case and the
 * behaviour operators already know.
 *
 * The popover also answers for a resource with NO binding — «keine Bindung» in
 * so many words. Both that case and «Zum Anspringen auswählen» over a list where
 * nothing IS navigable used to be silent: the hint promised an action that the
 * single row underneath it («TLF · Sonderfunktion · kein Einsatz») could not
 * deliver, and a free person produced no popover at all.
 */
function BindingsPopoverBody({
  state,
  onGo,
  onClose,
}: {
  state: BindingsPopoverState
  onGo: (binding: ResourceBinding) => void
  onClose: () => void
}) {
  const t = useTranslations('kanban.common')
  const hasNavigable = state.bindings.some(isNavigableBinding)
  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{state.title}</p>
          {state.subtitle && <p className="truncate text-2xs text-muted-foreground">{state.subtitle}</p>}
        </div>
        {state.bindings.length > 0 && (
          <Badge variant="outline" className="shrink-0 border-amber-200 text-amber-700 dark:border-amber-800/50 dark:text-amber-400">
            {t('bindingsCount', { count: state.bindings.length })}
          </Badge>
        )}
      </div>
      {state.bindings.length === 0 ? (
        <p className="text-2xs text-muted-foreground">{t('bindingsNone')}</p>
      ) : hasNavigable ? (
        <p className="text-2xs text-muted-foreground">{t('bindingsPick')}</p>
      ) : null}
      <div className="space-y-1">
        {state.bindings.map((binding) => {
          const reachable = isNavigableBinding(binding)
          return (
            <button
              key={binding.key}
              type="button"
              disabled={!reachable}
              onClick={() => { onGo(binding); onClose() }}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left",
                reachable ? "cursor-pointer hover:bg-muted/60" : "cursor-default",
              )}
            >
              {reachable ? (
                <ArrowRight className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
              ) : (
                <Package2 className="size-3.5 shrink-0 text-muted-foreground" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{binding.label}</span>
                {binding.detail && <span className="block truncate text-2xs text-muted-foreground">{binding.detail}</span>}
              </span>
              {reachable
                ? <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" />
                : <span className="shrink-0 text-2xs text-muted-foreground">–</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** "19.08." — the stamp on «seit …», the same one the Materialverwaltung uses. */
function shortDate(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.`
}

/**
 * One material row in the sidebar, with its right-click menu.
 *
 * «Nicht einsatzbereit» is settable in two places that write the SAME field:
 * here and in the Materialverwaltung. One entry, no submenu, no reason picker
 * and no cause list — set or not set. Clicking it again releases the device.
 *
 * A flagged device does not render as a draggable card at all: it is a dashed,
 * dimmed row with the word on it, so it cannot be picked up and cannot be
 * mistaken for something merely busy. Colour carries none of that alone.
 */
function MaterialSidebarRow({
  material,
  onClick,
  onToggleOutOfService,
  bindingsPopover,
  onCloseBindings,
  onGoBinding,
}: {
  material: Material
  onClick: () => void
  onToggleOutOfService: (material: Material, outOfService: boolean) => void
  bindingsPopover: BindingsPopoverState | null
  onCloseBindings: () => void
  onGoBinding: (binding: ResourceBinding) => void
}) {
  const t = useTranslations('kanban.common')
  const isOpen = bindingsPopover?.kind === 'material' && bindingsPopover.id === material.id
  return (
    <Popover open={isOpen} onOpenChange={(open) => { if (!open) onCloseBindings() }}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <PopoverAnchor asChild>
            <div>
              {material.outOfService ? (
                <div
                  onClick={onClick}
                  title={t('notReady')}
                  className="flex items-center gap-2 rounded-lg border border-dashed border-border bg-transparent px-3 py-2 opacity-70"
                >
                  {/* Icon only: the Ban glyph plus the dashed frame already say
                      «nicht einsatzbereit», and repeating it in words pushed the
                      device name into an ellipsis. The word survives as the
                      accessible name and in the tooltip, so nothing is lost for
                      a screen reader or on hover. */}
                  <Ban className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="sr-only">{t('notReady')}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-muted-foreground">{material.name}</span>
                    {material.outOfServiceSince && (
                      <span className="block text-2xs text-muted-foreground">
                        {t('notReadySince', { date: shortDate(material.outOfServiceSince) })}
                      </span>
                    )}
                  </span>
                </div>
              ) : (
                <DraggableMaterial material={material} onClick={onClick} />
              )}
            </div>
          </PopoverAnchor>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuCheckboxItem
            checked={material.outOfService}
            onCheckedChange={(checked) => onToggleOutOfService(material, checked === true)}
          >
            {t('notReady')}
          </ContextMenuCheckboxItem>
        </ContextMenuContent>
      </ContextMenu>
      <PopoverContent align="start" side="left" className="w-80 p-3">
        {bindingsPopover && (
          <BindingsPopoverBody state={bindingsPopover} onGo={onGoBinding} onClose={onCloseBindings} />
        )}
      </PopoverContent>
    </Popover>
  )
}

/** Priority → its label key under `kanban.common`, for the toast a keyboard
 *  priority change raises. */
const PRIORITY_LABEL_KEYS: Record<Operation["priority"], "priorityLow" | "priorityMedium" | "priorityHigh"> = {
  low: "priorityLow",
  medium: "priorityMedium",
  high: "priorityHigh",
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
  // Where each person actually is, for the sidebar card's tooltip (§P3.5) —
  // computed once here, passed down, so the memoized cards stay cheap.
  const personEngagements = usePersonEngagements()

  const { materialGroups, setMaterialOutOfService } = useMaterials()
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
  const tPrint = useTranslations('print.toasts')
  const tSidePanel = useTranslations('kanban.sidePanel')
  // Column titles, for the toasts a keyboard mutation raises.
  const tColumns = useTranslations('kanban.columns')
  // The board's one «Rückgängig» label — reused rather than copied.
  const tNotifications = useTranslations('notifications.operations')
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
  const openIncidentDetail = useCallback((
    operationId: string,
    tab?: OperationDetailTab,
    section?: OperationDetailSection,
    { allowModal = true }: { allowModal?: boolean } = {},
  ) => {
    setOpenDetailOnTab(tab ? { tab, nonce: Date.now(), section } : null)
    setSelectedOperationId(operationId)
    setHoveredOperationId(operationId)
    if (typeof window !== 'undefined' && window.innerWidth >= SIDE_PANEL_BREAKPOINT) {
      setDetailModalOpen(false)
      setSidePanelMode('detail')
    } else if (allowModal) {
      // Narrow viewport: only a notification earns the full-screen modal. A
      // sidebar binding would bury the list the operator is working through, and
      // its answer — «this device is on THAT card» — is the ring, not a modal.
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

  useRekoNotifications(operations, handleOpenIncidentFromNotification, handleUpdateOperationReko)
  const [vehicleTypes, setVehicleTypes] = useState<Array<{ key: string; name: string; id: string; type: string }>>([])
  const [showLeftSidebar, setShowLeftSidebar] = usePersistedState(LEFT_SIDEBAR_KEY, true, isBoolean)
  const [showRightSidebar, setShowRightSidebar] = usePersistedState(RIGHT_SIDEBAR_KEY, true, isBoolean)
  // Single state for footer sheets - only one can be open at a time
  // `'print'` is the one print/export sheet: thermal slip, A4 status print and
  // per-event file export live in it together (`PrintHubSheet`).
  const [activeFooterSheet, setActiveFooterSheet] = useState<'links' | 'vehicles' | 'print' | 'auftraege' | 'rapporte' | null>(null)
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

  // Which columns this screen has folded away. Seven columns do not fit on
  // every command-post monitor, and the two that matter right now must not be
  // behind a horizontal scrollbar. Per DEVICE, not per operator account: the
  // fold answers «how wide is this monitor», which nobody wants inherited on
  // the next machine — same hook, same reasoning as both wall boards.
  const collapsedColumns = useCollapsedSections(BOARD_COLUMN_COLLAPSE_KEY, DEFAULT_COLLAPSED_COLUMN_IDS)

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
    // No toast: the column reorders under the operator's eyes, so confirming it
    // in words is noise on a surface whose job is staying calm.
    reorderColumn(ordered)
  }, [operations, groups, setOperations, reorderColumn])

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

  /** «X → Im Einsatz» — a keyboard move can land on a card that is scrolled out
   *  of sight, so the board says what it just did. */
  const notifyStatusMove = useCallback((operation: Operation, newStatus: OperationStatus) => {
    toast.success(tCommon('statusMovedToast', {
      name: getIncidentLocationLabel(operation),
      status: tColumns(newStatus),
    }))
  }, [tCommon, tColumns])

  const moveOperationRight = useCallback((operationId: string) => {
    const operation = operations.find(op => op.id === operationId)
    if (!operation) return

    const currentColumnIndex = columns.findIndex((col) => col.status.includes(operation.status))
    if (currentColumnIndex < columns.length - 1) {
      const nextColumn = columns[currentColumnIndex + 1]
      const newStatus = nextColumn.status[0] as OperationStatus
      const previousStatus = operation.status
      updateOperation(operationId, { status: newStatus })
      notifyStatusMove(operation, newStatus)
      if (newStatus === "enroute") triggerDisponiertDialog(operationId, previousStatus)
      if (newStatus === "reko") triggerRekoCheck(operationId, previousStatus)
      if (newStatus === "reko_done") triggerRekoFormCheck(operationId, previousStatus)
      if (newStatus === "returning") triggerReturningVehicleCheck(operationId, previousStatus)
      if (newStatus === "complete") promptMaterialDecision(operationId, previousStatus)
    }
  }, [operations, updateOperation, notifyStatusMove, triggerDisponiertDialog, triggerRekoCheck, triggerRekoFormCheck, triggerReturningVehicleCheck, promptMaterialDecision])

  const moveOperationLeft = useCallback((operationId: string) => {
    const operation = operations.find(op => op.id === operationId)
    if (!operation) return

    const currentColumnIndex = columns.findIndex((col) => col.status.includes(operation.status))
    if (currentColumnIndex > 0) {
      const prevColumn = columns[currentColumnIndex - 1]
      const newStatus = prevColumn.status[0] as OperationStatus
      const previousStatus = operation.status
      updateOperation(operationId, { status: newStatus })
      notifyStatusMove(operation, newStatus)
      // Backwards into «Disponiert / Anfahrt» is a correction, not a new
      // dispatch — the workflow decides which dialog that means.
      if (newStatus === "enroute") triggerDisponiertDialog(operationId, previousStatus)
    }
  }, [operations, updateOperation, notifyStatusMove, triggerDisponiertDialog])

  // Quick-assign (number keys / command palette) toggle of a vehicle onto an
  // incident. For a GROUPED incident the route owns resources, so route the
  // assign/unassign to the Auftrag — otherwise a per-incident row would be
  // created that never renders on a grouped card (a hidden assignment).
  //
  // Toasts either way: one keystroke moving a Tanklöschfahrzeug on or off an
  // incident is exactly the mutation that must not happen in silence.
  const toggleVehicleAssignment = useCallback(
    (op: Operation, vehicle: { id: string; name: string }) => {
      const notify = (assigned: boolean) => {
        toast.success(
          tCommon(assigned ? 'vehicleAssignedToast' : 'vehicleRemovedToast', {
            vehicle: vehicle.name,
            name: getIncidentLocationLabel(op),
          }),
        )
      }
      if (op.groupId) {
        const existing = getGroupResources(op.groupId).vehicles.find((v) => v.resourceId === vehicle.id)
        if (existing) unassignGroupResource(op.groupId, existing.assignmentId)
        else assignGroupResource(op.groupId, "vehicle", vehicle.id)
        notify(!existing)
        return
      }
      if (op.vehicles.includes(vehicle.name)) {
        removeVehicle(op.id, vehicle.name)
        notify(false)
      } else {
        assignVehicleToOperation(vehicle.id, vehicle.name, op.id)
        notify(true)
      }
    },
    [getGroupResources, unassignGroupResource, assignGroupResource, removeVehicle, assignVehicleToOperation, tCommon],
  )

  /** Priority by keystroke — the card only shows it as a small chevron, so the
   *  change says itself. */
  const setOperationPriority = useCallback((operationId: string, priority: Operation["priority"]) => {
    const operation = operations.find((op) => op.id === operationId)
    if (!operation) return
    const previous = operation.priority
    updateOperation(operationId, { priority })
    toast.success(
      tCommon('priorityChangedToast', {
        name: getIncidentLocationLabel(operation),
        priority: tCommon(PRIORITY_LABEL_KEYS[priority]),
      }),
      previous === priority ? undefined : {
        action: {
          label: tNotifications('undoLabel'),
          onClick: () => updateOperation(operationId, { priority: previous }),
        },
      },
    )
  }, [operations, updateOperation, tCommon, tNotifications])

  /** «Zu Fuss» by keystroke — a vehicle-less dispatch is a radio-relevant fact. */
  const toggleZuFuss = useCallback((operationId: string) => {
    const operation = operations.find((op) => op.id === operationId)
    if (!operation) return
    const next = !operation.zuFuss
    updateOperation(operationId, { zuFuss: next })
    toast.success(
      tCommon(next ? 'zuFussOnToast' : 'zuFussOffToast', { name: getIncidentLocationLabel(operation) }),
      {
        action: {
          label: tNotifications('undoLabel'),
          onClick: () => updateOperation(operationId, { zuFuss: !next }),
        },
      },
    )
  }, [operations, updateOperation, tCommon, tNotifications])

  /** The driver decision is read out on the radio and printed on the slip, so
   *  the pill's click gets the same receipt as every other card mutation. The
   *  underlying hook is optimistic and toasts on failure by itself. */
  const handleToggleDriverStay = useCallback((operationId: string, vehicleName: string) => {
    const operation = operations.find((op) => op.id === operationId)
    const next = !(operation?.vehicleDriverStay?.get(vehicleName) ?? false)
    toggleDriverStay(operationId, vehicleName)
    toast.success(
      tCommon(next ? 'driverStaysToast' : 'driverReturnsToast', { vehicle: vehicleName }),
      {
        description: tCommon('driverStayToastHint'),
        action: {
          label: tNotifications('undoLabel'),
          onClick: () => toggleDriverStay(operationId, vehicleName),
        },
      },
    )
  }, [operations, toggleDriverStay, tCommon, tNotifications])

  /** Stage an incident for the delete confirmation — the context menu's
   *  destructive row and the Delete key share this one path. */
  const handleRequestDelete = useCallback((operationId: string) => {
    const operation = operations.find((op) => op.id === operationId)
    if (!operation) return
    setOperationToDelete(operation)
    setDeleteDialogOpen(true)
  }, [operations])

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
      onToggleLinks: () => setActiveFooterSheet(prev => prev === 'links' ? null : 'links'),
      onToggleRapporte: () => setActiveFooterSheet(prev => prev === 'rapporte' ? null : 'rapporte'),
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
      // Everything below acts on the SELECTED card, never on the hovered one:
      // while the palette is open the pointer is over the palette, and a
      // command that mutates has to name the card the operator chose.
      onToggleZuFuss: () => {
        if (selectedOperationId) toggleZuFuss(selectedOperationId)
      },
      onSearchPersonnel: () => {
        setShowLeftSidebar(true)
        setTimeout(() => document.getElementById('personnel-search-input')?.focus(), 50)
      },
      onSearchMaterial: () => {
        setShowRightSidebar(true)
        setTimeout(() => document.getElementById('material-search-input')?.focus(), 50)
      },
      hasSelectedIncident: !!selectedOperationId,
      onEditIncident: () => {
        if (selectedOperationId) {
          const operation = operations.find(op => op.id === selectedOperationId)
          if (operation) {
            openIncidentDetail(operation.id)
          }
        }
      },
      onDeleteIncident: () => {
        if (selectedOperationId) handleRequestDelete(selectedOperationId)
      },
      onMoveStatusForward: () => {
        if (selectedOperationId) {
          moveOperationRight(selectedOperationId)
        }
      },
      onMoveStatusBackward: () => {
        if (selectedOperationId) {
          moveOperationLeft(selectedOperationId)
        }
      },
      onSetPriority: (priority) => {
        if (selectedOperationId) setOperationPriority(selectedOperationId, priority)
      },
      onAssignVehicle: (vehicleNumber) => {
        if (selectedOperationId) {
          const vehicleType = vehicleTypes[vehicleNumber - 1]
          if (vehicleType) {
            const operation = operations.find(op => op.id === selectedOperationId)
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
    selectedOperationId,
    operations,
    vehicleTypes,
    moveOperationRight,
    moveOperationLeft,
    setOperationPriority,
    toggleZuFuss,
    handleRequestDelete,
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
        // Vehicle, Aufträge, Drucken, Links and Rapporte footers are non-modal
        // on desktop: keep their toggle keys (F / A / D / T / O) able to close
        // them again. Every other shortcut still stops at an open sheet — it is
        // only the key that opened this one that stays live.
        (!!activeFooterSheet &&
          activeFooterSheet !== 'vehicles' &&
          activeFooterSheet !== 'auftraege' &&
          activeFooterSheet !== 'print' &&
          activeFooterSheet !== 'links' &&
          activeFooterSheet !== 'rapporte') ||
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
    // A refused drop has to SAY it was refused. Silence here read as
    // "drag and drop is broken" — the sidebar let go and nothing moved.
    notifyRefused: () => toast.error(tCommon('dropRefusedRouteOccupied')),
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
  const { groupedPersonnel, groupedMaterials, filteredPersonnel, filteredMaterials } = useResourceFiltering(
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
   * Everywhere this person is held — all of it, not the first hit.
   *
   * `filter`, not `find`: after a double booking the second incident used to be
   * unreachable from the sidebar, because a second click resolved to the same
   * first match. The special functions come straight out of the context (they
   * are already on the person) instead of a per-click API fetch that only ever
   * looked at `driver`.
   */
  const collectPersonBindings = useCallback((person: Person): ResourceBinding[] => {
    const bindings: ResourceBinding[] = []
    for (const op of operations) {
      if (op.crew.includes(person.name)) {
        bindings.push({
          key: `incident-${op.id}`,
          kind: "incident",
          targetId: op.id,
          label: getIncidentRefLabel(op, 60),
          detail: op.groupId ? groupNames.get(op.groupId) ?? "" : "",
        })
      }
      if (op.assignedReko?.id === person.id) {
        bindings.push({
          key: `reko-${op.id}`,
          kind: "incident",
          targetId: op.id,
          label: getIncidentRefLabel(op, 60),
          detail: tCommon('reko'),
        })
      }
    }
    for (const group of groups) {
      if (getGroupResources(group.id).personnel.some((p) => p.name === person.name)) {
        bindings.push({ key: `route-${group.id}`, kind: "route", targetId: group.id, label: group.name, detail: "" })
      }
    }
    // Reko is an Ereignis-level function first and an incident assignment second:
    // `isReko` is set from the event's special functions, while `assignedReko`
    // needs an assignment row on a specific incident. A Reko-Offizier who has not
    // been sent anywhere yet has the flag and no incident — and produced exactly
    // nothing when clicked, because the loop above found no binding to list.
    // Same shape as the Fahrer below: the incident when there is one, the bare
    // function when there is not.
    if (person.isReko && !bindings.some((b) => b.key.startsWith("reko-"))) {
      bindings.push({
        key: "fn-reko",
        kind: "function",
        targetId: null,
        label: tCommon('reko'),
        detail: tCommon('specialFunctionNoIncident'),
      })
    }
    // Station functions. They bind a person as hard as an incident does, and
    // they are exactly the rows whose click used to do nothing at all.
    if (person.isDriver) {
      const drivenOp = person.driverVehicleName
        ? operations.find((op) => op.vehicles.includes(person.driverVehicleName!))
        : undefined
      bindings.push({
        key: "fn-driver",
        kind: drivenOp ? "incident" : "function",
        targetId: drivenOp?.id ?? null,
        label: person.driverVehicleName || tCommon('driver'),
        detail: drivenOp ? getIncidentRefLabel(drivenOp, 60) : tCommon('specialFunctionNoIncident'),
      })
    }
    if (person.isMagazin) bindings.push({ key: "fn-magazin", kind: "function", targetId: null, label: tCommon('magazin'), detail: tCommon('specialFunctionNoIncident') })
    if (person.isTelefondienst) bindings.push({ key: "fn-telefon", kind: "function", targetId: null, label: tCommon('telefondienst'), detail: tCommon('specialFunctionNoIncident') })
    if (person.isKommandoposten) bindings.push({ key: "fn-kp", kind: "function", targetId: null, label: tCommon('kommandoposten'), detail: tCommon('specialFunctionNoIncident') })
    return bindings
  }, [operations, groups, getGroupResources, groupNames, tCommon])

  const collectMaterialBindings = useCallback((material: Material): ResourceBinding[] => {
    const bindings: ResourceBinding[] = []
    for (const op of operations) {
      if (op.materials.includes(material.id)) {
        bindings.push({
          key: `incident-${op.id}`,
          kind: "incident",
          targetId: op.id,
          label: getIncidentRefLabel(op, 60),
          detail: op.groupId ? groupNames.get(op.groupId) ?? "" : "",
        })
      }
    }
    for (const group of groups) {
      if (getGroupResources(group.id).materials.some((m) => m.resourceId === material.id)) {
        bindings.push({ key: `route-${group.id}`, kind: "route", targetId: group.id, label: group.name, detail: "" })
      }
    }
    return bindings
  }, [operations, groups, getGroupResources, groupNames])

  /**
   * Follow one binding: a card to scroll to, or the Auftrag sheet to open.
   *
   * A card the board's own search is currently hiding is not there to be scrolled
   * to, and `scrollToCard` would quietly find nothing — so the query that hides it
   * is cleared first. The rest of the "nothing happens" cases are gone at the
   * source: a binding that cannot be followed is not offered as a button.
   */
  const followBinding = useCallback((binding: ResourceBinding) => {
    if (binding.kind === "incident" && binding.targetId) {
      if (!filteredOperations.some((op) => op.id === binding.targetId)) setSearchQuery('')
      scrollToCard(binding.targetId)
      // …and open it. «Wo ist die Motorsäge?» is answered by the card, but the
      // operator asked in order to look at it. No modal on a narrow viewport:
      // that would cover the resource list they are working through.
      openIncidentDetail(binding.targetId, undefined, undefined, { allowModal: false })
    } else if (binding.kind === "route" && binding.targetId) {
      setAuftraegeFocusGroupId(binding.targetId)
      setActiveFooterSheet('auftraege')
    }
  }, [scrollToCard, filteredOperations, setSearchQuery, openIncidentDetail])

  /**
   * A sidebar person row answers «wo ist diese Person?» — always.
   *
   * Every early return here used to be a click that did nothing: a free person
   * failed the occupancy gate, and an occupied one with no listable binding (the
   * Reko-Offizier who is not on an incident yet) fell through the second. The
   * popover now opens in both cases and says so in words; only the one-incident
   * shortcut still jumps straight to the card, which is what operators know.
   */
  const handlePersonClick = (person: Person) => {
    const bindings = collectPersonBindings(person)
    if (bindings.length === 1 && isNavigableBinding(bindings[0]) && bindings[0].kind === "incident") {
      followBinding(bindings[0])
      return
    }
    setBindingsPopover({
      kind: "person",
      id: person.id,
      title: person.name,
      subtitle: person.role ?? "",
      bindings,
    })
  }

  /** Right-click on a sidebar row → the same `{ out_of_service }` PUT the
   *  Materialverwaltung sends. Set or not set; no reason, no cause list. */
  const handleToggleMaterialOutOfService = useCallback((material: Material, outOfService: boolean) => {
    void setMaterialOutOfService(material.id, outOfService)
  }, [setMaterialOutOfService])

  /** The device row answers the same question the person row does, including
   *  «nirgends» — a free device used to be a click into the void as well. */
  const handleMaterialClick = (material: Material) => {
    const bindings = collectMaterialBindings(material)
    // A device inside a module block is drawn by MaterialGroupBlock, which has no
    // anchor for the popover — there the click keeps jumping to the first
    // binding rather than opening a list nothing could position.
    const firstIncident = bindings.find((b) => b.kind === "incident")
    if ((bindings.length === 1 || material.groupId) && firstIncident) {
      followBinding(firstIncident)
      return
    }
    if (bindings.length === 1 && bindings[0].kind === "route") {
      followBinding(bindings[0])
      return
    }
    if (material.groupId) return
    setBindingsPopover({
      kind: "material",
      id: material.id,
      title: material.name,
      subtitle: material.category,
      bindings,
    })
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

  // «Rapport erfassen» is a write, so the caret belongs in the Kurzbericht.
  // Everything that merely opens the same tab to read (a Feldmeldung in the
  // bell, the green icon on a card that already has one) passes no section.
  const handleOpenRapport = useCallback((operationId: string) => {
    setActiveFooterSheet(null)
    openIncidentDetail(operationId, 'rapport', 'kurzbericht')
  }, [openIncidentDetail])

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
  // Check-In and Anzeige links live in the Links & QR sheet too (it mints them
  // itself), so the page no longer generates either.

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

  /** «Freigegeben werden: 2 Personen, MTW» — what a delete hands back, named in
   *  the confirmation. Null when the card carries nothing. */
  const deleteReleaseHint = useMemo(() => {
    if (!operationToDelete) return null
    const parts = [
      operationToDelete.crew.length ? tCommon('personCount', { count: operationToDelete.crew.length }) : null,
      operationToDelete.vehicles.length ? operationToDelete.vehicles.join(', ') : null,
    ].filter(Boolean)
    return parts.length ? tCommon('deleteIncidentReleases', { what: parts.join(', ') }) : null
  }, [operationToDelete, tCommon])

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
        {/* Übung: the same warning strip the wall display, the Karte and the
            Übungs-Steuerung carry, at the top edge of the WINDOW. Chrome, not
            content — it is fixed and out of flow, so it stays put while the board
            scrolls, lies over the Benachrichtigungen sidebar instead of pushing
            the board 3px below it, and never competes with a card's priority
            colour. */}
        {selectedEvent?.training_flag && <TrainingBand />}
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
                            /* The row answers where the person is — completely.
                               An anchor rather than a trigger: the card keeps
                               its own click handler, which decides between a
                               direct jump and this list. */
                            <Popover
                              key={person.id}
                              open={bindingsPopover?.kind === 'person' && bindingsPopover.id === person.id}
                              onOpenChange={(open) => { if (!open) setBindingsPopover(null) }}
                            >
                              <PopoverAnchor asChild>
                                <div>
                                  <DraggablePerson
                                    person={person}
                                    onClick={() => handlePersonClick(person)}
                                    assignmentCount={doubleBookedPersons.counts.get(person.name)}
                                    engagement={personEngagements.get(person.name)}
                                  />
                                </div>
                              </PopoverAnchor>
                              <PopoverContent align="start" side="right" className="w-80 p-3">
                                {bindingsPopover && (
                                  <BindingsPopoverBody
                                    state={bindingsPopover}
                                    onGo={followBinding}
                                    onClose={() => setBindingsPopover(null)}
                                  />
                                )}
                              </PopoverContent>
                            </Popover>
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
                      : null}
                </p>
                {/* One number and its counterpart, both from the SAME predicate
                    the list is filtered with (`summarizeRoster` → isPersonOccupied).
                    The counter used to read `status === "available"` straight off
                    the API while the list went through the helpers, so people on
                    Reko, driving, in the Magazin or on Telefondienst were hidden
                    above and counted as free here — «14 verfügbar» over nine
                    visible rows. Deliberately NOT broken down by function: this
                    is the line read in half a second, not a statistic. */}
                {isLoaded && !effectivePersonnelQuery && (
                  <div className="flex items-center justify-center gap-2 text-xs">
                    <span className="inline-flex items-center gap-1 font-semibold text-emerald-600 dark:text-emerald-400">
                      <Check className="size-3.5" />
                      {tCommon('rosterFree', { count: rosterSummary.free })}
                    </span>
                    <span className="text-muted-foreground">{tCommon('rosterOf', { total: rosterSummary.total })}</span>
                    {rosterSummary.bound > 0 && (
                      <Badge variant="outline" className="border-amber-200 text-amber-700 dark:border-amber-800/50 dark:text-amber-400">
                        {tCommon('rosterBound', { count: rosterSummary.bound })}
                      </Badge>
                    )}
                  </div>
                )}
              </div>
            </aside>
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
              className="absolute left-1 top-1/2 z-20 flex h-12 w-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:bg-secondary/60 hover:text-foreground"
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
              className="absolute right-1 top-3 z-20 hidden h-12 w-5 cursor-pointer items-center justify-center rounded-md border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:bg-secondary/60 hover:text-foreground 2xl:flex"
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
                      // «Nicht einsatzbereit» leaves the module blocks and the
                      // normal rows and sinks to the bottom of its depot: a
                      // module whose contents are half defective must not read
                      // as ready, and a dead device must not sit in the middle
                      // of the pickable ones.
                      const readyItems = items.filter(m => !m.outOfService)
                      const outOfServiceItems = items.filter(m => m.outOfService)
                      const ungroupedItems = readyItems.filter(m => !m.groupId)
                      const groupedItems = new Map<string, Material[]>()
                      for (const m of readyItems.filter(m => m.groupId)) {
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
                            {/* Ungrouped materials, then the ones that cannot go out */}
                            {[...ungroupedItems, ...outOfServiceItems].map((material) => (
                              <MaterialSidebarRow
                                key={material.id}
                                material={material}
                                onClick={() => handleMaterialClick(material)}
                                onToggleOutOfService={handleToggleMaterialOutOfService}
                                bindingsPopover={bindingsPopover}
                                onCloseBindings={() => setBindingsPopover(null)}
                                onGoBinding={followBinding}
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
                      : null}
                </p>
                {/* Same helper as the list filter — see the crew footer above. */}
                {isLoaded && !effectiveMaterialQuery && (
                  <div className="flex items-center justify-center gap-2 text-xs">
                    <span className="inline-flex items-center gap-1 font-semibold text-emerald-600 dark:text-emerald-400">
                      <Check className="size-3.5" />
                      {tCommon('rosterFree', { count: materialSummary.free })}
                    </span>
                    <span className="text-muted-foreground">{tCommon('rosterOf', { total: materialSummary.total })}</span>
                    {materialSummary.bound > 0 && (
                      <Badge variant="outline" className="border-amber-200 text-amber-700 dark:border-amber-800/50 dark:text-amber-400">
                        {tCommon('rosterBound', { count: materialSummary.bound })}
                      </Badge>
                    )}
                  </div>
                )}
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
                      onOpenRekoPicker={() => setRekoPickerOpen(true)}
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

                Order is the contract. Items overflow from the end, so the pill
                an operator reaches for on a live board (Links & QR) is the
                last to go. */}
            <ToolbarOverflow
              moreLabel={tDash('more')}
              moreTitle={(count) => tDash('moreTitle', { count })}
              items={[
                {
                  // Every link the board hands out, in ONE sheet (decision 29).
                  // Was five pills — Check-In, Reko, Feld, Anzeige, Alarm —
                  // each opening its own sheet that did the same three things.
                  // Check-In and Anzeige held out for a while as pills of their
                  // own (the Appell; the display picker), but the Appell is a
                  // row in this sheet now and the display share is just the
                  // base /display link, so one pill covers everything.
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
        // «Nicht einsatzbereit» no longer rides along here — the dialog reads
        // it from the operations context itself, for every caller.
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


      {/* The one link sheet the footer opens: Check-In (with the Appell row),
          Feld-Code + Feld link, Alarm, and the base /display share. */}
      <LinksQrSheet
        open={linksSheetOpen}
        onOpenChange={(open) => !open && activeFooterSheet === 'links' && setActiveFooterSheet(null)}
        eventId={selectedEvent?.id ?? null}
        printerEnabled={printerEnabled}
        onOpenAttendance={openAttendance}
      />

      {/* The Appell itself */}
      {selectedEvent && (
        <AttendanceModal
          open={attendanceOpen}
          onOpenChange={setAttendanceOpen}
          eventId={selectedEvent.id}
          eventName={selectedEvent.name}
          assignmentLabelFor={assignmentLabelForPerson}
          onAttendanceChange={refreshPersonnel}
        />
      )}

      {/* The Checkliste's Reko picker — page-owned, see `rekoPickerOpen`. */}
      <RekoPickerDialog
        open={rekoPickerOpen}
        onOpenChange={setRekoPickerOpen}
        eventId={selectedEvent?.id ?? null}
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

      {/* Delete Operation Confirmation Dialog. The description names what the
          deletion also RELEASES — a card that was never an incident is usually
          one somebody had already put people and a vehicle on. */}
      <DeleteConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title={tCommon('deleteIncidentTitle')}
        description={[
          tCommon('deleteIncidentDescription', { name: operationToDelete ? (formatLocation(operationToDelete.location ?? '') || getIncidentTypeLabel(operationToDelete.incidentType)) : '' }),
          deleteReleaseHint,
        ].filter(Boolean).join(' ')}
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
        onOpenDetail={(operationId, tab, section) => {
          openIncidentDetail(operationId, tab, section)
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
