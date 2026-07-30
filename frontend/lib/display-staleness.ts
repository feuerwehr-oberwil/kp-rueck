/**
 * Staleness levels for the wall/TV displays.
 *
 * Separate from `lib/stale-data.ts` on purpose: that one answers "is the operator's
 * *authenticated* board still receiving realtime updates", and keys off WebSocket status.
 * The displays have no socket and no operations context — they are standalone token views
 * polling `getViewerData` every 5s — so the only honest signal they have is the age of the
 * last successful poll.
 *
 * Why this exists at all: `/display/status` and `/display/map` swallowed every fetch error
 * with a bare `catch {}` and kept rendering the last payload forever. A backend that started
 * 500ing at 02:10 produced a display that looked completely normal at 04:00. On a screen
 * nobody is standing at, showing hours-old positions as current is the most dangerous thing
 * this application can do.
 *
 * The escalation is progressive because a wall display is read from across a room by nobody
 * in particular:
 *   - `fresh` — under 30s. Normal poll jitter (5s interval); saying anything here is noise.
 *   - `warn`  — a discreet bar. Something is wrong, the picture is probably still usable.
 *   - `alert` — unmissable at 4 metres. Do not trust what is on this screen.
 *
 * Content stays visible at every level: during an outage the stale picture is still the best
 * information in the room, and AUSFALL_SOP.md tells the operator to print exactly that.
 */

/** Below this, silence — a single missed poll must not flash a warning. */
export const DISPLAY_STALE_WARN_MS = 30_000;

/** Above this, the display is not to be trusted at a glance. */
export const DISPLAY_STALE_ALERT_MS = 120_000;

export type DisplayStaleLevel = "fresh" | "warn" | "alert";

export interface DisplayStaleInput {
  /** Timestamp of the last SUCCESSFUL poll. Null before the first one lands. */
  lastRefresh: Date | null;
  now: Date;
  warnMs?: number;
  alertMs?: number;
}

/**
 * Pure staleness classification.
 *
 * `lastRefresh === null` returns "fresh": nothing has loaded yet, which is the loading
 * state's job to communicate, not this one's. Clock skew (a lastRefresh in the future)
 * also lands on "fresh" rather than reporting a negative age as stale.
 */
export function displayStaleLevel({
  lastRefresh,
  now,
  warnMs = DISPLAY_STALE_WARN_MS,
  alertMs = DISPLAY_STALE_ALERT_MS,
}: DisplayStaleInput): DisplayStaleLevel {
  if (lastRefresh === null) return "fresh";
  const ageMs = now.getTime() - lastRefresh.getTime();
  if (ageMs > alertMs) return "alert";
  if (ageMs > warnMs) return "warn";
  return "fresh";
}
