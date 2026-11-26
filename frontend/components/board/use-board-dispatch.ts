"use client"

import { useRef, type Dispatch, type SetStateAction } from "react"
import { useTranslations } from "next-intl"
import { materialResourceState } from "@/lib/resource-status"
import { toast } from "sonner"
import { undoToast } from "@/lib/toast-undo"
import { useOperations, type OperationStatus } from "@/lib/contexts/operations-context"
import { useGroups } from "@/lib/contexts/groups-context"
import { usePersonnel } from "@/lib/contexts/personnel-context"
import { useMaterials } from "@/lib/contexts/materials-context"
import { useReleaseUndo } from "@/lib/hooks/use-release-undo"
import { applyResourceDrop } from "@/lib/hooks/use-kanban-drag-drop"
import type { BoardDropTarget } from "@/lib/board-drag"
import { useCommandDispatch, type DispatchCommand } from "@/lib/hooks/use-command-dispatch"
import { usePersonPlaces } from "@/lib/hooks/use-person-matcher"
import type { DispatchResource, DispatchVocabulary } from "@/lib/command-dispatch"
import { RESOURCES_TARGET } from "@/lib/detail-target"
import { getIncidentLocationLabel, getIncidentTypeLabel } from "@/lib/incident-types"
import { soleDestination } from "@/lib/board-sidebar"
import type { useResourceBindings } from "./use-resource-bindings"
import type { BoardDrops } from "./use-board-drops"
import type { BoardLayout } from "./use-board-selection"
import type { BoardSheets } from "./use-board-sheets"
import { PRIORITY_LABEL_KEYS } from "./use-board-card-actions"

/** ⌘K's dispatch, read through a ref by the palette – see `useBoardDispatch`. */
export type BoardDispatchRef = ReturnType<typeof useBoardDispatch>

interface UseBoardDispatchInput {
  drops: BoardDrops
  /** Asked before ⌘K moves a card – see `holdStatusMove` in incident-status-workflow. */
  holdStatusMove: (operationId: string, targetStatus: OperationStatus) => boolean
  resourceBindings: Pick<ReturnType<typeof useResourceBindings>, "collectPersonBindings" | "collectMaterialBindings" | "followBinding">
  layout: Pick<BoardLayout, "setShowLeftSidebar" | "setShowRightSidebar">
  sheets: Pick<BoardSheets, "setActiveFooterSheet" | "setAuftraegeFocusGroupId">
  setPersonnelSearchQuery: Dispatch<SetStateAction<string>>
  setMaterialSearchQuery: Dispatch<SetStateAction<string>>
}

/**
 * Type-to-dispatch (⌘K «14 tlf meier»): the dispatch vocabulary, the drop-path
 * runner and jumping to a resource. Reads the board contexts itself. Returns a
 * ref that always holds this render's `{ vocabulary, run, jump }`, so the palette
 * registration (`useBoardCommandHandlers`) need not re-run on every board change.
 */
