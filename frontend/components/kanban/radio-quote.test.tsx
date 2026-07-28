import { describe, expect, it } from "vitest"
import { screen } from "@testing-library/react"
import { renderWithIntl } from "@/test-utils/render-with-intl"

import { RadioQuote } from "@/components/kanban/radio-quote"
import type { RadioSegment } from "@/lib/radio-announcement"

const AUFTRAG: RadioSegment[] = [
  { text: "An alle Omega, neuer Auftrag «Sturmholz Oberwil»:" },
  { text: " 2 Stops:" },
  { text: "1. Bahnhofstrasse 31", bold: true, newline: true, status: "active" },
  { text: "3. Schulstrasse 9", bold: true, newline: true, status: "incoming" },
]

describe("RadioQuote", () => {
  it("gives every stop its own line instead of one comma run-on", () => {
    const { container } = renderWithIntl(<RadioQuote segments={AUFTRAG} />)

    const lines = [...container.querySelectorAll("p")].map((p) => p.textContent)
    expect(lines).toHaveLength(3)
    expect(lines[1]).toContain("1. Bahnhofstrasse 31")
    expect(lines[2]).toContain("3. Schulstrasse 9")
    // The two addresses never share a line — that is the whole point.
    expect(lines[1]).not.toContain("Schulstrasse")
  })

  it("shows each open stop's status on screen", () => {
    renderWithIntl(<RadioQuote segments={AUFTRAG} />)

    expect(screen.getByText("Einsatz")).toBeDefined()
    expect(screen.getByText("Offen")).toBeDefined()
  })

  it("uses no quotation marks at all", () => {
    const { container } = renderWithIntl(<RadioQuote segments={AUFTRAG} />)

    // A straight " around a block several lines long left a stray mark in the
    // middle of the list. The left rule carries the «verbatim» meaning instead.
    expect(container.textContent).not.toContain('"')
    expect(container.firstElementChild!.className).toContain("border-l-2")
  })

  it("keeps the status out of the spoken line", () => {
    const { container } = renderWithIntl(<RadioQuote segments={AUFTRAG} />)

    const lastLine = [...container.querySelectorAll("p")].at(-1)!
    expect(lastLine.querySelector("span")!.textContent).toBe("3. Schulstrasse 9")
  })
})
