import { useEffect } from 'react'
import { extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge'
import type { Operation, Person, Material, OperationStatus } from '@/lib/contexts/operations-context'
import type { IncidentGroup } from '@/lib/types/groups'
import type { GroupResourceType } from '@/lib/api-client'
import { columns } from '@/lib/kanban-utils'

// The pragmatic-drag-and-drop element adapter is require()d below (it touches
// `document` at import time), so its payload types cannot be imported alongside
// it. These are the fields this monitor reads; the payload's `data` bags are
// untyped by design in the library too (`Record<string, unknown>`).
type DragData = Record<string, unknown>
interface DragMonitorPayload {
  source: { data: DragData }
  location: { current: { dropTargets: { data: DragData }[] } }
}

interface UseKanbanDragDropProps {
  isMounted: boolean
  canEdit?: boolean
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
  onStatusChange?: (operationId: string, newStatus: OperationStatus, previousStatus: OperationStatus) => void
  /** Aufträge (incident groups) — present so views without the Aufträge feature
   *  keep working unchanged. */
  groups?: IncidentGroup[]
  /** Attach an existing board card to a route (card → Auftrag-row drop). */
  addStopsToGroup?: (groupId: string, incidentIds: string[]) => void
  /** Attach a resource to the ROUTE (drop on an Auftrag row/stop, or on a grouped
   *  incident card). Resources are route-owned now, not per-stop. */
  assignGroupResource?: (groupId: string, resourceType: GroupResourceType, resourceId: string) => void
  occupiedGroupResourceIds?: Record<GroupResourceType, Set<string>>
}

/** Everything a resource drop needs — the hook hands its own props straight in. */
type ResourceDropDeps = Pick<
  UseKanbanDragDropProps,
  | 'operations'
  | 'assignPersonToOperation'
  | 'assignRekoPersonToOperation'
  | 'assignMaterialToOperation'
  | 'assignVehicleToOperation'
  | 'addStopsToGroup'
  | 'assignGroupResource'
  | 'occupiedGroupResourceIds'
>

/**
 * Routes a crew/vehicle/material drop to the right assignment call and returns
 * whether it consumed the drop (`false` = it was an operation card being moved,
 * which the monitor handles itself).
 *
 * A resource that is busy on another incident is NOT filtered out here: the
 * assign* functions in operations-context raise the Doppelbelegung prompt
 * (hierher verschieben / mehrfach zuweisen / abbrechen). This used to check
 * `status === "available"` first, which swallowed the drop before the question
 * could be asked — the sidebar let go of the card and nothing happened.
 *
 * Resources an *Auftrag* holds are still refused, because that conflict is
 * invisible to the incident-level prompt (route resources are route-owned and
 * never appear in `op.materials` / `op.crew`).
 */
export function applyResourceDrop(
  sourceData: DragData,
  destData: DragData,
  {
    operations,
    assignPersonToOperation,
    assignRekoPersonToOperation,
    assignMaterialToOperation,
    assignVehicleToOperation,
    addStopsToGroup,
    assignGroupResource,
    occupiedGroupResourceIds,
  }: ResourceDropDeps,
): boolean {
  // --- Aufträge (route) drop targets -----------------------------------
  // A stop row (`group-stop`) or the Auftrag header (`group-row`) accept the
  // same board payloads. Resources are ROUTE-owned now — a drop assigns to the
  // Auftrag itself, not any single stop. Reordering stops (source
  // `group-stop-drag`) is handled by the sheet-local monitor, not here.
  if (destData.type === "group-stop" || destData.type === "group-row") {
    const groupId = destData.groupId as string

    // Existing board card dropped on a route header → attach as a stop.
    if (sourceData.type === "operation" && destData.type === "group-row") {
      const opId = (sourceData.operation as Operation).id
      addStopsToGroup?.(groupId, [opId])
      return true
    }

    if (sourceData.type === "person") {
      const person = sourceData.person as Person
      // Reko is a per-stop scouting slot, not a route resource — ignore here.
      if (!person.isReko && person.status === "available" && !occupiedGroupResourceIds?.personnel.has(person.id)) {
        assignGroupResource?.(groupId, "personnel", person.id)
      }
    } else if (sourceData.type === "driver-vehicle") {
      const vehicleId = sourceData.vehicleId as string
      assignGroupResource?.(groupId, "vehicle", vehicleId)
    } else if (sourceData.type === "material") {
      const material = sourceData.material as Material
      if ((material.status === "available" || material.consumable) && !occupiedGroupResourceIds?.material.has(material.id)) assignGroupResource?.(groupId, "material", material.id)
    } else if (sourceData.type === "material-group") {
      for (const material of sourceData.materials as Material[]) {
        if (!occupiedGroupResourceIds?.material.has(material.id)) assignGroupResource?.(groupId, "material", material.id)
      }
    }
    return true
  }

  if (destData.type !== "operation-drop") return false

  const operationId = destData.operationId as string

  // --- Resource dropped on a GROUPED incident card ----------------------
  // The route owns resources, so route the assignment to the Auftrag instead of
  // the stop. Reko persons still attach to the specific stop. Ungrouped
  // incidents fall through to the per-incident mutators below.
  if (sourceData.type !== "operation") {
    const targetOp = operations.find((o) => o.id === operationId)
    if (targetOp?.groupId) {
      const groupId = targetOp.groupId
      if (sourceData.type === "person") {
        const person = sourceData.person as Person
        if (person.isReko) assignRekoPersonToOperation(person.id, person.name, targetOp.id)
        else if (person.status === "available" && !occupiedGroupResourceIds?.personnel.has(person.id)) assignGroupResource?.(groupId, "personnel", person.id)
      } else if (sourceData.type === "driver-vehicle") {
        const vehicleId = sourceData.vehicleId as string
        assignGroupResource?.(groupId, "vehicle", vehicleId)
      } else if (sourceData.type === "material") {
        const material = sourceData.material as Material
        if ((material.status === "available" || material.consumable) && !occupiedGroupResourceIds?.material.has(material.id)) assignGroupResource?.(groupId, "material", material.id)
      } else if (sourceData.type === "material-group") {
        for (const material of sourceData.materials as Material[]) {
          if (!occupiedGroupResourceIds?.material.has(material.id)) assignGroupResource?.(groupId, "material", material.id)
        }
      }
      return true
    }
  }

  // Person dropped on an ungrouped operation
  if (sourceData.type === "person") {
    const person = sourceData.person as Person
    // Reko personnel are assigned differently (to the reko slot, not crew)
    if (person.isReko) {
      assignRekoPersonToOperation(person.id, person.name, operationId)
    } else if (!occupiedGroupResourceIds?.personnel.has(person.id)) {
      assignPersonToOperation(person.id, person.name, operationId)
    }
    return true
  }

  // Driver (as vehicle) dropped on operation
  if (sourceData.type === "driver-vehicle") {
    assignVehicleToOperation?.(sourceData.vehicleId as string, sourceData.vehicleName as string, operationId)
    return true
  }

  // Material dropped on operation
  if (sourceData.type === "material") {
    const material = sourceData.material as Material
    if (!occupiedGroupResourceIds?.material.has(material.id)) {
      assignMaterialToOperation(material.id, operationId)
    }
    return true
  }

  // Material group dropped on operation — assign every material the block carries
  if (sourceData.type === "material-group") {
    for (const material of sourceData.materials as Material[]) {
      if (!occupiedGroupResourceIds?.material.has(material.id)) assignMaterialToOperation(material.id, operationId)
    }
    return true
  }

  return false
}

/**
 * Shared hook for Kanban drag-and-drop functionality
 * Handles person, material, and operation dragging/dropping
 * Used across Kanban board and Combined view
 */
export function useKanbanDragDrop({
  isMounted,
  canEdit = true,
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
  assignGroupResource,
  occupiedGroupResourceIds,
}: UseKanbanDragDropProps) {

  useEffect(() => {
    if (!isMounted || !canEdit) return

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { monitorForElements } = require('@atlaskit/pragmatic-drag-and-drop/element/adapter')

    return monitorForElements({
      onDragStart({ source }: DragMonitorPayload) {
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

      onDrop({ source, location }: DragMonitorPayload) {
        if (setDraggingItem) {
          setDraggingItem(null)
        }

        const destination = location.current.dropTargets[0]
        if (!destination) return

        const sourceData = source.data
        const destData = destination.data

        // Crew / vehicle / material drops live in applyResourceDrop below — it is
        // pure, so the "does a busy resource reach the Doppelbelegung prompt?"
        // question is testable without a real drag.
        if (applyResourceDrop(sourceData, destData, {
          operations,
          assignPersonToOperation,
          assignRekoPersonToOperation,
          assignMaterialToOperation,
          assignVehicleToOperation,
          addStopsToGroup,
          assignGroupResource,
          occupiedGroupResourceIds,
        })) {
          return
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
              onStatusChange?.(draggedOp.id, targetOp.status as OperationStatus, draggedOp.status as OperationStatus)
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
              onStatusChange?.(draggedOp.id, newStatus, draggedOp.status as OperationStatus)
            }
          }
        }
      },
    })
  }, [isMounted, canEdit, operations, assignPersonToOperation, assignRekoPersonToOperation, assignMaterialToOperation, assignVehicleToOperation, setOperations, updateOperation, reorderColumn, setDraggingItem, onOperationDrop, onStatusChange, groups, addStopsToGroup, assignGroupResource, occupiedGroupResourceIds])
}
