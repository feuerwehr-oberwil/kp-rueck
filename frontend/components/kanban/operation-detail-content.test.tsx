import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"
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
vi.mock("@/lib/api-client", () => ({
  apiClient: {
    getVehicles,
    getIncidents: vi.fn().mockResolvedValue([]),
    transferAssignments,
    updateAssignment: vi.fn(),
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
vi.mock("@/components/reko/reko-report-section", () => ({ default: () => <div>Reko-Meldungen</div> }))
vi.mock("@/components/kanban/schadenplatz-rapport-section", () => ({
  SchadenplatzRapportSection: () => <div>Schadenplatz-Rapport-Formular</div>,
}))
vi.mock("@/components/kanban/incident-timeline-popover", () => ({ IncidentTimelinePopover: () => <div>Verlauf</div> }))
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

beforeEach(() => {
  refreshOperations.mockClear()
  transferAssignments.mockClear()
  getVehicles.mockClear()
  getVehicles.mockResolvedValue([])
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
    expect(screen.getByText("incident-1")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Koordinaten löschen" }))
    expect(onUpdate).toHaveBeenCalledWith({ coordinates: null })

    await user.click(screen.getByRole("button", { name: "Disponiert / Anfahrt" }))
    expect(onChangeStatus).toHaveBeenCalledWith("incident-1", "enroute")

    await user.click(tab("Ressourcen"))
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

    // The action footer sits outside the tabs and stays reachable from any of them.
    await user.click(screen.getByRole("button", { name: "Ressourcen übertragen" }))
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
    expect(screen.queryByRole("button", { name: "Ressourcen übertragen" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Löschen" })).not.toBeInTheDocument()
    expect(screen.getByText("Adresse ändern").parentElement).toHaveAttribute("data-initial-geocode", "false")
    await user.click(screen.getByRole("button", { name: "Adresse ändern" }))
    await user.click(screen.getByRole("button", { name: "Koordinaten löschen" }))
    expect(onUpdate).not.toHaveBeenCalled()

    await user.click(tab("Ressourcen"))
    expect(screen.getByText("Reko Eins")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Alle offenen Rekos übertragen" })).not.toBeInTheDocument()
  })

  it("opens on Übersicht and swaps the panel when another tab is picked", async () => {
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

    // The header stays above the tab bar and is never swapped out.
    expect(screen.getByText("Hauptstrasse 1")).toBeInTheDocument()
    expect(tab("Übersicht")).toHaveAttribute("aria-selected", "true")
    expect(screen.getByRole("textbox", { name: "Meldung" })).toBeInTheDocument()
    expect(screen.queryByText("Zugewiesene Ressourcen")).not.toBeInTheDocument()
    // The Rapport panel is force-mounted for its form state, so it must be
    // hidden rather than absent.
    expect(screen.getByText("Reko-Meldungen")).not.toBeVisible()

    await user.click(tab("Ressourcen"))
    expect(tab("Ressourcen")).toHaveAttribute("aria-selected", "true")
    expect(screen.getByText("Zugewiesene Ressourcen")).toBeInTheDocument()
    expect(screen.queryByRole("textbox", { name: "Meldung" })).not.toBeInTheDocument()

    await user.click(tab("Rapport"))
    expect(screen.getByText("Reko-Meldungen")).toBeVisible()
    expect(screen.getByText("Schadenplatz-Rapport-Formular")).toBeVisible()
    expect(screen.getByText("Feldmeldungen")).toBeVisible()
    expect(screen.queryByText("Zugewiesene Ressourcen")).not.toBeInTheDocument()

    await user.click(tab("Verlauf"))
    expect(screen.getByText("Bisher im Einsatz")).toBeInTheDocument()
    expect(screen.getByText("Reko-Meldungen")).not.toBeVisible()
  })

  it("carries the assigned-resource count and the filed-rapport state in the tab labels", () => {
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

    expect(tab(/^Ressourcen/)).toHaveAccessibleName("Ressourcen 4")
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

    expect(tab(/^Ressourcen/)).toHaveAccessibleName("Ressourcen")
    expect(tab(/^Rapport/)).toHaveAccessibleName("Rapport")
  })

  it("brings the owning tab forward when a shortcut targets a control on another one", async () => {
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
    expect(tab("Übersicht")).toHaveAttribute("aria-selected", "true")

    // "0" toggles zu Fuss — the chip and the quick-assign list live on Ressourcen.
    fireEvent.keyDown(window, { key: "0" })
    await waitFor(() => expect(tab(/^Ressourcen/)).toHaveAttribute("aria-selected", "true"))

    // Shift+1..3 sets the priority, which is a control on Übersicht.
    fireEvent.keyDown(window, { key: "3", shiftKey: true })
    await waitFor(() => expect(tab("Übersicht")).toHaveAttribute("aria-selected", "true"))

    // "1".."5" assign the Nth quick-assign vehicle — Ressourcen again, but only
    // while that many vehicles actually exist.
    fireEvent.keyDown(window, { key: "2" })
    await waitFor(() => expect(tab(/^Ressourcen/)).toHaveAttribute("aria-selected", "true"))

    fireEvent.keyDown(window, { key: "3", shiftKey: true })
    await waitFor(() => expect(tab("Übersicht")).toHaveAttribute("aria-selected", "true"))
    fireEvent.keyDown(window, { key: "5" })
    expect(tab("Übersicht")).toHaveAttribute("aria-selected", "true")
  })

  it("leaves the tab alone when the operator is typing", async () => {
    renderWithIntl(
      <OperationDetailContent operation={operation} layout="modal" materials={[]} onUpdate={vi.fn()} />,
    )

    const meldung = screen.getByRole("textbox", { name: "Meldung" })
    fireEvent.keyDown(meldung, { key: "0" })
    expect(tab("Übersicht")).toHaveAttribute("aria-selected", "true")
  })
})
