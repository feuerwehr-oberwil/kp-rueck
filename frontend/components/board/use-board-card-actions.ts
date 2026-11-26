"use client"

import { useCallback } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { undoToast } from "@/lib/toast-undo"
import { useOperations, type Operation, type OperationStatus } from "@/lib/contexts/operations-context"
import { useGroups } from "@/lib/contexts/groups-context"
import { useVehicleShortcuts } from "@/lib/contexts/operations/use-vehicle-shortcuts"
import { useReleaseUndo } from "@/lib/hooks/use-release-undo"
import type { IncidentStatusWorkflowController } from "@/components/kanban/incident-status/use-incident-status-workflow"
import { toMirrorStatus } from "@/components/map/route-stop-list"
import { columns } from "@/lib/kanban-utils"
import { useAssignmentConflicts } from "@/lib/hooks/use-assignment-conflicts"
import { getIncidentLocationLabel, getIncidentTypeLabel } from "@/lib/incident-types"
import { moveInList, type MoveTo } from "@/lib/move-in-list"
import { takesAssignments } from "@/lib/assignable"

/** Priority → its label key under `kanban.common`, for the toast a keyboard
 *  priority change raises. */
export const PRIORITY_LABEL_KEYS: Record<Operation["priority"], "priorityLow" | "priorityMedium" | "priorityHigh"> = {
  low: "priorityLow",
  medium: "priorityMedium",
  high: "priorityHigh",
}

/** What the board does to a card – see `useBoardCardActions`. */
export type BoardCardActions = ReturnType<typeof useBoardCardActions>

/**
 * What the board does to a card: Auftrag stop status, column sort, transfer,
 * status moves left/right, vehicle toggle with the Doppelbelegung check,
 * priority, zu Fuss, driver stay, delete — plus the assignment-conflict
 * helpers they share. Reads the board contexts itself; the page hands in only
 * its status workflow (`useIncidentDialogs().statusWorkflow`), which asks before
 * and after a move.
 */
