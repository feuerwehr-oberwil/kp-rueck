"use client"

import { useTranslations } from "next-intl"
import { materialResourceState } from "@/lib/resource-status"
import { toast } from "sonner"
import { type Person, type Operation, type Material, type OperationStatus } from "@/lib/contexts/operations-context"
import { type GroupResourceType } from "@/lib/api-client"
import { useOperationHandlers } from "@/lib/hooks/use-operation-handlers"
import { applyResourceDrop } from "@/lib/hooks/use-kanban-drag-drop"
import { useCommandDispatch, type DispatchCommand } from "@/lib/hooks/use-command-dispatch"
import type { DispatchResource, DispatchVocabulary } from "@/lib/command-dispatch"
import { type OperationDetailSection, type OperationDetailTab } from "@/lib/hooks/use-operation-detail-shortcuts"
import { getIncidentLocationLabel, getIncidentTypeLabel } from "@/lib/incident-types"
import { soleDestination, type ResourceBinding } from "@/lib/board-sidebar"
import { type FooterSheet } from "@/components/board/board-footer"
import type { GroupResources, IncidentGroup } from "@/lib/types/groups"
import type { Dispatch, SetStateAction, RefObject } from "react"
import type { Released } from "@/lib/release-undo"
import type { ApiVehicle } from "@/lib/api-client"
import type { VehicleNeedingDriver } from "@/lib/contexts/operations-context"
import type { SyncMessageType } from "@/lib/hooks/use-cross-window-sync"
import { PRIORITY_LABEL_KEYS } from "./use-board-card-actions"

export interface UseBoardDispatchInput {
  removeReko: (operationId: string) => void
  operations: Operation[]
  outOfServiceVehicleIds: Set<string>
  assignVehicleToOperation: (vehicleId: string, vehicleName: string, operationId: string) => Promise<boolean>
  materials: Material[]
  removeCrew: (operationId: string, crewName: string) => Promise<boolean>
  removeMaterial: (operationId: string, materialId: string) => Promise<boolean>
  removeVehicle: (operationId: string, vehicleName: string) => Promise<boolean>
  deleteOperation: (operationId: string) => Promise<void>
  resourceConflict: { resourceType: "personnel" | "vehicle" | "material"; resourceId: string; resourceName: string; targetOperationId: string; targetOperationLabel?: string; conflicts: { operationId: string; operationLabel: string; }[]; customResolve?: (action: "move" | "keep") => Promise<void> | void; } | null
  vehicleNeedingDriver: VehicleNeedingDriver | null
  updateOperation: (operationId: string, updates: Partial<Operation>) => void
  fleet: ApiVehicle[]
  isAssignmentSettling: () => boolean
  assignRekoPersonToOperation: (personId: string, personName: string, operationId: string) => void
  getGroupResources: (groupId: string) => GroupResources
  groups: IncidentGroup[]
  unassignGroupResource: (groupId: string, assignmentId: string) => Promise<boolean>
  release: { releaseCrew: (operationId: string, crewName: string) => Promise<boolean>; releaseMaterial: (operationId: string, materialId: string) => Promise<boolean>; releaseVehicle: (operationId: string, vehicleName: string) => Promise<boolean>; releaseStop: (groupId: string, incidentId: string) => Promise<boolean>; releaseRouteResource: (groupId: string, assignmentId: string) => Promise<boolean>; restore: (item: Released) => Promise<void>; }
  dispatchRef: RefObject<{ vocabulary: () => DispatchVocabulary; run: (command: DispatchCommand) => void; jump: (target: DispatchResource) => void; }>
  personnel: Person[]
  operationsRef: RefObject<Operation[]>
  setPersonnelSearchQuery: Dispatch<SetStateAction<string>>
  setMaterialSearchQuery: Dispatch<SetStateAction<string>>
  selectedOperation: Operation | null
  setShowRightSidebar: Dispatch<SetStateAction<boolean>>
  setShowLeftSidebar: Dispatch<SetStateAction<boolean>>
  openIncidentDetail: (operationId: string, tab?: OperationDetailTab, section?: OperationDetailSection, options?: { allowModal?: boolean; }) => void
  setActiveFooterSheet: Dispatch<SetStateAction<FooterSheet | null>>
  setAuftraegeFocusGroupId: Dispatch<SetStateAction<string | null>>
  broadcast: (type: SyncMessageType, incidentId: string | null) => void
  isDraggingOperationRef: RefObject<boolean>
  assignVehicleToIncidentWithConflict: (vehicleId: string, vehicleName: string, operationId: string) => void
  boardAssignPerson: (personId: string, personName: string, operationId: string) => void
  boardAssignMaterial: (materialId: string, operationId: string) => void
  boardAssignGroupResource: (groupId: string, resourceType: GroupResourceType, resourceId: string) => void
  afterStatusMove: (operationId: string, newStatus: OperationStatus, previousStatus: OperationStatus) => void
  collectPersonBindings: (person: Person) => ResourceBinding[]
  collectMaterialBindings: (material: Material) => ResourceBinding[]
  followBinding: (binding: ResourceBinding) => void
}

