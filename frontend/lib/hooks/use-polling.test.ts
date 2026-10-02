import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, renderHook } from "@testing-library/react"

const ws = vi.hoisted(() => {
  const listeners = new Set<(status: string) => void>()
  const state = { status: "disconnected" }
  return {
    state,
    setStatus(status: string) {
      state.status = status
      listeners.forEach((cb) => cb(status))
    },
    reset() {
      listeners.clear()
      state.status = "disconnected"
    },
    client: {
      getStatus: () => state.status,
      onStatusChange(cb: (status: string) => void) {
        listeners.add(cb)
        cb(state.status) // the real client replays the current status
        return () => listeners.delete(cb)
      },
    },
  }
})
vi.mock("@/lib/websocket-client", () => ({ wsClient: ws.client }))

import { usePolling } from "./use-polling"

let visibility: DocumentVisibilityState = "visible"
function setVisibility(next: DocumentVisibilityState) {
  visibility = next
  document.dispatchEvent(new Event("visibilitychange"))
}

beforeEach(() => {
  vi.useFakeTimers()
  ws.reset()
  visibility = "visible"
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility)
})

afterEach(() => {
  vi.useRealTimers()
})

/** Let a resolved callback's `finally` (which schedules the next tick) run. */
const flush = () => act(async () => {})

describe("usePolling", () => {
  it("runs at once, then every interval after the previous run settles", async () => {
    const cb = vi.fn().mockResolvedValue(undefined)
    renderHook(() => usePolling(cb, { intervalMs: 5000 }))
    expect(cb).toHaveBeenCalledTimes(1)
    await flush()

    await act(() => vi.advanceTimersByTimeAsync(4999))
    expect(cb).toHaveBeenCalledTimes(1)
    await act(() => vi.advanceTimersByTimeAsync(1))
    expect(cb).toHaveBeenCalledTimes(2)
  })

  it("never overlaps a slow run", async () => {
    let finish!: () => void
    const cb = vi.fn(() => new Promise<void>((r) => (finish = r)))
    renderHook(() => usePolling(cb, { intervalMs: 1000 }))

    await act(() => vi.advanceTimersByTimeAsync(10_000))
    expect(cb).toHaveBeenCalledTimes(1)

    await act(async () => finish())
    await act(() => vi.advanceTimersByTimeAsync(1000))
    expect(cb).toHaveBeenCalledTimes(2)
  })

  it("pauses while the tab is hidden and runs the moment it is visible again", async () => {
    const cb = vi.fn().mockResolvedValue(undefined)
    renderHook(() => usePolling(cb, { intervalMs: 5000 }))
    await flush()

    act(() => setVisibility("hidden"))
    await act(() => vi.advanceTimersByTimeAsync(60_000))
    expect(cb).toHaveBeenCalledTimes(1)

    act(() => setVisibility("visible"))
    expect(cb).toHaveBeenCalledTimes(2)
    await flush()
    await act(() => vi.advanceTimersByTimeAsync(5000))
    expect(cb).toHaveBeenCalledTimes(3)
  })

  it("keeps a wall screen going when it was hidden from the start and never hears otherwise", async () => {
    visibility = "hidden"
    const cb = vi.fn().mockResolvedValue(undefined)
    renderHook(() => usePolling(cb, { intervalMs: 5000, pauseWhenHidden: false }))
    await flush()
    await act(() => vi.advanceTimersByTimeAsync(15_000))
    expect(cb).toHaveBeenCalledTimes(4)
  })

  it("stays quiet while the socket carries the data, catches up on reconnect, resumes when it drops", async () => {
    ws.state.status = "connected"
    const cb = vi.fn().mockResolvedValue(undefined)
    renderHook(() => usePolling(cb, { intervalMs: 5000, skipWhileWsConnected: true }))
    // The first load still happens — the socket only pushes CHANGES.
    expect(cb).toHaveBeenCalledTimes(1)
    await flush()
    await act(() => vi.advanceTimersByTimeAsync(30_000))
    expect(cb).toHaveBeenCalledTimes(1)

    act(() => ws.setStatus("disconnected"))
    await act(() => vi.advanceTimersByTimeAsync(5000))
    expect(cb).toHaveBeenCalledTimes(2)
    await act(() => vi.advanceTimersByTimeAsync(5000))
    expect(cb).toHaveBeenCalledTimes(3)

    // Back up: one catch-up run for what was broadcast while it was down, then quiet.
    act(() => ws.setStatus("connected"))
    expect(cb).toHaveBeenCalledTimes(4)
    await flush()
    await act(() => vi.advanceTimersByTimeAsync(30_000))
    expect(cb).toHaveBeenCalledTimes(4)
  })

  it("survives a failing callback", async () => {
    const cb = vi.fn().mockRejectedValue(new Error("500"))
    renderHook(() => usePolling(cb, { intervalMs: 1000 }))
    await flush()
    await act(() => vi.advanceTimersByTimeAsync(2000))
    expect(cb).toHaveBeenCalledTimes(3)
  })

  it("does nothing when disabled, and stops on unmount", async () => {
    const off = vi.fn().mockResolvedValue(undefined)
    renderHook(() => usePolling(off, { intervalMs: 1000, enabled: false }))
    const on = vi.fn().mockResolvedValue(undefined)
    const { unmount } = renderHook(() => usePolling(on, { intervalMs: 1000 }))
    await flush()
    unmount()
    await act(() => vi.advanceTimersByTimeAsync(10_000))
    expect(off).not.toHaveBeenCalled()
    expect(on).toHaveBeenCalledTimes(1)
  })
})
