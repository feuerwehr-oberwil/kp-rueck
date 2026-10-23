"use client"

import { createContext, useContext, useState, useEffect, ReactNode, useCallback, useRef, useMemo } from "react"
import { toast } from "sonner"
import { translateOutsideReact } from "@/lib/i18n-messages"
import {
  apiClient,
  ApiError,
  type ApiIncidentGroup,
  type ApiIncidentGroupCreate,
  type ApiIncidentGroupUpdate,
  type ApiPersonnel,
  type GroupResourceType,
} from "@/lib/api-client"
import type { GroupAssignment, GroupResources, IncidentGroup } from "@/lib/types/groups"
import { useOperations, type Operation } from "@/lib/contexts/operations-context"
import { isValidUUID, randomId } from "@/lib/utils/validation"
import { wsClient } from "@/lib/websocket-client"
import { usePolling } from "@/lib/hooks/use-polling"
import { useAuth } from "./auth-context"
import { useEvent } from "./event-context"
import { usePersonnel } from "./personnel-context"
import { useMaterials } from "./materials-context"

// Re-export the client type for convenience (as materials-context exposes Material).
export type { IncidentGroup } from "@/lib/types/groups"

/** Fields the UI supplies when creating an Auftrag (event scope is injected). */
export type CreateGroupInput = Omit<ApiIncidentGroupCreate, "event_id">
/** Partial PATCH payload for an Auftrag (name / color / notes). */
export type UpdateGroupInput = ApiIncidentGroupUpdate

/** What the client just read out over the radio for a route. */
export interface AnnouncementInput {
  /** Digest of the route's resources at that moment (see `radioFingerprint`). */
  fingerprint: string
  /** The stop the announcement was about. */
  stopId: string | null
  /** True for the full announcement, false for the short continuation. */
  full: boolean
}

export type StopRestoreResult = "restored" | "conflict" | "failed"

const EMPTY_RESOURCES: GroupResources = { vehicles: [], personnel: [], materials: [] }

interface GroupsContextType {
  /** Aufträge of the selected event, in `position` order. */
  groups: IncidentGroup[]
  /** True once the first load has resolved (gate empty states on this). */
  isLoaded: boolean
  refreshGroups: () => Promise<void>
  createGroup: (input: CreateGroupInput) => Promise<IncidentGroup | null>
  updateGroup: (id: string, input: UpdateGroupInput) => Promise<boolean>
  /** Note the Funkdurchsage just made for a route (drives full vs. short next time). */
  recordAnnouncement: (id: string, announcement: AnnouncementInput) => Promise<boolean>
  deleteGroup: (id: string) => Promise<boolean>
  reorderGroups: (orderedIds: string[]) => Promise<boolean>
  reorderGroupStops: (groupId: string, orderedIds: string[]) => Promise<boolean>
  /**
   * Conditional stop reorder for undo: applied only if the route's order on the
   * SERVER is still `expectedIds` (checked under the Auftrag lock). "conflict" =
   * somebody changed the route meanwhile; the local copy is refreshed from the
   * server. Not optimistic and never toasts — the caller words the outcome.
   */
  restoreGroupStops: (groupId: string, orderedIds: string[], expectedIds: string[]) => Promise<StopRestoreResult>
  addStops: (groupId: string, incidentIds: string[]) => Promise<boolean>
  removeStop: (groupId: string, incidentId: string) => Promise<boolean>
  /** Attach a vehicle / personnel / material to the ROUTE (not a single stop). */
  assignResource: (groupId: string, resourceType: GroupResourceType, resourceId: string) => Promise<boolean>
  /** Release a route-owned resource by its group-assignment id. */
  unassignResource: (groupId: string, assignmentId: string) => Promise<boolean>
  /** Resolve a route's owned resources to display names, split by kind. */
  getGroupResources: (groupId: string) => GroupResources
  /** Resolve the route resources for an incident's Auftrag (empty when ungrouped). */
  groupResourcesFor: (operation: Operation) => GroupResources
  occupiedResourceIds: Record<GroupResourceType, Set<string>>
}

