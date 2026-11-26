/**
 * The Auftrag actions: create, edit, reorder and delete routes, their stops and their
 * route-owned resources. Each one writes the board's Aufträge optimistically and takes a
 * cooldown hold like every other board mutation, so a reload already in flight cannot paint
 * the route from before it. `useGroups()` hands them out (groups-context).
 */

import { toast } from "sonner"
import { apiClient, ApiError, type GroupResourceType } from "@/lib/api-client"
import { refusalReason } from "@/lib/assignment-refusal"
import { translateOutsideReact } from "@/lib/i18n-messages"
import type { GroupAssignment, IncidentGroup } from "@/lib/types/groups"
import { isValidUUID, randomId } from "@/lib/utils/validation"
import { apiGroupAssignmentToAssignment, apiIncidentGroupToGroup } from "./mapping"
import type { BoardMutationContext } from "./board-context"
import type { CreateGroupInput, GroupActions, StopRestoreResult, UpdateGroupInput, VehicleStopAddResult } from "./types"

export function createGroupActions(board: BoardMutationContext): GroupActions {
  const {
    selectedEvent,
    outOfServiceVehicleIds,
    vehicles,
    groupsRef,
    setGroups,
    selectedEventIdRef,
    stopOrderQueueRef,
    setVehicleNeedingDriver,
    armAssignmentCooldown,
    releaseAssignmentCooldown,
    beginAssignmentSettling,
    reloadWhenSettled,
  } = board

  const eventId = selectedEvent && isValidUUID(selectedEvent.id) ? selectedEvent.id : null
  const groupById = (id: string) => groupsRef.current.find((g) => g.id === id)
  const replaceGroup = (id: string, next: IncidentGroup) => setGroups((gs) => gs.map((g) => (g.id === id ? next : g)))
  // A whole-list rollback only onto the Ereignis it was taken from: after a switch the list on
  // screen is another Ereignis's routes.
  const stillOnEvent = () => selectedEventIdRef.current === eventId
  const vehicleName = (vehicleId: string) => vehicles.find((v) => String(v.id) === vehicleId)?.name ?? vehicleId

  /** Run `request` under one cooldown hold: no automatic reload lands until it settled. */
  const held = async <T>(request: () => Promise<T>): Promise<T> => {
    armAssignmentCooldown()
    try {
      return await request()
    } finally {
      releaseAssignmentCooldown()
    }
  }

  const createGroup = (input: CreateGroupInput): Promise<IncidentGroup | null> => {
    if (!eventId) return Promise.resolve(null)
    const tempId = `temp-${randomId()}`
    const now = new Date()
    const optimistic: IncidentGroup = {
      id: tempId,
      eventId,
      name: input.name,
      color: input.color ?? null,
      notes: input.notes ?? null,
      position: groupsRef.current.reduce((max, g) => Math.max(max, g.position), -1) + 1,
      createdAt: now,
      updatedAt: now,
      createdBy: null,
      stopIds: [],
      assignments: [],
      progress: { total: 0, done: 0 },
      lastAnnounced: null,
    }
    return held(async () => {
      setGroups((gs) => [...gs, optimistic])
      try {
        const created = apiIncidentGroupToGroup(await apiClient.createIncidentGroup({ event_id: eventId, ...input }))
        replaceGroup(tempId, created)
        return created
      } catch (error) {
        console.error("Failed to create Auftrag:", error)
        setGroups((gs) => gs.filter((g) => g.id !== tempId))
        toast.error(translateOutsideReact("notifications.groups.createFailed"))
        return null
      }
    })
  }

  const updateGroup = (id: string, input: UpdateGroupInput): Promise<boolean> => {
    const previous = groupById(id)
    if (!previous) return Promise.resolve(false)
    return held(async () => {
      replaceGroup(id, {
        ...previous,
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.color !== undefined ? { color: input.color } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      })
      try {
        replaceGroup(id, apiIncidentGroupToGroup(await apiClient.updateIncidentGroup(id, input)))
        return true
      } catch (error) {
        console.error("Failed to update Auftrag:", error)
        replaceGroup(id, previous)
        toast.error(translateOutsideReact("notifications.groups.updateFailed"))
        return false
      }
    })
  }

  // Optimistic and silent on failure: a lost note only means the next stop hears the full
  // announcement once more, which is the safe direction – it must never put a toast in front of
  // an Einsatzleiter who is mid-Funkspruch.
  const recordAnnouncement: GroupActions["recordAnnouncement"] = (id, announcement) => {
    const previous = groupById(id)
    if (!previous) return Promise.resolve(false)
    return held(async () => {
      replaceGroup(id, {
        ...previous,
        lastAnnounced: { at: new Date(), fingerprint: announcement.fingerprint, stopId: announcement.stopId ?? null, full: announcement.full },
      })
      try {
        const updated = await apiClient.recordGroupAnnouncement(id, {
          fingerprint: announcement.fingerprint,
          stop_id: announcement.stopId ?? null,
          full: announcement.full,
        })
        replaceGroup(id, apiIncidentGroupToGroup(updated))
        return true
      } catch (error) {
        console.error("Failed to record Funkdurchsage:", error)
        replaceGroup(id, previous)
        return false
      }
    })
  }

  const deleteGroup = (id: string): Promise<boolean> => {
    const snapshot = groupsRef.current
    return held(async () => {
      setGroups((gs) => gs.filter((g) => g.id !== id))
      try {
        await apiClient.deleteIncidentGroup(id)
        return true
      } catch (error) {
        console.error("Failed to delete Auftrag:", error)
        if (stillOnEvent()) setGroups(snapshot)
        toast.error(translateOutsideReact("notifications.groups.deleteFailed"))
        return false
      }
    })
  }

  const reorderGroups = (orderedIds: string[]): Promise<boolean> => {
    if (!eventId || orderedIds.length === 0) return Promise.resolve(false)
    const snapshot = groupsRef.current
    // Reorder locally and restamp positions to the new index; groups not in `orderedIds` stay
    // appended in their order.
    const byId = new Map(snapshot.map((g) => [g.id, g]))
    const reordered = orderedIds.flatMap((gid, index) => {
      const g = byId.get(gid)
      return g ? [{ ...g, position: index }] : []
    })
    const missing = snapshot.filter((g) => !orderedIds.includes(g.id))
    return held(async () => {
      setGroups([...reordered, ...missing])
      try {
        await apiClient.reorderIncidentGroups(eventId, orderedIds)
        return true
      } catch (error) {
        console.error("Failed to reorder Aufträge:", error)
        if (stillOnEvent()) setGroups(snapshot)
        toast.error(translateOutsideReact("notifications.groups.reorderFailed"))
        return false
      }
    })
  }

  // One stop-order request per route at a time: a drag (or its undo) must not overtake the one
  // still on its way to the server.
  const reorderGroupStops = (groupId: string, orderedIds: string[]): Promise<boolean> => {
    const previous = groupById(groupId)
    if (!previous) return Promise.resolve(false)
    return held(async () => {
      setGroups((gs) => gs.map((g) => (g.id === groupId ? { ...g, stopIds: orderedIds } : g)))
      try {
        await stopOrderQueueRef.current.run(groupId, () => apiClient.reorderGroupStops(groupId, orderedIds))
        return true
      } catch (error) {
        console.error("Failed to reorder stops:", error)
        // Back only if nothing newer was put on the route meanwhile.
        setGroups((gs) =>
          gs.map((g) => {
            if (g.id !== groupId) return g
            const isStillThisOrder = g.stopIds.length === orderedIds.length && g.stopIds.every((id, i) => id === orderedIds[i])
            return isStillThisOrder ? previous : g
          }),
        )
        toast.error(translateOutsideReact("notifications.groups.reorderStopsFailed"))
        return false
      }
    })
  }

  const restoreGroupStops = (groupId: string, orderedIds: string[], expectedIds: string[]): Promise<StopRestoreResult> =>
    held(async () => {
      const outcome = await stopOrderQueueRef.current.run(groupId, async (): Promise<StopRestoreResult> => {
        try {
          await apiClient.reorderGroupStops(groupId, orderedIds, expectedIds)
          return "restored"
        } catch (error) {
          if (ApiError.isConflictError(error)) return "conflict"
          console.error("Failed to restore stop order:", error)
          return "failed"
        }
      })
      if (outcome === "restored") setGroups((gs) => gs.map((g) => (g.id === groupId ? { ...g, stopIds: orderedIds } : g)))
      // Our copy is the stale one – show what the route looks like now.
      else if (outcome === "conflict") reloadWhenSettled()
      return outcome
    })

  const postStops = (
    groupId: string,
    incidentIds: string[],
    guard: { viaVehicleId?: string; onlyUnassigned?: boolean } = {},
  ): Promise<VehicleStopAddResult> => {
    const guarded = Boolean(guard.viaVehicleId || guard.onlyUnassigned)
    const previous = groupById(groupId)
    // The #23 question outlived its Auftrag (deleted meanwhile): out of date, not a failure.
    if (!previous) return Promise.resolve(guarded ? "changed" : "failed")
    if (incidentIds.length === 0) return Promise.resolve("failed")
    const appended = incidentIds.filter((id) => !previous.stopIds.includes(id))
    return held(async () => {
      replaceGroup(groupId, {
        ...previous,
        stopIds: [...previous.stopIds, ...appended],
        progress: { ...previous.progress, total: previous.progress.total + appended.length },
      })
      try {
        replaceGroup(groupId, apiIncidentGroupToGroup(await apiClient.addStopsToGroup(groupId, incidentIds, guard)))
        return "added"
      } catch (error) {
        replaceGroup(groupId, previous)
        // 409: the Einsatz or the vehicle's Auftrag changed; 404: the Auftrag is gone.
        if (guarded && error instanceof ApiError && (error.status === 409 || error.status === 404)) {
          reloadWhenSettled()
          return "changed"
        }
        console.error("Failed to add stops:", error)
        toast.error(translateOutsideReact("notifications.groups.addStopsFailed"))
        return "failed"
      }
    })
  }

  const removeStop = (groupId: string, incidentId: string): Promise<boolean> => {
    const previous = groupById(groupId)
    if (!previous) return Promise.resolve(false)
    const wasMember = previous.stopIds.includes(incidentId)
    return held(async () => {
      replaceGroup(groupId, {
        ...previous,
        stopIds: previous.stopIds.filter((id) => id !== incidentId),
        progress: { ...previous.progress, total: wasMember ? Math.max(0, previous.progress.total - 1) : previous.progress.total },
      })
      try {
        await apiClient.removeStopFromGroup(groupId, incidentId)
        return true
      } catch (error) {
        console.error("Failed to remove stop:", error)
        replaceGroup(groupId, previous)
        toast.error(translateOutsideReact("notifications.groups.removeStopFailed"))
        return false
      }
    })
  }

  /**
   * The board's rule for an Einsatz, for an Auftrag too: a vehicle just put on a route with
   * nobody driving it opens the driver prompt. Fresh special functions, as for an Einsatz: the
   * board snapshot can lag a driver set a second ago on another device. Non-fatal on any
   * failure: the Auftrag still shows «Kein Fahrer» on the vehicle.
   */
  const promptIfDriverless = async (groupId: string, vehicleId: string) => {
    if (!eventId) return
    try {
      const functions = await apiClient.getEventSpecialFunctions(eventId)
      if (functions.some((f) => f.function_type === "driver" && f.vehicle_id === vehicleId)) return
      // Still on the route? (assign → release race, as on the incident path)
      const group = groupById(groupId)
      if (!group?.assignments.some((a) => a.resourceType === "vehicle" && a.resourceId === vehicleId)) return
      setVehicleNeedingDriver({ vehicleId, vehicleName: vehicleName(vehicleId), groupId })
    } catch (error) {
      console.error("Failed to check the route vehicle's driver:", error)
    }
  }

  const assignResource = (groupId: string, resourceType: GroupResourceType, resourceId: string): Promise<boolean> => {
    const previous = groupById(groupId)
    if (!previous) return Promise.resolve(false)
    // Already on the route – no-op (the backend would 409).
    if (previous.assignments.some((a) => a.resourceType === resourceType && a.resourceId === resourceId)) {
      return Promise.resolve(true)
    }
    // «Nicht einsatzbereit» locks the route exactly like it locks a Schadenplatz: the dialog
    // greys the row, but the number keys and a caller with a stale list bypass it.
    if (resourceType === "vehicle" && outOfServiceVehicleIds.has(resourceId)) {
      toast.error(translateOutsideReact("notifications.materials.outOfServiceBlockedTitle", { name: vehicleName(resourceId) }), {
        description: translateOutsideReact("notifications.materials.outOfServiceBlockedDescription"),
      })
      return Promise.resolve(false)
    }
    // A vehicle is not settled until its driver check has answered (⌘K waits on it).
    const settled = resourceType === "vehicle" ? beginAssignmentSettling() : () => {}
    const tempId = `temp-${randomId()}`
    const optimistic: GroupAssignment = { id: tempId, resourceType, resourceId, driverStay: false, isLeader: false }
    return held(async () => {
      setGroups((gs) => gs.map((g) => (g.id === groupId ? { ...g, assignments: [...g.assignments, optimistic] } : g)))
      try {
        // The server's row replaces the placeholder (its id is what a release names) – or joins
        // the route when a newer copy of it (a rename's answer, an R reload) dropped the
        // placeholder. The group_update broadcast brings the rest, in its turn.
        const created = apiGroupAssignmentToAssignment(
          await apiClient.assignGroupResource(groupId, { resource_type: resourceType, resource_id: resourceId }),
        )
        setGroups((gs) =>
          gs.map((g) => {
            if (g.id !== groupId) return g
            const rest = g.assignments.filter((a) => a.id !== tempId && a.id !== created.id)
            return { ...g, assignments: [...rest, created] }
          }),
        )
        if (resourceType === "vehicle") void promptIfDriverless(groupId, resourceId).finally(settled)
        return true
      } catch (error) {
        settled()
        console.error("Failed to assign route resource:", error)
        setGroups((gs) =>
          gs.map((g) => (g.id === groupId ? { ...g, assignments: g.assignments.filter((a) => a.id !== tempId) } : g)),
        )
        // A refusal the server put into words (archived, nicht einsatzbereit, …) is said as such.
        const reason = refusalReason(error)
        toast.error(translateOutsideReact("notifications.groups.assignFailed"), reason ? { description: reason } : undefined)
        return false
      }
    })
  }

  const unassignResource = (groupId: string, assignmentId: string): Promise<boolean> => {
    const previous = groupById(groupId)
    if (!previous) return Promise.resolve(false)
    return held(async () => {
      setGroups((gs) =>
        gs.map((g) => (g.id === groupId ? { ...g, assignments: g.assignments.filter((a) => a.id !== assignmentId) } : g)),
      )
      try {
        await apiClient.unassignGroupResource(groupId, assignmentId)
        return true
      } catch (error) {
        // The assignment or the whole Auftrag is gone: the resource is free already, and the
        // board learns which in its next settled reload (a failed request broadcasts nothing).
        if (error instanceof ApiError && error.status === 404) {
          reloadWhenSettled()
          return true
        }
        console.error("Failed to release route resource:", error)
        replaceGroup(groupId, previous)
        toast.error(translateOutsideReact("notifications.groups.unassignFailed"))
        return false
      }
    })
  }

  const setRouteDriverStay = (groupId: string, assignmentId: string, driverStay: boolean): Promise<boolean> => {
    const applyStay = (stay: boolean) =>
      setGroups((gs) =>
        gs.map((g) =>
          g.id === groupId
            ? { ...g, assignments: g.assignments.map((a) => (a.id === assignmentId ? { ...a, driverStay: stay } : a)) }
            : g,
        ),
      )
    return held(async () => {
      applyStay(driverStay)
      try {
        await apiClient.updateGroupAssignment(groupId, assignmentId, { driver_stay: driverStay })
        return true
      } catch (error) {
        console.error("Failed to set the route vehicle's driver stay:", error)
        applyStay(!driverStay)
        toast.error(translateOutsideReact("kanban.common.updateFailed"))
        return false
      }
    })
  }

  return {
    createGroup,
    updateGroup,
    recordAnnouncement,
    deleteGroup,
    reorderGroups,
    reorderGroupStops,
    restoreGroupStops,
    addStops: async (groupId, incidentIds) => (await postStops(groupId, incidentIds)) === "added",
    addStopForVehicle: (groupId, incidentId, vehicleId) => postStops(groupId, [incidentId], { viaVehicleId: vehicleId }),
    restoreStop: (groupId, incidentId) => postStops(groupId, [incidentId], { onlyUnassigned: true }),
    removeStop,
    assignResource,
    unassignResource,
    setRouteDriverStay,
  }
}
