"use client"

import { useCallback, useMemo } from "react"
import type { GroupResources } from "@/lib/types/groups"
import { useOperations } from "@/lib/contexts/operations-context"

// Re-export the client type for convenience (as materials-context exposes Material).
export type { IncidentGroup } from "@/lib/types/groups"

const EMPTY_RESOURCES: GroupResources = { vehicles: [], personnel: [], materials: [] }

/**
 * The Aufträge of the selected Ereignis and their actions – a selector over the board
 * (`useOperations()`), like `usePersonnel()` / `useMaterials()`. The routes load with the board
 * snapshot and live under its one mutation epoch (`./operations/group-actions`); what they mean
 * for the rest of the board (each route's named resources, who stands on one) is derived there
 * once (`deriveAuftragState`).
 */
export function useGroups() {
  const { groups, auftragResources, occupiedResourceIds, groupActions, isLoaded, boardNeverLoaded } = useOperations()

  /** A route's owned resources, named and split by kind (empty for an unknown id). */
  const getGroupResources = useCallback(
    (groupId: string): GroupResources => auftragResources.get(groupId) ?? EMPTY_RESOURCES,
    [auftragResources],
  )

  return useMemo(
    () => ({
      /** In `position` order. */
      groups,
      /** True once the first board load has resolved (gate empty states on this) – failed loads too. */
      isLoaded,
      /** No board load of this Ereignis got through yet: an empty list says nothing. */
      loadFailed: boardNeverLoaded,
      ...groupActions,
      getGroupResources,
      occupiedResourceIds,
    }),
    [groups, isLoaded, boardNeverLoaded, groupActions, getGroupResources, occupiedResourceIds],
  )
}
