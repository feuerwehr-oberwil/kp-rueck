import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { renderWithIntl } from "@/test-utils/render-with-intl"
import type { Operation } from "@/lib/contexts/operations-context"
import type { Person } from "@/lib/contexts/personnel-context"

const refreshOperations = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const transferAssignments = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const getVehicles = vi.hoisted(() => vi.fn().mockResolvedValue([]))
const sourcePerson = vi.hoisted((): Person => ({
  id: "person-1",
  name: "Reko Eins",
  role: "AdF",
  status: "assigned",
  roleSortOrder: 0,
  isReko: true,
}))

vi.mock("@/lib/contexts/operations-context", () => ({
  useOperations: () => ({
    formatLocation: (value: string) => value,
    setOperations: vi.fn(),
    refreshOperations,
  }),
}))
vi.mock("@/lib/contexts/event-context", () => ({
  useEvent: () => ({ selectedEvent: { id: "event-1" } }),
}))
vi.mock("@/lib/contexts/personnel-context", () => ({
  usePersonnel: () => ({ personnel: [sourcePerson] }),
}))
vi.mock("@/lib/contexts/materials-context", () => ({
  useMaterials: () => ({ materialGroups: [] }),
}))
vi.mock("@/lib/contexts/groups-context", () => ({
  useGroups: () => ({ groups: [], getGroupResources: vi.fn(), unassignResource: vi.fn() }),
}))
vi.mock("@/lib/hooks/use-vehicle-drivers", () => ({ useVehicleDrivers: () => new Map() }))
vi.mock("@/lib/hooks/use-reko-link-actions", () => ({
  useRekoLinkActions: () => ({
    copied: null,
    isCopying: false,
    copyDirectLink: vi.fn(),
    copyDashboardLink: vi.fn(),
  }),
}))
vi.mock("@/lib/hooks/use-whatsapp-copy", () => ({
  useWhatsAppCopy: () => ({ isCopying: false, copy: vi.fn() }),
}))
const getIncidentTimeline = vi.hoisted(() => vi.fn().mockResolvedValue({ events: [] }))
const getIncidentParticipants = vi.hoisted(() => vi.fn().mockResolvedValue({ participants: [] }))

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    getVehicles,
    getIncidents: vi.fn().mockResolvedValue([]),
    transferAssignments,
    updateAssignment: vi.fn(),
    getIncidentTimeline,
    getIncidentParticipants,
  },
}))
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }))
vi.mock("@/components/location/location-input", () => ({
  LocationInput: ({
    onAddressChange,
    onCoordinatesChange,
    geocodeInitialAddress,
  }: {
    onAddressChange: (address: string | null) => void
    onCoordinatesChange: (lat: number | null, lon: number | null) => void
    geocodeInitialAddress?: boolean
  }) => (
    <div data-initial-geocode={String(geocodeInitialAddress)}>
      <button onClick={() => onAddressChange("Neue Adresse")}>Adresse ändern</button>
      <button onClick={() => onCoordinatesChange(null, null)}>Koordinaten löschen</button>
    </div>
  ),
}))
// Renders its `dataSlot`: the Reko tab hands «Reko vor Ort» to the section so
// it lands in the data column, and a mock that dropped it would hide that.
vi.mock("@/components/reko/reko-report-section", () => ({
  default: ({ dataSlot }: { dataSlot?: ReactNode }) => (
    <div>
      Reko-Meldungen
      {dataSlot}
    </div>
  ),
}))
vi.mock("@/components/kanban/schadenplatz-rapport-section", () => ({
  // `applies` is the §18.27 gate. Surfaced on the node so the detail's own
  // tests can assert what it hands down without re-testing the section itself.
  SchadenplatzRapportSection: ({ applies }: { applies?: boolean }) => (
    <div data-testid="rapport-section" data-applies={String(applies)}>
      Schadenplatz-Rapport-Formular
    </div>
  ),
}))
vi.mock("@/components/incidents/transfer-incident-dialog", () => ({
  TransferIncidentDialog: ({ open, onTransfer }: { open: boolean; onTransfer: (id: string) => Promise<void> }) =>
    open ? <button onClick={() => onTransfer("incident-2")}>Transfer bestätigen</button> : null,
}))
vi.mock("@/components/incidents/assign-reko-dialog", () => ({ AssignRekoDialog: () => null }))
vi.mock("@/components/kanban/route-resource-sections", () => ({ RouteResourceSections: () => null }))
vi.mock("@/components/kanban/transfer-reko-dialog", () => ({
  TransferRekoDialog: ({ open, fromPerson }: { open: boolean; fromPerson: Person }) =>
    open ? <div>Event-Rekos von {fromPerson.name}</div> : null,
}))

