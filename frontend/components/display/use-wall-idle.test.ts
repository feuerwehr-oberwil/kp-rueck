import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, renderHook } from "@testing-library/react"

import { useWallIdle, WALL_IDLE_MS } from "@/components/display/use-wall-idle"

describe("useWallIdle", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("goes idle after 10 s without input", () => {
    const { result } = renderHook(() => useWallIdle())
    expect(result.current).toBe(false)

    act(() => vi.advanceTimersByTime(WALL_IDLE_MS - 1))
    expect(result.current).toBe(false)
    act(() => vi.advanceTimersByTime(1))
    expect(result.current).toBe(true)
  })

  it("wakes on the first mouse move and starts the 10 s over", () => {
    const { result } = renderHook(() => useWallIdle())
    act(() => vi.advanceTimersByTime(WALL_IDLE_MS))
    expect(result.current).toBe(true)

    act(() => {
      window.dispatchEvent(new MouseEvent("mousemove"))
    })
    expect(result.current).toBe(false)

    act(() => vi.advanceTimersByTime(WALL_IDLE_MS - 1))
    expect(result.current).toBe(false)
    act(() => vi.advanceTimersByTime(1))
    expect(result.current).toBe(true)
  })

  it("wakes on a key («S», the search shortcut)", () => {
    const { result } = renderHook(() => useWallIdle())
    act(() => vi.advanceTimersByTime(WALL_IDLE_MS))

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "s" }))
    })
    expect(result.current).toBe(false)
  })

  it("input before the timeout postpones it", () => {
    const { result } = renderHook(() => useWallIdle())
    act(() => vi.advanceTimersByTime(WALL_IDLE_MS - 1000))
    act(() => {
      window.dispatchEvent(new MouseEvent("mousemove"))
    })
    act(() => vi.advanceTimersByTime(WALL_IDLE_MS - 1))
    expect(result.current).toBe(false)
  })
})
