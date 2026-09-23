/**
 * Single-flight, coalescing scheduler for the board's full reload.
 *
 * One board reload is ~10 GETs. Until 2026-09-23 every WebSocket event started
 * its own, with nothing in flight counted anywhere: a Reko submit (incident +
 * assignment + personnel events within a few ms) fired three overlapping
 * reloads, the poll's «already loading?» check only knew about the FIRST load,
 * and a second, sequential copy of the loader (`refreshOperations`) raced all
 * of them. Whichever response arrived LAST won, not whichever was fetched last,
 * so an older snapshot could land on top of a newer one.
 *
 * The rules, in one place:
 *  - at most ONE load in flight;
 *  - a request while one is running is not dropped: it marks «run again when
 *    done», and every such request resolves with that one follow-up load
 *    (a load that started BEFORE the request can't have seen what the request
 *    is about);
 *  - WebSocket bursts go through a short trailing debounce (with a ceiling, so
 *    a steady trickle of events can't starve the board);
 *  - automatic loads (socket, poll, replay) pass a gate first — the operations
 *    context's mutation cooldown — and a follow-up load that only automatic
 *    requests asked for passes it again when it finally starts, because a
 *    mutation may have begun while it waited. Explicit requests
 *    (`refreshOperations`, the initial load) are never gated: their callers
 *    refresh on purpose, often from inside their own cooldown to snap a failed
 *    write back.
 *
 * Stale-result discard across instances (the selected Ereignis changes while a
 * load is in flight) is the caller's load id; `dispose()` only stops this
 * scheduler from starting anything new.
 */
export interface ReloadSchedulerOptions {
  /** The reload itself. Expected to handle its own errors; a rejection is
   *  swallowed so one failed load can't wedge the queue. */
  load: () => Promise<void>
  /** Trailing debounce for `requestDebounced`. */
  debounceMs?: number
  /** Longest a debounced request may be pushed back by further calls. */
  maxWaitMs?: number
  /** Gate for automatic loads. Return false to hold the load back. */
  mayAutoLoad?: () => boolean
  /** Called whenever the gate held a load back — the caller owns re-requesting it. */
  onAutoLoadHeld?: () => void
}

export const REMOTE_UPDATE_DEBOUNCE_MS = 200
export const REMOTE_UPDATE_MAX_WAIT_MS = 1000

export class ReloadScheduler {
  private readonly load: () => Promise<void>
  private readonly debounceMs: number
  private readonly maxWaitMs: number
  private readonly mayAutoLoad: () => boolean
  private readonly onAutoLoadHeld: () => void

  private inFlight: Promise<void> | null = null
  private followUp: Promise<void> | null = null
  /** At least one EXPLICIT request is waiting on the follow-up load. */
  private followUpExplicit = false
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private debounceStartedAt: number | null = null
  private disposed = false

  constructor(options: ReloadSchedulerOptions) {
    this.load = options.load
    this.debounceMs = options.debounceMs ?? REMOTE_UPDATE_DEBOUNCE_MS
    this.maxWaitMs = options.maxWaitMs ?? REMOTE_UPDATE_MAX_WAIT_MS
    this.mayAutoLoad = options.mayAutoLoad ?? (() => true)
    this.onAutoLoadHeld = options.onAutoLoadHeld ?? (() => {})
  }

  /** A load is running, queued behind the running one, or waiting on the debounce. */
  get busy(): boolean {
    return this.inFlight !== null || this.followUp !== null || this.debounceTimer !== null
  }

  /** Explicit reload: now, or right after the one in flight. Never gated. */
  request(): Promise<void> {
    return this.enqueue(true)
  }

  /** Automatic reload (poll tick, cooldown replay): gated by `mayAutoLoad`. */
  requestAuto(): Promise<void> {
    return this.enqueue(false)
  }

  /** Automatic reload for WebSocket events: debounced, then gated. */
  requestDebounced(): void {
    if (this.disposed) return
    const now = Date.now()
    if (this.debounceStartedAt === null) this.debounceStartedAt = now
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    const waitedMs = now - this.debounceStartedAt
    const delay = Math.max(0, Math.min(this.debounceMs, this.maxWaitMs - waitedMs))
    this.debounceTimer = setTimeout(() => {
      this.clearDebounce()
      void this.enqueue(false)
    }, delay)
  }

  /** Stop starting loads. A load already in flight still settles — the caller's
   *  load id decides whether its result is applied. */
  dispose(): void {
    this.disposed = true
    this.clearDebounce()
  }

  private clearDebounce(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = null
    this.debounceStartedAt = null
  }

  private enqueue(explicit: boolean): Promise<void> {
    if (this.disposed) return Promise.resolve()
    // Whatever we start or queue here begins after every request so far, so it
    // also answers a debounced request that hasn't fired yet.
    this.clearDebounce()

    if (!this.inFlight && !this.followUp) {
      if (!explicit && !this.passesGate()) return Promise.resolve()
      return this.start()
    }

    // Join the follow-up — also in the microtask gap where the running load has
    // just settled and the follow-up hasn't started yet, or two would overlap.
    if (explicit) this.followUpExplicit = true
    if (!this.followUp && this.inFlight) {
      const current = this.inFlight
      this.followUp = current.then(() => {
        const wasExplicit = this.followUpExplicit
        this.followUp = null
        this.followUpExplicit = false
        if (this.disposed) return
        if (!wasExplicit && !this.passesGate()) return
        return this.start()
      })
    }
    return this.followUp ?? Promise.resolve()
  }

  private passesGate(): boolean {
    if (this.mayAutoLoad()) return true
    this.onAutoLoadHeld()
    return false
  }

  private start(): Promise<void> {
    const run: Promise<void> = this.load()
      .catch(() => {})
      .finally(() => {
        if (this.inFlight === run) this.inFlight = null
      })
    this.inFlight = run
    return run
  }
}
