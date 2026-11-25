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
export class UpdateBatcher<T, R = void> {
  private timers = new Map<string, ReturnType<typeof setTimeout>>()
  private pending = new Map<string, Partial<T>>()
  // Latest flush callback per key, kept so flushAll() can fire batches whose
  // timers haven't elapsed yet (page hide/unload would otherwise drop them).
  private flushers = new Map<string, (merged: Partial<T>) => R | PromiseLike<R>>()
  // Everybody waiting on the key's pending batch: each edit merged into it.
  private waiters = new Map<string, ((result: R | PromiseLike<R>) => void)[]>()

  /**
   * Merge `updates` into the key's pending batch and (re)arm its timer.
   * When the timer fires, `flush` receives the full merged batch. Re-scheduling
   * uses the latest `flush` closure and restarts the delay.
   *
   * Resolves with what `flush` answered for the batch this edit went out in –
   * every edit merged into one batch gets the same answer.
   */
  schedule(key: string, updates: Partial<T>, delayMs: number, flush: (merged: Partial<T>) => R | PromiseLike<R>): Promise<R> {
    this.pending.set(key, { ...(this.pending.get(key) ?? {}), ...updates })
    this.flushers.set(key, flush)
    const settled = new Promise<R>((resolve) => {
      this.waiters.set(key, [...(this.waiters.get(key) ?? []), resolve])
    })

    const existing = this.timers.get(key)
    if (existing) clearTimeout(existing)

    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key)
        this.flush(key)
      }, delayMs)
    )
    return settled
  }

  /** Merged updates currently queued for `key`, if any. */
  getPending(key: string): Partial<T> | undefined {
    return this.pending.get(key)
  }

  /**
   * Fire every pending batch immediately, cancelling its timer. Called on
   * `pagehide`/`visibilitychange:hidden` so a debounced edit made just before
   * closing the tab still reaches the server instead of being silently lost.
   */
  flushAll(): void {
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    for (const key of [...this.pending.keys()]) {
      this.flush(key)
    }
  }

  private flush(key: string): void {
    const batch = this.pending.get(key)
    this.pending.delete(key)
    const flusher = this.flushers.get(key)
    this.flushers.delete(key)
    const waiters = this.waiters.get(key) ?? []
    this.waiters.delete(key)
    if (!batch || !flusher) return
    const result = flusher(batch)
    for (const resolve of waiters) resolve(result)
  }
}

/**
 * One request at a time per key, in the order they were asked for.
 *
 * The batcher above merges keystrokes into one PATCH per incident, but it does
 * not stop the NEXT batch from leaving while the previous one is still in
 * flight — and on a slow uplink (exactly when this matters) two PATCHes of the
 * same incident could reach the server in either order. The older text would
 * then win on the server while the field had already said «Synchronisiert» for
 * the newer one. Chaining them per incident is what makes that word true.
 *
 * There is deliberately no way to skip the line, not even for the `pagehide`
 * flush: a request sent past an older one in flight can arrive first and be
 * overwritten by it (review F06). If the tab closes while a save is still in
 * flight, the queued edit may not leave – the field said «Wird synchronisiert»,
 * never «Synchronisiert», so nothing claims otherwise.
 */
export class KeyedSerialQueue {
  private tails = new Map<string, Promise<void>>()

  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const ahead = this.tails.get(key)
    const result = ahead ? ahead.then(task) : task()
    // The tail never rejects: one failed request must not poison the queue.
    const tail = result.then(
      () => undefined,
      () => undefined,
    )
    this.tails.set(key, tail)
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key)
    })
    return result
  }

  /** Whether a request for `key` is still in flight or waiting. */
  isBusy(key: string): boolean {
    return this.tails.has(key)
  }
}
