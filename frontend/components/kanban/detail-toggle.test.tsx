import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"

import { DetailToggle } from "@/components/kanban/detail-field"

/**
 * Owner, 02.10.: flipping «Nachbarhilfe» / «Am Warten» on made the row grow —
 * the 28px note input appeared beside an 18px switch and every row below
 * jumped. The row reserves the dense field height (min-h-(--field-h-dense)) in BOTH states;
 * that is geometry jsdom cannot measure (the board-detail visual screen carries it), so this
 * pins only that the note belongs to the ON state.
 */
describe("DetailToggle note", () => {
  it("shows the note only while the toggle is on", () => {
    const { rerender } = render(
      <DetailToggle label="Nachbarhilfe" icon={null} checked={false} onToggle={vi.fn()} note={<input placeholder="Feuerwehr, Kontakt …" className="h-7" />} />,
    )
    expect(screen.queryByPlaceholderText("Feuerwehr, Kontakt …")).toBeNull()

    rerender(
      <DetailToggle label="Nachbarhilfe" icon={null} checked onToggle={vi.fn()} note={<input placeholder="Feuerwehr, Kontakt …" className="h-7" />} />,
    )
    expect(screen.getByPlaceholderText("Feuerwehr, Kontakt …")).toBeInTheDocument()
  })
})
