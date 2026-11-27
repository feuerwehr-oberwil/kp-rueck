"use client"

import { useOperations, type OperationStatus } from "@/lib/contexts/operations-context"
import { useGroups } from "@/lib/contexts/groups-context"
import { usePersonnel } from "@/lib/contexts/personnel-context"
import { useMaterials } from "@/lib/contexts/materials-context"
import { useAuth } from "@/lib/contexts/auth-context"
import { useKanbanDragDrop } from "@/lib/hooks/use-kanban-drag-drop"
import type { GroupResourceType } from "@/lib/api-client"
import type { useClosedStopGuard } from "@/lib/hooks/use-closed-stop-guard"
import { getIncidentRefParts } from "@/lib/incident-types"
import { planNext } from "@/lib/planned-actions"
import type { IncidentStatusWorkflowController } from "@/components/kanban/incident-status/use-incident-status-workflow"
import type { BoardCardActions } from "@/components/board/use-board-card-actions"

/** The board's conflict-aware assigns – see `useBoardDrops`. */
export type BoardDrops = ReturnType<typeof useBoardDrops>

interface UseBoardDropsInput {
  cardActions: Pick<
    BoardCardActions,
    | "groupsHolding"
    | "askRouteConflict"
    | "releaseFromGroups"
    | "assignVehicleToGroupWithConflict"
    | "assignVehicleToIncidentWithConflict"
  >
  statusWorkflow: IncidentStatusWorkflowController
  /** The page's one closed-stop confirmation (its prompt renders in `BoardDialogs`). */
  closedStopGuard: ReturnType<typeof useClosedStopGuard>
  isMounted: boolean
  /** A card was dropped: the page selects it. */
  onOperationDrop: (operationId: string) => void
}

/**
 * The board's drag and drop, and the conflict-aware assigns a drop calls. ⌘K's
 * type-to-dispatch goes through the very same functions (`useBoardDispatch` runs
 * them through `applyResourceDrop`), so a typed «14 meier» asks exactly what
 * dragging Meier onto Einsatz 14 asks.
 */
