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
  }
  operations: Operation[]
  onRemoveCrew: (operationId: string, crewName: string) => void
  onRemoveMaterial: (operationId: string, materialId: string) => void
  onRemoveVehicle: (operationId: string, vehicleName: string) => void
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
  showMeldung?: boolean
  printerEnabled?: boolean
}

export const DroppableColumn = memo(function DroppableColumn({
  column,
  operations,
  onRemoveCrew,
  onRemoveMaterial,
  onRemoveVehicle,
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
  showMeldung,
  printerEnabled,
}: DroppableColumnProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [isOver, setIsOver] = useState(false)
  const [isManuallyExpanded, setIsManuallyExpanded] = useState(false)
  const isLargeScreen = useIsLargeScreen()

  const isEmpty = operations.length === 0
  const isCollapsed = isEmpty && !isOver && !isManuallyExpanded && !isLargeScreen

  // Reset manual expand when column gets operations
  useEffect(() => {
    if (!isEmpty) setIsManuallyExpanded(false)
  }, [isEmpty])

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
        onClick={() => setIsManuallyExpanded(true)}
        role="region"
        aria-label={`${column.title} column (leer)`}
      >
        <div className="flex flex-col items-center gap-2 py-3">
          <span className="text-xs font-semibold text-muted-foreground [writing-mode:vertical-lr] [text-orientation:mixed]">
            {column.title}
          </span>
          <span className="text-xs text-muted-foreground/60 font-mono">0</span>
        </div>
      </div>
    )
  }

  return (
    <div data-column={column.id} className="flex min-w-[320px] max-w-[420px] flex-1 flex-col transition-all">
      <div className={cn(
        "mb-2 rounded-lg border border-border px-3 py-2 transition-all",
        column.color
      )}>
        <h2 className="text-balance text-sm font-semibold text-foreground">{column.title}</h2>
        <p className="text-xs text-muted-foreground mt-0.5">{operations.length} Einsätze</p>
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
                showMeldung={showMeldung}
                printerEnabled={printerEnabled}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
})
