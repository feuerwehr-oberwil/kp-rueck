import { incidentTimeReference } from '@/lib/incident-time'

/**
 * The phone Einsatz list's three orders («Sortieren» in its funnel menu, owner's pick 14.11.2026):
 *
 * - `status`      the list as it always was: board flow (Im Einsatz first … Abgeschlossen last),
 *                 then Hoch before Mittel before Niedrig, then the latest alarm first;
 * - `newest`      the latest alarm first (`dispatchTime`);
 * - `longestWait` longest in its current column first – the Spalte clock the cards show
 *                 (`incidentTimeReference(…, 'column')`: the last status change, else the alarm).
 *
 * The choice is per device (`usePersistedState`, validated by `isMobileIncidentSort`).
 */
export const MOBILE_INCIDENT_SORTS = ['status', 'newest', 'longestWait'] as const
export type MobileIncidentSort = (typeof MOBILE_INCIDENT_SORTS)[number]

export const MOBILE_INCIDENT_SORT_KEY = 'kp-board-phoneIncidentSort'

export function isMobileIncidentSort(value: unknown): value is MobileIncidentSort {
  return MOBILE_INCIDENT_SORTS.some((sort) => sort === value)
}

/** What a sort reads off an Einsatz – an `Operation` satisfies it. */
export interface SortableIncident {
  status: string
  priority?: string | null
  dispatchTime: Date
  statusChangedAt?: Date | null
}

// Active incidents first; an unknown status goes last.
const STATUS_ORDER: Record<string, number> = {
  active: 0,
  enroute: 1,
  incoming: 2,
  reko: 3,
  reko_done: 4,
  returning: 5,
  complete: 6,
}
const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 }

const newestFirst = (a: SortableIncident, b: SortableIncident) => b.dispatchTime.getTime() - a.dispatchTime.getTime()

const COMPARATORS: Record<MobileIncidentSort, (a: SortableIncident, b: SortableIncident) => number> = {
  status: (a, b) =>
    (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99) ||
    (PRIORITY_ORDER[a.priority ?? ''] ?? 1) - (PRIORITY_ORDER[b.priority ?? ''] ?? 1) ||
    newestFirst(a, b),
  newest: newestFirst,
  // The earlier the clock started, the longer it has run. Ties: the board's own order.
  longestWait: (a, b) =>
    incidentTimeReference(a, 'column').getTime() - incidentTimeReference(b, 'column').getTime() ||
    COMPARATORS.status(a, b),
}

/** A sorted copy – the input (the board's operations) is never reordered in place. */
export function sortMobileIncidents<T extends SortableIncident>(incidents: readonly T[], sort: MobileIncidentSort): T[] {
  return [...incidents].sort(COMPARATORS[sort])
}
