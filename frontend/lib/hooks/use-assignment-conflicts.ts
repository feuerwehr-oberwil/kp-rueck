"use client"

import { useCallback, useRef } from "react"
import type { useGroups } from "@/lib/contexts/groups-context"
import type { Operation, useOperations } from "@/lib/contexts/operations-context"
import { getIncidentRefLabel } from "@/lib/incident-types"

type Ops = ReturnType<typeof useOperations>
type Groups = ReturnType<typeof useGroups>

export interface AssignmentConflictInputs {
  /** The fleet as the board knows it; only id and name are read here. */
  vehicleTypes: ReadonlyArray<{ id: string; name: string }>
  groups: Groups["groups"]
  operations: Operation[]
  requestResourceConflict: Ops["requestResourceConflict"]
  assignGroupResource: Groups["assignResource"]
  unassignGroupResource: Groups["unassignResource"]
  removeVehicle: Ops["removeVehicle"]
  assignVehicleToOperation: Ops["assignVehicleToOperation"]
}

/**
 * The board's Doppelbelegung questions that span BOTH kinds of holder — an
 * Auftrag (route) and an Einsatz — which the operations provider alone cannot
 * ask, because it never sees the routes (`GroupsProvider` sits inside it).
 *
 * - vehicles onto a route or an incident, when a route or incident already has it;
 * - people and material held by a route, batched per drop into one question.
 *
 * Moved out of `app/page.tsx` verbatim (2026-09-23): same callbacks, same
 * dependency lists, same microtask batching; the page calls it where the block
 * used to stand.
 */
