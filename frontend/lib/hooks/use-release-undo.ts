"use client"

/**
 * useReleaseUndo — release a resource from an Einsatz (or a stop / resource
 * from an Auftrag) and offer «Rückgängig» in the toast.
 *
 * Wrap the operator's own release actions with this (card chips, detail panel,
 * stop rows); internal releases — a conflict «verschieben», the completion
 * flow, the assignment dialog's own checkboxes — keep calling the raw context
 * functions, because there the operator is not undoing a mis-tap.
 *
 * See `lib/release-undo.ts` for what the undo checks before it re-assigns.
 */

import { useCallback, useEffect, useMemo, useRef } from "react"
import { toast } from "sonner"
import { toastLifetime } from "@/lib/toast-lifetime"
import { useOperations } from "@/lib/contexts/operations-context"
import { useGroups } from "@/lib/contexts/groups-context"
import { translateOutsideReact } from "@/lib/i18n-messages"
import { getIncidentLocationLabel } from "@/lib/incident-types"
import { checkRestore, type Released, type RestoreState } from "@/lib/release-undo"

/** Releases of the same thing from the same place within this window share one toast. */
const BATCH_MS = 120

type Ops = ReturnType<typeof useOperations>
type Groups = ReturnType<typeof useGroups>

function batchKey(r: Released): string {
  const target = r.kind === "stop" || r.kind === "routeResource" ? r.groupId : r.operationId
  return `${r.kind}:${target}:${r.name}`
}

