import { useEffect } from 'react'
import { extractClosestEdge, type Edge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge'
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
  /** Say why a drop was refused. A drop that does nothing and says nothing is
   *  indistinguishable from a broken one — which is exactly how the route paths
   *  read before they stopped swallowing busy resources. */
  notifyRefused?: (reason: "route-occupied") => void
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
  | 'notifyRefused'
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
    notifyRefused,
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
      if (person.isReko) return true
      // No `status === "available"` gate. That is the very check the note above
      // says was removed from the incident path, and leaving it here meant
      // dropping somebody who is busy elsewhere onto a STOP did nothing at all:
      // no prompt, no toast, the card just went back. Busy is the normal state
      // of a roster during a storm.
      if (occupiedGroupResourceIds?.personnel.has(person.id)) notifyRefused?.("route-occupied")
      else assignGroupResource?.(groupId, "personnel", person.id)
    } else if (sourceData.type === "driver-vehicle") {
      const vehicleId = sourceData.vehicleId as string
      assignGroupResource?.(groupId, "vehicle", vehicleId)
    } else if (sourceData.type === "material") {
      const material = sourceData.material as Material
      if (occupiedGroupResourceIds?.material.has(material.id)) notifyRefused?.("route-occupied")
      else assignGroupResource?.(groupId, "material", material.id)
    } else if (sourceData.type === "material-group") {
      let refused = false
      for (const material of sourceData.materials as Material[]) {
        if (occupiedGroupResourceIds?.material.has(material.id)) refused = true
        else assignGroupResource?.(groupId, "material", material.id)
      }
      if (refused) notifyRefused?.("route-occupied")
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
      // Same rule as the Auftrag row above: only a resource the ROUTE model
      // genuinely cannot take is refused, and a refusal says so out loud.
      if (sourceData.type === "person") {
        const person = sourceData.person as Person
        if (person.isReko) assignRekoPersonToOperation(person.id, person.name, targetOp.id)
        else if (occupiedGroupResourceIds?.personnel.has(person.id)) notifyRefused?.("route-occupied")
        else assignGroupResource?.(groupId, "personnel", person.id)
      } else if (sourceData.type === "driver-vehicle") {
        const vehicleId = sourceData.vehicleId as string
        assignGroupResource?.(groupId, "vehicle", vehicleId)
      } else if (sourceData.type === "material") {
        const material = sourceData.material as Material
        if (occupiedGroupResourceIds?.material.has(material.id)) notifyRefused?.("route-occupied")
        else assignGroupResource?.(groupId, "material", material.id)
      } else if (sourceData.type === "material-group") {
        let refused = false
        for (const material of sourceData.materials as Material[]) {
          if (occupiedGroupResourceIds?.material.has(material.id)) refused = true
          else assignGroupResource?.(groupId, "material", material.id)
        }
        if (refused) notifyRefused?.("route-occupied")
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
 * The column's card order after a same-column drop: the dragged card lifted out
 * and re-inserted at the edge the pointer was closest to.
 *
 * Pure and exported so the "did anything actually move?" guard in the monitor
 * below is testable without driving a real drag.
 */
export function reorderWithinColumn<T extends { id: string }>(
  columnOps: T[],
  draggedId: string,
  sourceIndex: number,
  targetIndex: number,
  edge: Edge | null,
): T[] {
  const dragged = columnOps.find(op => op.id === draggedId)
  if (!dragged) return columnOps

  const filtered = columnOps.filter(op => op.id !== draggedId)

  // 'bottom' means "after the card the pointer is over".
  let newIndex = edge === 'bottom' ? targetIndex + 1 : targetIndex

  // Moving DOWN the same list: the dragged card no longer occupies its old slot
  // in `filtered`, so every index past it has shifted up by one.
  if (sourceIndex < targetIndex) newIndex = newIndex - 1

  return [...filtered.slice(0, newIndex), dragged, ...filtered.slice(newIndex)]
}

/** Same cards in the same order — i.e. this drop changed nothing. */
function isSameOrder(a: readonly { id: string }[], b: readonly { id: string }[]): boolean {
  return a.length === b.length && a.every((op, index) => op.id === b[index].id)
}

/** Everything moving a card needs — the hook hands its own props straight in. */
type OperationDropDeps = Pick<
  UseKanbanDragDropProps,
  | 'operations'
  | 'setOperations'
  | 'updateOperation'
  | 'reorderColumn'
  | 'onOperationDrop'
  | 'onStatusChange'
>

/**
 * Moves the dragged card: reorders it inside its column, or carries it across
 * to another one (which also writes the status change and its side effects).
 *
 * Takes its mutators as arguments for the same reason `applyResourceDrop` does
 * — the interesting questions ("does a wobble write?", "does a real reorder
 * still persist?") are then answerable without driving a real HTML5 drag.
 */
export function applyOperationDrop(
  sourceData: DragData,
  destData: DragData,
  {
    operations,
    setOperations,
    updateOperation,
    reorderColumn,
    onOperationDrop,
    onStatusChange,
  }: OperationDropDeps,
): void {
  if (sourceData.type !== "operation") return

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
      // A card cannot be reordered against ITSELF, so this drop is a click
      // that wobbled. pragmatic-drag-and-drop starts a drag at Blink's 3px
      // threshold — below every OS threshold, so real hands hit it constantly
      // — and the closest edge at the card's own centre comes out 'bottom',
      // which used to push the card one slot down and POST that order.
      // Meanwhile the click was swallowed by the card's own post-drag guard
      // (draggable-operation.tsx), so the gesture read as "my click didn't
      // work". Hand it back as the click it was: the same selection a real
      // click makes.
      if (targetOpId === draggedOp.id) {
        onOperationDrop?.(draggedOp.id)
        return
      }

      const sameColumnOps = operations.filter(op => op.status === draggedOp.status)
      const otherOps = operations.filter(op => op.status !== draggedOp.status)

      const reordered = reorderWithinColumn(
        sameColumnOps,
        draggedOp.id,
        sourceIndex,
        targetIndex,
        edge,
      )

      // Dropping on a neighbour's near edge lands the card back in its own
      // slot. Nothing moved, so nothing is written: a reorder POST re-stamps
      // every card's position in the column and pushes that over the socket
      // to every other board.
      if (isSameOrder(sameColumnOps, reordered)) return

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
  notifyRefused,
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
          notifyRefused,
        })) {
          return
        }

        // Moving the card itself — reorder, or across to another column. Pure
        // like applyResourceDrop above, so the wobble guard inside it can be
        // tested without a real drag.
        applyOperationDrop(sourceData, destData, {
          operations,
          setOperations,
          updateOperation,
          reorderColumn,
          onOperationDrop,
          onStatusChange,
        })
      },
    })
  }, [isMounted, canEdit, operations, assignPersonToOperation, assignRekoPersonToOperation, assignMaterialToOperation, assignVehicleToOperation, setOperations, updateOperation, reorderColumn, setDraggingItem, onOperationDrop, onStatusChange, groups, addStopsToGroup, assignGroupResource, occupiedGroupResourceIds, notifyRefused])
}
