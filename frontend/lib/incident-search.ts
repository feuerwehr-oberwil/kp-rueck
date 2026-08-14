import type { Material, Operation } from "@/lib/contexts/operations-context"
import { getIncidentTypeLabel } from "@/lib/incident-types"

/**
 * The board's one incident search.
 *
 * Address, type, priority, vehicles, crew, material NAMES (not ids), Meldung,
 * contact, status, Reko person, Auftrag name — one query field across all of
 * them, because an operator searching "Müller" does not know or care whether
 * Müller is crew on one incident and the Reko on another.
 *
 * It lives here rather than inside the board page because the /display board and
 * the /display status page ask the identical question, and a second copy is how
 * the wall screen quietly stops finding what the board finds.
 *
 * `groupName` is the name of the Auftrag this stop belongs to. The operation
 * itself only carries a `groupId`, so the caller resolves it — pass nothing and
 * the incident is simply not searchable by its route, exactly as before.
 */
export function matchesIncidentQuery(
  operation: Operation,
  query: string,
  materials: Material[],
  groupName?: string,
): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true

  return (
    operation.location.toLowerCase().includes(needle) ||
    operation.incidentType.toLowerCase().includes(needle) ||
    getIncidentTypeLabel(operation.incidentType).toLowerCase().includes(needle) ||
    operation.priority.toLowerCase().includes(needle) ||
    // `vehicle` is the legacy single field, `vehicles` the array — both, so an
    // incident created before the migration is still findable by its vehicle.
    (!!operation.vehicle && operation.vehicle.toLowerCase().includes(needle)) ||
    operation.vehicles.some((name) => name.toLowerCase().includes(needle)) ||
    operation.crew.some((name) => name.toLowerCase().includes(needle)) ||
    operation.materials.some((materialId) => {
      const material = materials.find((m) => m.id === materialId)
      return !!material && material.name.toLowerCase().includes(needle)
    }) ||
    operation.notes.toLowerCase().includes(needle) ||
    operation.contact.toLowerCase().includes(needle) ||
    operation.status.toLowerCase().includes(needle) ||
    (!!operation.assignedReko && operation.assignedReko.name.toLowerCase().includes(needle)) ||
    (operation.hasCompletedReko && "reko".includes(needle)) ||
    (!!groupName && groupName.toLowerCase().includes(needle))
  )
}

/**
 * `matchesIncidentQuery` over a list; returns the input untouched for an empty query.
 *
 * `groupNames` maps Auftrag id → Auftrag name (the routes context, or the
 * viewer payload's routes on a share link). Omit it and the stops of an Auftrag
 * stay findable by everything else, just not by the route's name.
 */
export function filterIncidents(
  operations: Operation[],
  query: string,
  materials: Material[],
  groupNames?: ReadonlyMap<string, string>,
): Operation[] {
  if (!query.trim()) return operations
  return operations.filter((operation) =>
    matchesIncidentQuery(
      operation,
      query,
      materials,
      operation.groupId ? groupNames?.get(operation.groupId) : undefined,
    ),
  )
}
