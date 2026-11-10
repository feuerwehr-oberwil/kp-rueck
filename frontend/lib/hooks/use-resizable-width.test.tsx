import { fireEvent, render, screen } from "@testing-library/react"
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

let renders = 0

// A right-hand rail dragged by its left edge, like the map's rail.
function Rail({ max = 560 }: { max?: number }) {
  renders += 1
  const resize = useResizableWidth({ storageKey: KEY, defaultWidth: 320, min: Math.min(280, max), max, side: "left" })
  return (
    <div ref={resize.panelRef} style={resize.style} data-testid="panel">
      <div {...resize.gripProps} aria-label="Breite" />
    </div>
  )
}

const grip = () => screen.getByRole("separator", { name: "Breite" })
const width = () => Number(grip().getAttribute("aria-valuenow"))
const panelWidth = () => screen.getByTestId("panel").style.getPropertyValue("--rail-w")

describe("useResizableWidth", () => {
  beforeEach(() => {
    installStorage()
    renders = 0
    // jsdom has no pointer capture.
    HTMLElement.prototype.setPointerCapture = vi.fn()
    HTMLElement.prototype.hasPointerCapture = vi.fn(() => true)
    HTMLElement.prototype.releasePointerCapture = vi.fn()
  })
  afterEach(() => vi.unstubAllGlobals())

  it("drags in the DOM without re-rendering, clamps, and persists only the release", () => {
    render(<Rail />)
    const before = renders
    fireEvent.pointerDown(grip(), { button: 0, clientX: 1000, pointerId: 1 })
    expect(screen.getByTestId("panel").dataset.resizing).toBe("")
    fireEvent.pointerMove(grip(), { clientX: 900, pointerId: 1 })
    expect(panelWidth()).toBe("420px")
    expect(width()).toBe(420)
    fireEvent.pointerMove(grip(), { clientX: 200, pointerId: 1 })
    expect(panelWidth()).toBe("560px")
    expect(renders).toBe(before)
    expect(localStorage.getItem(KEY)).toBeNull()
    fireEvent.pointerUp(grip(), { clientX: 200, pointerId: 1 })
    expect(localStorage.getItem(KEY)).toBe("560")
    expect(screen.getByTestId("panel").dataset.resizing).toBeUndefined()
    expect(panelWidth()).toBe("560px")
  })

  it("a click while the page caps the rail keeps the saved width for when there is room", () => {
    localStorage.setItem(KEY, "480")
    const { rerender } = render(<Rail max={256} />)
    expect(width()).toBe(256)
    fireEvent.pointerDown(grip(), { button: 0, clientX: 500, pointerId: 1 })
    fireEvent.pointerUp(grip(), { clientX: 500, pointerId: 1 })
    expect(localStorage.getItem(KEY)).toBe("480")
    rerender(<Rail />)
    expect(width()).toBe(480)
  })

  it("restores the stored width before the first paint and resets to the default on double-click", () => {
    localStorage.setItem(KEY, "480")
    render(<Rail />)
    // Layout effect: already the stored width when render() returns.
    expect(panelWidth()).toBe("480px")
    fireEvent.doubleClick(grip())
    expect(localStorage.getItem(KEY)).toBe("320")
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

  it("brings a stored width from other bounds back inside them", () => {
    localStorage.setItem(KEY, "900")
    render(<Rail />)
    expect(width()).toBe(560)
  })
})
