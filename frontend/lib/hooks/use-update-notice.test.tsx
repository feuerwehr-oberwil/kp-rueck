import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, renderHook } from "@testing-library/react"

const nav = vi.hoisted(() => ({ pathname: "/" }))
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }))
const toast = vi.hoisted(() => vi.fn())
vi.mock("sonner", () => ({ toast }))

import { BUILD_ID } from "@/lib/build-info"
import { RELOADED_FOR_KEY, UPDATE_CHECK_INTERVAL_MS, fetchServerBuildId, newBuildLoads, useUpdateNotice } from "./use-update-notice"

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
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

  it("a wall display reloads itself — once — when the new build really loads", async () => {
    nav.pathname = "/display/map"
    const reload = vi.fn()
    vi.stubGlobal("location", { ...window.location, reload })
    const confirm = vi.fn(async () => true)
    renderHook(() => useUpdateNotice(async () => "other@build", confirm))
    await flush()
    expect(confirm).toHaveBeenCalledWith("other@build")
    expect(toast).not.toHaveBeenCalled()
    await act(async () => { vi.advanceTimersByTime(30_000) })
    expect(reload).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(RELOADED_FOR_KEY)).toBe("other@build")
    vi.unstubAllGlobals()
  })

  it("no loop: after reloading for a build, a display still served another one shows the notice", async () => {
    nav.pathname = "/display/board"
    localStorage.setItem(RELOADED_FOR_KEY, "other@build") // the reload already happened
    const reload = vi.fn()
    vi.stubGlobal("location", { ...window.location, reload })
    const confirm = vi.fn(async () => true)
    renderHook(() => useUpdateNotice(async () => "other@build", confirm))
    await flush()
    await act(async () => { vi.advanceTimersByTime(60_000) })
    expect(reload).not.toHaveBeenCalled()
    expect(confirm).not.toHaveBeenCalled()
    expect(toast).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })

  it("a failed load check never reloads a display — it gets the quiet notice", async () => {
    nav.pathname = "/display/status"
    const reload = vi.fn()
    vi.stubGlobal("location", { ...window.location, reload })
    renderHook(() => useUpdateNotice(async () => "other@build", async () => false))
    await flush()
    await act(async () => { vi.advanceTimersByTime(60_000) })
    expect(reload).not.toHaveBeenCalled()
    expect(toast).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(RELOADED_FOR_KEY)).toBeNull()
    vi.unstubAllGlobals()
  })
})

describe("newBuildLoads", () => {
  const json = (id: string) => new Response(JSON.stringify({ id }), { status: 200 })
  it("needs the page AND the same new build id from this origin", async () => {
    const ok = vi.fn(async (url: string) => (url === "/" ? new Response("<html>", { status: 200 }) : json("new@1")))
    expect(await newBuildLoads("new@1", ok as unknown as typeof fetch)).toBe(true)
    const pageDown = vi.fn(async (url: string) => (url === "/" ? new Response("", { status: 502 }) : json("new@1")))
    expect(await newBuildLoads("new@1", pageDown as unknown as typeof fetch)).toBe(false)
    const flapping = vi.fn(async (url: string) => (url === "/" ? new Response("<html>", { status: 200 }) : json("old@0")))
    expect(await newBuildLoads("new@1", flapping as unknown as typeof fetch)).toBe(false)
    const offline = vi.fn(async () => { throw new TypeError("offline") })
    expect(await newBuildLoads("new@1", offline as unknown as typeof fetch)).toBe(false)
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
