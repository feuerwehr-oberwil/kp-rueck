import type { Operation } from '@/lib/contexts/operations/types'
import type { IncidentGroup } from '@/lib/types/groups'

/**
 * Where a person is bound right now, as search terms: the Einsatz numbers and the lowercased
 * texts (address, the Auftrag's name) a person picker matches a query against
 * (`personMatchesQuery`, owner feedback 23.11.2026 #8: «search where the person is dispatched»).
 */
export interface PersonPlaces {
  numbers: ReadonlySet<number>
  texts: readonly string[]
}

/** What `personPlaces` reads of an Einsatz and an Auftrag – the board's `Operation` and `IncidentGroup` fit. */
type PlaceOperation = Pick<Operation, 'id' | 'number' | 'location' | 'locationDisplay' | 'status' | 'groupId'> & {
  crew: readonly Pick<Operation['crew'][number], 'personnelId'>[]
  vehicles: readonly Pick<Operation['vehicles'][number], 'vehicleId'>[]
  assignedReko: { id: string } | null
}
type PlaceGroup = Pick<IncidentGroup, 'id' | 'name' | 'stopIds'> & {
  assignments: readonly Pick<IncidentGroup['assignments'][number], 'resourceType' | 'resourceId'>[]
}
type PlacePerson = { id: string; isDriver?: boolean; driverVehicleId?: string }

/**
 * Every person's places, by person id. A person is at an Einsatz they are crew of, Reko of,
 * or drive a vehicle of, and at every stop of an Auftrag whose crew they are (or whose vehicle
 * they drive) – an Auftrag's crew holds no row on its stops. A stop's place carries the
 * Auftrag's name too. A closed Einsatz is nobody's place. People bound nowhere are absent.
 *
 * Pure, so the board computes it once per render (`usePersonMatcher`) and ⌘K reads it.
 */
export function personPlaces(
  operations: readonly PlaceOperation[],
  groups: readonly PlaceGroup[],
  personnel: readonly PlacePerson[] = [],
): Map<string, PersonPlaces> {
  const groupById = new Map(groups.map((group) => [group.id, group]))
  const open = operations.filter((op) => op.status !== 'complete')
  const opById = new Map(open.map((op) => [op.id, op]))
  const found = new Map<string, { numbers: Set<number>; texts: Set<string> }>()

  const add = (personId: string, op: PlaceOperation) => {
    let entry = found.get(personId)
    if (!entry) found.set(personId, (entry = { numbers: new Set(), texts: new Set() }))
    if (typeof op.number === 'number') entry.numbers.add(op.number)
    for (const text of [op.location, op.locationDisplay, op.groupId ? groupById.get(op.groupId)?.name : undefined]) {
      if (text) entry.texts.add(text.toLowerCase())
    }
  }
  const addGroup = (personId: string, group: PlaceGroup) => {
    let entry = found.get(personId)
    if (!entry) found.set(personId, (entry = { numbers: new Set(), texts: new Set() }))
    entry.texts.add(group.name.toLowerCase())
    for (const stopId of group.stopIds) {
      const stop = opById.get(stopId)
      if (stop) add(personId, stop)
    }
  }

  for (const op of open) {
    for (const member of op.crew) add(member.personnelId, op)
    if (op.assignedReko) add(op.assignedReko.id, op)
  }
  for (const group of groups) {
    for (const a of group.assignments) if (a.resourceType === 'personnel') addGroup(a.resourceId, group)
  }
  for (const person of personnel) {
    const vehicleId = person.isDriver ? person.driverVehicleId : undefined
    if (!vehicleId) continue
    for (const op of open) if (op.vehicles.some((v) => v.vehicleId === vehicleId)) add(person.id, op)
    for (const group of groups) {
      if (group.assignments.some((a) => a.resourceType === 'vehicle' && a.resourceId === vehicleId)) addGroup(person.id, group)
    }
  }

  return new Map([...found].map(([id, { numbers, texts }]) => [id, { numbers, texts: [...texts] }]))
}

/**
 * Does a query name one of these places? A query of digits only is an Einsatz number and
 * matches it exactly – «12» is Einsatz 12, not every «Ringstrasse 120»; any other query is
 * found inside an address or an Auftrag's name. `q` is already trimmed and lowercased.
 */
export function placesMatch(places: PersonPlaces | null | undefined, q: string): boolean {
  if (!places) return false
  if (/^\d+$/.test(q)) return places.numbers.has(Number(q))
  return places.texts.some((text) => text.includes(q))
}
