import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"

import { DetailToggle } from "@/components/kanban/detail-field"

/**
 * Owner, 02.10.: flipping «Nachbarhilfe» / «Am Warten» on made the row grow —
 * the 28px note input appeared beside an 18px switch and every row below
 * jumped. The row reserves the dense field height (min-h-(--field-h-dense)) in BOTH states.
 */
function rowOf(label: string) {
  return screen.getByRole("switch", { name: label }).parentElement!.parentElement as HTMLElement
}

describe("DetailToggle row height", () => {
  it("reserves the note's height while OFF, so switching on does not move the form", () => {
    const { rerender } = render(
      <DetailToggle label="Nachbarhilfe" icon={null} checked={false} onToggle={vi.fn()} note={<input placeholder="Feuerwehr, Kontakt …" className="h-7" />} />,
    )
    expect(rowOf("Nachbarhilfe")).toHaveClass("min-h-(--field-h-dense)")
    expect(screen.queryByPlaceholderText("Feuerwehr, Kontakt …")).toBeNull()

    rerender(
      <DetailToggle label="Nachbarhilfe" icon={null} checked onToggle={vi.fn()} note={<input placeholder="Feuerwehr, Kontakt …" className="h-7" />} />,
    )
    expect(rowOf("Nachbarhilfe")).toHaveClass("min-h-(--field-h-dense)")
    expect(screen.getByPlaceholderText("Feuerwehr, Kontakt …")).toBeInTheDocument()
  })
})
