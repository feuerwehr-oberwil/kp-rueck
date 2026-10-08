import { act, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { CommandPaletteHandlers } from "@/lib/contexts/command-palette-context"
import type { DispatchVocabulary } from "@/lib/command-dispatch"
import { renderWithIntl } from "@/test-utils/render-with-intl"

let handlers: CommandPaletteHandlers = {}

vi.mock("@/lib/contexts/command-palette-context", () => ({
  useCommandPaletteHandlers: () => handlers,
}))
vi.mock("@/lib/contexts/groups-context", () => ({
  useGroups: () => ({ groups: [] }),
}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

import { CommandPalette, openCommandPalette } from "./command-palette"

const vocabulary: DispatchVocabulary = {
  incidents: [{ id: "inc-14", number: 14, label: "Bachweg 3", status: "incoming", priority: "medium" }],
  persons: [
    { id: "p-muster", name: "Muster Peter", detail: "Maschinist" },
    { id: "p-meier-hans", name: "Meier Hans", detail: "Gruppenführer", incidentIds: ["inc-14"] },
    { id: "p-meier-anna", name: "Meier Anna", detail: "AdF" },
  ],
  vehicles: [{ id: "v-tlf", name: "TLF", type: "TLF" }],
  materials: [],
}

function setup(extra: Partial<CommandPaletteHandlers> = {}) {
  const onDispatch = vi.fn()
  const onDispatchJump = vi.fn()
  const onOpenIncident = vi.fn()
  handlers = {
    getDispatchVocabulary: () => vocabulary,
    onDispatch,
    onDispatchJump,
    onOpenIncident,
    ...extra,
  }
  renderWithIntl(<CommandPalette />)
  act(() => openCommandPalette())
  return { onDispatch, onDispatchJump, onOpenIncident, user: userEvent.setup() }
}

const input = () => screen.getByRole("combobox")
const preview = () => screen.getByTestId("dispatch-preview")

describe("CommandPalette — type-to-dispatch preview", () => {
  beforeEach(() => {
    handlers = {}
  })

  it("shows what ↵ will do as chips, and does nothing before ↵", async () => {
    const { user, onDispatch } = setup()
    await user.type(input(), "14 tlf muster")

    const row = preview()
    expect(within(row).getByText("Bachweg 3")).toBeInTheDocument()
    expect(within(row).getByText("14")).toBeInTheDocument()
    expect(within(row).getByText("TLF")).toBeInTheDocument()
    expect(within(row).getByText("Muster Peter")).toBeInTheDocument()
    expect(within(row).getByText("ausführen")).toBeInTheDocument()
    expect(onDispatch).not.toHaveBeenCalled()

    await user.keyboard("{Enter}")
    expect(onDispatch).toHaveBeenCalledTimes(1)
    expect(onDispatch.mock.calls[0][0]).toMatchObject({
      kind: "dispatch",
      incident: { id: "inc-14" },
      assign: [{ target: { id: "v-tlf" } }, { target: { id: "p-muster" } }],
    })
    // ↵ ran it and closed the palette.
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument()
  })

  it("shows status and priority as their own chips", async () => {
    const { user } = setup()
    await user.type(input(), "14 einsatz hoch")
    const row = preview()
    expect(within(row).getByText("Im Einsatz")).toBeInTheDocument()
    expect(within(row).getByText("Hoch")).toBeInTheDocument()
  })

  it("greys a word it does not know", async () => {
    const { user } = setup()
    await user.type(input(), "14 tlf xyzzy")
    const grey = preview().querySelector('[data-dispatch-token="grey"]')
    expect(grey).toHaveTextContent("xyzzy")
  })

  it("says when a resource is already there", async () => {
    const { user } = setup()
    await user.type(input(), "14 meier hans")
    expect(within(preview()).getByText(/schon da/)).toBeInTheDocument()
  })

  it("offers choices for an ambiguous name and runs nothing until one is picked", async () => {
    const { user, onDispatch } = setup()
    await user.type(input(), "14 meier tlf")

    expect(within(preview()).getByText("2 Treffer")).toBeInTheDocument()
    expect(within(preview()).getByText("unten wählen")).toBeInTheDocument()
    // ↵ on the preview while it still asks: the palette stays open, nothing runs.
    await user.keyboard("{Enter}")
    expect(onDispatch).not.toHaveBeenCalled()
    expect(input()).toBeInTheDocument()

    await user.click(screen.getByRole("option", { name: /Meier Anna/ }))
    expect(within(preview()).getByText("Meier Anna")).toBeInTheDocument()
    expect(screen.queryByRole("option", { name: /Meier Hans/ })).not.toBeInTheDocument()

    await user.keyboard("{Enter}")
    expect(onDispatch).toHaveBeenCalledTimes(1)
    expect(onDispatch.mock.calls[0][0].assign.map((entry: { target: { id: string } }) => entry.target.id)).toEqual([
      "p-meier-anna",
      "v-tlf",
    ])
  })

  it("«meier hans» alone jumps to the person", async () => {
    const { user, onDispatchJump, onDispatch } = setup()
    await user.type(input(), "meier hans")
    expect(within(preview()).getByText("zeigen")).toBeInTheDocument()
    await user.keyboard("{Enter}")
    expect(onDispatchJump).toHaveBeenCalledWith(expect.objectContaining({ id: "p-meier-hans" }))
    expect(onDispatch).not.toHaveBeenCalled()
  })

  it("«14» alone opens the Einsatz", async () => {
    const { user, onOpenIncident } = setup()
    await user.type(input(), "14")
    expect(within(preview()).getByText("öffnen")).toBeInTheDocument()
    await user.keyboard("{Enter}")
    expect(onOpenIncident).toHaveBeenCalledWith("inc-14")
  })

  it("names an unknown number instead of guessing", async () => {
    const { user, onOpenIncident } = setup()
    await user.type(input(), "99 tlf")
    expect(within(preview()).getByText("Kein Einsatz 99")).toBeInTheDocument()
    await user.keyboard("{Enter}")
    expect(onOpenIncident).not.toHaveBeenCalled()
    expect(input()).toBeInTheDocument()
  })

  it("a viewer sees the preview but cannot run it", async () => {
    const { user } = setup({ onDispatch: undefined })
    await user.type(input(), "14 tlf")
    expect(within(preview()).getByText("Nur mit Bearbeitungsrecht")).toBeInTheDocument()
    await user.keyboard("{Enter}")
    expect(input()).toBeInTheDocument()
  })
})

describe("CommandPalette — the existing list keeps working", () => {
  it("filters the ordinary commands as before when the text is no dispatch", async () => {
    const { user } = setup()
    await user.type(input(), "karten")
    expect(screen.queryByTestId("dispatch-preview")).not.toBeInTheDocument()
    expect(screen.getByRole("option", { name: /Karten-Ansicht/ })).toBeInTheDocument()
  })

  it("has no dispatch block where the board registered no vocabulary", async () => {
    handlers = {}
    renderWithIntl(<CommandPalette />)
    act(() => openCommandPalette())
    const user = userEvent.setup()
    await user.type(input(), "14 tlf")
    expect(screen.queryByTestId("dispatch-preview")).not.toBeInTheDocument()
    expect(input()).toHaveAttribute("placeholder", "Befehl suchen …")
  })
})
