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
/** One input event instead of one per key: the palette re-renders its whole list
 *  per keystroke, which under jsdom costs seconds for a short line. */
async function typeIn(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.click(input())
  await user.paste(text)
}
const preview = () => screen.getByTestId("dispatch-preview")

describe("CommandPalette — type-to-dispatch preview", () => {
  beforeEach(() => {
    handlers = {}
  })

  it("shows what ↵ will do as chips, and does nothing before ↵", async () => {
    const { user, onDispatch } = setup()
    await typeIn(user, "14 tlf muster")

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

  it("asks «meintest du?» for a typo before putting anybody on an Einsatz", async () => {
    const { user, onDispatch } = setup()
    await typeIn(user, "14 mustr")
    expect(within(preview()).getByText("meintest du?")).toBeInTheDocument()
    await user.keyboard("{Enter}")
    expect(onDispatch).not.toHaveBeenCalled()
    await user.click(screen.getByRole("option", { name: /Muster Peter/ }))
    await user.keyboard("{Enter}")
    expect(onDispatch).toHaveBeenCalledTimes(1)
  })

  it("shows status and priority as their own chips", async () => {
    const { user } = setup()
    await typeIn(user, "14 einsatz hoch")
    const row = preview()
    expect(within(row).getByText("Im Einsatz")).toBeInTheDocument()
    expect(within(row).getByText("Hoch")).toBeInTheDocument()
  })

  it("greys a word it does not know", async () => {
    const { user } = setup()
    await typeIn(user, "14 tlf xyzzy")
    const grey = preview().querySelector('[data-dispatch-token="grey"]')
    expect(grey).toHaveTextContent("xyzzy")
  })

  it("says when a resource is already there", async () => {
    const { user } = setup()
    await typeIn(user, "14 meier hans")
    expect(within(preview()).getByText(/schon da/)).toBeInTheDocument()
  })

  it("offers choices for an ambiguous name and runs nothing until one is picked", async () => {
    const { user, onDispatch } = setup()
    await typeIn(user, "14 meier tlf")

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
    await typeIn(user, "meier hans")
    expect(within(preview()).getByText("zeigen")).toBeInTheDocument()
    await user.keyboard("{Enter}")
    expect(onDispatchJump).toHaveBeenCalledWith(expect.objectContaining({ id: "p-meier-hans" }))
    expect(onDispatch).not.toHaveBeenCalled()
  })

  it("«14» alone opens the Einsatz", async () => {
    const { user, onOpenIncident } = setup()
    await typeIn(user, "14")
    expect(within(preview()).getByText("öffnen")).toBeInTheDocument()
    await user.keyboard("{Enter}")
    expect(onOpenIncident).toHaveBeenCalledWith("inc-14")
  })

  it("names an unknown number instead of guessing", async () => {
    const { user, onOpenIncident } = setup()
    await typeIn(user, "99 tlf")
    expect(within(preview()).getByText("Kein Einsatz 99")).toBeInTheDocument()
    await user.keyboard("{Enter}")
    expect(onOpenIncident).not.toHaveBeenCalled()
    expect(input()).toBeInTheDocument()
  })

  it("a viewer sees the preview but cannot run it", async () => {
    const { user } = setup({ onDispatch: undefined })
    await typeIn(user, "14 tlf")
    expect(within(preview()).getByText("Nur mit Bearbeitungsrecht")).toBeInTheDocument()
    await user.keyboard("{Enter}")
    expect(input()).toBeInTheDocument()
  })
})

describe("CommandPalette — the existing list keeps working", () => {
  // Words a command is named by must stay commands: a preview that cannot run
  // (no Einsatz number) or only guesses at a name ranks below them, so ↵ runs
  // the command the operator typed.
  const selected = () => screen.getAllByRole("option").find((option) => option.getAttribute("aria-selected") === "true")

  it("«neu» still opens a new Einsatz", async () => {
    const onNewOperation = vi.fn()
    const { user, onDispatch } = setup({ onNewOperation })
    await typeIn(user, "neu")
    // «neu» is also the status word «Eingegangen», but with no number the
    // preview can only ask for one: it ranks last (CommandRankGroups orders by
    // score) and ↵ runs the command.
    const options = screen.getAllByRole("option")
    expect(options.at(-1)).toHaveTextContent("Einsatznummer voranstellen")
    expect(selected()).toHaveTextContent("Neuer Einsatz")
    await user.keyboard("{Enter}")
    expect(onNewOperation).toHaveBeenCalledTimes(1)
    expect(onDispatch).not.toHaveBeenCalled()
  })

  it("«hoch» still sets the priority of the selected card", async () => {
    const onSetPriority = vi.fn()
    const { user } = setup({ onSetPriority, hasSelectedIncident: true })
    await typeIn(user, "hoch")
    expect(selected()).toHaveTextContent("Priorität: Hoch")
    await user.keyboard("{Enter}")
    expect(onSetPriority).toHaveBeenCalledWith("high")
  })

  it("«einsätze» still searches the Einsätze", async () => {
    const onFocusIncidentSearch = vi.fn()
    const { user } = setup({ onFocusIncidentSearch })
    await typeIn(user, "einsätze")
    expect(selected()).toHaveTextContent("Einsätze durchsuchen")
    await user.keyboard("{Enter}")
    expect(onFocusIncidentSearch).toHaveBeenCalledTimes(1)
  })

  it("an ambiguous name without a number does not take ↵ from a command", async () => {
    const onSearchPersonnel = vi.fn()
    const { user } = setup({ onSearchPersonnel })
    // «meier» fits two people → blocked; «Personal durchsuchen» does not match it,
    // so the only rows are the preview and its choices – and ↵ runs nothing.
    await typeIn(user, "meier")
    expect(screen.getByRole("option", { name: /Meier Anna/ })).toBeInTheDocument()
    await user.keyboard("{Enter}")
    expect(input()).toBeInTheDocument()
  })

  it("filters the ordinary commands as before when the text is no dispatch", async () => {
    const { user } = setup()
    await typeIn(user, "karten")
    expect(screen.queryByTestId("dispatch-preview")).not.toBeInTheDocument()
    expect(screen.getByRole("option", { name: /Karten-Ansicht/ })).toBeInTheDocument()
  })

  it("has no dispatch block where the board registered no vocabulary", async () => {
    handlers = {}
    renderWithIntl(<CommandPalette />)
    act(() => openCommandPalette())
    const user = userEvent.setup()
    await typeIn(user, "14 tlf")
    expect(screen.queryByTestId("dispatch-preview")).not.toBeInTheDocument()
    expect(input()).toHaveAttribute("placeholder", "Befehl suchen …")
  })
})
