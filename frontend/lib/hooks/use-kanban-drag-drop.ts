import { useEffect } from 'react'
import { extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge'
import type { Operation, Person, Material, OperationStatus } from '@/lib/contexts/operations-context'
import type { IncidentGroup } from '@/lib/types/groups'
import type { GroupResourceType } from '@/lib/api-client'
import { columns } from '@/lib/kanban-utils'

interface UseKanbanDragDropProps {
  isMounted: boolean
  operations: Operation[]
  setOperations: React.Dispatch<React.SetStateAction<Operation[]>>
  updateOperation: (id: string, updates: Partial<Operation>) => void
  reorderColumn: (orderedIds: string[]) => void
  assignPersonToOperation: (personId: string, personName: string, operationId: string) => void
  assignRekoPersonToOperation: (personId: string, personName: string, operationId: string) => void
  assignMaterialToOperation: (materialId: string, operationId: string) => void
  assignVehicleToOperation?: (vehicleId: string, vehicleName: string, operationId: string) => void
  setDraggingItem?: (item: Person | Material | Operation | null) => void
  onOperationDrop?: (operationId: string) => void
  onStatusChange?: (operationId: string, newStatus: OperationStatus) => void
  /** Aufträge (incident groups) — used to resolve a route's source stop + mode
   *  when a resource is dropped on an Auftrag row. Optional so views without the
   *  Aufträge feature keep working unchanged. */
  groups?: IncidentGroup[]
  /** Attach an existing board card to a route (card → Auftrag-row drop). */
  addStopsToGroup?: (groupId: string, incidentIds: string[]) => void
  /** Copy the source stop's squad across the route after a header drop (mode-aware). */
  copyGroupSquad?: (groupId: string, sourceIncidentId: string, resourceTypes?: GroupResourceType[]) => void
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
  reorderColumn,
  assignPersonToOperation,
  assignRekoPersonToOperation,
  assignMaterialToOperation,
  assignVehicleToOperation,
  setDraggingItem,
  onOperationDrop,
  onStatusChange,
  groups,
  addStopsToGroup,
  copyGroupSquad,
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
        } else if (data.type === "material-group") {
          // Use first material as representative for drag preview
          const materials = data.materials as Material[]
          if (materials.length > 0) setDraggingItem(materials[0])
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

        // --- Aufträge (route) drop targets ---------------------------------
        // A stop row (`group-stop`) or the Auftrag header (`group-row`) accept
        // the same board payloads. Reordering stops (source `group-stop-drag`)
        // is handled by the sheet-local monitor, not here.
        if (destData.type === "group-stop" || destData.type === "group-row") {
          const groupId = destData.groupId as string

          // Existing board card dropped on a route header → attach as a stop.
          if (sourceData.type === "operation" && destData.type === "group-row") {
            const opId = (sourceData.operation as Operation).id
            addStopsToGroup?.(groupId, [opId])
            return
          }

          // Resolve the incident this resource lands on: the stop itself, or the
          // route's designated source stop (first stop) for a header drop.
          const group = groups?.find((g) => g.id === groupId)
          const targetIncidentId =
            destData.type === "group-stop" ? (destData.incidentId as string) : group?.stopIds[0]
          if (!targetIncidentId) return

          // Reuse the existing per-incident mutators so the vehicle-conflict /
          // driver prompts fire exactly as on the board.
          if (sourceData.type === "person") {
            const person = sourceData.person as Person
            if (person.isReko) assignRekoPersonToOperation(person.id, person.name, targetIncidentId)
            else if (person.status === "available") assignPersonToOperation(person.id, person.name, targetIncidentId)
          } else if (sourceData.type === "driver-vehicle") {
            assignVehicleToOperation?.(
              sourceData.vehicleId as string,
              sourceData.vehicleName as string,
              targetIncidentId,
            )
          } else if (sourceData.type === "material") {
            const material = sourceData.material as Material
            if (material.status === "available" || material.consumable) assignMaterialToOperation(material.id, targetIncidentId)
          } else if (sourceData.type === "material-group") {
            for (const material of sourceData.materials as Material[]) assignMaterialToOperation(material.id, targetIncidentId)
          } else {
            return
          }

          // Header drop → also copy the (mode-aware) squad to every stop. The
          // assign above is async; give its POST a moment to land before the
          // copy reads the source incident's assignments server-side.
          if (destData.type === "group-row" && copyGroupSquad) {
            setTimeout(() => copyGroupSquad(groupId, targetIncidentId), 500)
          }
          return
        }

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

          if (material.status === "available" || material.consumable) {
            assignMaterialToOperation(material.id, operationId)
          }
        }

        // Material group dropped on operation — assign all available materials in the group
        if (sourceData.type === "material-group" && destData.type === "operation-drop") {
          const groupMaterials = sourceData.materials as Material[]
          const operationId = destData.operationId as string

          for (const material of groupMaterials) {
            assignMaterialToOperation(material.id, operationId)
          }
        }

        // Operation reordering/moving
        if (sourceData.type === "operation") {
          // Look the operation up FRESH by id instead of using the drag-start
          // snapshot: re-inserting the snapshot would overwrite fields another
          // operator changed mid-drag, or resurrect a card that was deleted
          // remotely while it was in the user's hand.
          const draggedOpId = (sourceData.operation as Operation).id
          const draggedOp = operations.find(op => op.id === draggedOpId)
          if (!draggedOp) return
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
              const sameColumnOps = operations.filter(op => op.status === draggedOp.status)
              const otherOps = operations.filter(op => op.status !== draggedOp.status)

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

              setOperations([...otherOps, ...reordered])

              // Persist the new manual order so the next sync reproduces it
              // instead of snapping the card back to its created_at slot.
              reorderColumn(reordered.map(op => op.id))
            } else {
              // Different column - move to new column with position
              const updatedOp = { ...draggedOp, status: targetOp.status }

              // Remove from old position
              const withoutDragged = operations.filter(op => op.id !== draggedOp.id)

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

              setOperations([...otherOps, ...reordered])

              // Persist status change to backend (keeps status-transition side effects)
              updateOperation(draggedOp.id, { status: targetOp.status as OperationStatus })

              // Persist the dropped card's position within the target column so the
              // next sync keeps it where the user dropped it.
              reorderColumn(reordered.map(op => op.id))

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
  }, [isMounted, operations, assignPersonToOperation, assignRekoPersonToOperation, assignMaterialToOperation, assignVehicleToOperation, setOperations, updateOperation, reorderColumn, setDraggingItem, onOperationDrop, onStatusChange, groups, addStopsToGroup, copyGroupSquad])
}
