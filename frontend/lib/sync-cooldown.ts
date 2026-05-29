/**
 * Pure decision logic for the operations-context sync cooldown.
 *
 * Used by both the WebSocket update handler and the fallback polling
 * loop to decide what to do when a remote-update signal arrives:
 *
 *   - `'fetch'`      : we can issue a full reload right now
 *   - `'queue'`      : a local mutation is mid-cooldown; remember that
 *                       a remote update is waiting and replay it once
 *                       the cooldown clears
 *   - `'skip'`       : nothing to do (already loading, or — for the
 *                       replay path — nothing was queued in the first
 *                       place)
 *
 * Splitting this out from operations-context.tsx keeps the most
 * subtle bit of the UI #2 queue-replay fix unit-testable without
 * having to mount the whole context tree.
 */

export type SyncDecision = "fetch" | "queue" | "skip"

export interface RemoteUpdateInput {
  /** Any local mutation cooldown is currently active. */
  inCooldown: boolean
}

export interface PollTickInput {
  /** A loadData call is already in flight. */
  isLoading: boolean
  /** Any local mutation cooldown is currently active. */
  inCooldown: boolean
}

export interface CooldownClearInput {
  /** A previously-suppressed remote update is waiting to replay. */
  pendingReplay: boolean
  /** Any cooldown is still active (e.g. another mutation extended it). */
  stillInCooldown: boolean
}

/**
 * A WebSocket update arrived. Either fetch now or queue for replay
 * after the cooldown clears.
 */
export function decideRemoteUpdateAction({
  inCooldown,
}: RemoteUpdateInput): SyncDecision {
  return inCooldown ? "queue" : "fetch"
}

/**
 * The fallback polling timer fired. Skip if a load is already
 * happening; queue if a cooldown is suppressing it; otherwise fetch.
 */
export function decidePollTickAction({
  isLoading,
  inCooldown,
}: PollTickInput): SyncDecision {
  if (isLoading) return "skip"
  if (inCooldown) return "queue"
  return "fetch"
}

/**
 * A cooldown timer cleared. Decide whether to replay a previously
 * suppressed update.
 */
export function decideCooldownClearAction({
  pendingReplay,
  stillInCooldown,
}: CooldownClearInput): SyncDecision {
  if (stillInCooldown) return "skip"
  if (!pendingReplay) return "skip"
  return "fetch"
}
