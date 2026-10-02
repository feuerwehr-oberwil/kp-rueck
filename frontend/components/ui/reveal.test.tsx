import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, render, screen } from "@testing-library/react"

import { Reveal, REVEAL_MS } from "@/components/ui/reveal"

/**
 * The shared open/close motion for hand-built disclosures. What has to hold:
 * no animation on mount, the body stays mounted while it slides shut, closed
 * content is inert, reduced motion is instant, keepMounted hides instead of
 * unmounting.
 */

function setReducedMotion(reduce: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reduce && query.includes("reduce"),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia
}

beforeEach(() => {
  vi.useFakeTimers()
  setReducedMotion(false)
})
afterEach(() => {
  vi.useRealTimers()
})

const flushFrames = async () => {
  await act(async () => {
    vi.advanceTimersByTime(40)
  })
}

describe("Reveal", () => {
  it("renders open content without animating on mount", () => {
    render(<Reveal open>Inhalt</Reveal>)
    const box = screen.getByText("Inhalt").parentElement as HTMLElement
    expect(box).toHaveAttribute("data-state", "open")
    expect(box).toHaveClass("grid-rows-[1fr]")
  })

  it("renders nothing while closed", () => {
    render(<Reveal open={false}>Inhalt</Reveal>)
    expect(screen.queryByText("Inhalt")).toBeNull()
  })

  it("slides open from 0fr to 1fr", async () => {
    const { rerender } = render(<Reveal open={false}>Inhalt</Reveal>)
    rerender(<Reveal open>Inhalt</Reveal>)
    const box = () => screen.getByText("Inhalt").parentElement as HTMLElement
    expect(box()).toHaveClass("grid-rows-[0fr]")
    await flushFrames()
    expect(box()).toHaveClass("grid-rows-[1fr]")
  })

  it("keeps the body mounted (and inert) while it slides shut, then removes it", async () => {
    const { rerender } = render(<Reveal open>Inhalt</Reveal>)
    rerender(<Reveal open={false}>Inhalt</Reveal>)
    const box = screen.getByText("Inhalt").parentElement as HTMLElement
    expect(box).toHaveClass("grid-rows-[0fr]")
    expect(box).toHaveAttribute("inert")
    await act(async () => {
      vi.advanceTimersByTime(REVEAL_MS + 50)
    })
    expect(screen.queryByText("Inhalt")).toBeNull()
  })

  it("is instant under reduced motion", () => {
    setReducedMotion(true)
    const { rerender } = render(<Reveal open={false}>Inhalt</Reveal>)
    rerender(<Reveal open>Inhalt</Reveal>)
    expect(screen.getByText("Inhalt").parentElement).toHaveClass("grid-rows-[1fr]")
    rerender(<Reveal open={false}>Inhalt</Reveal>)
    expect(screen.queryByText("Inhalt")).toBeNull()
  })

  it("hides instead of unmounting with keepMounted", async () => {
    const { rerender } = render(
      <Reveal open keepMounted id="body">
        <input aria-label="Notiz" defaultValue="halb getippt" />
      </Reveal>,
    )
    rerender(
      <Reveal open={false} keepMounted id="body">
        <input aria-label="Notiz" defaultValue="halb getippt" />
      </Reveal>,
    )
    await act(async () => {
      vi.advanceTimersByTime(REVEAL_MS + 50)
    })
    const body = document.getElementById("body") as HTMLElement
    expect(body.hidden).toBe(true)
    expect(body.querySelector("input")?.value).toBe("halb getippt")
  })
})
