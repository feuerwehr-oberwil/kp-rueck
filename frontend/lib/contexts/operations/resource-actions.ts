/**
 * Putting resources on incidents and taking them off: crew, Reko, material and
 * vehicles, the Doppelbelegung prompt and the driver check after a vehicle lands.
 * Moved verbatim out of `OperationsProvider` (see `BoardMutationContext`).
 */

import { apiClient } from "@/lib/api-client"
import { assignFailureDescription } from "@/lib/assignment-refusal"
import { getIncidentRefParts } from "@/lib/incident-types"
import type { PersonStatus } from "../personnel-context"
import type { Material } from "../materials-context"
import { toast } from "sonner"
import { translateOutsideReact } from "@/lib/i18n-messages"
import { findRecentRemoval, recordRemoval } from "@/lib/recent-removals"
import { formatAgo } from "@/lib/duration"
import { drivenElsewhere, type DrivenElsewhere } from "@/lib/driver-conflict"
import { planNext } from "@/lib/planned-actions"
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
    refreshOperations,
  } = board

  const removeCrew = (operationId: string, personnelId: string): Promise<boolean> => {
    const operation = operations.find(op => op.id === operationId)
    if (!operation) return Promise.resolve(false)

    const assignmentId = operation.crew.find((m) => m.personnelId === personnelId)?.assignmentId
    if (!assignmentId) {
      console.warn(`No assignment ID found for crew member ${personnelId}`)
      return Promise.resolve(false)
    }

    armAssignmentCooldown()

    setOperations((ops) =>
      ops.map((op) =>
        op.id === operationId ? { ...op, crew: op.crew.filter((m) => m.personnelId !== personnelId) } : op
      )
    )

    const person = personnel.find((p) => p.id === personnelId)
    const personStatusSnapshot = person?.status ?? null
    const personnelShouldRevert =
      person !== undefined &&
      !operations.some(op => op.id !== operationId && op.crew.some((m) => m.personnelId === personnelId))
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

  /** Releases exactly the row the board shows. No release before its id is known (an
   *  optimistic assign whose POST has not answered): that POST may still be refused, and a
   *  release without an id would take whatever active row the person has there.
   *  `expectedAssignmentId` (⌘K's undo): only while the card still shows that row. */
  const removeReko = (operationId: string, expectedAssignmentId?: string) => {
    const operation = operations.find(op => op.id === operationId)
    if (!operation || !operation.assignedReko) return

    const { id: rekoPersonId, assignmentId } = operation.assignedReko
    if (isLoaded && !assignmentId) return
    if (expectedAssignmentId !== undefined && assignmentId !== expectedAssignmentId) return

    armAssignmentCooldown()

    // Optimistically update UI
    setOperations((ops) =>
      ops.map((op) => (op.id === operationId ? { ...op, assignedReko: null } : op))
    )

    if (isLoaded && assignmentId) {
      apiClient.unassignRekoPersonnel(operationId, rekoPersonId, assignmentId)
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


  /** The other incidents a resource is currently on, as prompt-ready cards («14 · Hauptstrasse 4»). */
  const collectConflicts = (holds: (op: Operation) => boolean, targetOperationId: string) =>
    operations
      .filter(op => op.id !== targetOperationId && holds(op))
      .map(op => ({ operationId: op.id, operationLabel: getIncidentRefParts(op).head }))

  const assignPersonToOperation = async (personId: string, personName: string, operationId: string, force = false): Promise<boolean> => {
    const operation = operations.find(op => op.id === operationId)
    const person = personnel.find(p => p.id === personId)

    if (!operation || !person || operation.crew.some((m) => m.personnelId === personId)) {
      return false
    }

    // Somebody already on another incident is a question for the operator, not a
    // silent no-op. It *was* a silent no-op — `person.status === "assigned"`
    // returned right here — which is why even the assignment dialog's own
    // «Doppelbelegung? Trotzdem zuweisen» did nothing: the confirm called
    // straight back into this function, which refused it again without a word.
    //
    // Special functions (Reko/Magazin) are deliberately not a conflict: they are
    // event-scoped, hold no incident, and are already surfaced with a badge where
    // they are picked. The Fahrer is the exception: they are wherever their
    // vehicle stands, so that Einsatz is a «Bisher» row too (lib/driver-conflict.ts).
    if (!force) {
      const driving = drivenElsewhere(person, operations, operationId)
      const conflicts = collectConflicts(
        op => op.crew.some((m) => m.personnelId === personId) || op.id === driving?.operationId,
        operationId,
      )
      if (conflicts.length > 0) {
        setResourceConflict({
          resourceType: "personnel",
          resourceId: personId,
          resourceName: personName,
          targetOperationId: operationId,
          targetOperationLabel: getIncidentRefParts(operation).head,
          conflicts,
        })
        return false
      }
    }

    // B6: warn (don't block) when re-assigning someone we just took off another incident.
    const recentRemoval = findRecentRemoval(recentRemovalsRef.current, personId, operationId)
    if (recentRemoval) {
      const ago = formatAgo(Date.now() - recentRemoval.removedAt, (key, values) => translateOutsideReact(`common.duration.${key}`, values))
      toast.warning(translateOutsideReact('notifications.operations.recentRemovalWarningTitle', { name: personName, ago, incident: recentRemoval.incidentLabel }), {
        description: translateOutsideReact('notifications.operations.recentRemovalWarningDescription'),
      })
      // Don't repeat the warning if the same operator re-confirms the assignment.
      recentRemovalsRef.current.delete(personId)
    }

    armAssignmentCooldown()

    setOperations((ops) =>
      ops.map((op) =>
        op.id === operationId
          ? { ...op, crew: [...op.crew, { personnelId: personId, assignmentId: null, name: personName }] }
          : op
      )
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
          ops.map((op) =>
            op.id === operationId
              ? { ...op, crew: op.crew.map((m) => (m.personnelId === personId ? { ...m, assignmentId: assignment.id } : m)) }
              : op
          )
        )
        return true
      } catch (err) {
        console.error("Failed to assign person:", err)
        toast.error(translateOutsideReact('notifications.operations.assignFailedTitle'), {
          description: assignFailureDescription(err, personName),
        })
        setOperations((ops) =>
          ops.map((op) => (op.id === operationId ? { ...op, crew: op.crew.filter((m) => m.personnelId !== personId) } : op))
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

    // This request's own entry, and its token: the answer lands only while the card still
    // holds exactly this object. Assign A, switch to B, back to A – a late answer to the
    // first A would otherwise install the id of a row the switch has already released.
    const optimistic: NonNullable<Operation["assignedReko"]> = { id: personId, name: personName }
    const isOurs = (op: Operation) => op.id === operationId && op.assignedReko === optimistic

    setOperations((ops) =>
      ops.map((op) => {
        if (op.id !== operationId) return op
        const updated = { ...op, assignedReko: optimistic }
        if (shouldAutoMoveToReko) {
          updated.status = "reko"
          updated.statusChangedAt = new Date()
        }
        return updated
      })
    )

    if (isLoaded) {
      // Settling until the POST answers: ⌘K's dispatch reports (and offers its undo) only
      // once the row's id is on the card – see `beginAssignmentSettling`.
      const settled = beginAssignmentSettling()
      let reloadAfter = false
      try {
        // Use the reko assignment API (backend auto-moves status to "reko" if eingegangen).
        // The row's id makes it releasable (`removeReko`).
        const assignment = await apiClient.assignRekoPersonnel(operationId, personId)
        setOperations((ops) =>
          ops.map((op) =>
            isOurs(op)
              ? { ...op, assignedReko: { ...optimistic, assignmentId: assignment.id, purpose: assignment.purpose ?? "reko" } }
              : op
          )
        )
      } catch (err) {
        console.error("Failed to assign reko person:", err)
        toast.error(translateOutsideReact('notifications.operations.assignFailedTitle'), {
          description: translateOutsideReact('notifications.operations.assignRekoFailedDescription', { name: personName }),
        })
        // Revert on error – only our own entry; a later assign on this card stays. Back to
        // the Reko the card had before (a refused replacement leaves the old one assigned on
        // the server), not to «none». A previous Reko without a row id was itself still
        // pending (assign Bea, switch to Sina, back to Bea): nobody knows what the server
        // holds, so the board reloads it instead of trusting the guess (a spare reload, when
        // a later assign already owns the card, costs nothing: it is single-flight).
        const previous = operation.assignedReko ?? null
        setOperations((ops) =>
          ops.map((op) => {
            if (!isOurs(op)) return op
            const back = { ...op, assignedReko: previous }
            if (shouldAutoMoveToReko) {
              back.status = "incoming" as OperationStatus
              back.statusChangedAt = currentOp?.statusChangedAt ?? null
            }
            return back
          })
        )
        reloadAfter = previous !== null && !previous.assignmentId
        // The reko badge already snapped back — say why, or the operator assumes it stuck.
        toast.error(translateOutsideReact('notifications.operations.assignRekoFailedTitle'), {
          description: translateOutsideReact('notifications.operations.assignRekoFailedDescription', { name: personName }),
        })
      } finally {
        settled()
        releaseAssignmentCooldown()
        // The hold itself lifts 500 ms later; the explicit reload does not wait for it. It
        // reads after the refused POST, so its snapshot is newer than this rollback, and an
        // edit that lands meanwhile still discards it (mutation epoch) and replays it.
        if (reloadAfter) void refreshOperations()
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
          targetOperationLabel: getIncidentRefParts(operation).head,
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
          description: assignFailureDescription(err, material.name),
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

  const assignVehicleToOperation = async (vehicleId: string, vehicleName: string, operationId: string, force = false): Promise<boolean> => {
    const operation = operations.find(op => op.id === operationId)

    if (!operation || operation.vehicles.some((v) => v.vehicleId === vehicleId)) {
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
    // rather than silently double-booking it. `force`: a question that named
    // those Einsätze already got «keep» (use-assignment-conflicts.ts).
    const conflicts = force ? [] : collectConflicts(op => op.vehicles.some((v) => v.vehicleId === vehicleId), operationId)
    if (conflicts.length > 0) {
      setResourceConflict({
        resourceType: "vehicle",
        resourceId: vehicleId,
        resourceName: vehicleName,
        targetOperationId: operationId,
        targetOperationLabel: getIncidentRefParts(operation).head,
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
    if (!operation || operation.vehicles.some((v) => v.vehicleId === vehicleId)) {
      return false
    }

    armAssignmentCooldown()

    // The call sign arrives with the next board load (as it always has), the
    // driver-stay flag with the assignment.
    const optimistic = { vehicleId, assignmentId: null, name: vehicleName, callsign: null }
    setOperations((ops) =>
      ops.map((op) => (op.id === operationId ? { ...op, vehicles: [...op.vehicles, optimistic] } : op))
    )

    if (isLoaded) {
      try {
        const assignment = await apiClient.assignResource(operationId, {
          resource_type: "vehicle",
          resource_id: vehicleId,
        })
        setOperations((ops) =>
          ops.map((op) =>
            op.id === operationId
              ? {
                  ...op,
                  vehicles: op.vehicles.map((v) =>
                    v.vehicleId === vehicleId
                      ? { ...v, assignmentId: assignment.id, driverStay: assignment.driver_stay || false }
                      : v
                  ),
                }
              : op
          )
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
              ?.vehicles.some((v) => v.vehicleId === vehicleId)
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
          description: assignFailureDescription(err, vehicleName),
        })
        setOperations((ops) =>
          ops.map((op) => (op.id === operationId ? { ...op, vehicles: op.vehicles.filter((v) => v.vehicleId !== vehicleId) } : op))
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

  const removeVehicle = (operationId: string, vehicleId: string): Promise<boolean> => {
    const operation = operations.find(op => op.id === operationId)
    if (!operation) return Promise.resolve(false)

    const assignmentId = operation.vehicles.find((v) => v.vehicleId === vehicleId)?.assignmentId
    if (!assignmentId) {
      console.warn(`No assignment ID found for vehicle ${vehicleId}`)
      return Promise.resolve(false)
    }

    armAssignmentCooldown()

    setOperations((ops) =>
      ops.map((op) =>
        op.id === operationId ? { ...op, vehicles: op.vehicles.filter((v) => v.vehicleId !== vehicleId) } : op
      )
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

  /** «Jetzt verschieben» for a Fahrer: the role goes too, the vehicle is left without one. */
  const releaseDriverRole = async (personId: string, personName: string, driving: DrivenElsewhere): Promise<boolean> => {
    if (!selectedEvent) return false
    try {
      await apiClient.unassignSpecialFunction(selectedEvent.id, {
        personnel_id: personId,
        function_type: "driver",
        vehicle_id: driving.vehicleId,
      })
    } catch (err) {
      console.error("Failed to release driver role:", err)
      toast.error(translateOutsideReact('notifications.operations.resourceNotMovedTitle', { name: personName }), {
        description: translateOutsideReact('notifications.operations.resourceNotMovedDescription'),
      })
      return false
    }
    setPersonnel((people) =>
      people.map((p) =>
        p.id === personId ? { ...p, isDriver: false, driverVehicleId: undefined, driverVehicleName: undefined } : p,
      ),
    )
    void refreshOperations()
    return true
  }

  const resolveResourceConflict = async (action: "move" | "plan") => {
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
    action: "move" | "plan",
  ) => {
    setResourceConflict(null)

    // A Fahrer whose vehicle stands on another Einsatz leaves that role behind on
    // a move, whichever entry point asked — or «verschieben» leaves them 2×.
    if (action === "move" && conflict.resourceType === "personnel") {
      const person = personnel.find((p) => p.id === conflict.resourceId)
      const driving = drivenElsewhere(person, operations, conflict.targetOperationId)
      if (driving && !(await releaseDriverRole(conflict.resourceId, conflict.resourceName, driving))) return
    }

    if (conflict.customResolve) {
      await conflict.customResolve(action)
      return
    }

    const { resourceType, resourceId, resourceName, targetOperationId } = conflict

    // «Danach vormerken» (owner pick 2B, 24.11.2026): nothing leaves where it is now; the
    // board offers «Zuteilen» once it is free.
    if (action === "plan") {
      await planNext(resourceType, resourceId, resourceName, {
        kind: "incident",
        id: targetOperationId,
        label: conflict.targetOperationLabel,
      })
      return
    }

    if (action === "move") {
      // Remove it from every other incident before assigning it here — and WAIT
      // for the removals: toasting "verschoben" before they were confirmed left
      // the resource double-booked on failure despite the operator explicitly
      // choosing "move".
      const results = await Promise.all(
        conflict.conflicts.map((c) =>
          resourceType === "vehicle"
            ? removeVehicle(c.operationId, resourceId)
            : resourceType === "personnel"
              // A row that is only the driven vehicle's Einsatz has no crew row to remove.
              ? operations.find((op) => op.id === c.operationId)?.crew.some((m) => m.personnelId === resourceId) === false
                ? Promise.resolve(true)
                : removeCrew(c.operationId, resourceId)
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
