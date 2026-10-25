import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { DetailFlags, type DetailFlag } from "@/components/kanban/detail-field"

/**
 * The «Merkmale» chip row (UX-DESKTOP-14 B) replaced the switch rows in «Neuer
 * Einsatz» and the Übersicht. A chip says its state (`aria-pressed`); a flag with
 * a «warum» note gets that note as its own labelled row while on, focused when
 * the chip is switched on — and only then, not when an incident opens already on.
 */
function flags(nachbarhilfe: boolean, onToggle = vi.fn()): DetailFlag[] {
  return [
    { key: "intake", label: "Telefonisch", icon: null, checked: false, onToggle },
    {
      key: "nachbarhilfe",
      label: "Nachbarhilfe",
      icon: null,
      checked: nachbarhilfe,
      onToggle,
      note: <input placeholder="Feuerwehr, Kontakt …" />,
    },
  ]
}

describe("DetailFlags", () => {
  it("is one labelled group of pressed/unpressed chips", async () => {
    const onToggle = vi.fn()
    render(<DetailFlags label="Merkmale" flags={flags(false, onToggle)} stacked={false} />)

    const group = screen.getByRole("group", { name: "Merkmale" })
    const chip = screen.getByRole("button", { name: "Nachbarhilfe" })
    expect(group).toContainElement(chip)
    expect(chip).toHaveAttribute("aria-pressed", "false")

    await userEvent.setup().click(chip)
    expect(onToggle).toHaveBeenCalledWith(true)
  })

  it("shows the note only while on, and focuses it on the switch-on only", () => {
    const { rerender, unmount } = render(<DetailFlags label="Merkmale" flags={flags(false)} stacked={false} />)
    expect(screen.queryByPlaceholderText("Feuerwehr, Kontakt …")).toBeNull()

    rerender(<DetailFlags label="Merkmale" flags={flags(true)} stacked={false} />)
    expect(screen.getByPlaceholderText("Feuerwehr, Kontakt …")).toHaveFocus()
    expect(screen.getByText("Nachbarhilfe", { selector: "label" })).toBeInTheDocument()
    unmount()

    // An incident that opens with the flag already on must not steal the cursor.
    render(<DetailFlags label="Merkmale" flags={flags(true)} stacked={false} />)
    expect(screen.getByPlaceholderText("Feuerwehr, Kontakt …")).not.toHaveFocus()
  })
})
