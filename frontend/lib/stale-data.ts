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
}

/**
 * Pure visibility logic for the stale-data banner. Show the banner when:
 *  - the WebSocket is not connected (so realtime updates are off), AND
 *  - the last successful operations load is older than the threshold.
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
}: ShouldShowStaleBannerInput): boolean {
  if (wsStatus === "connected") return false;
  if (wsStatus === "connecting") return false;
  if (lastSyncAt === null) return false;
  return now.getTime() - lastSyncAt.getTime() > thresholdMs;
}
