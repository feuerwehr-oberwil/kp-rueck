/**
 * The order of the Lagekarte's list (the desktop rail and the phone list under the map – one
 * component, `app/map/page.tsx`): within each status group («Offen», «Aktiv», …) Hoch → Mittel →
 * Niedrig, then the oldest first (owner pick U10 B, 08.11.2026). The rail is scanned for exactly
 * that – what is Hoch, then what has waited longest.
 *
 * «Oldest» is the age the row's own time chip shows: the instant the board-wide time mode
 * measures from (`incidentTimeReference` – Spalte from the last status change, Total and Start
 * from the alarm), so the list never contradicts the numbers printed beside it.
 */

import { incidentTimeReference, incidentTimeSource, type IncidentTimeMode } from './incident-time'

const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 }

/** What the order reads off an incident: the raw API shape, the same the row's chip reads. */
export interface ListOrderIncident {
  id: string
  priority?: string | null
  created_at: Date
  status_changed_at?: Date | null
}

/** A sorted copy: priority first (no priority counts as Niedrig, as the row's glyph draws it), then
 *  the earlier reference instant, then the id so equal rows keep a stable place between polls. */
export function sortForMapList<T extends ListOrderIncident>(incidents: readonly T[], mode: IncidentTimeMode): T[] {
  const since = (incident: T) => incidentTimeReference(incidentTimeSource(incident), mode).getTime()
  return [...incidents].sort(
    (a, b) =>
      (PRIORITY_RANK[a.priority ?? 'low'] ?? 2) - (PRIORITY_RANK[b.priority ?? 'low'] ?? 2) ||
      since(a) - since(b) ||
      a.id.localeCompare(b.id),
  )
}
