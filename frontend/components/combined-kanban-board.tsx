"use client"

import { useState, useEffect, useRef } from "react"
import { useOperations, type Operation, type Material } from "@/lib/contexts/operations-context"
import { columns } from "@/lib/kanban-utils"
import { DroppableColumn } from "@/components/kanban/droppable-column"

interface CombinedKanbanBoardProps {
  onCardHover: (operationId: string | null) => void
  onCardClick: (operation: Operation) => void
  highlightedOperationId: string | null
}

export default function CombinedKanbanBoard({
  onCardHover,
  onCardClick,
  highlightedOperationId
}: CombinedKanbanBoardProps) {
  const {
    operations,
    materials,
    formatLocation,
    removeCrew,
    removeMaterial,
    removeVehicle,
    setOperations,
    updateOperation,
    assignPersonToOperation,
    assignMaterialToOperation,
  } = useOperations()

  const [isMounted, setIsMounted] = useState(false)
  const isDraggingRef = useRef(false)

  useEffect(() => {
    setIsMounted(true)
  }, [])

  // Monitor drag events globally for drag-and-drop functionality
  useEffect(() => {
    if (!isMounted) return

    const { monitorForElements } = require('@atlaskit/pragmatic-drag-and-drop/element/adapter')
    const { extractClosestEdge } = require('@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge')

    return monitorForElements({
      onDragStart({ source }: any) {
        const data = source.data
        if (data.type === "person") {
          // Handle person dragging if needed
        } else if (data.type === "material") {
          // Handle material dragging if needed
        } else if (data.type === "operation") {
          // Operation is being dragged
        }
      },
      onDrop({ source, location }: any) {
        const destination = location.current.dropTargets[0]
        if (!destination) return

        const sourceData = source.data
        const destData = destination.data

        // Person dropped on operation
        if (sourceData.type === "person" && destData.type === "operation-drop") {
          const person = sourceData.person
          const operationId = destData.operationId as string

          if (person.status === "available") {
            assignPersonToOperation(person.id, person.name, operationId)
          }
        }

        // Material dropped on operation
        if (sourceData.type === "material" && destData.type === "operation-drop") {
          const material = sourceData.material
          const operationId = destData.operationId as string

          if (material.status === "available") {
            assignMaterialToOperation(material.id, operationId)
          }
        }

        // Operation reordering/moving
        if (sourceData.type === "operation") {
          const draggedOp = sourceData.operation as Operation
          const sourceIndex = sourceData.index as number

          // Dropped on another operation
          if (destData.type === "operation-drop") {
            const targetOpId = destData.operationId as string
            const targetIndex = destData.index as number
            const edge = extractClosestEdge(destData)

            // Find the target operation to determine its column
            const targetOp = operations.find(op => op.id === targetOpId)
            if (!targetOp) return

            // Same column - reorder
            if (draggedOp.status === targetOp.status) {
              setOperations((ops) => {
                const sameColumnOps = ops.filter(op => op.status === draggedOp.status)
                const otherOps = ops.filter(op => op.status !== draggedOp.status)

                // Remove dragged operation
                const filtered = sameColumnOps.filter(op => op.id !== draggedOp.id)

                // Calculate new index based on edge
                let newIndex = targetIndex
                if (edge === 'bottom') {
                  newIndex = targetIndex + 1
                }

                // Adjust index if we're moving down in the same list
                if (sourceIndex < targetIndex) {
                  newIndex = newIndex - 1
                }

                // Insert at new position
                const reordered = [
                  ...filtered.slice(0, newIndex),
                  draggedOp,
                  ...filtered.slice(newIndex)
                ]

                return [...otherOps, ...reordered]
              })
            } else {
              // Different column - move to new column with position
              setOperations((ops) => {
                // Update status
                const updatedOp = { ...draggedOp, status: targetOp.status }

                // Remove from old position
                const withoutDragged = ops.filter(op => op.id !== draggedOp.id)

                // Get operations in target column
                const targetColOps = withoutDragged.filter(op => op.status === targetOp.status)
                const otherOps = withoutDragged.filter(op => op.status !== targetOp.status)

                // Calculate insert index
                let insertIndex = targetIndex
                if (edge === 'bottom') {
                  insertIndex = targetIndex + 1
                }

                // Insert at position
                const reordered = [
                  ...targetColOps.slice(0, insertIndex),
                  updatedOp,
                  ...targetColOps.slice(insertIndex)
                ]

                return [...otherOps, ...reordered]
              })
            }
          }
          // Dropped on empty column area
          else if (destData.type === "column") {
            const targetColumnId = destData.columnId as string
            const targetColumn = columns.find(col => col.id === targetColumnId)

            if (targetColumn && draggedOp.status !== targetColumn.status[0]) {
              updateOperation(draggedOp.id, { status: targetColumn.status[0] as any })
            }
          }
        }
      },
    })
  }, [isMounted, operations, assignPersonToOperation, assignMaterialToOperation, setOperations, updateOperation])

  // Don't render drag and drop until client-side to avoid hydration errors
  if (!isMounted) {
    return (
      <div className="flex h-full items-center justify-center bg-zinc-950/20">
        <div className="text-muted-foreground">Laden...</div>
      </div>
    )
  }

  return (
    <div className="flex h-full gap-3 overflow-x-auto p-4 bg-zinc-950/20">
      {columns.map((column) => {
        const columnOps = operations.filter((op) => column.status.includes(op.status))
        return (
          <DroppableColumn
            key={column.id}
            column={column}
            operations={columnOps}
            onRemoveCrew={removeCrew}
            onRemoveMaterial={removeMaterial}
            onRemoveVehicle={removeVehicle}
            onCardClick={onCardClick}
            onCardHover={onCardHover}
            highlightedOperationId={highlightedOperationId}
            hoveredOperationId={null}
            isDraggingRef={isDraggingRef}
            materials={materials}
            formatLocation={formatLocation}
          />
        )
      })}
    </div>
  )
}
