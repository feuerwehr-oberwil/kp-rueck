"use client"

import { useEffect, useRef, useState, memo, useSyncExternalStore } from "react"
import { useTranslations } from "next-intl"
import { dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { type Operation, type Material } from "@/lib/contexts/operations-context"
import { DraggableOperation } from "./draggable-operation"
import { type CardViewSettings } from "@/lib/card-view"
import type { OperationDetailSection, OperationDetailTab } from "@/lib/hooks/use-operation-detail-shortcuts"
import { ageLevel, COLUMN_HEADER_CLASS } from "@/lib/kanban-utils"
import { getIncidentLocationLabel } from "@/lib/incident-types"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { ArrowUpDown, ChevronLeft, ChevronRight } from "lucide-react"
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
  /** A card was clicked. `tab`/`section` are the block that was hit — the card
   *  routes now (Reko block → Reko tab, a resource row → Übersicht/Ressourcen);
   *  undefined means "the card as a whole". Plumbing only, see
   *  draggable-operation.tsx. */
  onCardClick: (operation: Operation, tab?: OperationDetailTab, section?: OperationDetailSection) => void
  onCardSelect?: (operation: Operation, tab?: OperationDetailTab, section?: OperationDetailSection) => void
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
  /** Which card blocks this device shows — plumbing only, see lib/card-view.ts. */
  cardView?: CardViewSettings
  printerEnabled?: boolean
  /** Vehicle name → driver, loaded ONCE on the board and threaded down. Per-card
   *  it would be one roster fetch per card. */
  vehicleDrivers?: ReadonlyMap<string, string>
  doubleBookedCrewNames?: Set<string>
  /** False for viewers: cards render without a drag source (read-only board). */
  canDrag?: boolean
  /** Forwarded to cards: notifies the sync layer of drag start/end. */
  onDragActiveChange?: (dragging: boolean) => void
  /** Editor-only: apply a one-shot persisted sort to this column. */
  onSort?: (columnId: string, key: 'priority' | 'age' | 'auftrag' | 'type') => void
  /** Folded away by the operator. The board owns this (one per-device set for
   *  all seven columns, see BOARD_COLUMN_COLLAPSE_KEY) rather than each column
   *  keeping its own key — a fold is a statement about the whole board's width. */
  isCollapsed?: boolean
  /** Fold / unfold. Absent = this board does not offer folding at all. */
  onToggleCollapsed?: (columnId: string) => void
}

