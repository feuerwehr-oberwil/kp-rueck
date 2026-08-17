"use client"

import { createContext, useContext, useState, useEffect, ReactNode, useCallback, useRef, useMemo } from "react"
import { toast } from "sonner"
import { translateOutsideReact } from "@/lib/i18n-messages"
import {
  apiClient,
  type ApiIncidentGroup,
  type ApiIncidentGroupCreate,
  type ApiIncidentGroupUpdate,
  type ApiPersonnel,
  type ApiVehicle,
  type GroupResourceType,
} from "@/lib/api-client"
import type { GroupAssignment, GroupResources, IncidentGroup } from "@/lib/types/groups"
import type { Operation } from "@/lib/contexts/operations-context"
import { shouldStartPollingOnMount } from "@/lib/sync-cooldown"
import { isValidUUID, randomId } from "@/lib/utils/validation"
import { wsClient, type WebSocketStatus } from "@/lib/websocket-client"
import { useAuth } from "./auth-context"
import { useEvent } from "./event-context"
import { usePersonnel } from "./personnel-context"
import { useMaterials } from "./materials-context"

// Re-export the client type for convenience (mirrors materials-context exposing Material).
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

  const [groups, setGroups] = useState<IncidentGroup[]>([])
  const [isLoaded, setIsLoaded] = useState(false)
  const [loadedEventId, setLoadedEventId] = useState<string | null>(null)
  // Vehicle name lookup — no dedicated vehicles context exists, so resolve the
  // route's vehicle assignments (which carry ids) to names via a light fetch.
  const [vehicles, setVehicles] = useState<ApiVehicle[]>([])
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
   * Fetched once, exactly like the vehicle list above and for the same reason.
   */
  const [roster, setRoster] = useState<ApiPersonnel[]>([])

  // Toast deduplication across an outage; matches the materials-context pattern.
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
  const reorderQueuesRef = useRef(new Map<string, Promise<void>>())

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
      setGroups(apiGroups.map(apiGroupToGroup))
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

  // Load the vehicle list and the roster once (name resolution for route
  // assignments). Neither is event-scoped: both answer "what is this id called",
  // and an id that is on a route is on it whatever the person's duty status is.
  useEffect(() => {
    if (authLoading || !isAuthenticated) return
    apiClient
      .getVehicles()
      .then((list) => setVehicles(list))
      .catch(() => {
        // Silent: names fall back to the placeholder until the list loads.
      })
    apiClient
      .getAllPersonnel()
      .then((list) => setRoster(list))
      .catch(() => {
        // Silent, same reason.
      })
  }, [authLoading, isAuthenticated])

  // Initial load + WebSocket subscription + polling fallback. The socket
  // lifecycle itself is owned by operations-context; here we only subscribe.
  useEffect(() => {
    if (authLoading || !isAuthenticated) return

    const nextEventId = selectedEvent && isValidUUID(selectedEvent.id) ? selectedEvent.id : null
    activeEventIdRef.current = nextEventId
    loadSequenceRef.current++
    setGroups([])
    setIsLoaded(false)
    setLoadedEventId(null)
    lastSyncVersionRef.current = null

    if (!nextEventId) {
      // Only declare "loaded" once events have actually resolved, so consumers
      // don't flash an empty state before the selected event is known.
      if (isEventLoaded) setIsLoaded(true)
      return
    }

    const eventId = nextEventId
    let cancelled = false

    const loadData = async () => {
      const epochAtStart = mutationEpochRef.current
      const sequence = ++loadSequenceRef.current
      try {
        const versionSnapshot = await apiClient.getSyncVersion(eventId).catch(() => null)
        const apiGroups = await apiClient.getIncidentGroups(eventId)
        if (cancelled || activeEventIdRef.current !== eventId || sequence !== loadSequenceRef.current) return
        if (mutationEpochRef.current !== epochAtStart) return
        setGroups(apiGroups.map(apiGroupToGroup))
        hasShownErrorRef.current = false
        lastSyncVersionRef.current = versionSnapshot?.version ?? null
      } catch (error) {
        console.error("Failed to load Aufträge:", error)
      } finally {
        if (!cancelled && activeEventIdRef.current === eventId) {
          setIsLoaded(true)
          setLoadedEventId(eventId)
        }
      }
    }

    loadData()

    // Coalesce related broadcasts: one backend action may emit an incident,
    // assignment and group event in quick succession.
    let refreshTimeout: ReturnType<typeof setTimeout> | undefined
    const scheduleRefresh = () => {
      if (refreshTimeout) return
      refreshTimeout = setTimeout(() => {
        refreshTimeout = undefined
        void refreshGroups()
      }, 25)
    }
    const unsubscribeGroupUpdate = wsClient.on("group_update", scheduleRefresh)
    const unsubscribeAssignmentUpdate = wsClient.on("assignment_update", scheduleRefresh)
    const unsubscribeIncidentUpdate = wsClient.on("incident_update", scheduleRefresh)

    // Polling fallback: only while the socket is down. Mirrors operations-context —
    // a lightweight sync-version check gates the full group reload.
    let pollTimeout: ReturnType<typeof setTimeout> | undefined
    let isPollingActive = false

    const schedulePoll = () => {
      if (!isPollingActive) return
      pollTimeout = setTimeout(async () => {
        if (!isPollingActive) return
        try {
          const { version } = await apiClient.getSyncVersion(eventId)
          if (version !== lastSyncVersionRef.current) {
            lastSyncVersionRef.current = version
            await refreshGroups()
          }
        } catch {
          // Ignore; the next tick retries.
        }
        if (isPollingActive) schedulePoll()
      }, POLLING_INTERVAL)
    }

    const startPolling = () => {
      if (!isPollingActive) {
        isPollingActive = true
        schedulePoll()
      }
    }

    const stopPolling = () => {
      isPollingActive = false
      if (pollTimeout) {
        clearTimeout(pollTimeout)
        pollTimeout = undefined
      }
    }

    const statusUnsubscribe = wsClient.onStatusChange((status: WebSocketStatus) => {
      if (status === "disconnected" || status === "error") {
        startPolling()
      } else if (status === "connected") {
        stopPolling()
        // Resync once per (re)connect: group_update events broadcast while we
        // weren't in the room are gone otherwise.
        refreshGroups()
      }
    })

    // If the socket is already down when this effect runs, start polling now.
    // Shared with operations-context, which was missing it — see
    // `shouldStartPollingOnMount`.
    if (shouldStartPollingOnMount(wsClient.getStatus())) startPolling()

    return () => {
      cancelled = true
      unsubscribeGroupUpdate()
      unsubscribeAssignmentUpdate()
      unsubscribeIncidentUpdate()
      if (refreshTimeout) clearTimeout(refreshTimeout)
      statusUnsubscribe()
      stopPolling()
    }
  }, [authLoading, isAuthenticated, selectedEvent, isEventLoaded, refreshGroups])

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

  const assignResource = useCallback(
    async (groupId: string, resourceType: GroupResourceType, resourceId: string): Promise<boolean> => {
      const previous = groups.find((g) => g.id === groupId)
      if (!previous) return false
      // Already on the route — no-op (backend would 409).
      if (previous.assignments.some((a) => a.resourceType === resourceType && a.resourceId === resourceId)) {
        return true
      }

      mutationEpochRef.current++

      const tempId = `temp-${randomId()}`
      const optimistic: GroupAssignment = { id: tempId, resourceType, resourceId, driverStay: false, isLeader: false }
      setGroups((gs) =>
        gs.map((g) => (g.id === groupId ? { ...g, assignments: [...g.assignments, optimistic] } : g)),
      )

      try {
        await apiClient.assignGroupResource(groupId, { resource_type: resourceType, resource_id: resourceId })
        // Reconcile with the server truth (canonical assignment id + progress).
        await refreshGroups()
        return true
      } catch (error) {
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
    [groups, refreshGroups],
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
      for (const a of g.assignments) {
        if (a.resourceType === "vehicle") {
          const v = vehicles.find((x) => String(x.id) === a.resourceId)
          res.vehicles.push({
            assignmentId: a.id,
            resourceId: a.resourceId,
            name: v?.name ?? unknown,
            driverStay: a.driverStay,
          })
        } else if (a.resourceType === "personnel") {
          res.personnel.push({
            assignmentId: a.id,
            resourceId: a.resourceId,
            name: personnelNames.get(a.resourceId) ?? unknown,
            isLeader: a.isLeader,
          })
        } else {
          const m = materials.find((x) => x.id === a.resourceId)
          res.materials.push({ assignmentId: a.id, resourceId: a.resourceId, name: m?.name ?? unknown })
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
