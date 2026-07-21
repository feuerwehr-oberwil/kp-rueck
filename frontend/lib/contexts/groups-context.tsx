"use client"

import { createContext, useContext, useState, useEffect, ReactNode, useCallback, useRef } from "react"
import { toast } from "sonner"
import { translateOutsideReact } from "@/lib/i18n-messages"
import {
  apiClient,
  type ApiIncidentGroup,
  type ApiIncidentGroupCreate,
  type ApiIncidentGroupUpdate,
  type ApiCopySquadResult,
  type GroupResourceType,
} from "@/lib/api-client"
import type { IncidentGroup } from "@/lib/types/groups"
import { isValidUUID } from "@/lib/utils/validation"
import { wsClient, type WebSocketStatus } from "@/lib/websocket-client"
import { useAuth } from "./auth-context"
import { useEvent } from "./event-context"

// Re-export the client type for convenience (mirrors materials-context exposing Material).
export type { IncidentGroup } from "@/lib/types/groups"

/** Fields the UI supplies when creating an Auftrag (event scope is injected). */
export type CreateGroupInput = Omit<ApiIncidentGroupCreate, "event_id">
/** Partial PATCH payload for an Auftrag (name / color / mode / notes). */
export type UpdateGroupInput = ApiIncidentGroupUpdate

interface GroupsContextType {
  /** Aufträge of the selected event, in `position` order. */
  groups: IncidentGroup[]
  /** True once the first load has resolved (gate empty states on this). */
  isLoaded: boolean
  refreshGroups: () => Promise<void>
  createGroup: (input: CreateGroupInput) => Promise<IncidentGroup | null>
  updateGroup: (id: string, input: UpdateGroupInput) => Promise<boolean>
  deleteGroup: (id: string) => Promise<boolean>
  reorderGroups: (orderedIds: string[]) => Promise<boolean>
  reorderGroupStops: (groupId: string, orderedIds: string[]) => Promise<boolean>
  addStops: (groupId: string, incidentIds: string[]) => Promise<boolean>
  removeStop: (groupId: string, incidentId: string) => Promise<boolean>
  copySquad: (
    groupId: string,
    sourceIncidentId: string,
    resourceTypes?: GroupResourceType[],
  ) => Promise<ApiCopySquadResult | null>
}

const GroupsContext = createContext<GroupsContextType | undefined>(undefined)

// Convert the API shape to the camelCase client type (dates parsed to Date).
const apiGroupToGroup = (g: ApiIncidentGroup): IncidentGroup => ({
  id: String(g.id),
  eventId: String(g.event_id),
  name: g.name,
  color: g.color ?? null,
  mode: g.mode,
  notes: g.notes ?? null,
  position: g.position,
  createdAt: new Date(g.created_at),
  updatedAt: new Date(g.updated_at),
  createdBy: g.created_by ? String(g.created_by) : null,
  stopIds: g.stop_ids.map(String),
  progress: { total: g.progress?.total ?? 0, done: g.progress?.done ?? 0 },
})

// Poll cadence for the sync-version fallback (matches operations-context).
const POLLING_INTERVAL = 5000