import { OperationDetailContent } from "@/components/kanban/operation-detail-content"

const operation: Operation = {
  id: "incident-1",
  location: "Hauptstrasse 1",
  vehicle: null,
  vehicles: [],
  incidentType: "brand",
  dispatchTime: new Date(),
  crew: [],
  priority: "high",
  status: "incoming",
  coordinates: [47.1, 7.2],
  materials: [],
  notes: "Meldung",
  contact: "",
  contactPhone: "",
  internalNotes: "",
  nachbarhilfe: false,
  nachbarhilfeNote: "",
  amWarten: false,
  amWartenNote: "",
  zuFuss: false,
  groupId: null,
  groupPosition: 0,
  statusChangedAt: null,
  hasCompletedReko: false,
  rekoArrivedAt: null,
  rekoSummary: null,
  assignedReko: { id: sourcePerson.id, name: sourcePerson.name },
  leaderName: null,
  crewAssignments: new Map(),
  materialAssignments: new Map(),
  vehicleAssignments: new Map(),
  vehicleCallsigns: new Map(),
  vehicleDriverStay: new Map(),
}

const tab = (name: string | RegExp) => screen.getByRole("tab", { name })

// jsdom under Node 26 ships no localStorage, and the detail now remembers which
// tab each incident was left on. A Map-backed stub gives the tests the real
// code path AND a clean slate per test — without it, one test's tab click would
// decide the next test's opening tab.
const storage = new Map<string, string>()

beforeEach(() => {
  storage.clear()
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key),
    clear: () => storage.clear(),
  })
  refreshOperations.mockClear()
  transferAssignments.mockClear()
  getVehicles.mockClear()
  getVehicles.mockResolvedValue([])
  getIncidentTimeline.mockClear()
  getIncidentTimeline.mockResolvedValue({ events: [] })
  getIncidentParticipants.mockClear()
  getIncidentParticipants.mockResolvedValue({ participants: [] })
})

