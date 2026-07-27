import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useCollapsedSections } from "./use-collapsed-sections"

const KEY = "kp-test-collapsed"

// Node 26 does not expose localStorage unless --localstorage-file is passed, so
// the suite drives an in-memory stand-in (mirrors safe-storage.test.ts).
function installStorage() {
  const data = new Map<string, string>()
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    clear: () => data.clear(),
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() {
      return data.size
    },
  } as Storage)
}

describe("useCollapsedSections", () => {
  beforeEach(installStorage)
  afterEach(() => vi.unstubAllGlobals())

  it("starts with everything open — nothing hides by itself", () => {
    const { result } = renderHook(() => useCollapsedSections(KEY))
    expect(result.current.isCollapsed("incoming")).toBe(false)
    expect(result.current.isCollapsed("complete")).toBe(false)
  })

  it("honours the named exceptions (ABGESCHLOSSEN)", () => {
    const { result } = renderHook(() => useCollapsedSections(KEY, ["complete"]))
    expect(result.current.isCollapsed("complete")).toBe(true)
    expect(result.current.isCollapsed("active")).toBe(false)
  })

  it("toggles both ways", () => {
    const { result } = renderHook(() => useCollapsedSections(KEY))
    act(() => result.current.toggle("active"))
    expect(result.current.isCollapsed("active")).toBe(true)
    act(() => result.current.toggle("active"))
    expect(result.current.isCollapsed("active")).toBe(false)
  })

  it("remembers the fold on this device", () => {
    const first = renderHook(() => useCollapsedSections(KEY))
    act(() => first.result.current.toggle("active"))
    first.unmount()

    const second = renderHook(() => useCollapsedSections(KEY))
    expect(second.result.current.isCollapsed("active")).toBe(true)
  })

  it("a stored state replaces the defaults — reopening ABGESCHLOSSEN sticks", () => {
    window.localStorage.setItem(KEY, JSON.stringify([]))
    const { result } = renderHook(() => useCollapsedSections(KEY, ["complete"]))
    expect(result.current.isCollapsed("complete")).toBe(false)
  })

  it("falls back to the defaults when the stored value is junk", () => {
    window.localStorage.setItem(KEY, "not json")
    const { result } = renderHook(() => useCollapsedSections(KEY, ["complete"]))
    expect(result.current.isCollapsed("complete")).toBe(true)
  })
})
