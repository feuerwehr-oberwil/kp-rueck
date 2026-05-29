/**
 * Client-only memory of recent crew removals so we can warn operators
 * about rapid re-assignment: "you removed Müller from incident A 30s
 * ago and now you're putting them on B".
 *
 * Purely in-memory — entries vanish on page refresh and don't cross
 * tabs. That's a deliberate trade-off for B6: no backend round-trip,
 * no extra bytes on every personnel-list response, and the case it
 * catches (same operator double-binding within seconds) is by far
 * the most common one.
 */

export interface RecentRemoval {
  /** Incident the person was just removed from. */
  incidentId: string
  /** Human-readable label for the toast (typically the incident's location). */
  incidentLabel: string
  /** Wall-clock epoch ms when the removal happened. */
  removedAt: number
}

export type RecentRemovals = Map<string, RecentRemoval>

/** Default window in which a re-assignment counts as "recent". */
export const RECENT_REMOVAL_WINDOW_MS = 5 * 60 * 1000

export function recordRemoval(
  store: RecentRemovals,
  personId: string,
  incidentId: string,
  incidentLabel: string,
  now: number = Date.now(),
): void {
  store.set(personId, { incidentId, incidentLabel, removedAt: now })
}

/**
 * Look up a recent removal worth warning about.
 *
 * Returns null when:
 *   - there's no record for the person
 *   - the previous incident is the same one we're assigning to (returning
 *     someone you just removed from the same card is a normal undo)
 *   - the record is past the window (also prunes the entry as a side effect)
 *
 * Otherwise returns the stored RecentRemoval — caller can use it to
 * shape the warning toast.
 */
export function findRecentRemoval(
  store: RecentRemovals,
  personId: string,
  newIncidentId: string,
  now: number = Date.now(),
  windowMs: number = RECENT_REMOVAL_WINDOW_MS,
): RecentRemoval | null {
  const entry = store.get(personId)
  if (!entry) return null
  if (entry.incidentId === newIncidentId) return null
  if (now - entry.removedAt > windowMs) {
    store.delete(personId)
    return null
  }
  return entry
}

/**
 * Drop entries older than the window. Mostly for opportunistic cleanup
 * if a caller iterates the map; `findRecentRemoval` already prunes
 * the entries it checks.
 */
export function pruneExpired(
  store: RecentRemovals,
  now: number = Date.now(),
  windowMs: number = RECENT_REMOVAL_WINDOW_MS,
): void {
  for (const [personId, entry] of store) {
    if (now - entry.removedAt > windowMs) store.delete(personId)
  }
}
