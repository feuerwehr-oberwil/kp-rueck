"use client"

import { useCallback, useRef } from "react"
import type { useGroups } from "@/lib/contexts/groups-context"
import type { Operation, useOperations } from "@/lib/contexts/operations-context"
import { getIncidentRefParts } from "@/lib/incident-types"
import { askAuftragStop } from "@/lib/auftrag-stop-question"

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
 *   a vehicle that drives an Auftrag, put on a lone Einsatz, asks whether that
 *   Einsatz joins the Auftrag as its last stop (lib/auftrag-stop-question.ts);
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
  /** A holder's name on the prompt's cards: an Einsatz «14 · Hauptstrasse 4», an Auftrag by its name. */
  const holderLabel = useCallback(
    (id: string) => {
      const op = operations.find((item) => item.id === id)
      return op ? getIncidentRefParts(op).head : groups.find((group) => group.id === id)?.name ?? ""
    },
    [operations, groups],
  )

  /**
   * A vehicle onto an Auftrag from every entry point (number keys, picker, drag-drop): held by
   * another Auftrag or an Einsatz → the move/keep question, else the assign. Resolves true only
   * once it assigned straight away – a question is its own receipt, a failure toasts itself.
   */
  const assignVehicleToGroupWithConflict = useCallback(async (groupId: string, vehicleId: string): Promise<boolean> => {
    const vehicle = vehicleTypes.find((item) => item.id === vehicleId)
    if (!vehicle) return false
    const groupConflicts = groups
      .filter((group) => group.id !== groupId && group.assignments.some((a) => a.resourceType === "vehicle" && a.resourceId === vehicleId))
    const incidentConflicts = operations.filter((op) => op.vehicles.some((v) => v.vehicleId === vehicleId))
    if (groupConflicts.length === 0 && incidentConflicts.length === 0) {
      return assignGroupResource(groupId, "vehicle", vehicleId)
    }
    requestResourceConflict({
      resourceType: "vehicle",
      resourceId: vehicleId,
      resourceName: vehicle.name,
      targetOperationId: groupId,
      targetOperationLabel: holderLabel(groupId),
      conflicts: [
        ...groupConflicts.map((group) => ({ operationId: group.id, operationLabel: group.name })),
        ...incidentConflicts.map((op) => ({ operationId: op.id, operationLabel: getIncidentRefParts(op).head })),
      ],
      customResolve: async (action) => {
        if (action === "move") {
          const groupResults = await Promise.all(groupConflicts.map((group) => {
            const assignment = group.assignments.find((a) => a.resourceType === "vehicle" && a.resourceId === vehicleId)
            return assignment ? unassignGroupResource(group.id, assignment.id) : true
          }))
          const incidentResults = await Promise.all(incidentConflicts.map((op) => removeVehicle(op.id, vehicleId)))
          if ([...groupResults, ...incidentResults].some((ok) => !ok)) return
        }
        await assignGroupResource(groupId, "vehicle", vehicleId)
      },
    })
    return false
  }, [vehicleTypes, groups, operations, requestResourceConflict, assignGroupResource, unassignGroupResource, removeVehicle, holderLabel])

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

        // Every holder named once, with the dropped resources that sit on IT – the prompt's
        // cards draw those, not the whole drop on every card.
        const byHolder = new Map<string, { operationId: string; operationLabel: string; held: { id: string; name: string }[] }>()
        for (const entry of batch) {
          const resource = { id: entry.resourceId, name: entry.resourceName }
          for (const conflict of entry.conflicts) {
            const holder = byHolder.get(conflict.operationId)
            if (holder) holder.held.push(resource)
            else byHolder.set(conflict.operationId, { ...conflict, held: [resource] })
          }
        }
        const conflicts = [...byHolder.values()]

        requestResourceConflict({
          resourceType: batch[0].resourceType === "personnel" ? "personnel" : "material",
          resourceId: batch[0].resourceId,
          // The whole drop, so «Motorsäge» does not stand in for three devices.
          resourceName: batch.map((entry) => entry.resourceName).join(", "),
          resourceCount: batch.length,
          targetOperationId: batch[0].targetId,
          targetOperationLabel: holderLabel(batch[0].targetId),
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
    [requestResourceConflict, holderLabel],
  )

  /**
   * A vehicle onto an Einsatz from every entry point (number keys, picker, drag-drop).
   * Held by no Auftrag → the plain assign (which asks its own Einsatz-Doppelbelegung).
   * Held by an Auftrag and the Einsatz is in none → «als Stopp aufnehmen?». A grouped
   * target keeps the move/keep question naming the Auftrag. Either question names the other
   * Einsätze that hold it too, and its «keep» assigns with `force`, so nothing asks twice.
   * Returns true when it asked.
   */
  const assignVehicleToIncidentWithConflict = useCallback((vehicleId: string, vehicleName: string, operationId: string): boolean => {
    const groupConflicts = groups.filter((group) =>
      group.assignments.some((a) => a.resourceType === "vehicle" && a.resourceId === vehicleId),
    )
    if (groupConflicts.length === 0) {
      assignVehicleToOperation(vehicleId, vehicleName, operationId)
      return false
    }
    const incidentConflicts = operations.filter(
      (op) => op.id !== operationId && op.vehicles.some((v) => v.vehicleId === vehicleId),
    )
    const target = operations.find((op) => op.id === operationId)
    if (target && !target.groupId) {
      // Several Aufträge holding one vehicle is itself a double booking; the first is asked about.
      const [group] = groupConflicts
      askAuftragStop({
        groupId: group.id,
        groupName: group.name,
        incidentId: target.id,
        incidentLabel: getIncidentRefParts(target).head,
        vehicleId,
        vehicleName,
        alsoOn: incidentConflicts.map((op) => ({ id: op.id, label: getIncidentRefParts(op).head })),
        assignOnly: () => assignVehicleToOperation(vehicleId, vehicleName, operationId, true),
      })
      return true
    }
    requestResourceConflict({
      resourceType: "vehicle",
      resourceId: vehicleId,
      resourceName: vehicleName,
      targetOperationId: operationId,
      targetOperationLabel: holderLabel(operationId),
      conflicts: [
        ...groupConflicts.map((group) => ({ operationId: group.id, operationLabel: group.name })),
        ...incidentConflicts.map((op) => ({ operationId: op.id, operationLabel: getIncidentRefParts(op).head })),
      ],
      customResolve: async (action) => {
        if (action === "move") {
          const groupResults = await Promise.all(groupConflicts.map((group) => {
            const assignment = group.assignments.find((a) => a.resourceType === "vehicle" && a.resourceId === vehicleId)
            return assignment ? unassignGroupResource(group.id, assignment.id) : true
          }))
          const incidentResults = await Promise.all(incidentConflicts.map((op) => removeVehicle(op.id, vehicleId)))
          if ([...groupResults, ...incidentResults].some((ok) => !ok)) return
        }
        await assignVehicleToOperation(vehicleId, vehicleName, operationId, true)
      },
    })
    return true
  }, [groups, operations, requestResourceConflict, unassignGroupResource, removeVehicle, assignVehicleToOperation, holderLabel])

  return {
    assignVehicleToGroupWithConflict,
    groupsHolding,
    releaseFromGroups,
    askRouteConflict,
    assignVehicleToIncidentWithConflict,
  }
}
