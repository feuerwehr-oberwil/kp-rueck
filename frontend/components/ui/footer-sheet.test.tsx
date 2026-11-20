import { describe, expect, it, vi } from "vitest"
import { screen } from "@testing-library/react"
import { useState } from "react"
import { renderWithIntl } from "@/test-utils/render-with-intl"
import userEvent from "@testing-library/user-event"

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { FooterSheet, SHEET_LAYER_ATTR } from "@/components/ui/footer-sheet"
import { SheetTitle } from "@/components/ui/sheet"

// The desktop shape is the one under test: there the sheet is non-modal, so
// nothing absorbs the pointer and the sheet has to decide for itself what
// counts as "outside". On a phone it is a plain modal sheet and none of this
// applies.
vi.mock("@/components/ui/use-mobile", () => ({ useIsMobile: () => false }))

/**
 * A footer sheet whose content opens a picker in a portal — the /feld «Neue
 * Meldung» shape. Both the tagged suggestion list and the modal dialog land at
 * the end of `<body>`, i.e. outside the sheet's own subtree.
 */
function Board({
  onOpenChange,
  pickerOpen = false,
}: {
  onOpenChange: (open: boolean) => void
  pickerOpen?: boolean
}) {
  return (
    <>
      <button type="button">Karte</button>
      <FooterSheet open onOpenChange={onOpenChange}>
        <button type="button">Adresse</button>
      </FooterSheet>
      {/* Portalled, non-modal, and tagged as belonging to the sheet. */}
      <div {...{ [SHEET_LAYER_ATTR]: "" }}>
        <button type="button">Hauptstrasse 1</button>
      </div>
      <Dialog open={pickerOpen} onOpenChange={() => {}}>
        <DialogContent>
          <DialogTitle>Einsatzort auf Karte wählen</DialogTitle>
          <button type="button">Punkt auf der Karte</button>
        </DialogContent>
      </Dialog>
    </>
  )
}

describe("FooterSheet outside-click guard", () => {
  it("stays open when a tagged portalled layer is clicked", async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    renderWithIntl(<Board onOpenChange={onOpenChange} />)

    await user.click(screen.getByRole("button", { name: "Hauptstrasse 1" }))
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it("stays open while a modal layer above it owns the pointer", async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    renderWithIntl(<Board onOpenChange={onOpenChange} pickerOpen />)

    // Radix locks `<body>` for a modal layer; the sheet reads that as "the
    // click belongs to whatever is above me" — dropping a pin on the picker's
    // map must not take the form underneath with it.
    expect(document.body.style.pointerEvents).toBe("none")
    await user.click(screen.getByRole("button", { name: "Punkt auf der Karte" }))
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it("still closes on a click on the page behind it", async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    renderWithIntl(<Board onOpenChange={onOpenChange} />)

    await user.click(screen.getByRole("button", { name: "Karte" }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})

/** The board's wiring: footer pills that toggle on pointerdown (ToolbarToggle), one sheet at a time. */
function Toolbar() {
  const [active, setActive] = useState<"links" | "vehicles" | null>(null)
  const pill = (key: "links" | "vehicles", label: string) => (
    <button
      type="button"
      onPointerDown={(e) => {
        e.stopPropagation()
        setActive(active === key ? null : key)
      }}
    >
      {label}
    </button>
  )
  return (
    <>
      <footer>
        {pill("links", "Links & QR")}
        {pill("vehicles", "Fahrzeuge")}
      </footer>
      {(["links", "vehicles"] as const).map((key) => (
        <FooterSheet key={key} open={active === key} onOpenChange={(open) => !open && active === key && setActive(null)}>
          <SheetTitle>{`Sheet ${key}`}</SheetTitle>
        </FooterSheet>
      ))}
    </>
  )
}

describe("FooterSheet footer pills", () => {
  // Recording 19.11.2026: a «Fahrzeuge» click seemed to open nothing. The pill press is the
  // footer's own (not «outside»), so it opens, switches and closes on the first click.
  it("opens, switches and closes with one click each", async () => {
    const user = userEvent.setup()
    renderWithIntl(<Toolbar />)
    const shown = () => screen.queryAllByRole("dialog").map((d) => d.textContent)

    await user.click(screen.getByRole("button", { name: "Fahrzeuge" }))
    expect(shown()).toEqual(["Sheet vehicles"])

    await user.click(screen.getByRole("button", { name: "Links & QR" }))
    expect(shown()).toEqual(["Sheet links"])

    await user.click(screen.getByRole("button", { name: "Fahrzeuge" }))
    expect(shown()).toEqual(["Sheet vehicles"])

    await user.click(screen.getByRole("button", { name: "Fahrzeuge" }))
    expect(shown()).toEqual([])
  })
})
