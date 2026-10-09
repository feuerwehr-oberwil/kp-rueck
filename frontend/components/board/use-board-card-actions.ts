"use client"

import { useCallback } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { type Operation, type OperationStatus } from "@/lib/contexts/operations-context"
import { toMirrorStatus } from "@/components/map/route-stop-list"
import { apiClient, type GroupResourceType } from "@/lib/api-client"
import { columns, BOARD_COLUMN_COLLAPSE_KEY, DEFAULT_COLLAPSED_COLUMN_IDS } from "@/lib/kanban-utils"
import { useCollapsedSections } from "@/lib/hooks/use-collapsed-sections"
import { useAssignmentConflicts } from "@/lib/hooks/use-assignment-conflicts"
import { getIncidentLocationLabel, getIncidentTypeLabel } from "@/lib/incident-types"
import type { Incident } from "@/lib/types/incidents"
import type { Event } from "@/lib/types/incidents"
import type { GroupResources, IncidentGroup } from "@/lib/types/groups"
import type { Dispatch, SetStateAction, RefObject } from "react"
import type { Released } from "@/lib/release-undo"

/** Priority → its label key under `kanban.common`, for the toast a keyboard
 *  priority change raises. */
export const PRIORITY_LABEL_KEYS: Record<Operation["priority"], "priorityLow" | "priorityMedium" | "priorityHigh"> = {
  low: "priorityLow",
  medium: "priorityMedium",
  high: "priorityHigh",
}

export interface UseBoardCardActionsInput {
  requestResourceConflict: (conflict: NonNullable<{ resourceType: "personnel" | "vehicle" | "material"; resourceId: string; resourceName: string; targetOperationId: string; targetOperationLabel?: string; conflicts: { operationId: string; operationLabel: string; }[]; customResolve?: (action: "move" | "keep") => Promise<void> | void; } | null>) => void
  operations: Operation[]
  updateOperation: (operationId: string, updates: Partial<Operation>) => void
  setOperations: Dispatch<SetStateAction<Operation[]>>
  reorderColumn: (orderedIds: string[]) => void
  removeVehicle: (operationId: string, vehicleName: string) => Promise<boolean>
  assignVehicleToOperation: (vehicleId: string, vehicleName: string, operationId: string) => Promise<boolean>
  groups: IncidentGroup[]
  unassignGroupResource: (groupId: string, assignmentId: string) => Promise<boolean>
  assignGroupResource: (groupId: string, resourceType: GroupResourceType, resourceId: string) => Promise<boolean>
  getGroupResources: (groupId: string) => GroupResources
  release: { releaseCrew: (operationId: string, crewName: string) => Promise<boolean>; releaseMaterial: (operationId: string, materialId: string) => Promise<boolean>; releaseVehicle: (operationId: string, vehicleName: string) => Promise<boolean>; releaseStop: (groupId: string, incidentId: string) => Promise<boolean>; releaseRouteResource: (groupId: string, assignmentId: string) => Promise<boolean>; restore: (item: Released) => Promise<void>; }
  selectedEvent: Event | null
  expandColumnRef: RefObject<(id: string) => void>
  vehicleTypes: { key: string; name: string; id: string; type: string; status: string; }[]
  setDeleteDialogOpen: Dispatch<SetStateAction<boolean>>
  setOperationToDelete: Dispatch<SetStateAction<Operation | null>>
  setTransferSourceOp: Dispatch<SetStateAction<Operation | null>>
  transferSourceOp: Operation | null
  setTransferAvailableIncidents: Dispatch<SetStateAction<Incident[]>>
  setIsTransferring: Dispatch<SetStateAction<boolean>>
  toggleDriverStay: (operationId: string, vehicleName: string) => void
  triggerRekoFormCheck: (operationId: string, previousStatus?: OperationStatus) => void
  triggerRekoCheck: (operationId: string, previousStatus?: OperationStatus) => void
  promptMaterialDecision: (operationId: string, previousStatus?: OperationStatus) => void
  triggerReturningVehicleCheck: (operationId: string, previousStatus?: OperationStatus) => void
  triggerDisponiertDialog: (operationId: string, previousStatus?: OperationStatus) => void
  requestStatusChange: (operationId: string, targetStatus: OperationStatus) => void
}

/**
 * What the board does to a card: Auftrag stop status, column sort, transfer,
 * status moves left/right, vehicle toggle with the Doppelbelegung check,
 * priority, zu Fuss, driver stay, delete request — plus the assignment-conflict
 * helpers they share. Moved verbatim out of app/page.tsx.
 */