/**
 * Type-to-dispatch (⌘K «14 tlf meier») and the card handlers that share its
 * plumbing: the dispatch vocabulary, the drop-path runner, jumping to a resource,
 * and the card update/remove/assign/delete/click handlers. Moved verbatim out of
 * app/page.tsx.
 */
export function useBoardDispatch(input: UseBoardDispatchInput) {
  const {
    removeReko,
    operations,
    outOfServiceVehicleIds,
    assignVehicleToOperation,
    materials,
    removeCrew,
    removeMaterial,
    removeVehicle,
    deleteOperation,
    resourceConflict,
    vehicleNeedingDriver,
    updateOperation,
    fleet,
    isAssignmentSettling,
    assignRekoPersonToOperation,
    getGroupResources,
    groups,
    unassignGroupResource,
    release,
    dispatchRef,
    personnel,
    operationsRef,
    setPersonnelSearchQuery,
    setMaterialSearchQuery,
    selectedOperation,
    setShowRightSidebar,
    setShowLeftSidebar,
    openIncidentDetail,
    setActiveFooterSheet,
    setAuftraegeFocusGroupId,
    broadcast,
    isDraggingOperationRef,
    assignVehicleToIncidentWithConflict,
    boardAssignPerson,
    boardAssignMaterial,
    boardAssignGroupResource,
    afterStatusMove,
    collectPersonBindings,
    collectMaterialBindings,
    followBinding,
  } = input
  const tCommon = useTranslations('kanban.common')
  // Column titles, for the toasts a keyboard mutation raises.
  const tColumns = useTranslations('kanban.columns')
  // The board's one «Rückgängig» label — reused rather than copied.
  const tNotifications = useTranslations('notifications.operations')
  // ⌘K type-to-dispatch receipts.
  const tPalette = useTranslations('common.commandPalette')

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
      incidentIds: operations
        .filter((op) => op.crew.includes(person.name) || op.assignedReko?.id === person.id)
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
        incidentIds: operations.filter((op) => op.vehicles.includes(vehicle.name)).map((op) => op.id),
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
    const destination = { type: "operation-drop", operationId }
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
      updateOperation(operationId, { status })
      afterStatusMove(operationId, status, previous)
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
      // Said, not hidden: a «Hierher verschieben» took them off somewhere, and
      // «Rückgängig» puts them back there.
      for (const item of outcome.moved) {
        parts.push(tPalette('dispatch.toastMoved', { name: item.name, from: item.targetLabel }))
      }
      if (outcome.status) parts.push(tPalette('dispatch.toastStatus', { status: tColumns(outcome.status.to) }))
      if (outcome.priority) {
        parts.push(tPalette('dispatch.toastPriority', { priority: tCommon(PRIORITY_LABEL_KEYS[outcome.priority.to]) }))
      }
      toast.success(
        tPalette('dispatch.toastTitle', {
          number: outcome.operation.number ?? "",
          name: getIncidentLocationLabel(outcome.operation),
        }),
        {
          description: parts.join(" · "),
          action: {
            label: tNotifications('undoLabel'),
            onClick: () => {
              void undo().then(() => toast.success(tPalette('dispatch.toastUndone')))
            },
          },
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
      const onIncident = operations.find((op) => op.vehicles.includes(target.name))
      const onRoute = groups.find((group) =>
        group.assignments.some((assignment) => assignment.resourceType === "vehicle" && assignment.resourceId === target.id),
      )
      if (onIncident) {
        followBinding({ key: `incident-${onIncident.id}`, kind: "incident", targetId: onIncident.id, label: "", detail: "" })
      } else if (onRoute) {
        setAuftraegeFocusGroupId(onRoute.id)
        setActiveFooterSheet('auftraege')
      } else {
        // Nowhere: the Fahrzeuge sheet is where a free vehicle is seen.
        setActiveFooterSheet('vehicles')
      }
    }
  }

  dispatchRef.current = {
    vocabulary: dispatchVocabulary,
    run: (command) => {
      void runDispatch(command)
    },
    jump: jumpFromPalette,
  }

  // Use shared operation handlers hook
  const { handleOperationUpdate, handleVehicleRemove, handleVehicleAssign, handleOperationDelete } = useOperationHandlers({
    selectedOperation,
    updateOperation,
    removeVehicle: release.releaseVehicle,
    assignVehicleToOperation,
    deleteOperation,
  })

  // `tab`/`section` come from the card and say which BLOCK was clicked — the
  // card routes into the detail rather than always landing on one tab. Both
  // handlers just forward them; the card decides which of the two it calls
  // (modal below the side-panel breakpoint, selection above it).
  const handleCardClick = (operation: Operation, tab?: OperationDetailTab, section?: OperationDetailSection) => {
    // Don't open modal if we just finished dragging
    if (isDraggingOperationRef.current) {
      return
    }
    openIncidentDetail(operation.id, tab, section)
    broadcast("incident:selected", operation.id)
  }

  const handleCardSelect = (operation: Operation, tab?: OperationDetailTab, section?: OperationDetailSection) => {
    openIncidentDetail(operation.id, tab, section)
  }

  return {
    handleVehicleAssign,
    handleOperationDelete,
    handleVehicleRemove,
    handleOperationUpdate,
    handleCardClick,
    handleCardSelect,
  }
}
