import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useResizableWidth } from "./use-resizable-width"

const KEY = "kp-test-width"

// Node 26 does not expose localStorage unless --localstorage-file is passed, so
// the suite drives an in-memory stand-in (mirrors use-collapsed-sections.test.ts).
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

// A right-hand rail dragged by its left edge, like the Routenplanung panel.
function Rail() {
  const resize = useResizableWidth({ storageKey: KEY, defaultWidth: 320, min: 280, max: 560, side: "left" })
  return <div {...resize.gripProps} aria-label="Breite" />
}

const grip = () => screen.getByRole("separator", { name: "Breite" })
const width = () => Number(grip().getAttribute("aria-valuenow"))

describe("useResizableWidth", () => {
  beforeEach(() => {
    installStorage()
    // jsdom has no pointer capture.
    HTMLElement.prototype.setPointerCapture = vi.fn()
    HTMLElement.prototype.hasPointerCapture = vi.fn(() => true)
    HTMLElement.prototype.releasePointerCapture = vi.fn()
  })
  afterEach(() => vi.unstubAllGlobals())

  it("drags wider towards the outside, clamps, and persists only the release", async () => {
    render(<Rail />)
    await waitFor(() => expect(localStorage.getItem(KEY)).toBe("320"))
    fireEvent.pointerDown(grip(), { button: 0, clientX: 1000, pointerId: 1 })
    fireEvent.pointerMove(grip(), { clientX: 900, pointerId: 1 })
    expect(width()).toBe(420)
    expect(localStorage.getItem(KEY)).toBe("320")
    fireEvent.pointerMove(grip(), { clientX: 200, pointerId: 1 })
    expect(width()).toBe(560)
    fireEvent.pointerUp(grip(), { clientX: 200, pointerId: 1 })
    await waitFor(() => expect(localStorage.getItem(KEY)).toBe("560"))
  })

  it("restores the stored width and resets to the default on double-click", async () => {
    localStorage.setItem(KEY, "480")
    render(<Rail />)
    await waitFor(() => expect(width()).toBe(480))
    fireEvent.doubleClick(grip())
    await waitFor(() => expect(localStorage.getItem(KEY)).toBe("320"))
    expect(width()).toBe(320)
  })

  it("moves by keyboard: arrows (Shift = 4 steps), Home/End to the bounds", () => {
    render(<Rail />)
    fireEvent.keyDown(grip(), { key: "ArrowLeft" })
    expect(width()).toBe(336)
    fireEvent.keyDown(grip(), { key: "ArrowRight", shiftKey: true })
    expect(width()).toBe(280)
    fireEvent.keyDown(grip(), { key: "End" })
    expect(width()).toBe(560)
    fireEvent.keyDown(grip(), { key: "Home" })
    expect(width()).toBe(280)
  })

  it("brings a stored width from other bounds back inside them", async () => {
    localStorage.setItem(KEY, "900")
    render(<Rail />)
    await waitFor(() => expect(width()).toBe(560))
  })
})
