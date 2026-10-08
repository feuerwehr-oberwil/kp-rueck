import type { Material, Operation } from "@/lib/contexts/operations-context"
import { getActiveLocale, loadMessages, type SupportedLocale } from "@/lib/i18n-messages"
import { getIncidentTypeLabel } from "@/lib/incident-types"

/**
 * The words a card shows for its priority and status, lower-cased, in the
 * device's language — «hoch», «im einsatz», «haute», «en intervention». The
 * operator searches for what they read; the API codes (`high`, `active`) never
 * appear on a card, so a substring match on them only made «hoch» find nothing
 * and «in» find every incoming card.
 *
 * `rekoKeywords` is the whole word that finds a card with a finished Reko: the
 * Reko column's own label («reko» / «reconnaissance») plus «reko» in every
 * language, because that is what everyone says on the radio.
 */
interface SearchLabels {
  priority: Readonly<Record<string, string>>
  status: Readonly<Record<string, string>>
  rekoKeywords: ReadonlySet<string>
}

const labelCache = new Map<SupportedLocale, SearchLabels>()

function searchLabels(locale: SupportedLocale = getActiveLocale()): SearchLabels {
  const cached = labelCache.get(locale)
  if (cached) return cached
  const messages = loadMessages(locale)
  const lower = (table: Record<string, string>) =>
    Object.fromEntries(Object.entries(table).map(([code, label]) => [code, label.toLowerCase()]))
  const labels: SearchLabels = {
    priority: lower(messages.incidents.priority),
    status: lower(messages.kanban.columns),
    rekoKeywords: new Set(["reko", messages.kanban.columns.reko.toLowerCase()]),
  }
  labelCache.set(locale, labels)
  return labels
}

/** The displayed label contains the query, or the query IS the API code (exact, never a substring). */
function matchesCodedField(code: string, labels: Readonly<Record<string, string>>, needle: string): boolean {
  const label = labels[code]
  return (!!label && label.includes(needle)) || code.toLowerCase() === needle
}

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
 *
 * Priority and status match their displayed label (see `SearchLabels`); the
 * English code still matches, but only as the whole word.
 */
export function matchesIncidentQuery(
  operation: Operation,
  query: string,
  materials: Material[],
  groupName?: string,
  locale?: SupportedLocale,
): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  const labels = searchLabels(locale)

  return (
    operation.location.toLowerCase().includes(needle) ||
    operation.incidentType.toLowerCase().includes(needle) ||
    getIncidentTypeLabel(operation.incidentType).toLowerCase().includes(needle) ||
    matchesCodedField(operation.priority, labels.priority, needle) ||
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
    matchesCodedField(operation.status, labels.status, needle) ||
    (!!operation.assignedReko && operation.assignedReko.name.toLowerCase().includes(needle)) ||
    // A finished Reko is found by the keyword as a whole word — «reko» — not by
    // every query that happens to be a piece of it («r», «e», «ko»).
    (operation.hasCompletedReko && labels.rekoKeywords.has(needle)) ||
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
  locale?: SupportedLocale,
): Operation[] {
  if (!query.trim()) return operations
  return operations.filter((operation) =>
    matchesIncidentQuery(
      operation,
      query,
      materials,
      operation.groupId ? groupNames?.get(operation.groupId) : undefined,
      locale,
    ),
  )
}
