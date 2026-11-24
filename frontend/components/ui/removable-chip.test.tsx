import { afterEach, describe, expect, it, vi } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { Info } from "lucide-react"
import { renderWithIntl } from "@/test-utils/render-with-intl"
import { RemovableChip } from "@/components/ui/removable-chip"

/** Pretend the primary pointer is (not) a mouse — jsdom has no matchMedia. */
function setPointerFine(fine: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query === "(pointer: fine)" ? fine : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

function renderCrewChip({ onRemove = vi.fn(), onOpen = vi.fn(), onParentClick = vi.fn() } = {}) {
  renderWithIntl(
    // The card's resource block: any click that reaches it opens the detail.
    <div onClick={onParentClick}>
      <RemovableChip
        onRemove={onRemove}
        removeTitle="Wyss Fabio entfernen"
        menuTitle="Wyss Fabio"
        menuSubtitle="Wachtmeister"
        menuActions={[{ label: "Details öffnen", icon: <Info />, onSelect: onOpen }]}
        removeLabel="Vom Einsatz entfernen"
      >
        Wyss Fabio
      </RemovableChip>
    </div>,
  )
  return { onRemove, onOpen, onParentClick }
}

describe("RemovableChip with a mouse", () => {
  it("keeps the hover ✕, reserved only where a fine pointer exists", async () => {
    setPointerFine(true)
    const { onRemove, onParentClick } = renderCrewChip()

    const x = screen.getByRole("button", { name: "Wyss Fabio entfernen" })
    // `hidden` by default, shown by `pointer-fine:` — the same query the JS reads.
    expect(x.className).toMatch(/(^| )hidden( |$)/)
    expect(x.className).toContain("pointer-fine:inline-flex")
    expect(screen.queryByRole("button", { name: "Wyss Fabio" })).not.toBeInTheDocument()

    await userEvent.click(x)
    expect(onRemove).toHaveBeenCalledTimes(1)
    expect(onParentClick).not.toHaveBeenCalled()
  })

  it("lets a click on the chip itself fall through to the card, as before", async () => {
    setPointerFine(true)
    const { onParentClick } = renderCrewChip()
    await userEvent.click(screen.getByText("Wyss Fabio"))
    expect(onParentClick).toHaveBeenCalledTimes(1)
  })
})

describe("RemovableChip on touch", () => {
  it("has no ✕ at all — the chip opens a menu instead", () => {
    setPointerFine(false)
    renderCrewChip()
    expect(screen.queryByRole("button", { name: "Wyss Fabio entfernen" })).not.toBeInTheDocument()
    const chip = screen.getByRole("button", { name: "Wyss Fabio" })
    expect(chip).toHaveAttribute("aria-haspopup", "menu")
    expect(chip).toHaveAttribute("aria-expanded", "false")
  })

  it("a tap opens the menu — header, «Details öffnen» first, removal last and destructive", async () => {
    setPointerFine(false)
    const { onParentClick } = renderCrewChip()
    const chip = screen.getByRole("button", { name: "Wyss Fabio" })
    await userEvent.click(chip)

    const menu = await screen.findByRole("menu", { name: "Wyss Fabio" })
    expect(menu).toHaveTextContent("Wachtmeister")
    const rows = screen.getAllByRole("menuitem")
    expect(rows.map((row) => row.textContent)).toEqual(["Details öffnen", "Vom Einsatz entfernen"])
    expect(rows[1]).toHaveAttribute("data-variant", "destructive")
    // The tap is the chip's; the card must not open its detail underneath.
    expect(onParentClick).not.toHaveBeenCalled()
    // (Radix hides the rest of the page from assistive tech while the menu is up.)
    expect(chip).toHaveAttribute("aria-expanded", "true")
  })

  it("removes only on the second, deliberate tap", async () => {
    setPointerFine(false)
    const { onRemove, onParentClick } = renderCrewChip()
    await userEvent.click(screen.getByRole("button", { name: "Wyss Fabio" }))
    expect(onRemove).not.toHaveBeenCalled()

    await userEvent.click(await screen.findByRole("menuitem", { name: "Vom Einsatz entfernen" }))
    expect(onRemove).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument())
    // A row's click travels the React tree through the portal — it must stop
    // at the menu, or the card would open its detail on top of the removal.
    expect(onParentClick).not.toHaveBeenCalled()
  })

  it("keeps today's tap-to-open-detail one row away", async () => {
    setPointerFine(false)
    const { onOpen, onRemove, onParentClick } = renderCrewChip()
    await userEvent.click(screen.getByRole("button", { name: "Wyss Fabio" }))
    await userEvent.click(await screen.findByRole("menuitem", { name: "Details öffnen" }))
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onRemove).not.toHaveBeenCalled()
    expect(onParentClick).not.toHaveBeenCalled()
  })

  it("closes on Escape and hands focus back to the chip", async () => {
    setPointerFine(false)
    const { onRemove } = renderCrewChip()
    const chip = screen.getByRole("button", { name: "Wyss Fabio" })
    await userEvent.click(chip)
    await screen.findByRole("menu")
    await userEvent.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument())
    expect(onRemove).not.toHaveBeenCalled()
    expect(chip).toHaveFocus()
  })

  it("opens from the keyboard too", async () => {
    setPointerFine(false)
    renderCrewChip()
    screen.getByRole("button", { name: "Wyss Fabio" }).focus()
    await userEvent.keyboard("{Enter}")
    expect(await screen.findByRole("menu")).toBeInTheDocument()
  })

  it("falls back to the remove title when a caller passes nothing else", async () => {
    setPointerFine(false)
    const onRemove = vi.fn()
    renderWithIntl(
      <RemovableChip onRemove={onRemove} removeTitle="Ressource entfernen">
        TLF
      </RemovableChip>,
    )
    await userEvent.click(screen.getByRole("button", { name: "TLF" }))
    const rows = await screen.findAllByRole("menuitem")
    expect(rows.map((row) => row.textContent)).toEqual(["Ressource entfernen"])
  })

  it("leaves a read-only chip alone", () => {
    setPointerFine(false)
    renderWithIntl(<RemovableChip>TLF</RemovableChip>)
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
  })
})