export function useAssignmentConflicts({
  vehicleTypes,
  groups,
  operations,
  requestResourceConflict,
  assignGroupResource,
  unassignGroupResource,
  removeVehicle,
  assignVehicleToOperation,
}: AssignmentConflictInputs) {
  const assignVehicleToGroupWithConflict = useCallback((groupId: string, vehicleId: string) => {
    const vehicle = vehicleTypes.find((item) => item.id === vehicleId)
    if (!vehicle) return
    const groupConflicts = groups
      .filter((group) => group.id !== groupId && group.assignments.some((a) => a.resourceType === "vehicle" && a.resourceId === vehicleId))
    const incidentConflicts = operations.filter((op) => op.vehicles.includes(vehicle.name))
    if (groupConflicts.length === 0 && incidentConflicts.length === 0) {
      void assignGroupResource(groupId, "vehicle", vehicleId)
      return
    }
    requestResourceConflict({
      resourceType: "vehicle",
      resourceId: vehicleId,
      resourceName: vehicle.name,
      targetOperationId: groupId,
      conflicts: [
        ...groupConflicts.map((group) => ({ operationId: group.id, operationLabel: group.name })),
        ...incidentConflicts.map((op) => ({ operationId: op.id, operationLabel: getIncidentRefLabel(op) })),
      ],
      customResolve: async (action) => {
        if (action === "move") {
          const groupResults = await Promise.all(groupConflicts.map((group) => {
            const assignment = group.assignments.find((a) => a.resourceType === "vehicle" && a.resourceId === vehicleId)
            return assignment ? unassignGroupResource(group.id, assignment.id) : true
          }))
          const incidentResults = await Promise.all(incidentConflicts.map((op) => removeVehicle(op.id, vehicle.name)))
          if ([...groupResults, ...incidentResults].some((ok) => !ok)) return
        }
        await assignGroupResource(groupId, "vehicle", vehicleId)
      },
    })
  }, [vehicleTypes, groups, operations, requestResourceConflict, assignGroupResource, unassignGroupResource, removeVehicle])

  /**
   * The Auftrag half of the Doppelbelegung question, for people and material.
   *
   * Vehicles have had this since they got `assignVehicleTo*WithConflict`: a unit
   * already on a route raises the normal confirm, which names where it comes
   * from and where it is going, and «Verschieben» does the move. People and
   * material instead hit a flat refusal — «Schon von einem anderen Auftrag
   * belegt – dort zuerst freigeben.» — which is the board telling the operator
   * to go and do by hand the thing the dialog does in one click, in the middle
   * of a storm. Same question, same dialog; the Auftrag's name is what fills the
   * «bisher» line.
   *
   * Returns true when it handled the case (assigned or asked), false when the
   * resource is free and the caller should just assign.
   */
  const groupsHolding = useCallback(
    (resourceType: "personnel" | "material", resourceId: string, exceptGroupId?: string) =>
      groups.filter(
        (group) =>
          group.id !== exceptGroupId &&
          group.assignments.some((a) => a.resourceType === resourceType && a.resourceId === resourceId),
      ),
    [groups],
  )

  /**
   * One dialog per DROP, not per resource.
   *
   * `requestResourceConflict` is a plain `setState`, so two calls in the same
   * tick leave only the second — and a Modul-Block carries three Geräte. Dropping
   * «Ölwehr» on an Einsatz while the Auftrag holds it asked about the third
   * device and silently did nothing with the other two, while showing a dialog
   * that implied the whole drop had been handled. The loops in
   * `use-kanban-drag-drop` are synchronous, so a microtask flush collects the
   * whole drop and asks once, naming everything it is about to move.
   */
  const conflictBatch = useRef<
    {
      resourceType: "personnel" | "material"
      resourceId: string
      resourceName: string
      targetId: string
      /** Where it sits now, for the «Bisher:» line. */
      conflicts: { operationId: string; operationLabel: string }[]
      /** How to free it from each of those, for «Verschieben». */
      releases: (() => Promise<unknown> | unknown)[]
      assign: () => Promise<unknown> | unknown
    }[]
  >([])
  const conflictFlushQueued = useRef(false)

  /** «Verschieben» for a route-held resource: detach it from that route. */
  const releaseFromGroups = useCallback(
    (resourceType: "personnel" | "material", resourceId: string, holders: typeof groups) =>
      holders.map((group) => () => {
        const assignment = group.assignments.find(
          (a) => a.resourceType === resourceType && a.resourceId === resourceId,
        )
        return assignment ? unassignGroupResource(group.id, assignment.id) : true
      }),
    [unassignGroupResource],
  )

  const askRouteConflict = useCallback(
    (entry: {
      resourceType: "personnel" | "material"
      resourceId: string
      resourceName: string
      targetId: string
      conflicts: { operationId: string; operationLabel: string }[]
      releases: (() => Promise<unknown> | unknown)[]
      assign: () => Promise<unknown> | unknown
    }) => {
      conflictBatch.current.push(entry)
      if (conflictFlushQueued.current) return
      conflictFlushQueued.current = true

      queueMicrotask(() => {
        conflictFlushQueued.current = false
        const batch = conflictBatch.current
        conflictBatch.current = []
        if (batch.length === 0) return

        // Every holder named once, however many of the dropped resources sit on it.
        const seen = new Set<string>()
        const conflicts: { operationId: string; operationLabel: string }[] = []
        for (const entry of batch) {
          for (const conflict of entry.conflicts) {
            if (seen.has(conflict.operationId)) continue
            seen.add(conflict.operationId)
            conflicts.push(conflict)
          }
        }

        requestResourceConflict({
          resourceType: batch[0].resourceType === "personnel" ? "personnel" : "material",
          resourceId: batch[0].resourceId,
          // The whole drop, so «Motorsäge» does not stand in for three devices.
          resourceName: batch.map((entry) => entry.resourceName).join(", "),
          targetOperationId: batch[0].targetId,
          conflicts,
          customResolve: async (action) => {
            if (action === "move") {
              const results = await Promise.all(batch.flatMap((entry) => entry.releases.map((free) => free())))
              if (results.some((ok) => ok === false)) return
            }
            // Sequential: the assign calls hit the same rows, and firing three
            // PUTs at one Auftrag in parallel is how the last one wins.
            for (const entry of batch) await entry.assign()
          },
        })
      })
    },
    [requestResourceConflict],
  )

  const assignVehicleToIncidentWithConflict = useCallback((vehicleId: string, vehicleName: string, operationId: string) => {
    const groupConflicts = groups.filter((group) =>
      group.assignments.some((a) => a.resourceType === "vehicle" && a.resourceId === vehicleId),
    )
    if (groupConflicts.length === 0) {
      assignVehicleToOperation(vehicleId, vehicleName, operationId)
      return
    }
    requestResourceConflict({
      resourceType: "vehicle",
      resourceId: vehicleId,
      resourceName: vehicleName,
      targetOperationId: operationId,
      conflicts: groupConflicts.map((group) => ({ operationId: group.id, operationLabel: group.name })),
      customResolve: async (action) => {
        if (action === "move") {
          const results = await Promise.all(groupConflicts.map((group) => {
            const assignment = group.assignments.find((a) => a.resourceType === "vehicle" && a.resourceId === vehicleId)
            return assignment ? unassignGroupResource(group.id, assignment.id) : true
          }))
          if (results.some((ok) => !ok)) return
        }
        assignVehicleToOperation(vehicleId, vehicleName, operationId)
      },
    })
  }, [groups, requestResourceConflict, unassignGroupResource, assignVehicleToOperation])

  return {
    assignVehicleToGroupWithConflict,
    groupsHolding,
    releaseFromGroups,
    askRouteConflict,
    assignVehicleToIncidentWithConflict,
  }
}