export function useBoardDispatch({
  drops,
  holdStatusMove,
  resourceBindings,
  layout,
  sheets,
  setPersonnelSearchQuery,
  setMaterialSearchQuery,
}: UseBoardDispatchInput) {
  const {
    operations,
    outOfServiceVehicleIds,
    vehicles: fleet,
    removeCrew,
    removeMaterial,
    removeVehicle,
    removeReko,
    updateOperation,
    resourceConflict,
    vehicleNeedingDriver,
    isAssignmentSettling,
    assignRekoPersonToOperation,
  } = useOperations()
  const { personnel } = usePersonnel()
  const { materials } = useMaterials()
  const { groups, getGroupResources, unassignResource: unassignGroupResource } = useGroups()
  const release = useReleaseUndo()
  // The run reads the board as it is when a step lands, not as it was at ↵.
  const operationsRef = useRef(operations)
  operationsRef.current = operations
  const { boardAssignPerson, boardAssignMaterial, boardAssignGroupResource, assignVehicleToIncidentWithConflict, afterStatusMove } = drops
  const { collectPersonBindings, collectMaterialBindings, followBinding } = resourceBindings
  const { setShowLeftSidebar, setShowRightSidebar } = layout
  const { setActiveFooterSheet, setAuftraegeFocusGroupId } = sheets
  const tCommon = useTranslations('kanban.common')
  // Column titles, for the toasts a keyboard mutation raises.
  const tColumns = useTranslations('kanban.columns')
  // ⌘K type-to-dispatch receipts.
  const tPalette = useTranslations('common.commandPalette')
  // ⌘K also finds people by where they are now («12», «Sturmholz»), like every person picker.
  const personPlaces = usePersonPlaces()

  // ---------------------------------------------------------------------------
  // Type-to-dispatch (⌘K «14 tlf meier», `lib/command-dispatch.ts`). The parser
  // reads the vocabulary below; ↵ runs through the drop path
  // (`applyResourceDrop` with the board's own wrappers) so nothing a drag would
  // ask is skipped; «meier» alone answers «wo ist Meier?» like a sidebar click.
  const dispatchVocabulary = (): DispatchVocabulary => ({
    incidents: operations
      .filter((op) => typeof op.number === "number")
      .map((op) => ({
        id: op.id,
        number: op.number as number,
        label: getIncidentLocationLabel(op),
        type: getIncidentTypeLabel(op.incidentType),
        status: op.status,
        priority: op.priority,
      })),
    persons: personnel.map((person) => ({
      id: person.id,
      name: person.name,
      detail: person.role || undefined,
      search: { ...person, places: personPlaces.get(person.id) },
      incidentIds: operations
        .filter((op) => op.crew.some((m) => m.personnelId === person.id) || op.assignedReko?.id === person.id)
        .map((op) => op.id),
    })),
    vehicles: fleet
      .filter((vehicle) => !vehicle.archived_at)
      .map((vehicle) => ({
        id: vehicle.id,
        name: vehicle.name,
        type: vehicle.type,
        callSign: vehicle.radio_call_sign || undefined,
        detail: vehicle.radio_call_sign || undefined,
        outOfService: outOfServiceVehicleIds.has(vehicle.id),
        incidentIds: operations.filter((op) => op.vehicles.some((v) => v.vehicleId === vehicle.id)).map((op) => op.id),
      })),
    materials: materials.map((material) => ({
      id: material.id,
      name: material.name,
      detail: material.category || undefined,
      outOfService: material.outOfService,
      available: materialResourceState(material) === "available",
      incidentIds: operations.filter((op) => op.materials.includes(material.id)).map((op) => op.id),
    })),
  })

  const assignFromPalette = (resource: DispatchResource, operationId: string) => {
    const destination = { type: "operation-drop", operationId } satisfies BoardDropTarget
    const deps = {
      operations,
      assignPersonToOperation: boardAssignPerson,
      assignRekoPersonToOperation,
      assignMaterialToOperation: boardAssignMaterial,
      assignVehicleToOperation: assignVehicleToIncidentWithConflict,
      assignGroupResource: boardAssignGroupResource,
    }
    if (resource.kind === "person") {
      const person = personnel.find((candidate) => candidate.id === resource.id)
      if (person) applyResourceDrop({ type: "person", person }, destination, deps)
    } else if (resource.kind === "vehicle") {
      applyResourceDrop({ type: "driver-vehicle", vehicleId: resource.id, vehicleName: resource.name }, destination, deps)
    } else {
      const material = materials.find((candidate) => candidate.id === resource.id)
      if (material) applyResourceDrop({ type: "material", material }, destination, deps)
    }
  }

  const runDispatch = useCommandDispatch({
    getOperation: (operationId) => operationsRef.current.find((op) => op.id === operationId),
    getGroupResources,
    // The Doppelbelegung prompt and the driver prompt a vehicle raises when it
    // lands without a driver — each waits for the one before it — and the
    // context's own signal that an assignment may still ask (driver check,
    // a resolved move still re-assigning).
    isQuestionOpen: () => resourceConflict !== null || vehicleNeedingDriver !== null || isAssignmentSettling(),
    getOperations: () => operationsRef.current,
    getGroupsHolding: (resource) =>
      groups.filter((group) =>
        group.assignments.some(
          (assignment) =>
            assignment.resourceId === resource.id &&
            assignment.resourceType === (resource.kind === "person" ? "personnel" : resource.kind),
        ),
      ),
    labelOf: (operation) => getIncidentLocationLabel(operation),
    restore: release.restore,
    assign: assignFromPalette,
    setPriority: (operationId, priority) => updateOperation(operationId, { priority }),
    moveStatus: (operationId, status, previous) => {
      if (holdStatusMove(operationId, status)) return false
      updateOperation(operationId, { status })
      afterStatusMove(operationId, status, previous)
      return true
    },
    revertPriority: (operationId, priority) => updateOperation(operationId, { priority }),
    revertStatus: (operationId, status) => updateOperation(operationId, { status }),
    removeCrew,
    removeReko,
    removeVehicle,
    removeMaterial,
    unassignGroupResource,
    report: (outcome, undo) => {
      const parts: string[] = []
      if (outcome.assigned.length > 0) {
        parts.push(tPalette('dispatch.toastAssigned', { names: outcome.assigned.map((resource) => resource.name).join(", ") }))
      }
      // Said, not hidden: a «Jetzt verschieben» took them off somewhere, and
      // «Rückgängig» puts them back there.
      for (const item of outcome.moved) {
        parts.push(tPalette('dispatch.toastMoved', { name: item.name, from: item.targetLabel }))
      }
      if (outcome.status) parts.push(tPalette('dispatch.toastStatus', { status: tColumns(outcome.status.to) }))
      if (outcome.priority) {
        parts.push(tPalette('dispatch.toastPriority', { priority: tCommon(PRIORITY_LABEL_KEYS[outcome.priority.to]) }))
      }
      undoToast(
        tPalette('dispatch.toastTitle', {
          number: outcome.operation.number ?? "",
          name: getIncidentLocationLabel(outcome.operation),
        }),
        {
          description: parts.join(" · "),
          onUndo: () => undo().then(() => toast.success(tPalette('dispatch.toastUndone'))),
        },
      )
    },
  })

  const jumpFromPalette = (target: DispatchResource) => {
    if (target.kind === "person") {
      const person = personnel.find((candidate) => candidate.id === target.id)
      if (!person) return
      const only = soleDestination(collectPersonBindings(person))
      if (only) followBinding(only)
      else {
        // Free, or in several places: the sidebar row says which.
        setShowLeftSidebar(true)
        setPersonnelSearchQuery(person.name)
      }
    } else if (target.kind === "material") {
      const material = materials.find((candidate) => candidate.id === target.id)
      if (!material) return
      const only = soleDestination(collectMaterialBindings(material))
      if (only) followBinding(only)
      else {
        setShowRightSidebar(true)
        setMaterialSearchQuery(material.name)
      }
    } else {
      const onIncident = operations.find((op) => op.vehicles.some((v) => v.vehicleId === target.id))
      const onRoute = groups.find((group) =>
        group.assignments.some((assignment) => assignment.resourceType === "vehicle" && assignment.resourceId === target.id),
      )
      if (onIncident) {
        followBinding({ kind: "incident", targetId: onIncident.id, target: RESOURCES_TARGET })
      } else if (onRoute) {
        setAuftraegeFocusGroupId(onRoute.id)
        setActiveFooterSheet('auftraege')
      } else {
        // Nowhere: the Fahrzeuge sheet is where a free vehicle is seen.
        setActiveFooterSheet('vehicles')
      }
    }
  }

  const dispatch = {
    vocabulary: dispatchVocabulary,
    run: (command: DispatchCommand) => {
      void runDispatch(command)
    },
    jump: jumpFromPalette,
  }
  const dispatchRef = useRef(dispatch)
  dispatchRef.current = dispatch
  return dispatchRef
}
