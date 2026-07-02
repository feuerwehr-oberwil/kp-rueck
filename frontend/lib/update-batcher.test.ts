import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { UpdateBatcher } from './update-batcher'

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
