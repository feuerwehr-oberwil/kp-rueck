'use client'

/**
 * Where each person is actually engaged right now, by person id (sweep 27 §P3.5).
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
 * A Fahrer who is not crew is where their vehicle stands: «Fahrer Mowa · 12 ·
 * Ringstrasse 11 …», role first so the row's truncation never cuts it, the same
 * place the assignment dialog names. It used to read a bare «Fahrer Mowa», and
 * «where is the Mowa?» was a second lookup.
 *
 * Keyed by personnel id — two people may share a name. Computed once per board
 * render and passed down as a prop, so the memoized person cards do not each
 * subscribe to the whole operations context.
 */

import { useMemo } from 'react'
import { useTranslations } from 'next-intl'

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
  const { operations, personnel } = useOperations()
  const { groups, getGroupResources } = useGroups()
  const t = useTranslations('kanban')

  return useMemo(() => {
    const map = new Map<string, PersonEngagement>()
    for (const op of operations) {
      // A completed incident has released its crew, so `crew` is empty there —
      // no stale engagement survives a closed card.
      const label = { short: getIncidentRefLabel(op, 40), full: getIncidentRefLabel(op, 1000) }
      for (const { personnelId } of op.crew) {
        if (!map.has(personnelId)) map.set(personnelId, label)
      }
    }
    for (const person of personnel) {
      const vehicle = person.isDriver ? person.driverVehicleName : undefined
      const vehicleId = person.isDriver ? person.driverVehicleId : undefined
      if (!vehicle || !vehicleId || map.has(person.id)) continue
      const op = operations.find((o) => o.vehicles.some((v) => v.vehicleId === vehicleId))
      if (!op) continue
      const role = t('person.driverFunction', { vehicle })
      map.set(person.id, {
        short: `${role} · ${getIncidentRefLabel(op, 40)}`,
        full: `${role} · ${getIncidentRefLabel(op, 1000)}`,
      })
    }
    for (const group of groups) {
      const resources = getGroupResources(group.id)
      const label = { short: group.name, full: group.name }
      for (const person of resources.personnel) {
        if (!map.has(person.resourceId)) map.set(person.resourceId, label)
      }
    }
    return map
  }, [operations, personnel, groups, getGroupResources, t])
}
