/**
 * Per-key debounced update batcher.
 *
 * Regression guard for the "rapid consecutive edits" data-loss bug: a single
 * shared debounce timer meant that editing incident A and then incident B
 * within the debounce window silently dropped A's update. This batcher keeps
 * one timer and one pending-merge buffer per key, so edits to different keys
 * never cancel each other, and consecutive edits to the same key merge into
 * a single flush instead of the newest call replacing the whole payload.
 */
export class UpdateBatcher<T> {
  private timers = new Map<string, ReturnType<typeof setTimeout>>()
  private pending = new Map<string, Partial<T>>()

  /**
   * Merge `updates` into the key's pending batch and (re)arm its timer.
   * When the timer fires, `flush` receives the full merged batch. Re-scheduling
   * uses the latest `flush` closure and restarts the delay.
   */
  schedule(key: string, updates: Partial<T>, delayMs: number, flush: (merged: Partial<T>) => void): void {
    this.pending.set(key, { ...(this.pending.get(key) ?? {}), ...updates })

    const existing = this.timers.get(key)
    if (existing) clearTimeout(existing)

    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key)
        const batch = this.pending.get(key)
        this.pending.delete(key)
        if (batch) flush(batch)
      }, delayMs)
    )
  }

  /** Merged updates currently queued for `key`, if any. */
  getPending(key: string): Partial<T> | undefined {
    return this.pending.get(key)
  }
}
