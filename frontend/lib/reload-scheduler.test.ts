import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ReloadScheduler } from "./reload-scheduler"

/** A load whose every call hangs until the test resolves it. */
function controllableLoad() {
  const pending: Array<() => void> = []
  const load = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        pending.push(resolve)
      }),
  )
  return {
    load,
    /** Finish the oldest running call. */
    finish: async () => {
      pending.shift()?.()
      // Let the scheduler's promise chain (finally → follow-up → start) settle.
      for (let i = 0; i < 5; i++) await Promise.resolve()
    },
    get running() {
      return pending.length
    },
  }
}

describe("ReloadScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("never runs two loads at once, and runs exactly one follow-up for any number of requests", async () => {
    const l = controllableLoad()
    const s = new ReloadScheduler({ load: l.load })

    void s.request()
    void s.request()
    void s.requestAuto()
    void s.request()
    expect(l.load).toHaveBeenCalledTimes(1)
    expect(l.running).toBe(1)

    await l.finish()
    // The three requests that arrived mid-flight share ONE follow-up load.
    expect(l.load).toHaveBeenCalledTimes(2)
    expect(l.running).toBe(1)

    await l.finish()
    expect(l.load).toHaveBeenCalledTimes(2)
    expect(s.busy).toBe(false)
  })

  it("resolves a mid-flight request only once a load that started AFTER it has finished", async () => {
    const l = controllableLoad()
    const s = new ReloadScheduler({ load: l.load })
    void s.request()
    let secondDone = false
    void s.request().then(() => {
      secondDone = true
    })

    await l.finish() // the first load — fetched before the second request existed
    expect(secondDone).toBe(false)
    await l.finish()
    expect(secondDone).toBe(true)
  })

  it("does not overlap when a caller re-requests in the gap between a load and its follow-up", async () => {
    const l = controllableLoad()
    const s = new ReloadScheduler({ load: l.load })
    void s.request().then(() => {
      void s.request()
    })
    void s.request()

    await l.finish()
    expect(l.running).toBe(1)
  })

  it("collapses a burst of debounced requests into one load", async () => {
    const l = controllableLoad()
    const s = new ReloadScheduler({ load: l.load, debounceMs: 200 })
    s.requestDebounced()
    vi.advanceTimersByTime(100)
    s.requestDebounced()
    vi.advanceTimersByTime(100)
    s.requestDebounced()
    expect(l.load).not.toHaveBeenCalled()

    vi.advanceTimersByTime(200)
    expect(l.load).toHaveBeenCalledTimes(1)
  })

  it("caps the debounce so a steady trickle of events can't starve the board", () => {
    const l = controllableLoad()
    const s = new ReloadScheduler({ load: l.load, debounceMs: 200, maxWaitMs: 1000 })
    for (let t = 0; t < 1000; t += 150) {
      s.requestDebounced()
      vi.advanceTimersByTime(150)
    }
    expect(l.load).toHaveBeenCalledTimes(1)
  })

  it("an explicit request answers a pending debounced one", async () => {
    const l = controllableLoad()
    const s = new ReloadScheduler({ load: l.load })
    s.requestDebounced()
    void s.request()
    await l.finish()
    vi.advanceTimersByTime(1000)
    expect(l.load).toHaveBeenCalledTimes(1)
  })

  it("gates automatic loads — including a follow-up that only automatic requests asked for", async () => {
    const l = controllableLoad()
    let open = true
    const held = vi.fn()
    const s = new ReloadScheduler({ load: l.load, mayAutoLoad: () => open, onAutoLoadHeld: held })

    void s.request()
    void s.requestAuto() // queued while the gate is still open…
    open = false // …then a mutation starts
    await l.finish()

    expect(l.load).toHaveBeenCalledTimes(1)
    expect(held).toHaveBeenCalledTimes(1)

    void s.requestAuto()
    expect(l.load).toHaveBeenCalledTimes(1)
    expect(held).toHaveBeenCalledTimes(2)
  })

  it("never gates an explicit request, even as a follow-up", async () => {
    const l = controllableLoad()
    const s = new ReloadScheduler({ load: l.load, mayAutoLoad: () => false })
    void s.request()
    void s.requestAuto()
    void s.request()
    await l.finish()
    expect(l.load).toHaveBeenCalledTimes(2)
  })

  it("keeps going after a load rejects", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue(undefined)
    const s = new ReloadScheduler({ load })
    await s.request()
    await s.request()
    expect(load).toHaveBeenCalledTimes(2)
  })

  it("starts nothing after dispose", async () => {
    const l = controllableLoad()
    const s = new ReloadScheduler({ load: l.load })
    s.requestDebounced()
    s.dispose()
    vi.advanceTimersByTime(1000)
    await s.request()
    expect(l.load).not.toHaveBeenCalled()
  })
})
