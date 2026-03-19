import { useEffect } from 'react'
import { extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge'
import type { Operation, Person, Material, OperationStatus } from '@/lib/contexts/operations-context'
import { columns } from '@/lib/kanban-utils'

interface UseKanbanDragDropProps {
  isMounted: boolean
  operations: Operation[]
  setOperations: React.Dispatch<React.SetStateAction<Operation[]>>
  updateOperation: (id: string, updates: Partial<Operation>) => void
  assignPersonToOperation: (personId: string, personName: string, operationId: string) => void
  assignRekoPersonToOperation: (personId: string, personName: string, operationId: string) => void
  assignMaterialToOperation: (materialId: string, operationId: string) => void
  assignVehicleToOperation?: (vehicleId: string, vehicleName: string, operationId: string) => void
  setDraggingItem?: (item: Person | Material | Operation | null) => void
  onOperationDrop?: (operationId: string) => void
  onStatusChange?: (operationId: string, newStatus: OperationStatus) => void
}

/**
 * Shared hook for Kanban drag-and-drop functionality
 * Handles person, material, and operation dragging/dropping
 * Used across Kanban board and Combined view
 */
export function useKanbanDragDrop({
  isMounted,
  operations,
  setOperations,
  updateOperation,
  assignPersonToOperation,
  assignRekoPersonToOperation,
  assignMaterialToOperation,
  assignVehicleToOperation,
  setDraggingItem,
  onOperationDrop,
  onStatusChange,
}: UseKanbanDragDropProps) {

  useEffect(() => {
    if (!isMounted) return

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { monitorForElements } = require('@atlaskit/pragmatic-drag-and-drop/element/adapter')

    return monitorForElements({
      onDragStart({ source }: any) {
        if (!setDraggingItem) return

        const data = source.data
        if (data.type === "person") {
          setDraggingItem(data.person as Person)
        } else if (data.type === "material") {
          setDraggingItem(data.material as Material)
        } else if (data.type === "operation") {
          setDraggingItem(data.operation as Operation)
        }
      },

      onDrop({ source, location }: any) {
        if (setDraggingItem) {
          setDraggingItem(null)
        }

        const destination = location.current.dropTargets[0]
        if (!destination) return

        const sourceData = source.data
        const destData = destination.data

        // Person dropped on operation
        if (sourceData.type === "person" && destData.type === "operation-drop") {
          const person = sourceData.person as Person
          const operationId = destData.operationId as string

          // Reko personnel are assigned differently (to the reko slot, not crew)
          if (person.isReko) {
            assignRekoPersonToOperation(person.id, person.name, operationId)
          } else if (person.status === "available") {
            assignPersonToOperation(person.id, person.name, operationId)
          }
        }

        // Driver (as vehicle) dropped on operation
        if (sourceData.type === "driver-vehicle" && destData.type === "operation-drop") {
          const vehicleId = sourceData.vehicleId as string
          const vehicleName = sourceData.vehicleName as string
          const operationId = destData.operationId as string
          assignVehicleToOperation?.(vehicleId, vehicleName, operationId)
        }

        // Material dropped on operation
        if (sourceData.type === "material" && destData.type === "operation-drop") {
          const material = sourceData.material as Material
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

              // Persist status change to backend
              updateOperation(draggedOp.id, { status: targetOp.status as OperationStatus })

              // Auto-select the dropped card
              onOperationDrop?.(draggedOp.id)
              onStatusChange?.(draggedOp.id, targetOp.status as OperationStatus)
            }
          }
          // Dropped on empty column area
          else if (destData.type === "column") {
            const targetColumnId = destData.columnId as string
            const targetColumn = columns.find(col => col.id === targetColumnId)

            if (targetColumn && draggedOp.status !== targetColumn.status[0]) {
              const newStatus = targetColumn.status[0] as OperationStatus
              updateOperation(draggedOp.id, { status: newStatus })

              // Auto-select the dropped card
              onOperationDrop?.(draggedOp.id)
              onStatusChange?.(draggedOp.id, newStatus)
            }
          }
        }
      },
    })
  }, [isMounted, operations, assignPersonToOperation, assignRekoPersonToOperation, assignMaterialToOperation, assignVehicleToOperation, setOperations, updateOperation, setDraggingItem, onOperationDrop, onStatusChange])
}