export function useBoardCardActions(input: UseBoardCardActionsInput) {
  const {
    requestResourceConflict,
    operations,
    updateOperation,
    setOperations,
    reorderColumn,
    removeVehicle,
    assignVehicleToOperation,
    groups,
    unassignGroupResource,
    assignGroupResource,
    getGroupResources,
    release,
    selectedEvent,
    expandColumnRef,
    vehicleTypes,
    setDeleteDialogOpen,
    setOperationToDelete,
    setTransferSourceOp,
    transferSourceOp,
    setTransferAvailableIncidents,
    setIsTransferring,
    toggleDriverStay,
    triggerRekoFormCheck,
    triggerRekoCheck,
    promptMaterialDecision,
    triggerReturningVehicleCheck,
    triggerDisponiertDialog,
    requestStatusChange,
  } = input
  const tCommon = useTranslations('kanban.common')
  // Column titles, for the toasts a keyboard mutation raises.
  const tColumns = useTranslations('kanban.columns')
  // The board's one «Rückgängig» label — reused rather than copied.
  const tNotifications = useTranslations('notifications.operations')

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

  // Which columns this screen has folded away. Seven columns do not fit on
  // every command-post monitor, and the two that matter right now must not be
  // behind a horizontal scrollbar. Per DEVICE, not per operator account: the
  // fold answers «how wide is this monitor», which nobody wants inherited on
  // the next machine — same hook, same reasoning as both wall boards.
  const collapsedColumns = useCollapsedSections(BOARD_COLUMN_COLLAPSE_KEY, DEFAULT_COLLAPSED_COLUMN_IDS)
  expandColumnRef.current = collapsedColumns.expand

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
    const columnOperations = operations.filter((op) => column.status.includes(op.status)).sort(cmp)
    const ordered = columnOperations.map((op) => op.id)

    // Replace only this column's slots so every other column keeps its order.
    setOperations((prev) => {
      let nextIndex = 0
      return prev.map((op) => column.status.includes(op.status) ? columnOperations[nextIndex++] : op)
    })
    // No toast: the column reorders under the operator's eyes, so confirming it
    // in words is noise on a surface whose job is staying calm.
    reorderColumn(ordered)
  }, [operations, groups, setOperations, reorderColumn])

  // Open the "Ressourcen übertragen" dialog from the card context menu. Loads the
  // event's incidents as transfer targets (mirrors side-panel's handleOpenTransfer).
  const handleOpenTransfer = useCallback(async (operationId: string) => {
    const op = operations.find(o => o.id === operationId)
    if (!op || !selectedEvent) {
      toast.error(tCommon('error'), { description: tCommon('noEventSelected') })
      return
    }
    try {
      const apiIncidents = await apiClient.getIncidents(selectedEvent.id)
      const incidents: Incident[] = apiIncidents.map(inc => {
        const { location_lat, location_lng, created_at, updated_at, status_changed_at, completed_at, reko_arrived_at, assigned_vehicles, ...rest } = inc
        return {
          ...rest,
          location_lat: location_lat !== null ? parseFloat(location_lat) : null,
          location_lng: location_lng !== null ? parseFloat(location_lng) : null,
          created_at: new Date(created_at),
          updated_at: new Date(updated_at),
          status_changed_at: status_changed_at ? new Date(status_changed_at) : null,
          completed_at: completed_at ? new Date(completed_at) : null,
          reko_arrived_at: reko_arrived_at ? new Date(reko_arrived_at) : null,
          assigned_vehicles: assigned_vehicles.map(v => ({ ...v, assigned_at: new Date(v.assigned_at) })),
        }
      })
      setTransferAvailableIncidents(incidents)
      setTransferSourceOp(op)
    } catch (error) {
      console.error("Failed to load incidents:", error)
      toast.error(tCommon('loadFailed'))
    }
  }, [operations, selectedEvent, tCommon, setTransferAvailableIncidents, setTransferSourceOp])

  // Perform the transfer. The backend returns a specific German reason on failure.
  const handleTransfer = useCallback(async (targetIncidentId: string) => {
    if (!transferSourceOp) return
    try {
      setIsTransferring(true)
      await apiClient.transferAssignments(transferSourceOp.id, targetIncidentId)
      setTransferSourceOp(null)
      toast.success(tCommon('transferResources'))
    } catch (error) {
      toast.error(tCommon('transferFailed'), {
        description: (error instanceof Error && error.message) || tCommon('transferFailedDescription'),
      })
    } finally {
      setIsTransferring(false)
    }
  }, [transferSourceOp, tCommon, setIsTransferring, setTransferSourceOp])

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

    const currentColumnIndex = columns.findIndex((col) => col.status.includes(operation.status))
    if (currentColumnIndex < columns.length - 1) {
      const nextColumn = columns[currentColumnIndex + 1]
      const newStatus = nextColumn.status[0] as OperationStatus
      const previousStatus = operation.status
      updateOperation(operationId, { status: newStatus })
      notifyStatusMove(operation, newStatus)
      if (newStatus === "enroute") triggerDisponiertDialog(operationId, previousStatus)
      if (newStatus === "reko") triggerRekoCheck(operationId, previousStatus)
      if (newStatus === "reko_done") triggerRekoFormCheck(operationId, previousStatus)
      if (newStatus === "returning") triggerReturningVehicleCheck(operationId, previousStatus)
      if (newStatus === "complete") promptMaterialDecision(operationId, previousStatus)
    }
  }, [operations, updateOperation, notifyStatusMove, triggerDisponiertDialog, triggerRekoCheck, triggerRekoFormCheck, triggerReturningVehicleCheck, promptMaterialDecision])

  const moveOperationLeft = useCallback((operationId: string) => {
    const operation = operations.find(op => op.id === operationId)
    if (!operation) return

    const currentColumnIndex = columns.findIndex((col) => col.status.includes(operation.status))
    if (currentColumnIndex > 0) {
      const prevColumn = columns[currentColumnIndex - 1]
      const newStatus = prevColumn.status[0] as OperationStatus
      const previousStatus = operation.status
      updateOperation(operationId, { status: newStatus })
      notifyStatusMove(operation, newStatus)
      // Backwards into «Disponiert / Anfahrt» is a correction, not a new
      // dispatch — the workflow decides which dialog that means.
      if (newStatus === "enroute") triggerDisponiertDialog(operationId, previousStatus)
    }
  }, [operations, updateOperation, notifyStatusMove, triggerDisponiertDialog])

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
      if (op.groupId) {
        const existing = getGroupResources(op.groupId).vehicles.find((v) => v.resourceId === vehicle.id)
        if (existing) {
          void release.releaseRouteResource(op.groupId, existing.assignmentId)
        } else {
          assignGroupResource(op.groupId, "vehicle", vehicle.id)
          notify(true)
        }
        return
      }
      if (op.vehicles.includes(vehicle.name)) {
        void release.releaseVehicle(op.id, vehicle.name)
      } else {
        assignVehicleToOperation(vehicle.id, vehicle.name, op.id)
        notify(true)
      }
    },
    [getGroupResources, release, assignGroupResource, assignVehicleToOperation, tCommon],
  )

  /** Priority by keystroke — the card only shows it as a small chevron, so the
   *  change says itself. */
  const setOperationPriority = useCallback((operationId: string, priority: Operation["priority"]) => {
    const operation = operations.find((op) => op.id === operationId)
    if (!operation) return
    const previous = operation.priority
    updateOperation(operationId, { priority })
    toast.success(
      tCommon('priorityChangedToast', {
        name: getIncidentLocationLabel(operation),
        priority: tCommon(PRIORITY_LABEL_KEYS[priority]),
      }),
      previous === priority ? undefined : {
        action: {
          label: tNotifications('undoLabel'),
          onClick: () => updateOperation(operationId, { priority: previous }),
        },
      },
    )
  }, [operations, updateOperation, tCommon, tNotifications])

  /** «Zu Fuss» by keystroke — a vehicle-less dispatch is a radio-relevant fact. */
  const toggleZuFuss = useCallback((operationId: string) => {
    const operation = operations.find((op) => op.id === operationId)
    if (!operation) return
    const next = !operation.zuFuss
    updateOperation(operationId, { zuFuss: next })
    toast.success(
      tCommon(next ? 'zuFussOnToast' : 'zuFussOffToast', { name: getIncidentLocationLabel(operation) }),
      {
        action: {
          label: tNotifications('undoLabel'),
          onClick: () => updateOperation(operationId, { zuFuss: !next }),
        },
      },
    )
  }, [operations, updateOperation, tCommon, tNotifications])

  /** The driver decision is read out on the radio and printed on the slip, so
   *  the pill's click gets the same receipt as every other card mutation. The
   *  underlying hook is optimistic and toasts on failure by itself. */
  const handleToggleDriverStay = useCallback((operationId: string, vehicleName: string) => {
    const operation = operations.find((op) => op.id === operationId)
    const next = !(operation?.vehicleDriverStay?.get(vehicleName) ?? false)
    toggleDriverStay(operationId, vehicleName)
    toast.success(
      tCommon(next ? 'driverStaysToast' : 'driverReturnsToast', { vehicle: vehicleName }),
      {
        description: tCommon('driverStayToastHint'),
        action: {
          label: tNotifications('undoLabel'),
          onClick: () => toggleDriverStay(operationId, vehicleName),
        },
      },
    )
  }, [operations, toggleDriverStay, tCommon, tNotifications])

  /** Stage an incident for the delete confirmation — the context menu's
   *  destructive row and the Delete key share this one path. */
  const handleRequestDelete = useCallback((operationId: string) => {
    const operation = operations.find((op) => op.id === operationId)
    if (!operation) return
    setOperationToDelete(operation)
    setDeleteDialogOpen(true)
  }, [operations, setDeleteDialogOpen, setOperationToDelete])

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

  return {
    setRouteStopStatus,
    collapsedColumns,
    handleColumnSort,
    handleOpenTransfer,
    handleTransfer,
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
