'use client'

import { useCallback, useMemo } from 'react'

import { useGroups } from '@/lib/contexts/groups-context'
import { useOperations } from '@/lib/contexts/operations-context'
import { personPlaces } from '@/lib/person-places'
import { personMatchesQuery } from '@/lib/resource-status'

/**
 * Every person's current places (`personPlaces`) from the board's live Einsätze and Aufträge,
 * by person id – computed once per board change.
 */
export function usePersonPlaces() {
  const { operations, personnel } = useOperations()
  const { groups } = useGroups()
  return useMemo(() => personPlaces(operations, groups, personnel), [operations, groups, personnel])
}

/**
 * The board's person search: `personMatchesQuery` with the person's current places filled in.
 * Every board person picker filters through it –
 * `const matches = usePersonMatcher(); people.filter((p) => matches(p, query))`.
 */
export function usePersonMatcher() {
  const places = usePersonPlaces()
  return useCallback(
    (person: Parameters<typeof personMatchesQuery>[0] & { id: string }, query: string) =>
      personMatchesQuery({ ...person, places: places.get(person.id) }, query),
    [places],
  )
}
