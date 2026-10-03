import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, renderHook } from "@testing-library/react"

const nav = vi.hoisted(() => ({ pathname: "/" }))
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }))
const toast = vi.hoisted(() => vi.fn())
vi.mock("sonner", () => ({ toast }))

import { BUILD_ID } from "@/lib/build-info"
import { UPDATE_CHECK_INTERVAL_MS, fetchServerBuildId, useUpdateNotice } from "./use-update-notice"

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })

beforeEach(() => {
  vi.useFakeTimers()
  nav.pathname = "/"
  toast.mockClear()
})
afterEach(() => vi.useRealTimers())

describe("useUpdateNotice", () => {
  it("stays quiet while the server runs this build", async () => {
    renderHook(() => useUpdateNotice(async () => BUILD_ID))
    await flush()
    expect(toast).not.toHaveBeenCalled()
  })

  it("says «Neue Version verfügbar» once, with «Neu laden», when the server has another build", async () => {
    const fetchId = vi.fn(async () => "0.7.1@abc@2026-10-03T09:00:00Z")
    renderHook(() => useUpdateNotice(fetchId))
    await flush()
    expect(toast).toHaveBeenCalledTimes(1)
    const [title, opts] = toast.mock.calls[0]
    expect(title).toBe("Neue Version verfügbar")
    expect(opts.action.label).toBe("Neu laden")
    expect(opts.duration).toBe(Infinity)
    // later checks do not stack a second notice
    await act(async () => { vi.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS) })
    await flush()
    expect(toast).toHaveBeenCalledTimes(1)
  })

  it("an unreachable server is not an update", async () => {
    renderHook(() => useUpdateNotice(async () => null))
    await flush()
    expect(toast).not.toHaveBeenCalled()
  })

  it("checks again every 5 minutes", async () => {
    const fetchId = vi.fn(async () => BUILD_ID)
    renderHook(() => useUpdateNotice(fetchId))
    await flush()
    await act(async () => { vi.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS) })
    expect(fetchId).toHaveBeenCalledTimes(2)
  })

  it("a wall display reloads itself instead of waiting for a tap", async () => {
    nav.pathname = "/display/map"
    const reload = vi.fn()
    vi.stubGlobal("location", { ...window.location, reload })
    renderHook(() => useUpdateNotice(async () => "other@build"))
    await flush()
    expect(toast).not.toHaveBeenCalled()
    await act(async () => { vi.advanceTimersByTime(30_000) })
    expect(reload).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })
})

describe("fetchServerBuildId", () => {
  it("reads the id, and null on any failure", async () => {
    const ok = vi.fn(async () => new Response(JSON.stringify({ id: "x@y" }), { status: 200 }))
    expect(await fetchServerBuildId(ok as unknown as typeof fetch)).toBe("x@y")
    const down = vi.fn(async () => { throw new TypeError("offline") })
    expect(await fetchServerBuildId(down as unknown as typeof fetch)).toBeNull()
  })
})