export function GroupsProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, loading: authLoading } = useAuth()
  const { selectedEvent, isEventLoaded } = useEvent()

  const [groups, setGroups] = useState<IncidentGroup[]>([])
  const [isLoaded, setIsLoaded] = useState(false)

  // Toast deduplication across an outage; matches the materials-context pattern.
  const hasShownErrorRef = useRef(false)
  // Every optimistic mutation bumps this epoch. A refresh discards its result if
  // the epoch moved while it was in flight — otherwise a poll/WS reload that
  // began just before a mutation would overwrite the optimistic state.
  const mutationEpochRef = useRef(0)
  // Sync version for the lightweight polling fallback (folds in incident_groups).
  const lastSyncVersionRef = useRef<string | null>(null)

  const refreshGroups = useCallback(async (): Promise<void> => {
    if (!selectedEvent || !isValidUUID(selectedEvent.id)) {
      setGroups([])
      return
    }

    const epochAtStart = mutationEpochRef.current
    try {
      const apiGroups = await apiClient.getIncidentGroups(selectedEvent.id)
      // A local mutation landed while this reload was fetching — its optimistic
      // state is newer than this snapshot. Discard the stale result.
      if (mutationEpochRef.current !== epochAtStart) return
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

  // Initial load + WebSocket subscription + polling fallback. The socket
  // lifecycle itself is owned by operations-context; here we only subscribe.
  useEffect(() => {
    if (authLoading || !isAuthenticated) return

    if (!selectedEvent || !isValidUUID(selectedEvent.id)) {
      setGroups([])
      // Only declare "loaded" once events have actually resolved, so consumers
      // don't flash an empty state before the selected event is known.
      if (isEventLoaded) setIsLoaded(true)
      return
    }

    const eventId = selectedEvent.id
    let cancelled = false

    const loadData = async () => {
      const epochAtStart = mutationEpochRef.current
      try {
        const versionSnapshot = await apiClient.getSyncVersion(eventId).catch(() => null)
        const apiGroups = await apiClient.getIncidentGroups(eventId)
        if (cancelled) return
        if (mutationEpochRef.current !== epochAtStart) return
        setGroups(apiGroups.map(apiGroupToGroup))
        hasShownErrorRef.current = false
        lastSyncVersionRef.current = versionSnapshot?.version ?? null
      } catch (error) {
        console.error("Failed to load Aufträge:", error)
      } finally {
        if (!cancelled) setIsLoaded(true)
      }
    }

    loadData()

    // Refresh on the group_update WS broadcast (create/update/delete/reorder/stops).
    const unsubscribeGroupUpdate = wsClient.on("group_update", () => {
      refreshGroups()
    })

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
    if (wsClient.getStatus() !== "connected") startPolling()

    return () => {
      cancelled = true
      unsubscribeGroupUpdate()
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
      const tempId = `temp-${crypto.randomUUID()}`
      const nextPosition = groups.reduce((max, g) => Math.max(max, g.position), -1) + 1
      const now = new Date()
      const optimistic: IncidentGroup = {
        id: tempId,
        eventId,
        name: input.name,
        color: input.color ?? null,
        mode: input.mode ?? "squad",
        notes: input.notes ?? null,
        position: nextPosition,
        createdAt: now,
        updatedAt: now,
        createdBy: null,
        stopIds: [],
        progress: { total: 0, done: 0 },
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
              ...(input.mode !== undefined ? { mode: input.mode } : {}),
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

    const previous = groups.find((g) => g.id === groupId)
    if (!previous) return false

    setGroups((gs) => gs.map((g) => (g.id === groupId ? { ...g, stopIds: orderedIds } : g)))

    try {
      await apiClient.reorderGroupStops(groupId, orderedIds)
      return true
    } catch (error) {
      console.error("Failed to reorder stops:", error)
      setGroups((gs) => gs.map((g) => (g.id === groupId ? previous : g)))
      toast.error(translateOutsideReact("notifications.groups.reorderStopsFailed"))
      return false
    }
  }, [groups])

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

  const copySquad = useCallback(
    async (
      groupId: string,
      sourceIncidentId: string,
      resourceTypes?: GroupResourceType[],
    ): Promise<ApiCopySquadResult | null> => {
      // No local group state changes here — assignments live in operations-context,
      // which reconciles them via the incident/assignment WS + poll paths.
      try {
        return await apiClient.copyGroupSquad(groupId, sourceIncidentId, resourceTypes)
      } catch (error) {
        console.error("Failed to copy squad:", error)
        toast.error(translateOutsideReact("notifications.groups.copySquadFailed"))
        return null
      }
    },
    [],
  )

  return (
    <GroupsContext.Provider
      value={{
        groups,
        isLoaded,
        refreshGroups,
        createGroup,
        updateGroup,
        deleteGroup,
        reorderGroups,
        reorderGroupStops,
        addStops,
        removeStop,
        copySquad,
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
