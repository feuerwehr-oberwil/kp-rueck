import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { act, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useResizableWidth } from "@/lib/hooks/use-resizable-width"
import { PANEL_MOTION_MS, SlideRail } from "./slide-rail"

function Board({ open }: { open: boolean }) {
  const resize = useResizableWidth({ storageKey: "kp-test-rail", defaultWidth: 256, min: 224, max: 384, side: "right" })
  return (
    <SlideRail open={open} dock="left" resize={resize} gripLabel="Breite" gripHint="Ziehen">
      <aside>Personal</aside>
    </SlideRail>
  )
}

const rail = () => document.querySelector<HTMLElement>("[data-slot='slide-rail']")!

describe("SlideRail", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // jsdom: no matchMedia, i.e. no reduced-motion preference.
    vi.stubGlobal("matchMedia", () => ({ matches: false }))
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("stands as it was restored on load: an early toggle is instant, no motion yet", () => {
    const { rerender } = render(<Board open />)
    expect(rail().dataset.motion).toBeUndefined()
    expect(rail().style.width).toBe("calc(var(--rail-w) + var(--rail-extra, 0px))")
    // Open, it yields to the board down to its minimum.
    expect(rail().style.flexShrink).toBe("1")
    expect(rail().style.minWidth).toBe("calc(224px + var(--rail-extra, 0px))")
    rerender(<Board open={false} />)
    expect(rail().dataset.phase).toBe("closed")
    expect(rail().style.width).toBe("0px")
    expect(screen.queryByText("Personal")).toBeNull()
  })

  it("once drawn, closes over the motion time with the content kept but inert, then unmounts it", () => {
    const { rerender } = render(<Board open />)
    act(() => vi.advanceTimersByTime(50))
    expect(rail().dataset.motion).toBe("on")
    expect(screen.getByRole("separator", { name: "Breite" })).toBeTruthy()

    rerender(<Board open={false} />)
    expect(rail().dataset.phase).toBe("closing")
    expect(rail().style.width).toBe("0px")
    expect(rail().style.minWidth).toBe("")
    expect(screen.getByText("Personal").closest("[inert]")).not.toBeNull()
    expect(screen.queryByRole("separator")).toBeNull()

    act(() => vi.advanceTimersByTime(PANEL_MOTION_MS))
    expect(rail().dataset.phase).toBe("closed")
    expect(screen.queryByText("Personal")).toBeNull()

    rerender(<Board open />)
    expect(rail().dataset.phase).toBe("opening")
    expect(screen.getByText("Personal")).toBeTruthy()
    act(() => vi.advanceTimersByTime(PANEL_MOTION_MS))
    expect(rail().dataset.phase).toBe("open")
  })

  it("times its phases by the stylesheet's --motion-panel", () => {
    const css = readFileSync(resolve(__dirname, "../../app/globals.css"), "utf8")
    expect(css).toContain(`--motion-panel: ${PANEL_MOTION_MS}ms;`)
  })
})
