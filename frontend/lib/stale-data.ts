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
}

/**
 * Pure visibility logic for the stale-data banner. Show the banner when:
 *  - REST is known to be unreachable (repeated api-client connection
 *    failures) — even if the WebSocket still claims to be connected, because
 *    a socket that pings while every fetch dies is still a dead board; OR
 *  - the WebSocket is not connected (so realtime updates are off) AND the
 *    last successful operations load is older than the threshold.
 *
 * If `lastSyncAt` is null we have nothing to sync against yet (initial load
 * or no event selected), so the banner stays hidden — that case is the job
 * of the loading state, not this banner.
 */
export function shouldShowStaleBanner({
  wsStatus,
  lastSyncAt,
  now,
  thresholdMs = STALE_BANNER_THRESHOLD_MS,
  restReachable = true,
}: ShouldShowStaleBannerInput): boolean {
  if (lastSyncAt === null) return false;
  // A REST outage is already debounced by the api-client's retry/backoff, so
  // it raises the banner immediately — no extra threshold wait.
  if (!restReachable) return true;
  if (wsStatus === "connected") return false;
  if (wsStatus === "connecting") return false;
  return now.getTime() - lastSyncAt.getTime() > thresholdMs;
}
