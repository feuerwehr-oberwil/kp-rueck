"use client"

import { useEffect, useRef, useState, memo, useSyncExternalStore } from "react"
import { useTranslations } from "next-intl"
import { dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { type Operation, type Material } from "@/lib/contexts/operations-context"
import { DraggableOperation } from "./draggable-operation"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { ArrowUpDown } from "lucide-react"
import { SIDE_PANEL_MEDIA_QUERY } from "@/lib/layout-breakpoints"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

// On large screens (2xl+), columns stay expanded — collapsing only helps on smaller screens
const subscribeLargeScreen = (cb: () => void) => {
  const mql = window.matchMedia(SIDE_PANEL_MEDIA_QUERY)
  mql.addEventListener("change", cb)
  return () => mql.removeEventListener("change", cb)
}
const getIsLargeScreen = () => window.matchMedia(SIDE_PANEL_MEDIA_QUERY).matches
const getIsLargeScreenServer = () => false

function useIsLargeScreen() {
  return useSyncExternalStore(subscribeLargeScreen, getIsLargeScreen, getIsLargeScreenServer)
}

interface DroppableColumnProps {
  column: {
    id: string
    title: string
    status: string[]
    color: string
    collapsible?: boolean
  }
  operations: Operation[]
  onRemoveCrew: (operationId: string, crewName: string) => void
  onRemoveMaterial: (operationId: string, materialId: string) => void
  onRemoveVehicle: (operationId: string, vehicleName: string) => void
  onToggleDriverStay?: (operationId: string, vehicleName: string) => void
  onRemoveReko?: (operationId: string) => void
  onCardClick: (operation: Operation) => void
  onCardSelect?: (operation: Operation) => void
  onCardHover: (opId: string | null) => void
  highlightedOperationId: string | null
  selectedOperationId?: string | null
  hoveredOperationId?: string | null
  isDraggingRef: React.MutableRefObject<boolean>
  materials: Material[]
  formatLocation: (address: string) => string
  setOperationRef?: (id: string, element: HTMLDivElement | null) => void
  onAssignResource?: (resourceType: 'crew' | 'vehicles' | 'materials', operationId: string) => void
  onAssignReko?: (operationId: string) => void
  onToggleNachbarhilfe?: (operationId: string) => void
  onToggleAmWarten?: (operationId: string) => void
  onToggleZuFuss?: (operationId: string) => void
  /** Editor-only: archive the incident (status → complete) directly from the card. */
  onRequestComplete?: (operationId: string) => void
  /** Editor-only: open the "Ressourcen übertragen" dialog for an incident. */
  onTransfer?: (operationId: string) => void
  /** Editor-only: open the Auftrag picker to distribute an incident into a route. */
  onDistributeToAuftrag?: (operationId: string) => void
  showMeldung?: boolean
  showReko?: boolean
  printerEnabled?: boolean
  doubleBookedCrewNames?: Set<string>
  /** False for viewers: cards render without a drag source (read-only board). */
  canDrag?: boolean
  /** Forwarded to cards: notifies the sync layer of drag start/end. */
  onDragActiveChange?: (dragging: boolean) => void
  /** Editor-only: apply a one-shot persisted sort to this column. */
  onSort?: (columnId: string, key: 'priority' | 'age' | 'auftrag' | 'type') => void
}

// Custom comparison: skip re-render if operations for this column haven't actually changed
function arePropsEqual(prev: DroppableColumnProps, next: DroppableColumnProps): boolean {
  // Always re-render if non-operation props changed
  if (
    prev.column !== next.column ||
    prev.highlightedOperationId !== next.highlightedOperationId ||
    prev.selectedOperationId !== next.selectedOperationId ||
    prev.hoveredOperationId !== next.hoveredOperationId ||
    prev.showMeldung !== next.showMeldung ||
    prev.showReko !== next.showReko ||
    prev.printerEnabled !== next.printerEnabled ||
    prev.materials !== next.materials ||
    prev.doubleBookedCrewNames !== next.doubleBookedCrewNames ||
    prev.canDrag !== next.canDrag ||
    prev.onSort !== next.onSort
  ) {
    return false
  }

  // Deep compare operations array for this column
  if (prev.operations.length !== next.operations.length) return false
  for (let i = 0; i < prev.operations.length; i++) {
    const a = prev.operations[i]
    const b = next.operations[i]
    if (
      a.id !== b.id ||
      a.status !== b.status ||
      a.priority !== b.priority ||
      a.location !== b.location ||
      a.incidentType !== b.incidentType ||
      a.crew.length !== b.crew.length ||
      a.vehicles.length !== b.vehicles.length ||
      a.materials.length !== b.materials.length ||
      a.notes !== b.notes ||
      a.contact !== b.contact ||
      a.hasCompletedReko !== b.hasCompletedReko ||
      a.nachbarhilfe !== b.nachbarhilfe ||
      a.zuFuss !== b.zuFuss ||
      a.assignedReko?.id !== b.assignedReko?.id
    ) {
      return false
    }
    // Check crew members changed
    for (let j = 0; j < a.crew.length; j++) {
      if (a.crew[j] !== b.crew[j]) return false
    }
    // Check vehicles changed
    for (let j = 0; j < a.vehicles.length; j++) {
      if (a.vehicles[j] !== b.vehicles[j]) return false
      if (a.vehicleDriverStay?.get(a.vehicles[j]) !== b.vehicleDriverStay?.get(b.vehicles[j])) return false
    }
    // Check materials changed
    for (let j = 0; j < a.materials.length; j++) {
      if (a.materials[j] !== b.materials[j]) return false
    }
  }

  return true
}

export const DroppableColumn = memo(function DroppableColumn({
  column,
  operations,
  onRemoveCrew,
  onRemoveMaterial,
  onRemoveVehicle,
  onToggleDriverStay,
  onRemoveReko,
  onCardClick,
  onCardSelect,
  onCardHover,
  highlightedOperationId,
  selectedOperationId,
  hoveredOperationId,
  isDraggingRef,
  materials,
  formatLocation,
  setOperationRef,
  onAssignResource,
  onAssignReko,
  onToggleNachbarhilfe,
  onToggleAmWarten,
  onToggleZuFuss,
  onRequestComplete,
  onTransfer,
  onDistributeToAuftrag,
  showMeldung,
  showReko,
  printerEnabled,
  doubleBookedCrewNames,
  canDrag,
  onDragActiveChange,
  onSort,
}: DroppableColumnProps) {
  const t = useTranslations('kanban')
  const tDash = useTranslations('kanban.dashboard')
  const columnTitle = t(`columns.${column.id}`)
  const ref = useRef<HTMLDivElement>(null)
  const [isOver, setIsOver] = useState(false)
  const [isManuallyExpanded, setIsManuallyExpanded] = useState(false)
  const isLargeScreen = useIsLargeScreen()

  // Collapsible columns (like Abgeschlossen) start collapsed and persist via localStorage
  const isCollapsibleColumn = column.collapsible === true
  const [isCollapsibleOpen, setIsCollapsibleOpen] = useState(() => {
    if (!isCollapsibleColumn) return true
    if (typeof window === 'undefined') return false
    return localStorage.getItem(`column-collapsed-${column.id}`) === 'open'
  })

  const toggleCollapsible = () => {
    const next = !isCollapsibleOpen
    setIsCollapsibleOpen(next)
    localStorage.setItem(`column-collapsed-${column.id}`, next ? 'open' : 'collapsed')
  }

  const isEmpty = operations.length === 0
  const isCollapsed = isCollapsibleColumn
    ? !isCollapsibleOpen
    : (isEmpty && !isOver && !isManuallyExpanded && !isLargeScreen)

  // Reset manual expand when column gets operations (non-collapsible only)
  useEffect(() => {
    if (!isEmpty && !isCollapsibleColumn) setIsManuallyExpanded(false)
  }, [isEmpty, isCollapsibleColumn])

  useEffect(() => {
    const element = ref.current
    if (!element) return

    return dropTargetForElements({
      element,
      canDrop: ({ source }) => {
        return source.data.type === "operation"
      },
      getData: () => ({ type: "column", columnId: column.id }),
      onDragEnter: () => setIsOver(true),
      onDragLeave: () => setIsOver(false),
      onDrop: () => setIsOver(false),
    })
  }, [column.id, isCollapsed])

  // Collapsed view — narrow strip with vertical title
  if (isCollapsed) {
    return (
      <div
        ref={ref}
        data-column={column.id}
        className={cn(
          "flex w-12 flex-shrink-0 flex-col items-center rounded-lg border border-border cursor-pointer transition-all hover:w-16 hover:bg-muted/30",
          column.color,
          isOver && "drop-zone-active w-16"
        )}
        onClick={() => isCollapsibleColumn ? toggleCollapsible() : setIsManuallyExpanded(true)}
        role="region"
        aria-label={t('column.ariaLabelWithCount', { title: columnTitle, count: operations.length })}
      >
        <div className="flex flex-col items-center gap-2 py-3">
          <span className="text-xs font-semibold uppercase text-muted-foreground [writing-mode:vertical-lr] [text-orientation:mixed]">
            {columnTitle}
          </span>
          <span className="text-xs text-muted-foreground/60 font-mono">{operations.length}</span>
        </div>
      </div>
    )
  }

  return (
    <div data-column={column.id} className="flex min-w-[320px] max-w-[420px] flex-1 flex-col transition-all">
      <div className={cn(
        "mb-2 rounded-lg border border-border px-3 py-3 transition-all",
        column.color
      )}>
        <div className="flex items-center justify-between">
          {/* min-w-0 + truncate: the title is the only part that may give way. A long
              column name must not push the sort/collapse controls off the header. */}
          <h2 className="min-w-0 truncate text-sm font-bold uppercase tracking-tight text-foreground" title={columnTitle}>{columnTitle}</h2>
          <div className="flex items-center gap-2">
            {onSort && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    title={tDash('sort.label')}
                    aria-label={`${columnTitle}: ${tDash('sort.label')}`}
                  >
                    <ArrowUpDown className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>{tDash('sort.label')}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => onSort(column.id, 'priority')}>{tDash('sort.priority')}</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onSort(column.id, 'age')}>{tDash('sort.age')}</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onSort(column.id, 'auftrag')}>{tDash('sort.auftrag')}</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onSort(column.id, 'type')}>{tDash('sort.type')}</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <span className="inline-flex items-center justify-center h-6 min-w-6 px-1.5 rounded-md bg-foreground/10 text-foreground text-xs font-bold tabular-nums">
              {operations.length}
            </span>
            {isCollapsibleColumn && (
              <button
                onClick={toggleCollapsible}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors px-1.5 py-0.5 rounded hover:bg-muted"
                title={t('column.collapse')}
              >
                ←
              </button>
            )}
          </div>
        </div>
      </div>

      <div
        ref={ref}
        data-board-scroll
        className={cn(
          // `overscroll-y-contain`, NOT `overscroll-contain`: a column body with
          // `overflow-y: auto` has its `overflow-x: visible` computed to `auto`,
          // so it counts as a horizontal scroll container with nothing to
          // scroll. Containing BOTH axes made it swallow every horizontal
          // trackpad delta instead of chaining it to `#kanban-main`, which left
          // the board's own scrollbar as the only way to pan sideways.
          "flex-1 space-y-3 overflow-y-auto overscroll-y-contain p-2 rounded-lg transition-all min-h-[200px] relative",
          isOver && operations.length === 0 && "drop-zone-active"
        )}
        role="region"
        aria-label={t('column.ariaLabel', { title: columnTitle })}
      >
        {/* Empty state hint when dragging over */}
        {isOver && operations.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-sm text-foreground/70 font-medium">{t('column.dropHere')}</p>
          </div>
        )}

        {/* Empty state with collapse hint */}
        {isEmpty && !isOver && (
          <div className="flex items-center justify-center h-32">
            <button
              onClick={() => setIsManuallyExpanded(false)}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {t('column.empty')}
            </button>
          </div>
        )}

        {/* flex gap instead of space-y: gap is applied by the container and
            can't be lost to sibling-selector/margin edge cases when cards are
            re-parented by live (websocket) status moves */}
        <div className="flex flex-col gap-3">
          {operations.map((operation, index) => (
            <div
              key={operation.id}
              ref={(el) => setOperationRef?.(operation.id, el)}
            >
              <DraggableOperation
                operation={operation}
                onRemoveCrew={(crewName) => onRemoveCrew(operation.id, crewName)}
                onRemoveMaterial={(materialId) => onRemoveMaterial(operation.id, materialId)}
                onRemoveVehicle={(vehicleName) => onRemoveVehicle(operation.id, vehicleName)}
                onToggleDriverStay={onToggleDriverStay ? (vehicleName) => onToggleDriverStay(operation.id, vehicleName) : undefined}
                onRemoveReko={onRemoveReko ? () => onRemoveReko(operation.id) : undefined}
                onClick={() => onCardClick(operation)}
                onSelect={() => onCardSelect?.(operation)}
                onHover={onCardHover}
                isHighlighted={highlightedOperationId === operation.id}
                isSelected={selectedOperationId === operation.id}
                isKeyboardFocused={hoveredOperationId === operation.id}
                isDraggingRef={isDraggingRef}
                materials={materials}
                index={index}
                formatLocation={formatLocation}
                onAssignResource={onAssignResource}
                onAssignReko={onAssignReko ? () => onAssignReko(operation.id) : undefined}
                onToggleNachbarhilfe={onToggleNachbarhilfe ? () => onToggleNachbarhilfe(operation.id) : undefined}
                onToggleAmWarten={onToggleAmWarten ? () => onToggleAmWarten(operation.id) : undefined}
                onToggleZuFuss={onToggleZuFuss ? () => onToggleZuFuss(operation.id) : undefined}
                onRequestComplete={onRequestComplete ? () => onRequestComplete(operation.id) : undefined}
                onTransfer={onTransfer ? () => onTransfer(operation.id) : undefined}
                onDistributeToAuftrag={onDistributeToAuftrag ? () => onDistributeToAuftrag(operation.id) : undefined}
                showMeldung={showMeldung}
                showReko={showReko}
                printerEnabled={printerEnabled}
                doubleBookedCrewNames={doubleBookedCrewNames}
                canDrag={canDrag}
                onDragActiveChange={onDragActiveChange}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}, arePropsEqual)
