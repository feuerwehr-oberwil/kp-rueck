'use client'

/**
 * Where each person is actually engaged right now, by name (sweep 27 §P3.5).
 *
 * The sidebar card's status icon used to say a bare «Im Einsatz» for everyone
 * `isPersonOccupied` flags — including special-function holders (Fahrer,
 * Telefondienst, …) who are on no incident at all, which claimed an Einsatz
 * that does not exist. This resolves the real engagement the same way the
 * assignment dialog's «Bereits im Einsatz» labels do: an incident's crew list
 * names the incident (short address + type/Meldung), a route-level assignment
 * names the Auftrag. A person on neither is simply absent from the map — the
 * caller then falls back to the function name, never to a generic «Im Einsatz».
 *
 * Keyed by NAME because the operations context's `crew` arrays hold names —
 * the same convention the dialog already leans on. Computed once per board
 * render and passed down as a prop, so the memoized person cards do not each
 * subscribe to the whole operations context.
 */

import { useMemo } from 'react'

import { useGroups } from '@/lib/contexts/groups-context'
import { useOperations } from '@/lib/contexts/operations-context'
import { getIncidentRefLabel } from '@/lib/incident-types'

export interface PersonEngagement {
  /** Truncated for inline chips. */
  short: string
  /** Untruncated, for hover titles. */
  full: string
}

export function usePersonEngagements(): Map<string, PersonEngagement> {
  const { operations } = useOperations()
  const { groups, getGroupResources } = useGroups()

  return useMemo(() => {
    const map = new Map<string, PersonEngagement>()
    for (const op of operations) {
      // A completed incident has released its crew, so `crew` is empty there —
      // no stale engagement survives a closed card.
      const label = { short: getIncidentRefLabel(op, 40), full: getIncidentRefLabel(op, 1000) }
      for (const name of op.crew) {
        if (!map.has(name)) map.set(name, label)
      }
    }
    for (const group of groups) {
      const resources = getGroupResources(group.id)
      const label = { short: group.name, full: group.name }
      for (const person of resources.personnel) {
        if (!map.has(person.name)) map.set(person.name, label)
      }
    }
    return map
  }, [operations, groups, getGroupResources])
}