export function useBoardDrops({ cardActions, statusWorkflow, closedStopGuard, isMounted, onOperationDrop }: UseBoardDropsInput) {
  const {
    operations,
    updateOperation,
    reorderColumn,
    assignPersonToOperation,
    assignRekoPersonToOperation,
    assignMaterialToOperation,
    removeCrew,
    removeMaterial,
  } = useOperations()
  const { groups, addStops: addStopsToGroup, assignResource: assignGroupResource } = useGroups()
  const { personnel } = usePersonnel()
  const { materials } = useMaterials()
  const { isEditor } = useAuth()
  const {
    groupsHolding,
    askRouteConflict,
    releaseFromGroups,
    assignVehicleToGroupWithConflict,
    assignVehicleToIncidentWithConflict,
  } = cardActions
  const {
    triggerDisponiertDialog,
    triggerRekoCheck,
    triggerReturningVehicleCheck,
    promptMaterialDecision,
    holdStatusMove,
  } = statusWorkflow

  // Person/Material onto an INCIDENT: if a route already holds them, ask the
  // same Doppelbelegung question vehicles have always asked instead of
  // refusing the drop outright.
  /** An Einsatz as a «Danach vormerken» target, named the way the conflict prompt names it. */
  const incidentTarget = (operationId: string) => {
    const op = operations.find((o) => o.id === operationId)
    return { kind: "incident" as const, id: operationId, label: op ? getIncidentRefParts(op).head : "" }
  }

  const boardAssignPerson = (personId: string, personName: string, operationId: string) => {
    const holders = groupsHolding("personnel", personId)
    if (holders.length === 0) {
      void assignPersonToOperation(personId, personName, operationId)
      return
    }
    askRouteConflict({
      resourceType: "personnel",
      resourceId: personId,
      resourceName: personName,
      targetId: operationId,
      conflicts: holders.map((group) => ({ operationId: group.id, operationLabel: group.name })),
      releases: releaseFromGroups("personnel", personId, holders),
      assign: () => assignPersonToOperation(personId, personName, operationId),
      plan: () => planNext("personnel", personId, personName, incidentTarget(operationId)),
    })
  }

  // A consumable never asks: several Einsätze and Aufträge draw from the same Bindemittel.
  const isConsumable = (materialId: string) => materials.some((m) => m.id === materialId && m.consumable)

  const boardAssignMaterial = (materialId: string, operationId: string) => {
    const holders = isConsumable(materialId) ? [] : groupsHolding("material", materialId)
    if (holders.length === 0) {
      void assignMaterialToOperation(materialId, operationId)
      return
    }
    const name = materials.find((m) => m.id === materialId)?.name ?? materialId
    askRouteConflict({
      resourceType: "material",
      resourceId: materialId,
      resourceName: name,
      targetId: operationId,
      conflicts: holders.map((group) => ({ operationId: group.id, operationLabel: group.name })),
      releases: releaseFromGroups("material", materialId, holders),
      assign: () => assignMaterialToOperation(materialId, operationId),
      plan: () => planNext("material", materialId, name, incidentTarget(operationId)),
    })
  }

  const boardAssignGroupResource = (groupId: string, resourceType: GroupResourceType, resourceId: string) => {
    if (resourceType === "vehicle") {
      void assignVehicleToGroupWithConflict(groupId, resourceId)
      return
    }
    // Onto ANOTHER Auftrag: same question again, «bisher» being the route that
    // holds them now. `exceptGroupId` keeps a drop onto the route a resource is
    // already on from asking about itself.
    if (resourceType === "material" && isConsumable(resourceId)) {
      void assignGroupResource(groupId, resourceType, resourceId)
      return
    }
    const holders = groupsHolding(resourceType, resourceId, groupId)
    const name =
      resourceType === "personnel"
        ? personnel.find((p) => p.id === resourceId)?.name ?? resourceId
        : materials.find((m) => m.id === resourceId)?.name ?? resourceId
    // ALSO the Einsätze that hold it. A route conflict is not the only kind:
    // dropping somebody who is crew on «Bahnhofstrasse 12» onto an Auftrag used
    // to put them on both without a word, while the same drag with a vehicle
    // asked — `assignVehicleToGroupWithConflict` has always collected both.
    const incidentHolders =
      resourceType === "personnel"
        ? operations.filter((op) => op.crew.some((m) => m.personnelId === resourceId))
        : operations.filter((op) => op.materials.includes(resourceId))
    if (holders.length === 0 && incidentHolders.length === 0) {
      void assignGroupResource(groupId, resourceType, resourceId)
      return
    }
    askRouteConflict({
      resourceType,
      resourceId,
      resourceName: name,
      targetId: groupId,
      conflicts: [
        ...holders.map((group) => ({ operationId: group.id, operationLabel: group.name })),
        ...incidentHolders.map((op) => ({ operationId: op.id, operationLabel: getIncidentRefParts(op).head })),
      ],
      releases: [
        ...releaseFromGroups(resourceType, resourceId, holders),
        ...incidentHolders.map((op) => () =>
          resourceType === "personnel" ? removeCrew(op.id, resourceId) : removeMaterial(op.id, resourceId),
        ),
      ],
      assign: () => assignGroupResource(groupId, resourceType, resourceId),
      plan: () =>
        planNext(resourceType, resourceId, name, {
          kind: "group",
          id: groupId,
          label: groups.find((group) => group.id === groupId)?.name ?? "",
        }),
    })
  }

  // What a card arriving in a column asks — after a drag across, and after a
  // typed «14 einsatz» (⌘K), which is the same move. «Reko abgeschlossen» without
  // a report asks BEFORE the move instead (`holdStatusMove`).
  const afterStatusMove = (operationId: string, newStatus: OperationStatus, previousStatus: OperationStatus) => {
    if (newStatus === "enroute") triggerDisponiertDialog(operationId, previousStatus)
    if (newStatus === "reko") triggerRekoCheck(operationId, previousStatus)
    if (newStatus === "returning") triggerReturningVehicleCheck(operationId, previousStatus)
    // Drag-to-ABGESCHLOSSEN already ran updateOperation(complete) inside the hook
    // (which keeps materials). Just prompt the material decision here.
    if (newStatus === "complete") promptMaterialDecision(operationId, previousStatus)
  }

  // Use shared drag-and-drop hook
  useKanbanDragDrop({
    isMounted,
    canEdit: isEditor,
    operations,
    updateOperation,
    reorderColumn,
    assignPersonToOperation: boardAssignPerson,
    assignRekoPersonToOperation,
    assignMaterialToOperation: boardAssignMaterial,
    assignVehicleToOperation: assignVehicleToIncidentWithConflict,
    onOperationDrop,
    onStatusChange: afterStatusMove,
    holdStatusChange: holdStatusMove,
    // Aufträge (route) drop targets — see auftraege-sheet.tsx for the registered
    // drop-target data contract (`group-row` / `group-stop`).
    groups,
    // Dragging a card onto an Auftrag goes through the same closed-incident
    // confirmation as the stop picker — the drop is just another way to attach.
    addStopsToGroup: (groupId, incidentIds) => {
      closedStopGuard.guard(incidentIds, () => { void addStopsToGroup(groupId, incidentIds) })
    },
    assignGroupResource: boardAssignGroupResource,
  })

  return {
    boardAssignPerson,
    boardAssignMaterial,
    boardAssignGroupResource,
    assignVehicleToIncidentWithConflict,
    afterStatusMove,
  }
}
