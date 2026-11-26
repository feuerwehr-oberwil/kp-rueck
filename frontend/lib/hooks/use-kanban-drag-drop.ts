import { useEffect } from 'react'
import { monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { extractClosestEdge, type Edge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge'
import type { Operation, OperationStatus } from '@/lib/contexts/operations-context'
import type { IncidentGroup } from '@/lib/types/groups'
import type { GroupResourceType } from '@/lib/api-client'
import { takesAssignments } from '@/lib/assignable'
import { readBoardDrag, readBoardDrop, type BoardDragSource, type BoardDropTarget } from '@/lib/board-drag'

interface UseKanbanDragDropProps {
  isMounted: boolean
  canEdit?: boolean
  operations: Operation[]
  updateOperation: (id: string, updates: Partial<Operation>) => void
  reorderColumn: (orderedIds: string[]) => void
  assignPersonToOperation: (personId: string, personName: string, operationId: string) => void
  assignRekoPersonToOperation: (personId: string, personName: string, operationId: string) => void
  assignMaterialToOperation: (materialId: string, operationId: string) => void
  assignVehicleToOperation?: (vehicleId: string, vehicleName: string, operationId: string) => void
  onOperationDrop?: (operationId: string) => void
  onStatusChange?: (operationId: string, newStatus: OperationStatus, previousStatus: OperationStatus) => void
  /** Asked before a card changes column: true = the move waits for a question and is made
   *  by whoever asked it (`holdStatusMove` – the Reko form), so the drop changes nothing. */
  holdStatusChange?: (operationId: string, newStatus: OperationStatus) => boolean
  /** Aufträge (incident groups) — present so views without the Aufträge feature
   *  keep working unchanged. */
  groups?: IncidentGroup[]
  /** Attach an existing board card to a route (card → Auftrag-row drop). */
  addStopsToGroup?: (groupId: string, incidentIds: string[]) => void
  /** Attach a resource to the ROUTE (drop on an Auftrag row/stop, or on a grouped
   *  incident card). Resources are route-owned now, not per-stop. */
  assignGroupResource?: (groupId: string, resourceType: GroupResourceType, resourceId: string) => void
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
 * Resources an *Auftrag* holds are not refused either, any more. That conflict
 * is invisible to the incident-level prompt (route resources are route-owned and
 * never appear in `op.materials` / `op.crew`), so it used to end in a flat
 * «dort zuerst freigeben» toast — the board telling the operator to go and do by
 * hand, mid-storm, what one click of the dialog does. The board's own
 * `assignGroupResource` / `assignPersonToOperation` wrappers now raise the SAME
 * Doppelbelegung dialog with the Auftrag's name on the «bisher» line, exactly as
 * vehicles have done all along. Nothing is swallowed here.
 */
export function applyResourceDrop(
  sourceData: BoardDragSource,
  destData: BoardDropTarget,
  {
    operations,
    assignPersonToOperation,
    assignRekoPersonToOperation,
    assignMaterialToOperation,
    assignVehicleToOperation,
    addStopsToGroup,
    assignGroupResource,
  }: ResourceDropDeps,
): boolean {
  // --- Aufträge (route) drop targets -----------------------------------
  // A stop row (`group-stop`) or the Auftrag header (`group-row`) accept the
  // same board payloads. Resources are ROUTE-owned now — a drop assigns to the
  // Auftrag itself, not any single stop. Reordering stops (source
  // `group-stop-drag`) is handled by the sheet-local monitor, not here.
  if (destData.type === "group-stop" || destData.type === "group-row") {
    const groupId = destData.groupId

    // Existing board card dropped on a route header → attach as a stop.
    if (sourceData.type === "operation") {
      if (destData.type === "group-row") addStopsToGroup?.(groupId, [sourceData.operation.id])
      return destData.type === "group-row"
    }

    // Reko is a per-stop scouting slot, not a route resource — ignore here.
    if (sourceData.type === "person" && sourceData.person.isReko) return true
    // No availability and no occupancy gate: busy is the normal state of a
    // roster during a storm, and `assignGroupResource` is the board's
    // conflict-aware wrapper, which asks rather than refuses.
    assignToGroup(sourceData, groupId, assignGroupResource)
    return true
  }

  if (destData.type !== "operation-drop") return false

  const operationId = destData.operationId

  // A closed Einsatz takes no new assignment (lib/assignable.ts) – not even through its
  // Auftrag. Its targets refuse the drag already; this catches a card closed mid-drag.
  const dropOn = operations.find((o) => o.id === operationId)
  if (sourceData.type !== "operation" && dropOn && !takesAssignments(dropOn)) return true

  // --- Resource dropped on a GROUPED incident card ----------------------
  // The route owns resources, so route the assignment to the Auftrag instead of
  // the stop. Reko persons still attach to the specific stop. Ungrouped
  // incidents fall through to the per-incident mutators below.
  if (sourceData.type !== "operation") {
    const targetOp = dropOn
    if (targetOp?.groupId) {
      const groupId = targetOp.groupId
      // Same rule as the Auftrag row above: nothing is refused here, the
      // wrapper asks.
      if (sourceData.type === "person" && sourceData.person.isReko) {
        assignRekoPersonToOperation(sourceData.person.id, sourceData.person.name, targetOp.id)
      } else {
        assignToGroup(sourceData, groupId, assignGroupResource)
      }
      return true
    }
  }

  // Person dropped on an ungrouped operation
  if (sourceData.type === "person") {
    const { person } = sourceData
    // Reko personnel are assigned differently (to the reko slot, not crew)
    if (person.isReko) {
      assignRekoPersonToOperation(person.id, person.name, operationId)
    } else {
      assignPersonToOperation(person.id, person.name, operationId)
    }
    return true
  }

  // Driver (as vehicle) dropped on operation
  if (sourceData.type === "driver-vehicle") {
    assignVehicleToOperation?.(sourceData.vehicleId, sourceData.vehicleName, operationId)
    return true
  }

  // Material dropped on operation
  if (sourceData.type === "material") {
    assignMaterialToOperation(sourceData.material.id, operationId)
    return true
  }

  // Material group dropped on operation — assign every material the block carries
  if (sourceData.type === "material-group") {
    for (const material of sourceData.materials) {
      assignMaterialToOperation(material.id, operationId)
    }
    return true
  }

  return false
}

/** A resource drag onto an Auftrag: the route owns it (`assignGroupResource` asks on a
 *  Doppelbelegung). A card drag is not a resource and assigns nothing. */
function assignToGroup(
  drag: BoardDragSource,
  groupId: string,
  assignGroupResource: ResourceDropDeps['assignGroupResource'],
): void {
  switch (drag.type) {
    case "person":
      assignGroupResource?.(groupId, "personnel", drag.person.id)
      return
    case "driver-vehicle":
      assignGroupResource?.(groupId, "vehicle", drag.vehicleId)
      return
    case "material":
      assignGroupResource?.(groupId, "material", drag.material.id)
      return
    case "material-group":
      for (const material of drag.materials) assignGroupResource?.(groupId, "material", material.id)
      return
    case "operation":
      return
  }
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
  | 'updateOperation'
  | 'reorderColumn'
  | 'onOperationDrop'
  | 'onStatusChange'
  | 'holdStatusChange'
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
  sourceData: BoardDragSource,
  destData: BoardDropTarget,
  {
    operations,
    updateOperation,
    reorderColumn,
    onOperationDrop,
    onStatusChange,
    holdStatusChange,
  }: OperationDropDeps,
): void {
  if (sourceData.type !== "operation") return

  // Look the operation up FRESH by id instead of using the drag-start
  // snapshot: re-inserting the snapshot would overwrite fields another
  // operator changed mid-drag, or resurrect a card that was deleted
  // remotely while it was in the user's hand.
  const draggedOpId = sourceData.operation.id
  const draggedOp = operations.find(op => op.id === draggedOpId)
  if (!draggedOp) return
  const sourceIndex = sourceData.index

  // Dropped on another operation (the detail panel's target has no `index` and takes no card)
  if (destData.type === "operation-drop") {
    const targetOpId = destData.operationId
    const targetIndex = destData.index
    if (targetIndex === undefined) return
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

      // Shows the new order and persists it, so the next sync reproduces it
      // instead of snapping the card back to its created_at slot.
      reorderColumn(reordered.map(op => op.id))
    } else {
      if (holdStatusChange?.(draggedOp.id, targetOp.status)) return
      // Different column - move to new column with position
      const updatedOp = { ...draggedOp, status: targetOp.status }

      // Remove from old position
      const withoutDragged = operations.filter(op => op.id !== draggedOp.id)

      // Get operations in target column
      const targetColOps = withoutDragged.filter(op => op.status === targetOp.status)

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

      // Persist status change to backend (keeps status-transition side effects)
      updateOperation(draggedOp.id, { status: targetOp.status })

      // The dropped card's position within the target column – on screen and
      // persisted, so the next sync keeps it where the user dropped it.
      reorderColumn(reordered.map(op => op.id))

      // Auto-select the dropped card
      onOperationDrop?.(draggedOp.id)
      onStatusChange?.(draggedOp.id, targetOp.status, draggedOp.status)
    }
  }
  // Dropped on empty column area
  else if (destData.type === "column") {
    const newStatus = destData.columnId

    if (draggedOp.status !== newStatus) {
      if (holdStatusChange?.(draggedOp.id, newStatus)) return
      updateOperation(draggedOp.id, { status: newStatus })

      // Auto-select the dropped card
      onOperationDrop?.(draggedOp.id)
      onStatusChange?.(draggedOp.id, newStatus, draggedOp.status)
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
  updateOperation,
  reorderColumn,
  assignPersonToOperation,
  assignRekoPersonToOperation,
  assignMaterialToOperation,
  assignVehicleToOperation,
  onOperationDrop,
  onStatusChange,
  holdStatusChange,
  groups,
  addStopsToGroup,
  assignGroupResource,
}: UseKanbanDragDropProps) {

  useEffect(() => {
    if (!isMounted || !canEdit) return

    return monitorForElements({
      onDrop({ source, location }) {
        const destination = location.current.dropTargets[0]
        if (!destination) return

        // Another surface's drag (a route-stop or settings sort) is not the board's.
        const sourceData = readBoardDrag(source.data)
        const destData = readBoardDrop(destination.data)
        if (!sourceData || !destData) return

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
                    })) {
          return
        }

        // Moving the card itself — reorder, or across to another column. Pure
        // like applyResourceDrop above, so the wobble guard inside it can be
        // tested without a real drag.
        applyOperationDrop(sourceData, destData, {
          operations,
          updateOperation,
          reorderColumn,
          onOperationDrop,
          onStatusChange,
          holdStatusChange,
        })
      },
    })
  }, [isMounted, canEdit, operations, assignPersonToOperation, assignRekoPersonToOperation, assignMaterialToOperation, assignVehicleToOperation, updateOperation, reorderColumn, onOperationDrop, onStatusChange, holdStatusChange, groups, addStopsToGroup, assignGroupResource])
}
