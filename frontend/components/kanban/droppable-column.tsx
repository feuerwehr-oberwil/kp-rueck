"use client"

import { useEffect, useRef, useState } from "react"
import { dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { type Operation, type Material } from "@/lib/contexts/operations-context"
import { columns } from "@/lib/kanban-utils"
import { DraggableOperation } from "./draggable-operation"

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
  onCardClick: (operation: Operation) => void
  onCardHover: (opId: string | null) => void
  highlightedOperationId: string | null
  hoveredOperationId?: string | null
  isDraggingRef: React.MutableRefObject<boolean>
  materials: Material[]
  formatLocation: (address: string) => string
  setOperationRef?: (id: string, element: HTMLDivElement | null) => void
}

export function DroppableColumn({
  column,
  operations,
  onRemoveCrew,
  onRemoveMaterial,
  onRemoveVehicle,
  onCardClick,
  onCardHover,
  highlightedOperationId,
  hoveredOperationId,
  isDraggingRef,
  materials,
  formatLocation,
  setOperationRef,
}: DroppableColumnProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [isOver, setIsOver] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (!element) return

    return dropTargetForElements({
      element,
      canDrop: ({ source }) => {
        // Only allow operations to be dropped on empty columns
        return source.data.type === "operation"
      },
      getData: () => ({ type: "column", columnId: column.id }),
      onDragEnter: () => setIsOver(true),
      onDragLeave: () => setIsOver(false),
      onDrop: () => setIsOver(false),
    })
  }, [column.id])

  return (
    <div className="flex min-w-[400px] w-[400px] flex-shrink-0 flex-col transition-all">
      <div className={`mb-3 rounded-lg ${column.color} border border-border/50 px-4 py-3 transition-all`}>
        <h2 className="text-balance text-sm font-bold uppercase tracking-wide text-foreground">{column.title}</h2>
        <p className="text-xs text-muted-foreground mt-0.5">{operations.length} Einsätze</p>
      </div>

      <div ref={ref} className={`flex-1 space-y-3 overflow-y-auto p-2 rounded-lg transition-all min-h-[200px] relative ${isOver && operations.length === 0 ? "border-2 border-dashed border-primary" : ""}`}>
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
                onClick={() => onCardClick(operation)}
                onHover={onCardHover}
                isHighlighted={highlightedOperationId === operation.id}
                isKeyboardFocused={hoveredOperationId === operation.id}
                isDraggingRef={isDraggingRef}
                materials={materials}
                index={index}
                columnOperations={operations}
                formatLocation={formatLocation}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
