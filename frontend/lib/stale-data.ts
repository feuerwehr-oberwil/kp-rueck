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
  /**
   * When the WebSocket last came up (`liveSince` from the operations context),
   * null while it is down. A connected socket vouches for the board only once a
   * load has got through SINCE then. Omitted (undefined): the caller does not
   * know, and «connected» is taken at its word as before.
   */
  liveSince?: Date | null;
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
 *
 * «Connected» and «connecting» no longer hide it on their own (review idea #4,
 * 2026-10-02). A socket that is still dialling after the threshold delivers
 * nothing, and a socket that has just come back has not yet delivered what was
 * broadcast while it was away — the resync it triggers can fail. So the
 * connected socket counts only once a load has been CONFIRMED since it came up
 * (`lastSyncAt >= liveSince`); until then the board ages like any other. A
 * successful poll moves `lastSyncAt` too, so the board recovers without a
 * socket and without the browser's «online» event. The threshold still keeps
 * one missed request from flashing the banner (Front's lesson: no status that
 * flickers on a single failed request).
 */
export function shouldShowStaleBanner({
  wsStatus,
  lastSyncAt,
  now,
  thresholdMs = STALE_BANNER_THRESHOLD_MS,
  restReachable = true,
  loadFailed = false,
  liveSince,
}: ShouldShowStaleBannerInput): boolean {
  if (lastSyncAt === null) return loadFailed;
  const ageMs = now.getTime() - lastSyncAt.getTime();
  if (loadFailed && ageMs > thresholdMs) return true;
  // A REST outage is already debounced by the api-client's retry/backoff, so
  // it raises the banner immediately — no extra threshold wait.
  if (!restReachable) return true;
  if (isLiveConfirmed({ wsStatus, lastSyncAt, liveSince })) return false;
  return ageMs > thresholdMs;
}

/**
 * The socket is up AND a board load got through after it came up — the one
 * state in which an old `lastSyncAt` is not old news: nothing has changed, and
 * the socket would have said so.
 */
export function isLiveConfirmed({
  wsStatus,
  lastSyncAt,
  liveSince,
}: {
  wsStatus: WebSocketStatus;
  lastSyncAt: Date | null;
  liveSince?: Date | null;
}): boolean {
  if (wsStatus !== "connected" || lastSyncAt === null) return false;
  if (liveSince === undefined) return true;
  return liveSince !== null && lastSyncAt.getTime() >= liveSince.getTime();
}