const GroupsContext = createContext<GroupsContextType | undefined>(undefined)

// Parse the API assignment list to the camelCase client shape.
const apiAssignmentsToClient = (g: ApiIncidentGroup): GroupAssignment[] =>
  (g.assignments ?? []).map((a) => ({
    id: String(a.id),
    resourceType: a.resource_type,
    resourceId: String(a.resource_id),
    driverStay: a.driver_stay,
    isLeader: a.is_leader,
  }))

// Convert the API shape to the camelCase client type (dates parsed to Date).
const apiGroupToGroup = (g: ApiIncidentGroup): IncidentGroup => ({
  id: String(g.id),
  eventId: String(g.event_id),
  name: g.name,
  color: g.color ?? null,
  notes: g.notes ?? null,
  position: g.position,
  createdAt: new Date(g.created_at),
  updatedAt: new Date(g.updated_at),
  createdBy: g.created_by ? String(g.created_by) : null,
  stopIds: g.stop_ids.map(String),
  assignments: apiAssignmentsToClient(g),
  progress: { total: g.progress?.total ?? 0, done: g.progress?.done ?? 0 },
  // Both the timestamp and the fingerprint have to be there for the record to
  // mean anything — a half-written one would silently force the full
  // announcement forever, which is exactly the bug this replaces.
  lastAnnounced: g.last_announced_at && g.last_announced_fingerprint
    ? {
        at: new Date(g.last_announced_at),
        fingerprint: g.last_announced_fingerprint,
        stopId: g.last_announced_stop_id ? String(g.last_announced_stop_id) : null,
        full: Boolean(g.last_announced_full),
      }
    : null,
})

// Poll cadence for the sync-version fallback (matches operations-context).
const POLLING_INTERVAL = 5000