describe("OperationDetailContent", () => {
  it("uses canonical callbacks for coordinate clearing, status, and event-wide Reko transfer", async () => {
    const user = userEvent.setup()
    const onUpdate = vi.fn()
    const onChangeStatus = vi.fn()

    renderWithIntl(
      <OperationDetailContent
        operation={operation}
        layout="panel"
        materials={[]}
        onUpdate={onUpdate}
        onChangeStatus={onChangeStatus}
      />,
    )

    expect(screen.getByText("Hauptstrasse 1")).toBeInTheDocument()
    // The panel carries the incident id as the title's tooltip: 36 monospace
    // characters nobody reads aloud are not worth a line in 420px.
    expect(screen.getByText("Hauptstrasse 1").closest("h2")).toHaveAttribute(
      "title",
      "Hauptstrasse 1 · incident-1",
    )

    await user.click(screen.getByRole("button", { name: "Koordinaten löschen" }))
    expect(onUpdate).toHaveBeenCalledWith({ coordinates: null })

    await user.click(screen.getByRole("button", { name: "Disponiert / Anfahrt" }))
    expect(onChangeStatus).toHaveBeenCalledWith("incident-1", "enroute")

    // Resources live on Übersicht now — no tab switch to reach the Reko row.
    const transfer = screen.getByRole("button", { name: "Alle offenen Rekos übertragen" })
    expect(transfer).toHaveAttribute(
      "title",
      "Überträgt alle offenen Reko-Aufträge dieser Person im gesamten Event, nicht nur diesen Einsatz.",
    )
    await user.click(transfer)
    expect(screen.getByText("Event-Rekos von Reko Eins")).toBeInTheDocument()
  })

  it("closes the transfer dialog but keeps incident detail open after success", async () => {
    const user = userEvent.setup()

    renderWithIntl(
      <OperationDetailContent
        operation={operation}
        layout="modal"
        materials={[]}
        onUpdate={vi.fn()}
      />,
    )

    // The action footer sits outside the tabs and stays reachable from any of
    // them. Everything but «WhatsApp kopieren» lives behind ⋯ now — those
    // actions are rare here and already on the card's context menu.
    await user.click(screen.getByRole("button", { name: "Weitere Aktionen" }))
    await user.click(await screen.findByRole("menuitem", { name: "Ressourcen übertragen" }))
    const confirm = await screen.findByRole("button", { name: "Transfer bestätigen" })
    await user.click(confirm)

    await waitFor(() => expect(refreshOperations).toHaveBeenCalledOnce())
    expect(transferAssignments).toHaveBeenCalledWith("incident-1", "incident-2")
    expect(screen.queryByRole("button", { name: "Transfer bestätigen" })).not.toBeInTheDocument()
    expect(screen.getByTestId("operation-detail-content")).toBeInTheDocument()
  })

  it("keeps viewer details read-only while retaining non-mutating information", async () => {
    const user = userEvent.setup()
    const onUpdate = vi.fn()

    renderWithIntl(
      <OperationDetailContent
        operation={operation}
        layout="modal"
        active
        canEdit={false}
        materials={[]}
        onUpdate={onUpdate}
        onDelete={vi.fn()}
        onAssignResource={vi.fn()}
        onChangeStatus={vi.fn()}
      />,
    )

    expect(screen.getByRole("textbox", { name: "Meldung" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "WhatsApp kopieren" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Disponiert / Anfahrt" })).not.toBeInTheDocument()
    // A viewer's ⋯ menu holds none of the editing actions — so it is not
    // rendered as an empty menu either.
    await user.click(screen.getByRole("button", { name: "Weitere Aktionen" }))
    expect(screen.queryByRole("menuitem", { name: "Ressourcen übertragen" })).not.toBeInTheDocument()
    expect(screen.queryByRole("menuitem", { name: "Löschen" })).not.toBeInTheDocument()
    await user.keyboard("{Escape}")
    expect(screen.getByText("Adresse ändern").parentElement).toHaveAttribute("data-initial-geocode", "false")
    await user.click(screen.getByRole("button", { name: "Adresse ändern" }))
    await user.click(screen.getByRole("button", { name: "Koordinaten löschen" }))
    expect(onUpdate).not.toHaveBeenCalled()

    expect(screen.getByText("Reko Eins")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Alle offenen Rekos übertragen" })).not.toBeInTheDocument()
  })

  it("offers four tabs, with the incident and its resources on one of them", async () => {
    const user = userEvent.setup()

    renderWithIntl(
      <OperationDetailContent
        operation={operation}
        layout="modal"
        materials={[]}
        onUpdate={vi.fn()}
        onChangeStatus={vi.fn()}
      />,
    )

    // Ressourcen is gone as a tab — it is part of Übersicht. Reko has one of
    // its own: it is read while deciding what to send, not while reading what
    // the crew reported afterwards.
    expect(screen.getAllByRole("tab")).toHaveLength(4)
    expect(screen.queryByRole("tab", { name: /Ressourcen/ })).not.toBeInTheDocument()
    expect(tab("Reko")).toBeInTheDocument()

    // The header keeps the address and now carries the tab bar on the same row.
    expect(screen.getByText("Hauptstrasse 1")).toBeInTheDocument()
    expect(tab("Übersicht")).toHaveAttribute("aria-selected", "true")
    expect(screen.getByRole("textbox", { name: "Meldung" })).toBeInTheDocument()
    // ...and what used to cost a tab switch is on the same panel.
    expect(screen.getByText("Zugewiesene Ressourcen")).toBeInTheDocument()
    // The Rapport panel is force-mounted for its form state, so it must be
    // hidden rather than absent. Reko is a plain panel and simply absent.
    expect(screen.queryByText("Reko-Meldungen")).not.toBeInTheDocument()
    expect(screen.getByText("Schadenplatz-Rapport-Formular")).not.toBeVisible()

    // Reko has a tab of its own — read while deciding what to send, and it
    // carries the Funkmeldung that is about the reconnaissance.
    await user.click(tab("Reko"))
    expect(screen.getByText("Reko-Meldungen")).toBeVisible()
    expect(screen.getByText("Reko vor Ort")).toBeVisible()

    await user.click(tab(/^Rapport/))
    expect(screen.getByText("Schadenplatz-Rapport-Formular")).toBeVisible()
    // Two settable rows since plan 26 §5.2 — but they answer different
    // questions and now sit on different tabs: «Abholung nötig» is what this
    // Schadenplatz still needs, «Reko vor Ort» is part of the reconnaissance.
    // Angekommen and Einsatz beendet stay information in the thread, not switches.
    // With one row per tab the «Funkmeldungen» heading is gone: over a single
    // row it only repeats the row's own label.
    expect(screen.queryByText("Funkmeldungen")).not.toBeInTheDocument()
    expect(screen.getByText("Abholung nötig")).toBeVisible()
    expect(screen.queryByText("Reko vor Ort")).not.toBeInTheDocument()
    expect(screen.getByText("Meldungen vom Feld")).toBeVisible()
    expect(screen.queryByText("Zugewiesene Ressourcen")).not.toBeInTheDocument()

    await user.click(tab("Verlauf"))
    // Both lists, expanded, with no toggle to reveal them.
    expect(await screen.findByText("Bisher im Einsatz")).toBeInTheDocument()
    expect(screen.getByText("Statusänderungen, Zuweisungen und Meldungen")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Bisher im Einsatz/ })).not.toBeInTheDocument()
    expect(screen.queryByText("Reko-Meldungen")).not.toBeInTheDocument()
  })

  it("carries the filed-rapport state in the tab label", () => {
    renderWithIntl(
      <OperationDetailContent
        operation={{
          ...operation,
          crew: ["Muster Hans", "Muster Anna"],
          vehicles: ["TLF"],
          materials: ["mat-1"],
          hasSchadenplatzRapport: true,
        }}
        layout="modal"
        materials={[]}
        onUpdate={vi.fn()}
      />,
    )

    expect(tab(/^Rapport/)).toHaveAccessibleName("Rapport · erfasst")
  })

  it("says «Entwurf» for a rapport somebody started and walked away from", () => {
    // The state worth surfacing: 'nobody filed' and 'somebody half-filed' read
    // very differently at 02:00, and the second one is the actionable gap.
    renderWithIntl(
      <OperationDetailContent
        operation={{ ...operation, hasSchadenplatzRapportDraft: true }}
        layout="modal"
        materials={[]}
        onUpdate={vi.fn()}
      />,
    )

    expect(tab(/^Rapport/)).toHaveAccessibleName("Rapport · Entwurf")
  })

  it("stays quiet on the labels while nothing is assigned and no rapport was filed", () => {
    renderWithIntl(
      <OperationDetailContent operation={operation} layout="modal" materials={[]} onUpdate={vi.fn()} />,
    )

    expect(tab(/^Rapport/)).toHaveAccessibleName("Rapport")
  })

  // Generously timed: every tab switch re-mounts a panel that now holds the
  // whole incident plus its resources, and CI is slower than a laptop.
  it("brings Übersicht forward when a shortcut targets a control on it", async () => {
    const user = userEvent.setup()
    getVehicles.mockResolvedValue([
      { id: "v1", name: "TLF", type: "TLF", display_order: 1 },
      { id: "v2", name: "Pio", type: "Pio", display_order: 2 },
    ])

    renderWithIntl(
      <OperationDetailContent
        operation={operation}
        layout="modal"
        materials={[]}
        onUpdate={vi.fn()}
        onAssignVehicle={vi.fn()}
        onRemoveVehicle={vi.fn()}
      />,
    )

    await waitFor(() => expect(getVehicles).toHaveBeenCalled())

    // Every mutating shortcut now aims at a control on Übersicht: priority,
    // "zu Fuss" and the quick-assign fleet all sit there. Fired from another
    // tab, the operator must be shown the change.
    for (const key of [
      { key: "0" },
      { key: "3", shiftKey: true },
      { key: "2" },
    ]) {
      await user.click(tab("Verlauf"))
      expect(tab("Verlauf")).toHaveAttribute("aria-selected", "true")
      fireEvent.keyDown(window, key)
      await waitFor(() => expect(tab("Übersicht")).toHaveAttribute("aria-selected", "true"))
    }

    // A key that addresses a vehicle the station does not have is not ours.
    await user.click(tab("Verlauf"))
    fireEvent.keyDown(window, { key: "5" })
    expect(tab("Verlauf")).toHaveAttribute("aria-selected", "true")
  }, 20_000)

  it("walks the tabs with the arrow keys from anywhere in the detail", async () => {
    const user = userEvent.setup()

    renderWithIntl(
      <OperationDetailContent operation={operation} layout="modal" materials={[]} onUpdate={vi.fn()} />,
    )

    // The shortcut is signposted next to the tabs, not folklore.
    expect(screen.getByLabelText("Tab wechseln")).toBeInTheDocument()

    // Focus on a button, i.e. nowhere near the tab list: → still moves.
    const whatsapp = screen.getByRole("button", { name: "WhatsApp kopieren" })
    whatsapp.focus()
    fireEvent.keyDown(whatsapp, { key: "ArrowRight" })
    await waitFor(() => expect(tab("Reko")).toHaveAttribute("aria-selected", "true"))

    fireEvent.keyDown(whatsapp, { key: "ArrowRight" })
    await waitFor(() => expect(tab(/^Rapport/)).toHaveAttribute("aria-selected", "true"))

    fireEvent.keyDown(whatsapp, { key: "ArrowRight" })
    await waitFor(() => expect(tab("Verlauf")).toHaveAttribute("aria-selected", "true"))

    // No wrap-around: the last tab is the last tab.
    fireEvent.keyDown(whatsapp, { key: "ArrowRight" })
    expect(tab("Verlauf")).toHaveAttribute("aria-selected", "true")

    fireEvent.keyDown(whatsapp, { key: "ArrowLeft" })
    await waitFor(() => expect(tab(/^Rapport/)).toHaveAttribute("aria-selected", "true"))
    fireEvent.keyDown(whatsapp, { key: "ArrowLeft" })
    await waitFor(() => expect(tab("Reko")).toHaveAttribute("aria-selected", "true"))
    fireEvent.keyDown(whatsapp, { key: "ArrowLeft" })
    await waitFor(() => expect(tab("Übersicht")).toHaveAttribute("aria-selected", "true"))

    // A caret with nothing to its right has no move to make, so → is free...
    const meldung = screen.getByRole("textbox", { name: "Meldung" }) as HTMLTextAreaElement
    meldung.focus()
    meldung.setSelectionRange(meldung.value.length, meldung.value.length)
    fireEvent.keyDown(meldung, { key: "ArrowRight" })
    await waitFor(() => expect(tab("Reko")).toHaveAttribute("aria-selected", "true"))

    // ...while ← from that same caret is real cursor movement and stays with
    // the field. This is the rule that keeps a form-heavy tab usable without
    // swallowing the shortcut everywhere.
    await user.click(tab("Übersicht"))
    const meldungAgain = screen.getByRole("textbox", { name: "Meldung" }) as HTMLTextAreaElement
    meldungAgain.focus()
    meldungAgain.setSelectionRange(meldungAgain.value.length, meldungAgain.value.length)
    fireEvent.keyDown(meldungAgain, { key: "ArrowLeft" })
    expect(tab("Übersicht")).toHaveAttribute("aria-selected", "true")
  }, 20_000)

  it("walks the tabs with the arrow keys in the SIDE PANEL too, without taking the board's", async () => {
    renderWithIntl(
      <OperationDetailContent operation={operation} layout="panel" materials={[]} onUpdate={vi.fn()} />,
    )

    // The panel traps no focus and the kanban card that opened it is not
    // focusable, so nothing would put the keyboard in here on its own. The root
    // is a focus sink for exactly that reason — without it every arrow goes to
    // the board's horizontal scroll and the tabs are unreachable.
    const root = screen.getByTestId("operation-detail-content")
    await waitFor(() => expect(document.activeElement).toBe(root))

    fireEvent.keyDown(root, { key: "ArrowRight" })
    await waitFor(() => expect(tab("Reko")).toHaveAttribute("aria-selected", "true"))
    fireEvent.keyDown(root, { key: "ArrowRight" })
    await waitFor(() => expect(tab(/^Rapport/)).toHaveAttribute("aria-selected", "true"))
    fireEvent.keyDown(root, { key: "ArrowRight" })
    await waitFor(() => expect(tab("Verlauf")).toHaveAttribute("aria-selected", "true"))
    // Same no-wrap rule as the modal.
    fireEvent.keyDown(root, { key: "ArrowRight" })
    expect(tab("Verlauf")).toHaveAttribute("aria-selected", "true")
    fireEvent.keyDown(root, { key: "ArrowLeft" })
    await waitFor(() => expect(tab(/^Rapport/)).toHaveAttribute("aria-selected", "true"))

    // …and from a control inside the panel, not just from the root.
    const whatsapp = screen.getByRole("button", { name: "WhatsApp kopieren" })
    whatsapp.focus()
    fireEvent.keyDown(whatsapp, { key: "ArrowLeft" })
    await waitFor(() => expect(tab("Reko")).toHaveAttribute("aria-selected", "true"))
    fireEvent.keyDown(whatsapp, { key: "ArrowLeft" })
    await waitFor(() => expect(tab("Übersicht")).toHaveAttribute("aria-selected", "true"))

    // The board behind the panel is still live and Chrome spends an unclaimed
    // arrow scrolling it sideways. A keystroke from OUTSIDE the panel is the
    // board's, and the modal's "an ancestor counts" exception must not leak
    // here — <body> contains the panel, and honouring that would silently
    // delete the board's own arrow keys for as long as a card is selected.
    fireEvent.keyDown(document.body, { key: "ArrowRight" })
    expect(tab("Übersicht")).toHaveAttribute("aria-selected", "true")
  }, 20_000)

  it("offers no Schadenplatz-Rapport before the incident was disponiert", async () => {
    const user = userEvent.setup()
    const section = () => screen.getByTestId("rapport-section")

    const { rerender } = renderWithIntl(
      <OperationDetailContent operation={operation} layout="modal" materials={[]} onUpdate={vi.fn()} />,
    )
    await user.click(tab(/^Rapport/))
    // `incoming`, never dispatched: nothing to report on.
    expect(section()).toHaveAttribute("data-applies", "false")

    // Dragged into Disponiert — the rapport exists from that moment, without
    // waiting for the board's next refetch to bring `hasBeenDispatched` back.
    rerender(
      <OperationDetailContent
        operation={{ ...operation, status: "enroute" }}
        layout="modal"
        materials={[]}
        onUpdate={vi.fn()}
      />,
    )
    expect(section()).toHaveAttribute("data-applies", "true")

    // Closed again later: "ever", not "now" — most rapports are filed here.
    rerender(
      <OperationDetailContent
        operation={{ ...operation, status: "complete", hasBeenDispatched: true }}
        layout="modal"
        materials={[]}
        onUpdate={vi.fn()}
      />,
    )
    expect(section()).toHaveAttribute("data-applies", "true")

    // A card closed without anybody ever going out stays empty…
    rerender(
      <OperationDetailContent
        operation={{ ...operation, status: "complete" }}
        layout="modal"
        materials={[]}
        onUpdate={vi.fn()}
      />,
    )
    expect(section()).toHaveAttribute("data-applies", "false")

    // …unless a rapport was filed on it anyway. Written work is never hidden.
    rerender(
      <OperationDetailContent
        operation={{ ...operation, status: "complete", hasSchadenplatzRapportDraft: true }}
        layout="modal"
        materials={[]}
        onUpdate={vi.fn()}
      />,
    )
    expect(section()).toHaveAttribute("data-applies", "true")
  }, 20_000)

  it("reopens a Schadenplatz on the tab it was left on, per incident", async () => {
    const user = userEvent.setup()
    const render = () =>
      renderWithIntl(
        <OperationDetailContent operation={operation} layout="modal" materials={[]} onUpdate={vi.fn()} />,
      )

    const first = render()
    await user.click(tab("Verlauf"))
    expect(tab("Verlauf")).toHaveAttribute("aria-selected", "true")
    first.unmount()

    // Same incident, reopened: an operator working through the rapports of a
    // storm night must not be sent back to Übersicht on every visit.
    const second = render()
    expect(tab("Verlauf")).toHaveAttribute("aria-selected", "true")
    second.unmount()

    // A different Schadenplatz has its own answer, and has never been opened.
    const other = renderWithIntl(
      <OperationDetailContent
        operation={{ ...operation, id: "incident-2" }}
        layout="modal"
        materials={[]}
        onUpdate={vi.fn()}
      />,
    )
    expect(tab("Übersicht")).toHaveAttribute("aria-selected", "true")
    await user.click(tab(/^Rapport/))
    other.unmount()

    // ...and neither has forgotten the other.
    render()
    expect(tab("Verlauf")).toHaveAttribute("aria-selected", "true")
  }, 20_000)

  it("opens on the tab a notification is about, without repointing the card for good", async () => {
    const user = userEvent.setup()

    // The operator was last working in Verlauf on this card.
    storage.set("kp-rueck:incident-detail-tabs", JSON.stringify([["incident-1", "history"]]))

    // A "Rapport erfasst" notification: they clicked one specific thing.
    const fromBell = renderWithIntl(
      <OperationDetailContent
        operation={operation}
        layout="modal"
        materials={[]}
        onUpdate={vi.fn()}
        openOnTab={{ tab: "rapport", nonce: 1 }}
      />,
    )
    expect(tab(/^Rapport/)).toHaveAttribute("aria-selected", "true")
    fromBell.unmount()

    // Opened by hand afterwards: still Verlauf. The notification pointed at one
    // opening — it did not rewrite where this card lives.
    const byHand = renderWithIntl(
      <OperationDetailContent operation={operation} layout="modal" materials={[]} onUpdate={vi.fn()} />,
    )
    expect(tab("Verlauf")).toHaveAttribute("aria-selected", "true")
    // …and a tab the operator picks themselves IS remembered, as before.
    await user.click(tab("Übersicht"))
    byHand.unmount()

    renderWithIntl(
      <OperationDetailContent operation={operation} layout="modal" materials={[]} onUpdate={vi.fn()} />,
    )
    expect(tab("Übersicht")).toHaveAttribute("aria-selected", "true")
  }, 20_000)

  it("brings the tab forward again when the same notification is clicked twice", async () => {
    const user = userEvent.setup()

    const { rerender } = renderWithIntl(
      <OperationDetailContent
        operation={operation}
        layout="panel"
        materials={[]}
        onUpdate={vi.fn()}
        openOnTab={{ tab: "rapport", nonce: 1 }}
      />,
    )
    expect(tab(/^Rapport/)).toHaveAttribute("aria-selected", "true")

    // The operator wanders off to Verlauf; the panel stays mounted because the
    // incident has not changed.
    await user.click(tab("Verlauf"))
    expect(tab("Verlauf")).toHaveAttribute("aria-selected", "true")

    rerender(
      <OperationDetailContent
        operation={operation}
        layout="panel"
        materials={[]}
        onUpdate={vi.fn()}
        openOnTab={{ tab: "rapport", nonce: 2 }}
      />,
    )
    await waitFor(() => expect(tab(/^Rapport/)).toHaveAttribute("aria-selected", "true"))
  }, 20_000)

  it("falls back to Übersicht when a notification names a tab this detail has not got", () => {
    renderWithIntl(
      <OperationDetailContent
        operation={operation}
        layout="modal"
        materials={[]}
        onUpdate={vi.fn()}
        openOnTab={{ tab: "resources" as never, nonce: 1 }}
      />,
    )

    // Never an empty shell: the tab has to be one this detail actually renders.
    expect(tab("Übersicht")).toHaveAttribute("aria-selected", "true")
  })

  it("falls back to Übersicht when the remembered tab is one that no longer exists", () => {
    // «Ressourcen» was a tab until it was folded into Übersicht. A stored value
    // from that build must never leave an operator on a blank panel.
    storage.set("kp-rueck:incident-detail-tabs", JSON.stringify([["incident-1", "resources"]]))

    renderWithIntl(
      <OperationDetailContent operation={operation} layout="modal" materials={[]} onUpdate={vi.fn()} />,
    )

    expect(tab("Übersicht")).toHaveAttribute("aria-selected", "true")
  })

  it("shows what the crew radioed in — as a thread on Rapport and inside the Verlauf", async () => {
    const user = userEvent.setup()
    getIncidentTimeline.mockResolvedValue({
      events: [
        {
          event_type: "field_message",
          timestamp: "2026-08-09T21:20:00Z",
          actor_name: "Muster Hans",
          message: "Wasser steigt weiter",
          source: "feld",
        },
        {
          event_type: "field_message",
          timestamp: "2026-08-09T21:05:00Z",
          actor_name: "Muster Hans",
          message: "Pumpe läuft",
          source: "feld",
        },
        {
          event_type: "status_change",
          timestamp: "2026-08-09T20:00:00Z",
          actor_name: "Wache",
          from_status: "incoming",
          to_status: "active",
        },
      ],
    })

    renderWithIntl(
      <OperationDetailContent operation={operation} layout="modal" materials={[]} onUpdate={vi.fn()} />,
    )

    await user.click(tab(/^Rapport/))
    // Newest last, the way a thread reads.
    await waitFor(() =>
      expect(
        screen.getAllByText(/Pumpe läuft|Wasser steigt weiter/).map((node) => node.textContent),
      ).toEqual(["Pumpe läuft", "Wasser steigt weiter"]),
    )
    expect(screen.getAllByText(/vom Feld, Muster Hans/)).toHaveLength(2)

    // The same two messages sit in the Verlauf, among the status changes.
    await user.click(tab("Verlauf"))
    const verlauf = within(await screen.findByTestId("incident-timeline"))
    expect(verlauf.getByText("Pumpe läuft")).toBeInTheDocument()
    expect(verlauf.getByText("Wasser steigt weiter")).toBeInTheDocument()
    expect(verlauf.getByText("Eingegangen")).toBeInTheDocument()
  }, 20_000)

  it("leaves the tab alone when the operator is typing", async () => {
    renderWithIntl(
      <OperationDetailContent operation={operation} layout="modal" materials={[]} onUpdate={vi.fn()} />,
    )

    const meldung = screen.getByRole("textbox", { name: "Meldung" })
    fireEvent.keyDown(meldung, { key: "0" })
    expect(tab("Übersicht")).toHaveAttribute("aria-selected", "true")
  })
})
