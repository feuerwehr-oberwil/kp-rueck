"use client"

import { useEffect, useRef, useState, memo, useSyncExternalStore } from "react"
import { dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { type Operation, type Material } from "@/lib/contexts/operations-context"
import { columns } from "@/lib/kanban-utils"
import { DraggableOperation } from "./draggable-operation"
import { cn } from "@/lib/utils"

// On large screens (2xl+), columns stay expanded — collapsing only helps on smaller screens
const largeScreenQuery = "(min-width: 1536px)"
const subscribeLargeScreen = (cb: () => void) => {
  const mql = window.matchMedia(largeScreenQuery)
  mql.addEventListener("change", cb)
  return () => mql.removeEventListener("change", cb)
}
const getIsLargeScreen = () => window.matchMedia(largeScreenQuery).matches
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
  showMeldung?: boolean
  printerEnabled?: boolean
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
    prev.printerEnabled !== next.printerEnabled ||
    prev.materials !== next.materials
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
  showMeldung,
  printerEnabled,
}: DroppableColumnProps) {
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
        aria-label={`${column.title} column (${operations.length} Einsätze)`}
      >
        <div className="flex flex-col items-center gap-2 py-3">
          <span className="text-xs font-semibold text-muted-foreground [writing-mode:vertical-lr] [text-orientation:mixed]">
            {column.title}
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
          <h2 className="text-sm font-bold tracking-tight text-foreground uppercase">{column.title}</h2>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center justify-center h-6 min-w-6 px-1.5 rounded-md bg-foreground/10 text-foreground text-xs font-bold tabular-nums">
              {operations.length}
            </span>
            {isCollapsibleColumn && (
              <button
                onClick={toggleCollapsible}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors px-1.5 py-0.5 rounded hover:bg-muted"
                title="Spalte einklappen"
              >
                ←
              </button>
            )}
          </div>
        </div>
      </div>

      <div
        ref={ref}
        className={cn(
          "flex-1 space-y-3 overflow-y-auto p-2 rounded-lg transition-all min-h-[200px] relative",
          isOver && operations.length === 0 && "drop-zone-active"
        )}
        role="region"
        aria-label={`${column.title} column`}
      >
        {/* Empty state hint when dragging over */}
        {isOver && operations.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-sm text-foreground/70 font-medium">Einsatz hier ablegen</p>
          </div>
        )}

        {/* Empty state with collapse hint */}
        {isEmpty && !isOver && (
          <div className="flex items-center justify-center h-32">
            <button
              onClick={() => setIsManuallyExpanded(false)}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Keine Einsätze
            </button>
          </div>
        )}

        <div className="space-y-3">
          {operations.map((operation, index) => (
            <div
              key={operation.id}
              ref={(el) => setOperationRef?.(operation.id, el)}
            >
              <DraggableOperation
                operation={operation}
                columnColor={column.color}
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
                columnOperations={operations}
                formatLocation={formatLocation}
                onAssignResource={onAssignResource}
                onAssignReko={onAssignReko ? () => onAssignReko(operation.id) : undefined}
                onToggleNachbarhilfe={onToggleNachbarhilfe ? () => onToggleNachbarhilfe(operation.id) : undefined}
                onToggleAmWarten={onToggleAmWarten ? () => onToggleAmWarten(operation.id) : undefined}
                onToggleZuFuss={onToggleZuFuss ? () => onToggleZuFuss(operation.id) : undefined}
                showMeldung={showMeldung}
                printerEnabled={printerEnabled}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}, arePropsEqual)