export function useReleaseUndo() {
  const ops = useOperations()
  const groupsCtx = useGroups()

  // The undo runs seconds later, from a toast: it must read the board as it is
  // THEN, not as it was when the chip was clicked (that render still has the
  // resource on the incident, and every assign would refuse as «already there»).
  const latest = useRef<{ ops: Ops; groups: Groups }>({ ops, groups: groupsCtx })
  useEffect(() => {
    latest.current = { ops, groups: groupsCtx }
  })

  const pending = useRef(new Map<string, { items: Released[]; timer: ReturnType<typeof setTimeout> }>())

  // Both read the ref only, so they are stable for the callbacks below.
  const restoreState = useCallback((): RestoreState => {
    const { ops: o, groups: g } = latest.current
    return {
      operations: o.operations,
      groups: g.groups,
      personnel: o.personnel,
      materials: o.materials,
      outOfServiceVehicleIds: o.outOfServiceVehicleIds,
      labelOf: (id) => {
        const op = o.operations.find((x) => x.id === id)
        return op ? getIncidentLocationLabel(op) : id
      },
    }
  }, [])

  const incidentLabel = useCallback((operationId: string) => {
    const op = latest.current.ops.operations.find((x) => x.id === operationId)
    return op ? getIncidentLocationLabel(op) : ""
  }, [])

  const restoreOne = useCallback(async (r: Released): Promise<boolean> => {
    const { ops: o, groups: g } = latest.current
    switch (r.kind) {
      case "personnel":
        return o.assignPersonToOperation(r.personId, r.name, r.operationId)
      case "vehicle":
        return o.assignVehicleToOperation(r.vehicleId, r.name, r.operationId)
      case "material":
        return o.assignMaterialToOperation(r.materialId, r.operationId)
      case "routeResource":
        return g.assignResource(r.groupId, r.resourceType, r.resourceId)
      case "stop": {
        const before = g.groups.find((x) => x.id === r.groupId)?.stopIds ?? []
        if (!(await g.addStops(r.groupId, [r.incidentId]))) return false
        // addStops appends; put it back into its old slot — guarded like the
        // route undo, so if anybody touched the route meanwhile it simply stays
        // at the end rather than overwriting their order.
        if (r.position !== undefined && r.position < before.length) {
          await g.restoreGroupStops(
            r.groupId,
            [...before.slice(0, r.position), r.incidentId, ...before.slice(r.position)],
            [...before, r.incidentId],
          )
        }
        return true
      }
    }
  }, [])

  const undo = useCallback(
    async (items: Released[]) => {
      const first = items[0]
      const values = { resource: first.name, target: first.targetLabel }
      const state = restoreState()
      let restored = 0
      for (const item of items) {
        const block = checkRestore(item, state)
        if (block) {
          if (block.reason === "alreadyBack") {
            toast.info(translateOutsideReact("notifications.release.reason.alreadyBack", values))
            continue
          }
          toast.error(translateOutsideReact("notifications.release.restoreFailedTitle", values), {
            description: translateOutsideReact(`notifications.release.reason.${block.reason}`, {
              ...values,
              where: block.reason === "elsewhere" ? block.where : "",
            }),
          })
          return
        }
        // A refused / failed assign has already said why (its own toast, or the
        // conflict prompt) — do not stack a second message on top.
        if (!(await restoreOne(item))) return
        restored++
      }
      if (restored > 0) toast.success(translateOutsideReact("notifications.release.restored", values))
    },
    [restoreOne, restoreState],
  )

  const offer = useCallback(
    (released: Released) => {
      const key = batchKey(released)
      const existing = pending.current.get(key)
      if (existing) clearTimeout(existing.timer)
      const items = [...(existing?.items ?? []), released]
      const timer = setTimeout(() => {
        pending.current.delete(key)
        const values = { resource: released.name, target: released.targetLabel, count: items.length }
        let used = false
        toast(
          translateOutsideReact(items.length > 1 ? "notifications.release.releasedMany" : "notifications.release.released", values),
          {
            // a bare toast() bypasses the lifetime wrappers — carry the line itself
            ...toastLifetime(8000),
            action: {
              label: translateOutsideReact("notifications.operations.undoLabel"),
              onClick: () => {
                // One shot: a second click on the same toast changes nothing.
                if (used) return
                used = true
                void undo(items)
              },
            },
          },
        )
      }, BATCH_MS)
      pending.current.set(key, { items, timer })
    },
    [undo],
  )

  useEffect(() => {
    const timers = pending.current
    return () => {
      for (const { timer } of timers.values()) clearTimeout(timer)
    }
  }, [])

  const releaseCrew = useCallback(
    async (operationId: string, crewName: string): Promise<boolean> => {
      const ops = latest.current.ops
      const person = ops.personnel.find((p) => p.name === crewName)
      const targetLabel = incidentLabel(operationId)
      const ok = await ops.removeCrew(operationId, crewName)
      if (ok && person) offer({ kind: "personnel", operationId, personId: person.id, name: crewName, targetLabel })
      return ok
    },
    [offer, incidentLabel],
  )

  const releaseMaterial = useCallback(
    async (operationId: string, materialId: string): Promise<boolean> => {
      const ops = latest.current.ops
      const material = ops.materials.find((m) => m.id === materialId)
      const targetLabel = incidentLabel(operationId)
      const ok = await ops.removeMaterial(operationId, materialId)
      if (ok && material) offer({ kind: "material", operationId, materialId, name: material.name, targetLabel })
      return ok
    },
    [offer, incidentLabel],
  )

  const releaseVehicle = useCallback(
    async (operationId: string, vehicleName: string): Promise<boolean> => {
      const ops = latest.current.ops
      const vehicle = ops.vehicles.find((v) => v.name === vehicleName)
      const vehicleId = vehicle ? String(vehicle.id) : null
      const targetLabel = incidentLabel(operationId)
      const ok = await ops.removeVehicle(operationId, vehicleName)
      if (ok && vehicleId) offer({ kind: "vehicle", operationId, vehicleId, name: vehicleName, targetLabel })
      return ok
    },
    [offer, incidentLabel],
  )

  const releaseStop = useCallback(
    async (groupId: string, incidentId: string): Promise<boolean> => {
      const groupsCtx = latest.current.groups
      const group = groupsCtx.groups.find((g) => g.id === groupId)
      const position = group?.stopIds.indexOf(incidentId)
      const name = incidentLabel(incidentId)
      const ok = await groupsCtx.removeStop(groupId, incidentId)
      if (ok && group) {
        offer({
          kind: "stop",
          groupId,
          incidentId,
          name,
          targetLabel: group.name,
          position: position !== undefined && position >= 0 ? position : undefined,
        })
      }
      return ok
    },
    [offer, incidentLabel],
  )

  const releaseRouteResource = useCallback(
    async (groupId: string, assignmentId: string): Promise<boolean> => {
      const groupsCtx = latest.current.groups
      const group = groupsCtx.groups.find((g) => g.id === groupId)
      const assignment = group?.assignments.find((a) => a.id === assignmentId)
      const resources = groupsCtx.getGroupResources(groupId)
      const name = [...resources.personnel, ...resources.vehicles, ...resources.materials].find(
        (r) => r.assignmentId === assignmentId,
      )?.name
      const ok = await groupsCtx.unassignResource(groupId, assignmentId)
      if (ok && group && assignment && name) {
        offer({
          kind: "routeResource",
          groupId,
          resourceType: assignment.resourceType,
          resourceId: assignment.resourceId,
          name,
          targetLabel: group.name,
        })
      }
      return ok
    },
    [offer],
  )

  // Stable identity on purpose: callers put these into effect / callback deps
  // (the board's command-palette registration does), and a fresh object per
  // render re-ran that effect on every render — an update loop.
  /** Put one released resource back – the same checked path as the toast's
   *  «Rückgängig» (⌘K's undo uses it for what a «Hierher verschieben» moved). */
  const restore = useCallback((item: Released) => undo([item]), [undo])

  return useMemo(
    () => ({ releaseCrew, releaseMaterial, releaseVehicle, releaseStop, releaseRouteResource, restore }),
    [releaseCrew, releaseMaterial, releaseVehicle, releaseStop, releaseRouteResource, restore],
  )
}
