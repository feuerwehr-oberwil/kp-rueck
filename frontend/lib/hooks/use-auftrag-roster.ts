"use client"

import { useMemo } from "react"
import { useGroups } from "@/lib/contexts/groups-context"
import { useOperations, type Person } from "@/lib/contexts/operations-context"

/**
 * The roster with «steht auf einem Auftrag» folded in (`isOnAuftrag`) – what the
 * board's sidebar and every assignment dialog must draw.
 *
 * A route's crew is held on the group, and `GroupsProvider` sits inside
 * `OperationsProvider`, so the event-scoped reconciliation that produces `status`
 * never sees a group assignment. Without this, a Sturm route with five people on
 * it left all five drawn emerald in the sidebar and counted in «verfügbar» over
 * it – the same bug `isReko` was given `personResourceState` to fix, one source
 * of assignment later.
 */
export function useAuftragRoster(): Person[] {
  const { personnel } = useOperations()
  const { occupiedResourceIds } = useGroups()
  return useMemo(
    () =>
      personnel.map((person) =>
        occupiedResourceIds.personnel.has(person.id) ? { ...person, isOnAuftrag: true } : person,
      ),
    [personnel, occupiedResourceIds],
  )
}
