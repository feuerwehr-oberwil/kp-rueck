import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { KeyedSerialQueue, UpdateBatcher } from './update-batcher'

interface Op {
  status: string
  priority: string
  location: string
}

describe('UpdateBatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('flushes updates for two different keys scheduled within the debounce window', () => {
    // Regression: a shared debounce timer dropped incident A's update when
    // incident B was edited within 500 ms (audit item C1).
    const batcher = new UpdateBatcher<Op>()
    const flushA = vi.fn()
    const flushB = vi.fn()

    batcher.schedule('incident-a', { status: 'enroute' }, 500, flushA)
    vi.advanceTimersByTime(100)
    batcher.schedule('incident-b', { status: 'active' }, 500, flushB)

    vi.advanceTimersByTime(500)

    expect(flushA).toHaveBeenCalledExactlyOnceWith({ status: 'enroute' })
    expect(flushB).toHaveBeenCalledExactlyOnceWith({ status: 'active' })
  })

  it('merges consecutive updates to the same key into a single flush', () => {
    const batcher = new UpdateBatcher<Op>()
    const flush = vi.fn()

    batcher.schedule('incident-a', { status: 'enroute' }, 500, flush)
    vi.advanceTimersByTime(100)
    batcher.schedule('incident-a', { priority: 'high' }, 500, flush)

    vi.advanceTimersByTime(500)

    expect(flush).toHaveBeenCalledExactlyOnceWith({ status: 'enroute', priority: 'high' })
  })

  it('lets the newest value win when the same field is updated twice', () => {
    const batcher = new UpdateBatcher<Op>()
    const flush = vi.fn()

    batcher.schedule('incident-a', { status: 'enroute' }, 500, flush)
    batcher.schedule('incident-a', { status: 'active' }, 500, flush)

    vi.advanceTimersByTime(500)

    expect(flush).toHaveBeenCalledExactlyOnceWith({ status: 'active' })
  })

  it('restarts the delay and uses the latest flush on reschedule', () => {
    const batcher = new UpdateBatcher<Op>()
    const staleFlush = vi.fn()
    const latestFlush = vi.fn()

    batcher.schedule('incident-a', { status: 'enroute' }, 500, staleFlush)
    vi.advanceTimersByTime(400)
    batcher.schedule('incident-a', { priority: 'high' }, 500, latestFlush)

    // Old deadline passes without a flush — the timer was re-armed.
    vi.advanceTimersByTime(100)
    expect(staleFlush).not.toHaveBeenCalled()
    expect(latestFlush).not.toHaveBeenCalled()

    vi.advanceTimersByTime(400)
    expect(staleFlush).not.toHaveBeenCalled()
    expect(latestFlush).toHaveBeenCalledExactlyOnceWith({ status: 'enroute', priority: 'high' })
  })

  it('flushAll fires every pending batch immediately and cancels timers', () => {
    // Regression: debounced edits were silently lost when the tab closed
    // within the debounce window — nothing flushed on pagehide.
    const batcher = new UpdateBatcher<Op>()
    const flushA = vi.fn()
    const flushB = vi.fn()

    batcher.schedule('incident-a', { status: 'enroute' }, 500, flushA)
    batcher.schedule('incident-b', { priority: 'high' }, 500, flushB)

    batcher.flushAll()
    expect(flushA).toHaveBeenCalledExactlyOnceWith({ status: 'enroute' })
    expect(flushB).toHaveBeenCalledExactlyOnceWith({ priority: 'high' })
    expect(batcher.getPending('incident-a')).toBeUndefined()

    // The cancelled timers must not fire the batches a second time.
    vi.advanceTimersByTime(1000)
    expect(flushA).toHaveBeenCalledTimes(1)
    expect(flushB).toHaveBeenCalledTimes(1)
  })

  it('flushAll on an empty batcher is a no-op', () => {
    const batcher = new UpdateBatcher<Op>()
    expect(() => batcher.flushAll()).not.toThrow()
  })

  it('clears the pending batch after flushing', () => {
    const batcher = new UpdateBatcher<Op>()
    const flush = vi.fn()

    batcher.schedule('incident-a', { status: 'enroute' }, 500, flush)
    expect(batcher.getPending('incident-a')).toEqual({ status: 'enroute' })

    vi.advanceTimersByTime(500)
    expect(batcher.getPending('incident-a')).toBeUndefined()

    // Updates arriving after a flush start a fresh batch.
    batcher.schedule('incident-a', { location: 'Liestal' }, 500, flush)
    vi.advanceTimersByTime(500)
    expect(flush).toHaveBeenLastCalledWith({ location: 'Liestal' })
    expect(flush).toHaveBeenCalledTimes(2)
  })
})

describe("KeyedSerialQueue", () => {
  const deferred = () => {
    let resolve!: () => void
    let reject!: (e: Error) => void
    const promise = new Promise<void>((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve, reject }
  }

  it("runs one task per key at a time, in order, and other keys in parallel", async () => {
    const queue = new KeyedSerialQueue()
    const started: string[] = []
    const a1 = deferred()
    const a2 = deferred()
    const b1 = deferred()
    void queue.run("a", () => (started.push("a1"), a1.promise))
    const second = queue.run("a", () => (started.push("a2"), a2.promise))
    void queue.run("b", () => (started.push("b1"), b1.promise))
    await Promise.resolve()
    expect(started).toEqual(["a1", "b1"])

    // A failure ahead does not block or poison the next one.
    a1.reject(new Error("offline"))
    await new Promise((r) => setTimeout(r, 0))
    expect(started).toEqual(["a1", "b1", "a2"])
    a2.resolve()
    await expect(second).resolves.toBeUndefined()
    b1.resolve()
    await new Promise((r) => setTimeout(r, 0))
    expect(queue.isBusy("a")).toBe(false)
  })

  it("keeps a pagehide flush behind the save already in flight", async () => {
    // Review F06: the flush used to skip the line, so an older PATCH still in
    // flight could land after the newer text and overwrite it on the server.
    const queue = new KeyedSerialQueue()
    const applied: string[] = []
    const older = deferred()
    void queue.run("a", () => older.promise.then(() => void applied.push("older")))
    const flush = queue.run("a", async () => void applied.push("newer"))
    await Promise.resolve()
    expect(applied).toEqual([])
    expect(queue.isBusy("a")).toBe(true)

    older.resolve()
    await flush
    expect(applied).toEqual(["older", "newer"])
  })

  // «Erneut speichern» stands on this: the failed PATCH reaches its caller (so the field
  // can say «Nicht gespeichert»), and the retry for the same incident leaves at once
  // instead of waiting behind a rejected tail forever.
  it("frees the key after a rejected task: the caller sees the error, the retry runs", async () => {
    const queue = new KeyedSerialQueue()
    const failed = queue.run("a", () => Promise.reject(new Error("offline")))
    await expect(failed).rejects.toThrow("offline")
    await new Promise((r) => setTimeout(r, 0))
    expect(queue.isBusy("a")).toBe(false)

    const retry = vi.fn(async () => "saved")
    await expect(queue.run("a", retry)).resolves.toBe("saved")
    expect(retry).toHaveBeenCalledOnce()
  })
})
