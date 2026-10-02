import type { WebSocketStatus } from "@/lib/websocket-client";

/**
 * Default threshold for showing the stale-data banner: 15 seconds since the
 * last successful operations load. Picked to be comfortably above the
 * 5-second polling base interval so a single missed poll cycle doesn't
 * flash the banner — but well under the audit-cited 2-minute worst case.
 */
export const STALE_BANNER_THRESHOLD_MS = 15_000;

export interface ShouldShowStaleBannerInput {
  wsStatus: WebSocketStatus;
  lastSyncAt: Date | null;
  now: Date;
  thresholdMs?: number;
  /**
   * REST reachability from the api-client (`getRestReachable`): false once a
   * request has exhausted its retries on a network failure, true again after
   * the next answered request. Optional so callers without it keep the pure
   * WS-based behavior.
   */
  restReachable?: boolean;
  /**
   * The most recent board load failed (`loadError` from the operations
   * context). Optional for the same reason as `restReachable`.
   */
  loadFailed?: boolean;
}

/**
 * Pure visibility logic for the stale-data banner. Show the banner when:
 *  - REST is known to be unreachable (repeated api-client connection
 *    failures) — even if the WebSocket still claims to be connected, because
 *    a socket that pings while every fetch dies is still a dead board; OR
 *  - the WebSocket is not connected (so realtime updates are off) AND the
 *    last successful operations load is older than the threshold.
 *
 *  - the last board load FAILED and the last good sync is older than the
 *    threshold — whatever the WebSocket says. A connected socket only proves
 *    events can arrive; it says nothing about whether the reload they trigger
 *    got through, and it used to hide the banner over a board that had not
 *    loaded since the failure;
 *  - the FIRST board load failed (`lastSyncAt` null, `loadFailed`): there is
 *    no good state at all, and an empty board must not pass for an empty
 *    Ereignis.
 *
 * If `lastSyncAt` is null and nothing failed, we have nothing to sync against
 * yet (initial load or no event selected), so the banner stays hidden — that
 * case is the job of the loading state, not this banner.
 */
export function shouldShowStaleBanner({
  wsStatus,
  lastSyncAt,
  now,
  thresholdMs = STALE_BANNER_THRESHOLD_MS,
  restReachable = true,
  loadFailed = false,
}: ShouldShowStaleBannerInput): boolean {
  if (lastSyncAt === null) return loadFailed;
  const ageMs = now.getTime() - lastSyncAt.getTime();
  if (loadFailed && ageMs > thresholdMs) return true;
  // A REST outage is already debounced by the api-client's retry/backoff, so
  // it raises the banner immediately — no extra threshold wait.
  if (!restReachable) return true;
  if (wsStatus === "connected") return false;
  if (wsStatus === "connecting") return false;
  return ageMs > thresholdMs;
}