// Custom comparison: skip re-render if operations for this column haven't actually changed
function arePropsEqual(prev: DroppableColumnProps, next: DroppableColumnProps): boolean {
  // Always re-render if non-operation props changed
  if (
    prev.column !== next.column ||
    prev.highlightedOperationId !== next.highlightedOperationId ||
    prev.selectedOperationId !== next.selectedOperationId ||
    prev.hoveredOperationId !== next.hoveredOperationId ||
    // Identity is enough here — the store hands out one stable object per
    // settings value, and the card runs the field-by-field comparison anyway.
    prev.cardView !== next.cardView ||
    prev.printerEnabled !== next.printerEnabled ||
    prev.vehicleDrivers !== next.vehicleDrivers ||
    prev.materials !== next.materials ||
    prev.doubleBookedCrewNames !== next.doubleBookedCrewNames ||
    prev.canDrag !== next.canDrag ||
    prev.onSort !== next.onSort ||
    prev.isCollapsed !== next.isCollapsed ||
    prev.onToggleCollapsed !== next.onToggleCollapsed
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
  cardView,
  printerEnabled,
  vehicleDrivers,
  doubleBookedCrewNames,
  canDrag,
  onDragActiveChange,
  onSort,
  isCollapsed: isFoldedByOperator = false,
  onToggleCollapsed,
}: DroppableColumnProps) {
  const t = useTranslations('kanban')
  const tDash = useTranslations('kanban.dashboard')
  const columnTitle = t(`columns.${column.id}`)
  /** What accepts a dropped card: the column body when the column is open, the
   *  folded strip when it is not. One ref for both — they are two different
   *  elements and only ever one of them is mounted, so a callback ref keeps the
   *  drop-target effect honest without branching on element type. */
  const dropRef = useRef<HTMLElement | null>(null)
  const [isOver, setIsOver] = useState(false)
  const [isManuallyExpanded, setIsManuallyExpanded] = useState(false)
  const isLargeScreen = useIsLargeScreen()

  // Only a *click* scrolls; a column that was already folded at load must not
  // yank the board sideways on every mount.
  const keepInViewRef = useRef(false)
  const requestKeepInView = () => {
    keepInViewRef.current = true
  }

  const isEmpty = operations.length === 0
  // Two ways a column ends up narrow, and the operator's wins:
  //  1. they folded it (persisted, whole-board set — `isFoldedByOperator`);
  //  2. it is empty and the board is too narrow to spend a column on nothing.
  //
  // `isOver` is deliberately NOT in here any more. It used to expand an
  // auto-folded column the moment a card was dragged over it, which swapped the
  // strip for a full column mid-drag — the drop target unmounted under the
  // pointer and re-registered somewhere else. The strip is a real drop target
  // instead (it lights up), so a drag can land on a folded column
  // without the board re-laying itself out under the cursor.
  const isCollapsed = isFoldedByOperator || (isEmpty && !isManuallyExpanded && !isLargeScreen)

  /** Fold from the open header. */
  const collapse = () => {
    requestKeepInView()
    onToggleCollapsed?.(column.id)
  }

  /** Unfold from the strip. Clears BOTH reasons a column can be narrow — an
   *  empty column that the operator had also folded would otherwise stay a
   *  strip and the click would read as «nothing happened». */
  const expand = () => {
    requestKeepInView()
    if (isFoldedByOperator) onToggleCollapsed?.(column.id)
    setIsManuallyExpanded(true)
  }

  // Something in here has sat past the board's own warning threshold. It stays
  // visible on the folded strip: a column that hides its overdue incident
  // behind a title is exactly what folding must not do. The dot alone only says
  // "something", which is the one thing nobody can act on — so it carries the
  // names of the incidents that tripped it, up to three, on hover. Same
  // treatment as the wall board.
  const overdueOps = isCollapsed
    ? operations.filter((op) => ageLevel(op.statusChangedAt || op.dispatchTime) !== "normal")
    : []
  const overdueTitle = overdueOps.length > 0
    ? t('column.overdueTitle', {
        count: overdueOps.length,
        titles: overdueOps.slice(0, 3).map((op) => getIncidentLocationLabel(op)).join(', ')
          + (overdueOps.length > 3 ? ` ${t('column.overdueMore', { count: overdueOps.length - 3 })}` : ''),
      })
    : undefined

  // Folding a column changes its width by hundreds of pixels, which shoves every
  // column after it sideways — so the one you just clicked can end up outside the
  // scrollport and the click reads as "the column disappeared". «Abgeschlossen»
  // showed this worst, sitting at the far right, but an empty column folding in
  // the middle of a wide board does it too.
  //
  // BOTH directions, not just opening: closing moves the board just as far.
  // And a DOM query rather than a ref, because the collapsed strip and the
  // expanded column are two different elements — the ref that survives the
  // toggle is whichever one is not mounted. `data-column` is on both.
  useEffect(() => {
    if (!keepInViewRef.current) return
    keepInViewRef.current = false
    document
      .querySelector(`[data-column="${column.id}"]`)
      // `nearest`, not `end`: bring it back only as far as it takes to be
      // visible, so a column that never left the viewport does not jump.
      ?.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' })
  }, [isCollapsed, column.id])

  // The manual expand only ever answers the auto-fold, so it is spent the
  // moment the column has cards of its own. An operator fold is untouched by
  // this — it lives in the board's persisted set, not here.
  useEffect(() => {
    if (!isEmpty) setIsManuallyExpanded(false)
  }, [isEmpty])

  useEffect(() => {
    const element = dropRef.current
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

  // Folded view — a narrow strip, and still a full drop target: an incident can
  // be dragged straight onto it (the strip lights up on drag-over)
  // without the column having to unfold first.
  //
  // A real <button>, so the fold is reachable and reversible from the keyboard
  // — the strip is the ONLY way back for a column the operator has folded.
  if (isCollapsed) {
    return (
      <button
        type="button"
        ref={(el) => { dropRef.current = el }}
        data-column={column.id}
        className={cn(
          // Width is CONSTANT: hover and drag-over speak through colour only.
          // The strip used to grow to w-16 on both, which shifted every column
          // to its right whenever the pointer crossed it — nothing on the board
          // may move because the pointer moved.
          "flex w-12 flex-shrink-0 cursor-pointer flex-col items-center gap-2 rounded-lg border border-border py-3 transition-colors hover:bg-foreground/10",
          column.color,
          isOver && "drop-zone-active"
        )}
        onClick={expand}
        aria-expanded={false}
        aria-label={t('column.ariaLabelWithCount', { title: columnTitle, count: operations.length })}
        title={t('column.collapsedHint', { title: columnTitle, count: operations.length })}
      >
        <ChevronRight className="size-4 text-muted-foreground" />
        {/* The count is the whole safety case for folding: the strip must never
            let the board hide that something is sitting in here. Same badge as
            the open header, not a quieter one. */}
        <span className="relative inline-flex items-center justify-center h-6 min-w-6 px-1.5 rounded-md bg-foreground/10 text-foreground text-xs font-bold tabular-nums">
          {operations.length}
          {overdueTitle && (
            <span
              title={overdueTitle}
              aria-label={overdueTitle}
              className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-red-500"
            />
          )}
        </span>
        {/* Same title as the expanded header, so the same treatment. */}
        <span className={cn(COLUMN_HEADER_CLASS, "[writing-mode:vertical-rl]")}>
          {columnTitle}
        </span>
      </button>
    )
  }

  return (
    <div data-column={column.id} className="flex min-w-[320px] max-w-[420px] flex-1 flex-col transition-all">
      <div className={cn(
        // py-2, not py-3: the header carries one line of text and three small
        // controls, and every pixel it takes is a pixel off the column body.
        "mb-2 rounded-lg border border-border px-3 py-2 transition-all",
        column.color
      )}>
        <div className="flex items-center justify-between gap-1">
          {/* The fold handle sits left of the title, where the wall board puts
              it — same disclosure chevron, same place, so the two screens teach
              one gesture. Its own <button> rather than the whole header, which
              the wall board can afford but this one cannot: the header also
              carries the sort menu, and a button inside a button is not a
              control. */}
          {onToggleCollapsed && (
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={collapse}
              aria-expanded
              title={t('column.collapse')}
              aria-label={`${columnTitle}: ${t('column.collapse')}`}
            >
              <ChevronLeft className="size-3.5" />
            </Button>
          )}
          {/* min-w-0 + truncate: the title is the only part that may give way. A long
              column name must not push the sort/collapse controls off the header. */}
          {/* Treatment from COLUMN_HEADER_CLASS — see there for why caps but quiet.
              Shared with both display boards so one column cannot look like two
              different things on two screens. */}
          <h2 className={cn("min-w-0 flex-1 truncate", COLUMN_HEADER_CLASS)} title={columnTitle}>{columnTitle}</h2>
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
            {/* No overdue dot here, unlike the folded strip and the wall board:
                every card in an open column already carries its own age chip,
                and a second signal for the same fact is noise. */}
            <span className="inline-flex items-center justify-center h-6 min-w-6 px-1.5 rounded-md bg-foreground/10 text-foreground text-xs font-bold tabular-nums">
              {operations.length}
            </span>
          </div>
        </div>
      </div>

      <div
        ref={(el) => { dropRef.current = el }}
        data-board-scroll
        className={cn(
          // `overscroll-y-contain`, NOT `overscroll-contain`: a column body with
          // `overflow-y: auto` has its `overflow-x: visible` computed to `auto`,
          // so it counts as a horizontal scroll container with nothing to
          // scroll. Containing BOTH axes made it swallow every horizontal
          // trackpad delta instead of chaining it to `#kanban-main`, which left
          // the board's own scrollbar as the only way to pan sideways.
          // Horizontal inset is px-1 (4px), not the old p-2: cards span the
          // column, and 4px is exactly what the card's drag-over cue needs —
          // ring-2 + ring-offset-2 sit outside the card's border box and this
          // container clips (overflow-y:auto computes overflow-x to auto, and a
          // box-shadow never scrolls). The right 4px doubles as the scrollbar
          // gutter so the bar does not sit on the cards.
          "flex-1 space-y-3 overflow-y-auto overscroll-y-contain py-2 px-1 rounded-lg transition-all min-h-[200px] relative",
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

        {/* Empty state. Plain text, no hover/cursor affordance: it used to be a
            button that folded the column, but nothing about it said so — it read
            as something clickable that "doesn't work". Folding lives on the
            header's own control, where it is labelled. */}
        {isEmpty && !isOver && (
          <div className="flex items-center justify-center h-32">
            <p className="text-sm text-muted-foreground/70 select-none">{t('column.empty')}</p>
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
                onClick={(tab, section) => onCardClick(operation, tab, section)}
                onSelect={(tab, section) => onCardSelect?.(operation, tab, section)}
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
                cardView={cardView}
                printerEnabled={printerEnabled}
                vehicleDrivers={vehicleDrivers}
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