describe("RemovableChip with a mouse menu (the vehicle chip, owner pick 2B)", () => {
  function renderVehicleChip(mouseMenu: "click" | "contextmenu", { stays = false } = {}) {
    const onPickDriver = vi.fn()
    const onToggleStay = vi.fn()
    const onParentClick = vi.fn()
    const onParentContextMenu = vi.fn()
    renderWithIntl(
      <div onClick={onParentClick} onContextMenu={onParentContextMenu}>
        <RemovableChip
          onRemove={vi.fn()}
          removeTitle="TLF freigeben"
          menuTitle="TLF"
          menuActions={[
            { label: "Fahrer ändern …", hint: "Meier Hans", onSelect: onPickDriver },
            { label: "Fahrer bleibt vor Ort", checked: stays, onSelect: onToggleStay },
          ]}
          removeLabel="Fahrzeug freigeben"
          mouseMenu={mouseMenu}
        >
          TLF
        </RemovableChip>
      </div>,
    )
    return { onPickDriver, onToggleStay, onParentClick, onParentContextMenu }
  }

  it("«contextmenu»: a click still reaches the card, a right-click opens the chip's menu instead of the card's", async () => {
    setPointerFine(true)
    const { onParentClick, onParentContextMenu } = renderVehicleChip("contextmenu")
    // The hover ✕ stays.
    expect(screen.getByRole("button", { name: "TLF freigeben" })).toBeInTheDocument()

    await userEvent.click(screen.getByText("TLF"))
    expect(onParentClick).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole("menu")).not.toBeInTheDocument()

    await userEvent.pointer({ keys: "[MouseRight]", target: screen.getByText("TLF") })
    expect(await screen.findByRole("menu", { name: "TLF" })).toBeInTheDocument()
    expect(onParentContextMenu).not.toHaveBeenCalled()
  })

  it("«click»: a click opens the menu; the driver row names who drives, the checkbox shows the stay flag", async () => {
    setPointerFine(true)
    const { onPickDriver, onParentClick } = renderVehicleChip("click", { stays: true })
    await userEvent.click(screen.getByRole("button", { name: "TLF" }))
    expect(onParentClick).not.toHaveBeenCalled()

    const driverRow = await screen.findByRole("menuitem", { name: /^Fahrer ändern …/ })
    expect(driverRow).toHaveTextContent("Meier Hans")
    expect(screen.getByRole("menuitemcheckbox", { name: "Fahrer bleibt vor Ort" })).toHaveAttribute("aria-checked", "true")
    expect(screen.getByRole("menuitem", { name: "Fahrzeug freigeben" })).toHaveAttribute("data-variant", "destructive")

    await userEvent.click(driverRow)
    expect(onPickDriver).toHaveBeenCalledTimes(1)
  })

  it("the checkbox row calls its write once", async () => {
    setPointerFine(true)
    const { onToggleStay } = renderVehicleChip("click")
    await userEvent.click(screen.getByRole("button", { name: "TLF" }))
    const stay = await screen.findByRole("menuitemcheckbox", { name: "Fahrer bleibt vor Ort" })
    expect(stay).toHaveAttribute("aria-checked", "false")
    await userEvent.click(stay)
    expect(onToggleStay).toHaveBeenCalledTimes(1)
  })
})
