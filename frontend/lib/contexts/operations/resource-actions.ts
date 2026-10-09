/**
 * Putting resources on incidents and taking them off: crew, Reko, material and
 * vehicles, the Doppelbelegung prompt and the driver check after a vehicle lands.
 * Moved verbatim out of `OperationsProvider` (see `BoardMutationContext`).
 */

import { apiClient, ApiError } from "@/lib/api-client"
import { getIncidentRefLabel } from "@/lib/incident-types"
import type { PersonStatus } from "../personnel-context"
import type { Material } from "../materials-context"
import { toast } from "sonner"
import { translateOutsideReact } from "@/lib/i18n-messages"
import { findRecentRemoval, recordRemoval } from "@/lib/recent-removals"
import type { Operation, OperationStatus, OperationsContextType } from "./types"
import type { BoardMutationContext } from "./board-context"

export function createResourceActions(board: BoardMutationContext) {
  const {
    operations,
    personnel,
    materials,
    isLoaded,
    selectedEvent,
    resourceConflict,
    outOfServiceVehicleIds,
    setOperations,
    setPersonnel,
    setMaterials,
    setResourceConflict,
    setVehicleNeedingDriver,
    operationsRef,
    recentRemovalsRef,
    armAssignmentCooldown,
    releaseAssignmentCooldown,
    beginAssignmentSettling,
  } = board

  const removeCrew = (operationId: string, crewName: string): Promise<boolean> => {
    const operation = operations.find(op => op.id === operationId)
    if (!operation) return Promise.resolve(false)

    const assignmentId = operation.crewAssignments.get(crewName)
    if (!assignmentId) {
      console.warn(`No assignment ID found for crew member ${crewName}`)
      return Promise.resolve(false)
    }

    armAssignmentCooldown()

    setOperations((ops) =>
      ops.map((op) => {
        if (op.id === operationId) {
          const newCrewAssignments = new Map(op.crewAssignments)
          newCrewAssignments.delete(crewName)
          return { ...op, crew: op.crew.filter((name) => name !== crewName), crewAssignments: newCrewAssignments }
        }
        return op
      })
    )

    const person = personnel.find((p) => p.name === crewName)
    const personStatusSnapshot = person?.status ?? null
    const personnelShouldRevert =
      person !== undefined &&
      !operations.some(op => op.id !== operationId && op.crew.includes(crewName))
    if (personnelShouldRevert) {
      setPersonnel((people) =>
        people.map((p) => (p.id === person!.id ? { ...p, status: "available" as PersonStatus } : p))
      )
    }

    // B6: remember this removal so the next assignment can warn about rapid re-binding.
    if (person) {
      recordRemoval(recentRemovalsRef.current, person.id, operationId, operation.location)
    }

    if (isLoaded) {
      return apiClient.unassignResource(operationId, assignmentId)
        .then(() => true)
        .catch(err => {
          console.error("Failed to unassign crew:", err)
          toast.error(translateOutsideReact('notifications.operations.removeFailedTitle'), { description: translateOutsideReact('notifications.operations.removePersonFailedDescription') })
          setOperations((ops) =>
            ops.map((op) => (op.id === operationId ? operation : op))
          )
          if (personnelShouldRevert && person && personStatusSnapshot) {
            setPersonnel((people) =>
              people.map((p) => (p.id === person.id ? { ...p, status: personStatusSnapshot } : p))
            )
          }
          // Removal failed → drop the memo so we don't warn about a phantom removal.
          if (person) recentRemovalsRef.current.delete(person.id)
          return false
        })
        .finally(() => {
          releaseAssignmentCooldown()
        })
    }
    releaseAssignmentCooldown(3000)
    return Promise.resolve(true)
  }

  const removeReko = (operationId: string) => {
    const operation = operations.find(op => op.id === operationId)
    if (!operation || !operation.assignedReko) return

    const rekoPersonId = operation.assignedReko.id

    armAssignmentCooldown()

    // Optimistically update UI
    setOperations((ops) =>
      ops.map((op) => (op.id === operationId ? { ...op, assignedReko: null } : op))
    )

    if (isLoaded) {
      // Use the unassign reko API
      apiClient.unassignRekoPersonnel(operationId, rekoPersonId)
        .catch(err => {
          console.error("Failed to unassign reko:", err)
          toast.error(translateOutsideReact('notifications.operations.removeFailedTitle'), { description: translateOutsideReact('notifications.operations.removeRekoFailedDescription') })
          // Revert on error
          setOperations((ops) =>
            ops.map((op) => (op.id === operationId ? { ...op, assignedReko: operation.assignedReko } : op))
          )
        })
        .finally(() => {
          releaseAssignmentCooldown()
        })
    } else {
      releaseAssignmentCooldown(3000)
    }
  }

  /** Returns whether the release actually landed — the "move" branch of a
   *  double-booking waits on it, like it already did for crew and vehicles. */
  const removeMaterial = (operationId: string, materialId: string): Promise<boolean> => {
    const operation = operations.find(op => op.id === operationId)
    if (!operation) return Promise.resolve(false)

    const assignmentId = operation.materialAssignments.get(materialId)
    if (!assignmentId) {
      console.warn(`No assignment ID found for material ${materialId}`)
      return Promise.resolve(false)
    }

    armAssignmentCooldown()

    setOperations((ops) =>
      ops.map((op) => {
        if (op.id === operationId) {
          const newMaterialAssignments = new Map(op.materialAssignments)
          newMaterialAssignments.delete(materialId)
          return { ...op, materials: op.materials.filter((id) => id !== materialId), materialAssignments: newMaterialAssignments }
        }
        return op
      })
    )

    const material = materials.find((m) => m.id === materialId)
    const materialStatusSnapshot = material?.status ?? null
    const materialShouldRevert =
      material !== undefined &&
      !operations.some(op => op.id !== operationId && op.materials.includes(materialId))
    if (materialShouldRevert) {
      setMaterials((mats) =>
        mats.map((m) => (m.id === material!.id ? { ...m, status: "available" as Material["status"] } : m))
      )
    }

    if (isLoaded) {
      return apiClient.unassignResource(operationId, assignmentId)
        .then(() => true)
        .catch(err => {
          console.error("Failed to unassign material:", err)
          toast.error(translateOutsideReact('notifications.operations.removeFailedTitle'), { description: translateOutsideReact('notifications.operations.removeMaterialFailedDescription') })
          setOperations((ops) =>
            ops.map((op) => (op.id === operationId ? operation : op))
          )
          if (materialShouldRevert && material && materialStatusSnapshot) {
            setMaterials((mats) =>
              mats.map((m) => (m.id === material.id ? { ...m, status: materialStatusSnapshot } : m))
            )
          }
          return false
        })
        .finally(() => {
          releaseAssignmentCooldown()
        })
    }
    releaseAssignmentCooldown(3000)
    return Promise.resolve(true)
  }


  /** The other incidents a resource is currently on, as prompt-ready rows. */
  const collectConflicts = (holds: (op: Operation) => boolean, targetOperationId: string) =>
    operations
      .filter(op => op.id !== targetOperationId && holds(op))
      .map(op => ({ operationId: op.id, operationLabel: getIncidentRefLabel(op) }))

  const assignPersonToOperation = async (personId: string, personName: string, operationId: string, force = false): Promise<boolean> => {
    const operation = operations.find(op => op.id === operationId)
    const person = personnel.find(p => p.id === personId)

    if (!operation || !person || operation.crew.includes(personName)) {
      return false
    }

    // Somebody already on another incident is a question for the operator, not a
    // silent no-op. It *was* a silent no-op — `person.status === "assigned"`
    // returned right here — which is why even the assignment dialog's own
    // «Doppelbelegung? Trotzdem zuweisen» did nothing: the confirm called
    // straight back into this function, which refused it again without a word.
    //
    // Special functions (Reko/Fahrer/Magazin) are deliberately not a conflict:
    // they are event-scoped, hold no incident, and are already surfaced with a
    // badge where they are picked.
    if (!force) {
      const conflicts = collectConflicts(op => op.crew.includes(personName), operationId)
      if (conflicts.length > 0) {
        setResourceConflict({
          resourceType: "personnel",
          resourceId: personId,
          resourceName: personName,
          targetOperationId: operationId,
          targetOperationLabel: getIncidentRefLabel(operation),
          conflicts,
        })
        return false
      }
    }

    // B6: warn (don't block) when re-assigning someone we just took off another incident.
    const recentRemoval = findRecentRemoval(recentRemovalsRef.current, personId, operationId)
    if (recentRemoval) {
      const elapsedSec = Math.round((Date.now() - recentRemoval.removedAt) / 1000)
      toast.warning(translateOutsideReact('notifications.operations.recentRemovalWarningTitle', { name: personName, seconds: elapsedSec, incident: recentRemoval.incidentLabel }), {
        description: translateOutsideReact('notifications.operations.recentRemovalWarningDescription'),
      })
      // Don't repeat the warning if the same operator re-confirms the assignment.
      recentRemovalsRef.current.delete(personId)
    }

    armAssignmentCooldown()

    setOperations((ops) =>
      ops.map((op) => (op.id === operationId ? { ...op, crew: [...op.crew, personName] } : op))
    )
    setPersonnel((people) =>
      people.map((p) => (p.id === personId ? { ...p, status: "assigned" as PersonStatus } : p))
    )

    if (isLoaded) {
      try {
        const assignment = await apiClient.assignResource(operationId, {
          resource_type: "personnel",
          resource_id: personId,
        })
        setOperations((ops) =>
          ops.map((op) => {
            if (op.id === operationId) {
              const newCrewAssignments = new Map(op.crewAssignments)
              newCrewAssignments.set(personName, assignment.id)
              return { ...op, crewAssignments: newCrewAssignments }
            }
            return op
          })
        )
        return true
      } catch (err) {
        console.error("Failed to assign person:", err)
        toast.error(translateOutsideReact('notifications.operations.assignFailedTitle'), {
          description: ApiError.isConflictError(err)
            ? translateOutsideReact('notifications.operations.assignConflictDescription', { name: personName })
            : translateOutsideReact('notifications.operations.assignFailedDescription', { name: personName }),
        })
        setOperations((ops) =>
          ops.map((op) => (op.id === operationId ? { ...op, crew: op.crew.filter(n => n !== personName) } : op))
        )
        setPersonnel((people) =>
          people.map((p) => (p.id === personId ? { ...p, status: "available" as PersonStatus } : p))
        )
        // The chip already snapped back — say why, or the operator assumes it stuck.
        toast.error(translateOutsideReact('notifications.operations.assignFailedFollowupTitle'), {
          description: translateOutsideReact('notifications.operations.assignFailedDescription', { name: personName }),
        })
        return false
      } finally {
        releaseAssignmentCooldown()
      }
    } else {
      releaseAssignmentCooldown(3000)
      return true
    }
  }

  const assignRekoPersonToOperation = async (personId: string, personName: string, operationId: string) => {
    const operation = operations.find(op => op.id === operationId)
    const person = personnel.find(p => p.id === personId)

    // Only allow reko personnel to be assigned via this function
    if (!operation || !person || !person.isReko) {
      return
    }

    // If same person already assigned, do nothing
    if (operation.assignedReko?.id === personId) {
      return
    }

    armAssignmentCooldown()

    // Optimistically update UI - also move to "reko" status if currently "incoming"
    const currentOp = operations.find(op => op.id === operationId)
    const shouldAutoMoveToReko = currentOp?.status === "incoming"

    setOperations((ops) =>
      ops.map((op) => {
        if (op.id !== operationId) return op
        const updated = { ...op, assignedReko: { id: personId, name: personName } }
        if (shouldAutoMoveToReko) {
          updated.status = "reko"
          updated.statusChangedAt = new Date()
        }
        return updated
      })
    )

    if (isLoaded) {
      try {
        // Use the reko assignment API (backend auto-moves status to "reko" if eingegangen)
        await apiClient.assignRekoPersonnel(operationId, personId)
      } catch (err) {
        console.error("Failed to assign reko person:", err)
        toast.error(translateOutsideReact('notifications.operations.assignFailedTitle'), {
          description: translateOutsideReact('notifications.operations.assignRekoFailedDescription', { name: personName }),
        })
        // Revert on error
        setOperations((ops) =>
          ops.map((op) => {
            if (op.id !== operationId) return op
            const reverted = { ...op, assignedReko: null }
            if (shouldAutoMoveToReko) {
              reverted.status = "incoming" as OperationStatus
              reverted.statusChangedAt = currentOp?.statusChangedAt ?? null
            }
            return reverted
          })
        )
        // The reko badge already snapped back — say why, or the operator assumes it stuck.
        toast.error(translateOutsideReact('notifications.operations.assignRekoFailedTitle'), {
          description: translateOutsideReact('notifications.operations.assignRekoFailedDescription', { name: personName }),
        })
      } finally {
        releaseAssignmentCooldown()
      }
    } else {
      releaseAssignmentCooldown(3000)
    }
  }

  const assignMaterialToOperation = async (materialId: string, operationId: string, force = false): Promise<boolean> => {
    const operation = operations.find(op => op.id === operationId)
    const material = materials.find(m => m.id === materialId)

    const isConsumable = material?.consumable
    if (!operation || !material || operation.materials.includes(materialId)) {
      return false
    }

    // «Nicht einsatzbereit» is a lock, not a note. The sidebar row is already
    // undraggable and the picker greys it out, so this is the backstop for the
    // paths that don't go through either (command palette, Auftrag sheet).
    if (material.outOfService) {
      toast.error(translateOutsideReact('notifications.materials.outOfServiceBlockedTitle', { name: material.name }), {
        description: translateOutsideReact('notifications.materials.outOfServiceBlockedDescription'),
      })
      return false
    }

    // A consumable is not a single physical thing — several incidents can draw
    // from the same Bindemittel, so it never conflicts. Everything else does,
    // and used to be dropped in silence by a `status === "assigned"` guard right
    // here (see the same story in assignPersonToOperation).
    if (!isConsumable && !force) {
      const conflicts = collectConflicts(op => op.materials.includes(materialId), operationId)
      if (conflicts.length > 0) {
        setResourceConflict({
          resourceType: "material",
          resourceId: materialId,
          resourceName: material.name,
          targetOperationId: operationId,
          targetOperationLabel: getIncidentRefLabel(operation),
          conflicts,
        })
        return false
      }
    }

    armAssignmentCooldown()

    setOperations((ops) =>
      ops.map((op) => (op.id === operationId ? { ...op, materials: [...op.materials, materialId] } : op))
    )
    // Consumables stay "available" — they can be assigned to multiple incidents
    if (!isConsumable) {
      setMaterials((mats) =>
        mats.map((m) => (m.id === materialId ? { ...m, status: "assigned" as Material["status"] } : m))
      )
    }

    if (isLoaded) {
      try {
        const assignment = await apiClient.assignResource(operationId, {
          resource_type: "material",
          resource_id: materialId,
        })
        setOperations((ops) =>
          ops.map((op) => {
            if (op.id === operationId) {
              const newMaterialAssignments = new Map(op.materialAssignments)
              newMaterialAssignments.set(materialId, assignment.id)
              return { ...op, materialAssignments: newMaterialAssignments }
            }
            return op
          })
        )
        return true
      } catch (err) {
        console.error("Failed to assign material:", err)
        toast.error(translateOutsideReact('notifications.operations.assignFailedTitle'), {
          description: ApiError.isConflictError(err)
            ? translateOutsideReact('notifications.operations.assignConflictDescription', { name: material.name })
            : translateOutsideReact('notifications.operations.assignFailedDescription', { name: material.name }),
        })
        setOperations((ops) =>
          ops.map((op) => (op.id === operationId ? { ...op, materials: op.materials.filter(id => id !== materialId) } : op))
        )
        setMaterials((mats) =>
          mats.map((m) => (m.id === materialId ? { ...m, status: "available" as Material["status"] } : m))
        )
        return false
      } finally {
        releaseAssignmentCooldown()
      }
    } else {
      releaseAssignmentCooldown(3000)
      return true
    }
  }

  const assignVehicleToOperation = async (vehicleId: string, vehicleName: string, operationId: string): Promise<boolean> => {
    const operation = operations.find(op => op.id === operationId)

    if (!operation || operation.vehicles.includes(vehicleName)) {
      return false
    }

    if (!vehicleId || vehicleId.trim() === '') {
      console.error('[ERROR] Invalid vehicleId:', { vehicleId, vehicleName, operationId })
      toast.error(translateOutsideReact('notifications.operations.errorTitle'), { description: translateOutsideReact('notifications.operations.vehicleInvalidIdDescription', { name: vehicleName }) })
      return false
    }

    // «Nicht einsatzbereit» is a lock for vehicles too. The picker greys the row
    // out; this is the backstop for the shortcut keys and the command palette.
    if (outOfServiceVehicleIds.has(vehicleId)) {
      toast.error(translateOutsideReact('notifications.materials.outOfServiceBlockedTitle', { name: vehicleName }), {
        description: translateOutsideReact('notifications.materials.outOfServiceBlockedDescription'),
      })
      return false
    }

    // A vehicle is a single physical asset — if it's still assigned elsewhere,
    // ask the operator whether to move it here or keep the double booking,
    // rather than silently double-booking it.
    const conflicts = collectConflicts(op => op.vehicles.includes(vehicleName), operationId)
    if (conflicts.length > 0) {
      setResourceConflict({
        resourceType: "vehicle",
        resourceId: vehicleId,
        resourceName: vehicleName,
        targetOperationId: operationId,
        targetOperationLabel: getIncidentRefLabel(operation),
        conflicts,
      })
      return false
    }

    return performVehicleAssign(vehicleId, vehicleName, operationId)
  }

  // Settling until the driver check below has answered — see `beginAssignmentSettling`.
  const performVehicleAssign = async (vehicleId: string, vehicleName: string, operationId: string): Promise<boolean> => {
    const end = beginAssignmentSettling()
    try {
      return await performVehicleAssignAndAskDriver(vehicleId, vehicleName, operationId)
    } finally {
      end()
    }
  }

  const performVehicleAssignAndAskDriver = async (vehicleId: string, vehicleName: string, operationId: string): Promise<boolean> => {
    const operation = operations.find(op => op.id === operationId)
    if (!operation || operation.vehicles.includes(vehicleName)) {
      return false
    }

    armAssignmentCooldown()

    setOperations((ops) =>
      ops.map((op) => (op.id === operationId ? { ...op, vehicles: [...op.vehicles, vehicleName] } : op))
    )

    if (isLoaded) {
      try {
        const assignment = await apiClient.assignResource(operationId, {
          resource_type: "vehicle",
          resource_id: vehicleId,
        })
        setOperations((ops) =>
          ops.map((op) => {
            if (op.id === operationId) {
              const newVehicleAssignments = new Map(op.vehicleAssignments)
              newVehicleAssignments.set(vehicleName, assignment.id)
              const newVehicleDriverStay = new Map(op.vehicleDriverStay)
              newVehicleDriverStay.set(vehicleName, assignment.driver_stay || false)
              return { ...op, vehicleAssignments: newVehicleAssignments, vehicleDriverStay: newVehicleDriverStay }
            }
            return op
          })
        )

        // Prompt for a driver if this vehicle doesn't have one yet. Drivers are
        // event-scoped (EventSpecialFunction), so a vehicle that already has a
        // driver from elsewhere in the event isn't prompted again. Non-fatal:
        // if we can't determine the driver state, we simply skip the prompt.
        if (selectedEvent?.id) {
          try {
            const functions = await apiClient.getEventSpecialFunctions(selectedEvent.id)
            const hasDriver = functions.some(
              (f) => f.function_type === "driver" && f.vehicle_id === vehicleId
            )
            // Guard against the assign→remove race: this runs two network
            // round-trips after the assignment, so the operator may have already
            // unassigned the vehicle. Only prompt if it's still on this incident,
            // otherwise the prompt appears to fire on *un*assignment.
            const stillAssigned = operationsRef.current
              .find((op) => op.id === operationId)
              ?.vehicles.includes(vehicleName)
            if (!hasDriver && stillAssigned) {
              // Carrying the incident is what lets the prompt offer to take the
              // vehicle back off it when nobody is found to drive it.
              setVehicleNeedingDriver({ vehicleId, vehicleName, incidentId: operationId })
            }
          } catch (err) {
            console.error("Failed to check vehicle driver state:", err)
          }
        }
        return true
      } catch (err) {
        console.error("Failed to assign vehicle:", err)
        toast.error(translateOutsideReact('notifications.operations.assignFailedTitle'), {
          description: ApiError.isConflictError(err)
            ? translateOutsideReact('notifications.operations.assignConflictDescription', { name: vehicleName })
            : translateOutsideReact('notifications.operations.assignFailedDescription', { name: vehicleName }),
        })
        setOperations((ops) =>
          ops.map((op) => (op.id === operationId ? { ...op, vehicles: op.vehicles.filter(name => name !== vehicleName) } : op))
        )
        return false
      } finally {
        // Clear cooldown after API response, with a small grace period
        releaseAssignmentCooldown()
      }
    } else {
      releaseAssignmentCooldown(3000)
      return true
    }
  }

  const removeVehicle = (operationId: string, vehicleName: string): Promise<boolean> => {
    const operation = operations.find(op => op.id === operationId)
    if (!operation) return Promise.resolve(false)

    const assignmentId = operation.vehicleAssignments.get(vehicleName)
    if (!assignmentId) {
      console.warn(`No assignment ID found for vehicle ${vehicleName}`)
      return Promise.resolve(false)
    }

    armAssignmentCooldown()

    setOperations((ops) =>
      ops.map((op) => {
        if (op.id === operationId) {
          const newVehicleAssignments = new Map(op.vehicleAssignments)
          newVehicleAssignments.delete(vehicleName)
          const newVehicleCallsigns = new Map(op.vehicleCallsigns)
          newVehicleCallsigns.delete(vehicleName)
          const newVehicleDriverStay = new Map(op.vehicleDriverStay)
          newVehicleDriverStay.delete(vehicleName)
          return { ...op, vehicles: op.vehicles.filter((name) => name !== vehicleName), vehicleAssignments: newVehicleAssignments, vehicleCallsigns: newVehicleCallsigns, vehicleDriverStay: newVehicleDriverStay }
        }
        return op
      })
    )

    if (isLoaded) {
      return apiClient.unassignResource(operationId, assignmentId)
        .then(() => true)
        .catch(err => {
          console.error("Failed to unassign vehicle:", err)
          toast.error(translateOutsideReact('notifications.operations.removeFailedTitle'), { description: translateOutsideReact('notifications.operations.removeVehicleFailedDescription') })
          setOperations((ops) =>
            ops.map((op) => (op.id === operationId ? operation : op))
          )
          return false
        })
        .finally(() => {
          releaseAssignmentCooldown()
        })
    }
    releaseAssignmentCooldown(3000)
    return Promise.resolve(true)
  }

  const resolveResourceConflict = async (action: "move" | "keep") => {
    const conflict = resourceConflict
    if (!conflict) return
    // The prompt closes now, but the move and the re-assign (and a vehicle's
    // driver question) are still to come.
    const end = beginAssignmentSettling()
    try {
      await resolveResourceConflictNow(conflict, action)
    } finally {
      end()
    }
  }

  const resolveResourceConflictNow = async (
    conflict: NonNullable<OperationsContextType["resourceConflict"]>,
    action: "move" | "keep",
  ) => {
    setResourceConflict(null)

    if (conflict.customResolve) {
      await conflict.customResolve(action)
      return
    }

    const { resourceType, resourceId, resourceName, targetOperationId } = conflict

    if (action === "move") {
      // Remove it from every other incident before assigning it here — and WAIT
      // for the removals: toasting "verschoben" before they were confirmed left
      // the resource double-booked on failure despite the operator explicitly
      // choosing "move".
      const results = await Promise.all(
        conflict.conflicts.map((c) =>
          resourceType === "vehicle"
            ? removeVehicle(c.operationId, resourceName)
            : resourceType === "personnel"
              ? removeCrew(c.operationId, resourceName)
              : removeMaterial(c.operationId, resourceId)
        )
      )
      if (results.some((ok) => !ok)) {
        // The remove already rolled back and toasted the failed ones.
        toast.error(translateOutsideReact('notifications.operations.resourceNotMovedTitle', { name: resourceName }), {
          description: translateOutsideReact('notifications.operations.resourceNotMovedDescription'),
        })
        return
      }
      const labels = conflict.conflicts.map(c => `"${c.operationLabel}"`).join(", ")
      toast.info(translateOutsideReact('notifications.operations.resourceMovedTitle', { name: resourceName }), {
        description: translateOutsideReact('notifications.operations.resourceMovedDescription', { labels }),
      })
    }

    if (resourceType === "vehicle") {
      await performVehicleAssign(resourceId, resourceName, targetOperationId)
    } else if (resourceType === "personnel") {
      await assignPersonToOperation(resourceId, resourceName, targetOperationId, true)
    } else {
      await assignMaterialToOperation(resourceId, targetOperationId, true)
    }
  }

  return {
    removeCrew,
    removeReko,
    removeMaterial,
    removeVehicle,
    assignPersonToOperation,
    assignRekoPersonToOperation,
    assignMaterialToOperation,
    assignVehicleToOperation,
    resolveResourceConflict,
  }
}
