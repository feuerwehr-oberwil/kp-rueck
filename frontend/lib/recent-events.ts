import type { Event } from '@/lib/types/incidents'

/** How far back the start screen offers an Ereignis to continue (owner, 2026-10-24: «less than a day»). */
export const RECENT_EVENT_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * The Ereignisse the no-Ereignis start screen lists as rows: still open (not archived) and
 * opened less than 24 h before `now`, the most recently active first – that first row is the
 * one the ink «Öffnen» and ↵ go to. Empty → the screen shows its fallback card.
 */
export function recentOpenEvents(events: readonly Event[], now: Date): Event[] {
  const since = now.getTime() - RECENT_EVENT_WINDOW_MS
  return events
    .filter((e) => !e.archived_at && new Date(e.created_at).getTime() > since)
    .sort((a, b) => new Date(b.last_activity_at).getTime() - new Date(a.last_activity_at).getTime())
}