export function useBoardCardActions(statusWorkflow: IncidentStatusWorkflowController) {
  const {
    requestResourceConflict,
    operations,
    updateOperation,
    reorderColumn,
    removeVehicle,
    assignVehicleToOperation,
    deleteOperation,
    toggleDriverStay,
  } = useOperations()
  const {
    groups,
    unassignResource: unassignGroupResource,
    assignResource: assignGroupResource,
  } = useGroups()
  const release = useReleaseUndo()
  const vehicleTypes = useVehicleShortcuts()
  const {
    holdStatusMove,
    triggerRekoCheck,
    promptMaterialDecision,
    triggerReturningVehicleCheck,
    triggerDisponiertDialog,
    requestStatusChange,
  } = statusWorkflow
  const tCommon = useTranslations('kanban.common')
  // Column titles, for the toasts a keyboard mutation raises.
  const tColumns = useTranslations('kanban.columns')

  const setRouteStopStatus = useCallback((operationId: string, newStatus: OperationStatus) => {
    const operation = operations.find((op) => op.id === operationId)
    if (!operation || operation.status === "complete") return
    // The stop control shows a lossy MIRROR of the real status: reko + reko_done
    // both read as "Offen" (incoming). Re-selecting the bucket the incident is
    // already in must be a no-op — otherwise writing "incoming" back regresses a
    // reko/reko-done incident all the way to eingegangen, discarding its progress.
    if (toMirrorStatus(operation) === newStatus) return
    requestStatusChange(operationId, newStatus)
  }, [operations, requestStatusChange])

  // One-shot column sort: persist the chosen column's order without turning off
  // manual drag-and-drop ordering afterwards.
  const handleColumnSort = useCallback((columnId: string, key: 'priority' | 'age' | 'auftrag' | 'type') => {
    const column = columns.find((candidate) => candidate.id === columnId)
    if (!column) return

    const priorityRank: Record<string, number> = { high: 0, medium: 1, low: 2 }
    const byAge = (a: Operation, b: Operation) => a.dispatchTime.getTime() - b.dispatchTime.getTime()
    const groupName = (id: string | null) => (id ? groups.find((g) => g.id === id)?.name ?? '' : '')
    const cmp = (a: Operation, b: Operation): number => {
      switch (key) {
        case 'priority':
          return (priorityRank[a.priority] - priorityRank[b.priority]) || byAge(a, b)
        case 'type':
          return getIncidentTypeLabel(a.incidentType).localeCompare(getIncidentTypeLabel(b.incidentType)) || byAge(a, b)
        case 'auftrag':
          // Cluster grouped stops together (by route name, then stop order);
          // ungrouped cards fall after, oldest first.
          if (!!a.groupId !== !!b.groupId) return a.groupId ? -1 : 1
          if (a.groupId && b.groupId && a.groupId !== b.groupId) {
            return groupName(a.groupId).localeCompare(groupName(b.groupId))
          }
          if (a.groupId && b.groupId) return a.groupPosition - b.groupPosition
          return byAge(a, b)
        default:
          return byAge(a, b)
      }
    }
    const columnOperations = operations.filter((op) => column.id === op.status).sort(cmp)
    // No toast: the column reorders under the operator's eyes, so confirming it
    // in words is noise on a surface whose job is staying calm.
    reorderColumn(columnOperations.map((op) => op.id))
  }, [operations, groups, reorderColumn])

  // «Nach oben / Nach unten» in a card's menu: the same write as dragging the
  // card inside its column. At the column's edge nothing moves and nothing is sent.
  const moveInColumn = useCallback((operationId: string, to: MoveTo) => {
    const operation = operations.find((op) => op.id === operationId)
    const column = operation && columns.find((candidate) => candidate.id === operation.status)
    if (!column) return
    const columnOperations = operations.filter((op) => column.id === op.status)
    const moved = moveInList(columnOperations, columnOperations.findIndex((op) => op.id === operationId), to)
    if (!moved) return
    reorderColumn(moved.map((op) => op.id))
  }, [operations, reorderColumn])

  /** «X → Im Einsatz» — a keyboard move can land on a card that is scrolled out
   *  of sight, so the board says what it just did. */
  const notifyStatusMove = useCallback((operation: Operation, newStatus: OperationStatus) => {
    toast.success(tCommon('statusMovedToast', {
      name: getIncidentLocationLabel(operation),
      status: tColumns(newStatus),
    }))
  }, [tCommon, tColumns])

  const moveOperationRight = useCallback((operationId: string) => {
    const operation = operations.find(op => op.id === operationId)
    if (!operation) return

    const currentColumnIndex = columns.findIndex((col) => col.id === operation.status)
    if (currentColumnIndex < columns.length - 1) {
      const nextColumn = columns[currentColumnIndex + 1]
      const newStatus = nextColumn.id
      const previousStatus = operation.status
      if (holdStatusMove(operationId, newStatus)) return
      updateOperation(operationId, { status: newStatus })
      notifyStatusMove(operation, newStatus)
      if (newStatus === "enroute") triggerDisponiertDialog(operationId, previousStatus)
      if (newStatus === "reko") triggerRekoCheck(operationId, previousStatus)
      if (newStatus === "returning") triggerReturningVehicleCheck(operationId, previousStatus)
      if (newStatus === "complete") promptMaterialDecision(operationId, previousStatus)
    }
  }, [operations, updateOperation, notifyStatusMove, holdStatusMove, triggerDisponiertDialog, triggerRekoCheck, triggerReturningVehicleCheck, promptMaterialDecision])

  const moveOperationLeft = useCallback((operationId: string) => {
    const operation = operations.find(op => op.id === operationId)
    if (!operation) return

    const currentColumnIndex = columns.findIndex((col) => col.id === operation.status)
    if (currentColumnIndex > 0) {
      const prevColumn = columns[currentColumnIndex - 1]
      const newStatus = prevColumn.id
      const previousStatus = operation.status
      updateOperation(operationId, { status: newStatus })
      notifyStatusMove(operation, newStatus)
      // Backwards into «Disponiert / Anfahrt» is a correction, not a new
      // dispatch — the workflow decides which dialog that means.
      if (newStatus === "enroute") triggerDisponiertDialog(operationId, previousStatus)
    }
  }, [operations, updateOperation, notifyStatusMove, triggerDisponiertDialog])

  // Doppelbelegung across Aufträge and Einsätze — see use-assignment-conflicts.
  const {
    assignVehicleToGroupWithConflict,
    groupsHolding,
    releaseFromGroups,
    askRouteConflict,
    assignVehicleToIncidentWithConflict,
  } = useAssignmentConflicts({
    vehicleTypes,
    groups,
    operations,
    requestResourceConflict,
    assignGroupResource,
    unassignGroupResource,
    removeVehicle,
    assignVehicleToOperation,
  })

  // Quick-assign (number keys / command palette) toggle of a vehicle onto an
  // incident. For a GROUPED incident the route owns resources, so route the
  // assign/unassign to the Auftrag — otherwise a per-incident row would be
  // created that never renders on a grouped card (a hidden assignment).
  //
  // Toasts either way: one keystroke moving a Tanklöschfahrzeug on or off an
  // incident is exactly the mutation that must not happen in silence.
  const toggleVehicleAssignment = useCallback(
    (op: Operation, vehicle: { id: string; name: string }) => {
      const notify = (assigned: boolean) => {
        toast.success(
          tCommon(assigned ? 'vehicleAssignedToast' : 'vehicleRemovedToast', {
            vehicle: vehicle.name,
            name: getIncidentLocationLabel(op),
          }),
        )
      }
      // Removing says itself — with «Rückgängig» — through the release toast.
      const onRoute = op.groupId ? op.auftragResources?.vehicles.find((v) => v.resourceId === vehicle.id) : undefined
      if (op.groupId && onRoute) {
        void release.releaseRouteResource(op.groupId, onRoute.assignmentId)
        return
      }
      if (!op.groupId && op.vehicles.some((v) => v.vehicleId === vehicle.id)) {
        void release.releaseVehicle(op.id, vehicle.id)
        return
      }
      // A closed Einsatz takes no new assignment (lib/assignable.ts). Said, not swallowed.
      if (!takesAssignments(op)) {
        toast.info(tCommon('closedTakesNoAssignment', { name: getIncidentLocationLabel(op) }))
        return
      }
      if (op.groupId) {
        // Held elsewhere → the Doppelbelegung question (#22); the toast only for an assign
        // that went through.
        void assignVehicleToGroupWithConflict(op.groupId, vehicle.id).then((assigned) => {
          if (assigned) notify(true)
        })
        return
      }
      // The same question as the picker and a drop: an Auftrag holding the vehicle asks
      // «als Stopp aufnehmen?», another Einsatz holding it asks «auf beiden führen?».
      // A question is its own receipt – the toast is for an assign that just happened.
      const heldByEinsatz = operations.some((other) => other.id !== op.id && other.vehicles.some((v) => v.vehicleId === vehicle.id))
      const asked = assignVehicleToIncidentWithConflict(vehicle.id, vehicle.name, op.id)
      if (!asked && !heldByEinsatz) notify(true)
    },
    [release, assignVehicleToGroupWithConflict, assignVehicleToIncidentWithConflict, operations, tCommon],
  )

  /** Priority by keystroke — the card only shows it as a small chevron, so the
   *  change says itself. */
  const setOperationPriority = useCallback((operationId: string, priority: Operation["priority"]) => {
    const operation = operations.find((op) => op.id === operationId)
    if (!operation) return
    const previous = operation.priority
    updateOperation(operationId, { priority })
    const message = tCommon('priorityChangedToast', {
      name: getIncidentLocationLabel(operation),
      priority: tCommon(PRIORITY_LABEL_KEYS[priority]),
    })
    if (previous === priority) toast.success(message)
    else undoToast(message, { onUndo: () => updateOperation(operationId, { priority: previous }) })
  }, [operations, updateOperation, tCommon])

  /** «Zu Fuss» by keystroke — a vehicle-less dispatch is a radio-relevant fact. */
  const toggleZuFuss = useCallback((operationId: string) => {
    const operation = operations.find((op) => op.id === operationId)
    if (!operation) return
    const next = !operation.zuFuss
    updateOperation(operationId, { zuFuss: next })
    undoToast(tCommon(next ? 'zuFussOnToast' : 'zuFussOffToast', { name: getIncidentLocationLabel(operation) }), {
      // One toast per Einsatz: pressing 0 again replaces it rather than stacking.
      key: `zu-fuss:${operationId}`,
      onUndo: () => updateOperation(operationId, { zuFuss: !next }),
    })
  }, [operations, updateOperation, tCommon])

  /** The driver decision is read out on the radio and printed on the slip, so
   *  the pill's click gets the same receipt as every other card mutation. The
   *  underlying hook is optimistic and toasts on failure by itself. */
  const handleToggleDriverStay = useCallback((operationId: string, vehicleId: string) => {
    const vehicle = operations.find((op) => op.id === operationId)?.vehicles.find((v) => v.vehicleId === vehicleId)
    if (!vehicle) return
    const next = !(vehicle.driverStay ?? false)
    toggleDriverStay(operationId, vehicleId)
    undoToast(tCommon(next ? 'driverStaysToast' : 'driverReturnsToast', { vehicle: vehicle.name }), {
      // One toast per vehicle assignment: clicking the pill again replaces it rather than stacking.
      key: `driver-stay:${operationId}:${vehicleId}`,
      description: tCommon('driverStayToastHint'),
      onUndo: () => toggleDriverStay(operationId, vehicleId),
    })
  }, [operations, toggleDriverStay, tCommon])

  /** Delete an incident at once — the context menu's destructive row and the
   *  Delete key share this one path. No «wirklich löschen?»: the undo toast that
   *  `deleteOperation` raises takes it back (owner, 17.11.2026). */
  const handleRequestDelete = useCallback(async (operationId: string) => {
    try {
      await deleteOperation(operationId)
    } catch {
      toast.error(tCommon('deleteFailed'))
    }
  }, [deleteOperation, tCommon])

  return {
    setRouteStopStatus,
    handleColumnSort,
    moveInColumn,
    moveOperationRight,
    moveOperationLeft,
    toggleVehicleAssignment,
    setOperationPriority,
    toggleZuFuss,
    handleToggleDriverStay,
    handleRequestDelete,
    assignVehicleToGroupWithConflict,
    groupsHolding,
    releaseFromGroups,
    assignVehicleToIncidentWithConflict,
    askRouteConflict,
  }
}