export function GroupsProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, loading: authLoading } = useAuth()
  const { selectedEvent, isEventLoaded } = useEvent()
  const { personnel } = usePersonnel()
  const { materials } = useMaterials()
  // Readiness lives in the operations context (refreshed with every poll).
  // GroupsProvider sits inside OperationsProvider in the root layout.
  // So does the fleet, for naming a route's vehicle assignments (they carry ids).
  const { outOfServiceVehicleIds, requestVehicleDriver, beginAssignmentSettling, vehicles } = useOperations()

  const [groups, setGroups] = useState<IncidentGroup[]>([])
  const [isLoaded, setIsLoaded] = useState(false)
  const [loadedEventId, setLoadedEventId] = useState<string | null>(null)
  /**
   * The FULL roster, for name resolution only.
   *
   * `usePersonnel()` loads `checked_in_only: true`, and a route assignment
   * outlives a check-out on purpose — the board warns and proceeds, and `/feld`
   * lets somebody go home while still assigned. So the moment a crew member
   * checks out, the context no longer knows their name and every consumer of
   * `GroupResources` printed the raw UUID instead: the Auftrag card, the
   * WhatsApp message, the Funkspruch and the printout.
   *
   * Fetched once per sign-in: it answers «what is this id called», not who is on duty.
   */
  const [roster, setRoster] = useState<ApiPersonnel[]>([])

  // Toast deduplication across an outage; same pattern as the roster and depot loaders.
  const hasShownErrorRef = useRef(false)
  // Every optimistic mutation bumps this epoch. A refresh discards its result if
  // the epoch moved while it was in flight — otherwise a poll/WS reload that
  // began just before a mutation would overwrite the optimistic state.
  const mutationEpochRef = useRef(0)
  // Sync version for the lightweight polling fallback (folds in incident_groups).
  const lastSyncVersionRef = useRef<string | null>(null)
  const activeEventIdRef = useRef<string | null>(null)
  const loadSequenceRef = useRef(0)
  const groupsRef = useRef<IncidentGroup[]>([])
  const reorderQueuesRef = useRef(new Map<string, Promise<unknown>>())

  useEffect(() => {
    groupsRef.current = groups
  }, [groups])

  const refreshGroups = useCallback(async (): Promise<void> => {
    if (!selectedEvent || !isValidUUID(selectedEvent.id)) {
      setGroups([])
      return
    }

    const epochAtStart = mutationEpochRef.current
    const eventId = selectedEvent.id
    const sequence = ++loadSequenceRef.current
    try {
      const apiGroups = await apiClient.getIncidentGroups(eventId)
      // A local mutation landed while this reload was fetching — its optimistic
      // state is newer than this snapshot. Discard the stale result.
      if (mutationEpochRef.current !== epochAtStart || activeEventIdRef.current !== eventId || sequence !== loadSequenceRef.current) return
      const next = apiGroups.map(apiGroupToGroup)
      // Synchronously too: a caller awaiting this refresh (promptIfDriverless)
      // reads the ref before the sync effect has run.
      groupsRef.current = next
      setGroups(next)
      hasShownErrorRef.current = false
    } catch (error) {
      console.error("Failed to load Aufträge:", error)
      if (!hasShownErrorRef.current) {
        hasShownErrorRef.current = true
        toast.error(translateOutsideReact("notifications.groups.loadFailedTitle"), {
          description: translateOutsideReact("notifications.groups.loadFailedDescription"),
        })
      }
    }
  }, [selectedEvent])

  // Load the roster once (name resolution for route assignments). Not
  // event-scoped: an id that is on a route is on it whatever the person's duty
  // status is.
  useEffect(() => {
    if (authLoading || !isAuthenticated) return
    apiClient
      .getAllPersonnel()
      .then((list) => setRoster(list))
      .catch(() => {
        // Silent: names fall back to the placeholder until the list loads.
      })
  }, [authLoading, isAuthenticated])

  const authReady = !authLoading && isAuthenticated
  const scopeEventId = selectedEvent && isValidUUID(selectedEvent.id) ? selectedEvent.id : null

  // A new scope (sign-in, Ereignis switch): forget the old one before the
  // first load of the new one lands.
  useEffect(() => {
    if (!authReady) return
    activeEventIdRef.current = scopeEventId
    loadSequenceRef.current++
    setGroups([])
    setIsLoaded(false)
    setLoadedEventId(null)
    lastSyncVersionRef.current = null
  }, [authReady, scopeEventId])

  // No Ereignis: only declare "loaded" once events have actually resolved, so
  // consumers don't flash an empty state before the selected event is known.
  useEffect(() => {
    if (authReady && !scopeEventId && isEventLoaded) setIsLoaded(true)
  }, [authReady, scopeEventId, isEventLoaded])

  /**
   * The initial load and the polling fallback in one. The cheap sync version
   * (it folds in incident_groups) gates the full reload, so a tick that finds
   * nothing new costs one small request. `usePolling` runs it on a new scope,
   * every POLLING_INTERVAL while the socket is down, and once when the socket
   * comes back – group_update broadcasts sent while we were out of the room
   * are gone otherwise. The socket lifecycle itself is owned by
   * operations-context; here we only listen.
   */
  const syncGroups = useCallback(async () => {
    const eventId = scopeEventId
    if (!eventId) return
    const epochAtStart = mutationEpochRef.current
    try {
      const versionSnapshot = await apiClient.getSyncVersion(eventId).catch(() => null)
      if (versionSnapshot && versionSnapshot.version === lastSyncVersionRef.current) return
      // Claimed only now: a tick that found nothing new must not invalidate a
      // refresh a broadcast started meanwhile.
      const sequence = ++loadSequenceRef.current
      const apiGroups = await apiClient.getIncidentGroups(eventId)
      if (activeEventIdRef.current !== eventId || sequence !== loadSequenceRef.current) return
      if (mutationEpochRef.current !== epochAtStart) return
      const next = apiGroups.map(apiGroupToGroup)
      groupsRef.current = next
      setGroups(next)
      hasShownErrorRef.current = false
      lastSyncVersionRef.current = versionSnapshot?.version ?? null
    } catch (error) {
      console.error("Failed to load Aufträge:", error)
    } finally {
      if (activeEventIdRef.current === eventId) {
        setIsLoaded(true)
        setLoadedEventId(eventId)
      }
    }
  }, [scopeEventId])

  usePolling(syncGroups, {
    intervalMs: POLLING_INTERVAL,
    enabled: authReady && scopeEventId !== null,
    skipWhileWsConnected: true,
  })

  // Coalesce related broadcasts: one backend action may emit an incident,
  // assignment and group event in quick succession.
  useEffect(() => {
    if (!authReady || !scopeEventId) return
    let refreshTimeout: ReturnType<typeof setTimeout> | undefined
    const scheduleRefresh = () => {
      if (refreshTimeout) return
      refreshTimeout = setTimeout(() => {
        refreshTimeout = undefined
        void refreshGroups()
      }, 25)
    }
    const unsubscribers = [
      wsClient.on("group_update", scheduleRefresh),
      wsClient.on("assignment_update", scheduleRefresh),
      wsClient.on("incident_update", scheduleRefresh),
    ]
    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe())
      if (refreshTimeout) clearTimeout(refreshTimeout)
    }
  }, [authReady, scopeEventId, refreshGroups])

  const createGroup = useCallback(
    async (input: CreateGroupInput): Promise<IncidentGroup | null> => {
      if (!selectedEvent || !isValidUUID(selectedEvent.id)) return null
      const eventId = selectedEvent.id

      mutationEpochRef.current++

      // Optimistic placeholder appended at the end of the list.
      const tempId = `temp-${randomId()}`
      const nextPosition = groups.reduce((max, g) => Math.max(max, g.position), -1) + 1
      const now = new Date()
      const optimistic: IncidentGroup = {
        id: tempId,
        eventId,
        name: input.name,
        color: input.color ?? null,
        notes: input.notes ?? null,
        position: nextPosition,
        createdAt: now,
        updatedAt: now,
        createdBy: null,
        stopIds: [],
        assignments: [],
        progress: { total: 0, done: 0 },
        lastAnnounced: null,
      }
      setGroups((gs) => [...gs, optimistic])

      try {
        const created = apiGroupToGroup(await apiClient.createIncidentGroup({ event_id: eventId, ...input }))
        setGroups((gs) => gs.map((g) => (g.id === tempId ? created : g)))
        return created
      } catch (error) {
        console.error("Failed to create Auftrag:", error)
        setGroups((gs) => gs.filter((g) => g.id !== tempId))
        toast.error(translateOutsideReact("notifications.groups.createFailed"))
        return null
      }
    },
    [selectedEvent, groups],
  )

  const updateGroup = useCallback(async (id: string, input: UpdateGroupInput): Promise<boolean> => {
    mutationEpochRef.current++

    const previous = groups.find((g) => g.id === id)
    if (!previous) return false

    setGroups((gs) =>
      gs.map((g) =>
        g.id === id
          ? {
              ...g,
              ...(input.name !== undefined ? { name: input.name } : {}),
              ...(input.color !== undefined ? { color: input.color } : {}),
              ...(input.notes !== undefined ? { notes: input.notes } : {}),
            }
          : g,
      ),
    )

    try {
      const updated = apiGroupToGroup(await apiClient.updateIncidentGroup(id, input))
      setGroups((gs) => gs.map((g) => (g.id === id ? updated : g)))
      return true
    } catch (error) {
      console.error("Failed to update Auftrag:", error)
      setGroups((gs) => gs.map((g) => (g.id === id ? previous : g)))
      toast.error(translateOutsideReact("notifications.groups.updateFailed"))
      return false
    }
  }, [groups])

  // Note what was just read out over the radio for a route. Optimistic and
  // silent on failure: a lost note only means the next stop hears the full
  // announcement once more, which is the safe direction — it must never put a
  // toast in front of an Einsatzleiter who is mid-Funkspruch.
  const recordAnnouncement = useCallback(
    async (id: string, announcement: AnnouncementInput): Promise<boolean> => {
      mutationEpochRef.current++

      const previous = groups.find((g) => g.id === id)
      if (!previous) return false

      const optimistic = {
        at: new Date(),
        fingerprint: announcement.fingerprint,
        stopId: announcement.stopId ?? null,
        full: announcement.full,
      }
      setGroups((gs) => gs.map((g) => (g.id === id ? { ...g, lastAnnounced: optimistic } : g)))

      try {
        const updated = apiGroupToGroup(
          await apiClient.recordGroupAnnouncement(id, {
            fingerprint: announcement.fingerprint,
            stop_id: announcement.stopId ?? null,
            full: announcement.full,
          }),
        )
        setGroups((gs) => gs.map((g) => (g.id === id ? updated : g)))
        return true
      } catch (error) {
        console.error("Failed to record Funkdurchsage:", error)
        setGroups((gs) => gs.map((g) => (g.id === id ? previous : g)))
        return false
      }
    },
    [groups],
  )

  const deleteGroup = useCallback(async (id: string): Promise<boolean> => {
    mutationEpochRef.current++

    const snapshot = groups
    setGroups((gs) => gs.filter((g) => g.id !== id))

    try {
      await apiClient.deleteIncidentGroup(id)
      return true
    } catch (error) {
      console.error("Failed to delete Auftrag:", error)
      setGroups(snapshot)
      toast.error(translateOutsideReact("notifications.groups.deleteFailed"))
      return false
    }
  }, [groups])

  const reorderGroups = useCallback(async (orderedIds: string[]): Promise<boolean> => {
    if (!selectedEvent || !isValidUUID(selectedEvent.id) || orderedIds.length === 0) return false
    const eventId = selectedEvent.id

    mutationEpochRef.current++

    const snapshot = groups
    // Reorder locally and restamp positions to the new index.
    const byId = new Map(groups.map((g) => [g.id, g]))
    const reordered = orderedIds
      .map((gid, index) => {
        const g = byId.get(gid)
        return g ? { ...g, position: index } : null
      })
      .filter((g): g is IncidentGroup => g !== null)
    // Keep any groups not present in orderedIds appended, order preserved.
    const missing = groups.filter((g) => !orderedIds.includes(g.id))
    setGroups([...reordered, ...missing])

    try {
      await apiClient.reorderIncidentGroups(eventId, orderedIds)
      return true
    } catch (error) {
      console.error("Failed to reorder Aufträge:", error)
      setGroups(snapshot)
      toast.error(translateOutsideReact("notifications.groups.reorderFailed"))
      return false
    }
  }, [selectedEvent, groups])

  const reorderGroupStops = useCallback(async (groupId: string, orderedIds: string[]): Promise<boolean> => {
    mutationEpochRef.current++

    const previous = groupsRef.current.find((g) => g.id === groupId)
    if (!previous) return false

    setGroups((gs) => {
      const next = gs.map((g) => (g.id === groupId ? { ...g, stopIds: orderedIds } : g))
      groupsRef.current = next
      return next
    })

    let succeeded = false
    const previousRequest = reorderQueuesRef.current.get(groupId) ?? Promise.resolve()
    const request = previousRequest.catch(() => {}).then(async () => {
      await apiClient.reorderGroupStops(groupId, orderedIds)
      succeeded = true
    })
    reorderQueuesRef.current.set(groupId, request)
    try {
      await request
      return succeeded
    } catch (error) {
      console.error("Failed to reorder stops:", error)
      setGroups((gs) => gs.map((g) => {
        if (g.id !== groupId) return g
        const isStillThisOrder = g.stopIds.length === orderedIds.length && g.stopIds.every((id, i) => id === orderedIds[i])
        return isStillThisOrder ? previous : g
      }))
      toast.error(translateOutsideReact("notifications.groups.reorderStopsFailed"))
      return false
    } finally {
      if (reorderQueuesRef.current.get(groupId) === request) reorderQueuesRef.current.delete(groupId)
    }
  }, [])

  const restoreGroupStops = useCallback(
    async (groupId: string, orderedIds: string[], expectedIds: string[]): Promise<StopRestoreResult> => {
      mutationEpochRef.current++
      // Same per-route queue as reorderGroupStops: an undo must not overtake a
      // drag that is still on its way to the server.
      const previousRequest = reorderQueuesRef.current.get(groupId) ?? Promise.resolve()
      const request = previousRequest.catch(() => {}).then(async (): Promise<StopRestoreResult> => {
        try {
          await apiClient.reorderGroupStops(groupId, orderedIds, expectedIds)
          return "restored"
        } catch (error) {
          if (ApiError.isConflictError(error)) return "conflict"
          console.error("Failed to restore stop order:", error)
          return "failed"
        }
      })
      reorderQueuesRef.current.set(groupId, request)
      let outcome: StopRestoreResult
      try {
        outcome = await request
      } finally {
        if (reorderQueuesRef.current.get(groupId) === request) reorderQueuesRef.current.delete(groupId)
      }
      if (outcome === "restored") {
        setGroups((gs) => {
          const next = gs.map((g) => (g.id === groupId ? { ...g, stopIds: orderedIds } : g))
          groupsRef.current = next
          return next
        })
      } else if (outcome === "conflict") {
        // Our copy is the stale one — show what the route looks like now.
        void refreshGroups()
      }
      return outcome
    },
    [refreshGroups],
  )

  const addStops = useCallback(async (groupId: string, incidentIds: string[]): Promise<boolean> => {
    mutationEpochRef.current++

    const previous = groups.find((g) => g.id === groupId)
    if (!previous || incidentIds.length === 0) return false

    // Optimistically append the new stops (dedup) and bump the progress total.
    const appended = incidentIds.filter((id) => !previous.stopIds.includes(id))
    setGroups((gs) =>
      gs.map((g) =>
        g.id === groupId
          ? {
              ...g,
              stopIds: [...g.stopIds, ...appended],
              progress: { ...g.progress, total: g.progress.total + appended.length },
            }
          : g,
      ),
    )

    try {
      const updated = apiGroupToGroup(await apiClient.addStopsToGroup(groupId, incidentIds))
      setGroups((gs) => gs.map((g) => (g.id === groupId ? updated : g)))
      return true
    } catch (error) {
      console.error("Failed to add stops:", error)
      setGroups((gs) => gs.map((g) => (g.id === groupId ? previous : g)))
      toast.error(translateOutsideReact("notifications.groups.addStopsFailed"))
      return false
    }
  }, [groups])

  const removeStop = useCallback(async (groupId: string, incidentId: string): Promise<boolean> => {
    mutationEpochRef.current++

    const previous = groups.find((g) => g.id === groupId)
    if (!previous) return false

    const wasMember = previous.stopIds.includes(incidentId)
    setGroups((gs) =>
      gs.map((g) =>
        g.id === groupId
          ? {
              ...g,
              stopIds: g.stopIds.filter((id) => id !== incidentId),
              progress: {
                ...g.progress,
                total: wasMember ? Math.max(0, g.progress.total - 1) : g.progress.total,
              },
            }
          : g,
      ),
    )

    try {
      await apiClient.removeStopFromGroup(groupId, incidentId)
      return true
    } catch (error) {
      console.error("Failed to remove stop:", error)
      setGroups((gs) => gs.map((g) => (g.id === groupId ? previous : g)))
      toast.error(translateOutsideReact("notifications.groups.removeStopFailed"))
      return false
    }
  }, [groups])

  /**
   * The board's rule for an Einsatz, now for an Auftrag too: a vehicle that
   * was just put on a route with nobody driving it opens the driver prompt
   * (`VehicleDriverPrompt`). Not a block — a driver is sometimes named a minute
   * later on the forecourt — but the one moment to fix it in one tap. Fresh
   * special functions, like `performVehicleAssign`: the board snapshot can lag
   * a driver set a second ago on another device. Non-fatal on any failure: the
   * Auftrag still shows «Kein Fahrer» on the vehicle.
   */
  const promptIfDriverless = useCallback(
    async (groupId: string, vehicleId: string) => {
      const eventId = selectedEvent?.id
      if (!eventId || !requestVehicleDriver) return
      try {
        const functions = await apiClient.getEventSpecialFunctions(eventId)
        if (functions.some((f) => f.function_type === "driver" && f.vehicle_id === vehicleId)) return
        // Still on the route? (assign → release race, as on the incident path)
        const group = groupsRef.current.find((g) => g.id === groupId)
        if (!group?.assignments.some((a) => a.resourceType === "vehicle" && a.resourceId === vehicleId)) return
        const vehicleName = vehicles.find((v) => String(v.id) === vehicleId)?.name ?? vehicleId
        requestVehicleDriver({ vehicleId, vehicleName, groupId })
      } catch (error) {
        console.error("Failed to check the route vehicle's driver:", error)
      }
    },
    [selectedEvent, requestVehicleDriver, vehicles],
  )

  const assignResource = useCallback(
    async (groupId: string, resourceType: GroupResourceType, resourceId: string): Promise<boolean> => {
      const previous = groups.find((g) => g.id === groupId)
      if (!previous) return false
      // Already on the route — no-op (backend would 409).
      if (previous.assignments.some((a) => a.resourceType === resourceType && a.resourceId === resourceId)) {
        return true
      }

      // «Nicht einsatzbereit» locks the route exactly like it locks a
      // Schadenplatz (operations-context assignVehicle): without this, a
      // defective vehicle could silently land on an Auftrag — the dialog greys
      // the row, but the number keys and any caller with a stale list bypass it.
      if (resourceType === "vehicle" && outOfServiceVehicleIds.has(resourceId)) {
        const name = vehicles.find((v) => String(v.id) === resourceId)?.name ?? resourceId
        toast.error(translateOutsideReact("notifications.materials.outOfServiceBlockedTitle", { name }), {
          description: translateOutsideReact("notifications.materials.outOfServiceBlockedDescription"),
        })
        return false
      }

      mutationEpochRef.current++
      // A vehicle is not settled until its driver check has answered (⌘K waits on it).
      const settled = resourceType === "vehicle" ? beginAssignmentSettling() : () => {}

      const tempId = `temp-${randomId()}`
      const optimistic: GroupAssignment = { id: tempId, resourceType, resourceId, driverStay: false, isLeader: false }
      setGroups((gs) =>
        gs.map((g) => (g.id === groupId ? { ...g, assignments: [...g.assignments, optimistic] } : g)),
      )

      try {
        await apiClient.assignGroupResource(groupId, { resource_type: resourceType, resource_id: resourceId })
        // Reconcile with the server truth (canonical assignment id + progress).
        await refreshGroups()
        if (resourceType === "vehicle") void promptIfDriverless(groupId, resourceId).finally(settled)
        return true
      } catch (error) {
        settled()
        console.error("Failed to assign route resource:", error)
        setGroups((gs) =>
          gs.map((g) =>
            g.id === groupId ? { ...g, assignments: g.assignments.filter((a) => a.id !== tempId) } : g,
          ),
        )
        toast.error(translateOutsideReact("notifications.groups.assignFailed"))
        return false
      }
    },
    [groups, refreshGroups, outOfServiceVehicleIds, vehicles, promptIfDriverless, beginAssignmentSettling],
  )

  const unassignResource = useCallback(
    async (groupId: string, assignmentId: string): Promise<boolean> => {
      const previous = groups.find((g) => g.id === groupId)
      if (!previous) return false

      mutationEpochRef.current++

      setGroups((gs) =>
        gs.map((g) =>
          g.id === groupId ? { ...g, assignments: g.assignments.filter((a) => a.id !== assignmentId) } : g,
        ),
      )

      try {
        await apiClient.unassignGroupResource(groupId, assignmentId)
        await refreshGroups()
        return true
      } catch (error) {
        console.error("Failed to release route resource:", error)
        setGroups((gs) => gs.map((g) => (g.id === groupId ? previous : g)))
        toast.error(translateOutsideReact("notifications.groups.unassignFailed"))
        return false
      }
    },
    [groups, refreshGroups],
  )

  /**
   * id → name for everybody who could be on a route.
   *
   * The live context wins where it has an answer (a rename lands there first);
   * the roster fetched above covers everybody it dropped — which is anybody who
   * has checked out, and they keep their route assignment.
   */
  const personnelNames = useMemo(() => {
    const names = new Map<string, string>()
    for (const person of roster) names.set(String(person.id), person.name)
    for (const person of personnel) names.set(person.id, person.name)
    return names
  }, [roster, personnel])

  const getGroupResources = useCallback(
    (groupId: string): GroupResources => {
      const g = groups.find((x) => x.id === groupId)
      if (!g) return EMPTY_RESOURCES
      const res: GroupResources = { vehicles: [], personnel: [], materials: [] }
      // Whatever is missing, it is NEVER the id: a UUID in a chip is unreadable,
      // and this name is also what goes into the Funkspruch, the WhatsApp text
      // and the printout. A placeholder is wrong in a way an operator can see.
      const unknown = translateOutsideReact("kanban.common.unknownResource")
      // `|| unknown` on a TRIMMED name, not `?? unknown`: an empty or
      // whitespace-only name would otherwise render as a blank chip, which is
      // worse than «Unbekannt» — it looks like nothing is assigned at all.
      for (const a of g.assignments) {
        if (a.resourceType === "vehicle") {
          const v = vehicles.find((x) => String(x.id) === a.resourceId)
          res.vehicles.push({
            assignmentId: a.id,
            resourceId: a.resourceId,
            name: v?.name?.trim() || unknown,
            driverStay: a.driverStay,
          })
        } else if (a.resourceType === "personnel") {
          res.personnel.push({
            assignmentId: a.id,
            resourceId: a.resourceId,
            name: personnelNames.get(a.resourceId)?.trim() || unknown,
            isLeader: a.isLeader,
          })
        } else {
          const m = materials.find((x) => x.id === a.resourceId)
          res.materials.push({
            assignmentId: a.id,
            resourceId: a.resourceId,
            name: m?.name?.trim() || unknown,
            location: m?.category?.trim() || undefined,
          })
        }
      }
      return res
    },
    [groups, vehicles, personnelNames, materials],
  )

  const groupResourcesFor = useCallback(
    (operation: Operation): GroupResources =>
      operation.groupId ? getGroupResources(operation.groupId) : EMPTY_RESOURCES,
    [getGroupResources],
  )

  const occupiedResourceIds = useMemo<Record<GroupResourceType, Set<string>>>(() => {
    const occupied = { vehicle: new Set<string>(), personnel: new Set<string>(), material: new Set<string>() }
    for (const group of groups) {
      for (const assignment of group.assignments) occupied[assignment.resourceType].add(assignment.resourceId)
    }
    return occupied
  }, [groups])

  const selectedEventId = selectedEvent && isValidUUID(selectedEvent.id) ? selectedEvent.id : null
  const scopedGroups = selectedEventId ? groups.filter((group) => group.eventId === selectedEventId) : []

  return (
    <GroupsContext.Provider
      value={{
        groups: scopedGroups,
        isLoaded: isLoaded && loadedEventId === selectedEventId,
        refreshGroups,
        createGroup,
        updateGroup,
        recordAnnouncement,
        deleteGroup,
        reorderGroups,
        reorderGroupStops,
        restoreGroupStops,
        addStops,
        removeStop,
        assignResource,
        unassignResource,
        getGroupResources,
        groupResourcesFor,
        occupiedResourceIds,
      }}
    >
      {children}
    </GroupsContext.Provider>
  )
}

export function useGroups() {
  const context = useContext(GroupsContext)
  if (context === undefined) {
    throw new Error("useGroups must be used within a GroupsProvider")
  }
  return context
}
