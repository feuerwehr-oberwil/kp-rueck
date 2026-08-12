import type { Material, Operation } from "@/lib/contexts/operations-context"
import { getIncidentTypeLabel } from "@/lib/incident-types"

/**
 * The board's one incident search.
 *
 * Address, type, priority, vehicles, crew, material NAMES (not ids), Meldung,
 * contact, status, Reko person — one query field across all of them, because an
 * operator searching "Müller" does not know or care whether Müller is crew on
 * one incident and the Reko on another.
 *
 * It lives here rather than inside the board page because the /display board and
 * the /display status page ask the identical question, and a second copy is how
 * the wall screen quietly stops finding what the board finds.
 */
export function matchesIncidentQuery(
  operation: Operation,
  query: string,
  materials: Material[],
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
    (operation.hasCompletedReko && "reko".includes(needle))
  )
}

/** `matchesIncidentQuery` over a list; returns the input untouched for an empty query. */
export function filterIncidents(
  operations: Operation[],
  query: string,
  materials: Material[],
): Operation[] {
  if (!query.trim()) return operations
  return operations.filter((operation) => matchesIncidentQuery(operation, query, materials))
}
