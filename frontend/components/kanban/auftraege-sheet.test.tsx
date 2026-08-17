import { describe, expect, it, vi, beforeEach } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { renderWithIntl } from "@/test-utils/render-with-intl"

import type { GroupResources } from "@/lib/types/groups"
import type { IncidentGroup } from "@/lib/types/groups"

// --- Fixtures ---------------------------------------------------------------

const grp = (overrides: Partial<IncidentGroup> = {}): IncidentGroup => ({
  id: "g1",
  eventId: "e1",
  name: "Sturm-Route West",
  color: "#ef4444",
  notes: null,
  position: 0,
  createdAt: new Date("2026-07-21"),
  updatedAt: new Date("2026-07-21"),
  createdBy: null,
  stopIds: [],
  assignments: [],
  progress: { total: 0, done: 0 },
  lastAnnounced: null,
  ...overrides,
})

const emptyResources = (): GroupResources => ({ vehicles: [], personnel: [], materials: [] })

// Loose Operation stub — the sheet only reads id/location/status.
const op = (id: string, status: string, location: string, extra: Record<string, unknown> = {}) =>
  ({ id, status, location, vehicles: [], crew: [], ...extra }) as unknown as Record<string, unknown>

// --- Mocks ------------------------------------------------------------------

// Mutable state the mocked hooks read from, re-seeded per test.
const state = vi.hoisted(() => ({
  groups: [] as unknown[],
  operations: [] as unknown[],
  vehicleDrivers: new Map<string, string>(),
}))

const createGroup = vi.hoisted(() => vi.fn())
const updateGroup = vi.hoisted(() => vi.fn())
const deleteGroup = vi.hoisted(() => vi.fn())
const reorderGroupStops = vi.hoisted(() => vi.fn())
const removeStop = vi.hoisted(() => vi.fn())
const unassignResource = vi.hoisted(() => vi.fn())
const getGroupResources = vi.hoisted(() =>
  vi.fn(() => ({ vehicles: [], personnel: [], materials: [] }) as GroupResources),
)
const updateOperation = vi.hoisted(() => vi.fn())

vi.mock("@/lib/contexts/groups-context", () => ({
  useGroups: () => ({
    groups: state.groups,
    isLoaded: true,
    createGroup,
    updateGroup,
    deleteGroup,
    reorderGroupStops,
    removeStop,
    unassignResource,
    getGroupResources,
    refreshGroups: vi.fn(),
    reorderGroups: vi.fn(),
    addStops: vi.fn(),
    assignResource: vi.fn(),
    groupResourcesFor: vi.fn(() => ({ vehicles: [], personnel: [], materials: [] })),
  }),
}))
vi.mock("@/lib/contexts/operations-context", () => ({
  useOperations: () => ({
    operations: state.operations,
    updateOperation,
    createOperation: vi.fn(),
    refreshOperations: vi.fn(async () => {}),
    formatLocation: (address: string) => address,
  }),
}))

// The sheet now instantiates useRoutePlanning (for the in-row optimize action),
// which reads settings + vehicle GPS on mount — stub the API so no real fetch runs.
vi.mock("@/lib/api-client", () => ({
  apiClient: {
    getAllSettings: async () => ({}) as Record<string, string>,
    getVehiclePositions: async () => [],
    // No Standard-Aufträge configured: the Vorlagen row stays out of the way,
    // which is the state every assertion below is written against.
    getAuftragTemplates: async () => [],
  },
}))
vi.mock("@/lib/geocoding", () => ({ reverseGeocode: vi.fn(async () => "Adresse") }))

// The sheet resolves the event to look up who drives which Fahrzeug; the driver
// map itself is seeded per test through `state.vehicleDrivers`.
vi.mock("@/lib/contexts/event-context", () => ({
  useEvent: () => ({ selectedEvent: { id: "e1" } }),
}))
vi.mock("@/lib/hooks/use-vehicle-drivers", () => ({
  useVehicleDrivers: () => state.vehicleDrivers,
}))

// Force desktop layout (matchMedia is unimplemented in jsdom).
vi.mock("@/components/ui/use-mobile", () => ({ useIsMobile: () => false }))

// pragmatic-drag-and-drop is a no-op in jsdom: reorder/drop behaviour is covered
// by the routen-editor tests. Here we only need the sheet to mount cleanly.
vi.mock("@atlaskit/pragmatic-drag-and-drop/element/adapter", () => ({
  draggable: () => () => {},
  dropTargetForElements: () => () => {},
  monitorForElements: () => () => {},
}))
vi.mock("@atlaskit/pragmatic-drag-and-drop/combine", () => ({ combine: () => () => {} }))
vi.mock("@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge", () => ({
  attachClosestEdge: (data: unknown) => data,
  extractClosestEdge: () => null,
}))
vi.mock("@atlaskit/pragmatic-drag-and-drop-react-drop-indicator/box", () => ({
  DropIndicator: () => null,
}))

const toastSuccess = vi.fn()
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: vi.fn(), info: vi.fn() } }))

import { AuftraegeSheet } from "@/components/kanban/auftraege-sheet"

const noop = () => {}

function renderSheet(overrides: Partial<React.ComponentProps<typeof AuftraegeSheet>> = {}) {
  return renderWithIntl(
    <AuftraegeSheet
      open
      onOpenChange={noop}
      onAddStop={noop}
      onAssignRouteResource={noop}
      onOpenDetail={noop}
      onOpenRoutenEditor={noop}
      canEdit
      onSetStopStatus={noop}
      {...overrides}
    />,
  )
}

beforeEach(() => {
  state.groups = []
  state.operations = []
  state.vehicleDrivers = new Map()
  createGroup.mockReset().mockResolvedValue(grp({ id: "new" }))
  updateGroup.mockReset().mockResolvedValue(true)
  deleteGroup.mockReset()
  reorderGroupStops.mockReset()
  removeStop.mockReset()
  unassignResource.mockReset()
  getGroupResources.mockReset().mockReturnValue(emptyResources())
  updateOperation.mockReset()
  toastSuccess.mockReset()
})

describe("AuftraegeSheet — derived checklist + progress", () => {
  it("mirrors the board column per stop status and progress as done/total", async () => {
    state.groups = [grp({ stopIds: ["i1", "i2", "i3"] })]
    state.operations = [
      op("i1", "complete", "Baum Hauptstr. 12"),
      op("i2", "active", "Keller Ringstr. 8"),
      op("i3", "incoming", "Ast Bahnhofstr. 2"),
    ]
    const user = userEvent.setup()
    renderSheet()

    // Header roll-up: one of three stops is done.
    expect(screen.getByText("1/3 erledigt")).toBeInTheDocument()

    // Expand the card to reveal the checklist (whole header is the toggle).
    await user.click(screen.getByRole("button", { name: "Auftrag auf-/zuklappen" }))

    expect(await screen.findByText("Baum Hauptstr. 12")).toBeInTheDocument()
    expect(screen.getByText("Keller Ringstr. 8")).toBeInTheDocument()
    expect(screen.getByText("Ast Bahnhofstr. 2")).toBeInTheDocument()

    // Kanban-column mirror labels per stop status (each appears exactly once):
    // complete is distinct and terminal; active → Einsatz, incoming → Offen.
    expect(screen.getByText("Abgeschlossen")).toBeInTheDocument()
    expect(screen.getByText("Einsatz")).toBeInTheDocument()
    expect(screen.getByText("Offen")).toBeInTheDocument()
  })
})

describe("AuftraegeSheet — create", () => {
  it("calls createGroup after '+ Neuer Auftrag' and confirming the inline row", async () => {
    const user = userEvent.setup()
    renderSheet()

    await user.click(screen.getByRole("button", { name: /Neuer Auftrag/ }))

    const nameInput = await screen.findByPlaceholderText("Auftragsname")
    await user.clear(nameInput)
    await user.type(nameInput, "Sturm-Route West")
    await user.click(screen.getByRole("button", { name: "Erstellen" }))

    await waitFor(() => expect(createGroup).toHaveBeenCalledTimes(1))
    expect(createGroup).toHaveBeenCalledWith(expect.objectContaining({ name: "Sturm-Route West" }))
  })
})

describe("AuftraegeSheet — viewer", () => {
  it("keeps details and routes visible but hides every mutation", async () => {
    state.groups = [grp({ stopIds: ["i1"] })]
    state.operations = [op("i1", "incoming", "Hauptstr. 1")]
    const user = userEvent.setup()
    renderSheet({ canEdit: false })

    expect(screen.queryByRole("button", { name: /Neuer Auftrag/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Auftrag auf-/zuklappen" }))
    expect(screen.getByTitle("Karte")).toBeInTheDocument()
    expect(screen.queryByText("Stopp hinzufügen")).not.toBeInTheDocument()
    expect(screen.queryByTitle("Fahrzeug zuweisen")).not.toBeInTheDocument()
    expect(screen.queryByLabelText("Status wählen")).not.toBeInTheDocument()
  })
})

describe("AuftraegeSheet — Ressourcen (route-owned)", () => {
  it("lists assigned vehicles + personnel + material and unassigns on ✕", async () => {
    state.groups = [grp({ stopIds: [] })]
    getGroupResources.mockReturnValue({
      vehicles: [{ assignmentId: "va", resourceId: "v1", name: "TLF 1", driverStay: false }],
      personnel: [{ assignmentId: "pa", resourceId: "p1", name: "Muster Hans" }],
      materials: [{ assignmentId: "ma", resourceId: "m1", name: "Schlauch B" }],
    })
    const user = userEvent.setup()
    renderSheet()

    await user.click(screen.getByRole("button", { name: "Auftrag auf-/zuklappen" }))

    expect(await screen.findByText("TLF 1")).toBeInTheDocument()
    expect(screen.getByText("Muster Hans")).toBeInTheDocument()
    expect(screen.getByText("Schlauch B")).toBeInTheDocument()

    await user.click(screen.getByTitle("TLF 1 entfernen"))
    expect(unassignResource).toHaveBeenCalledWith("g1", "va")
  })

  it("names the driver on a route's Fahrzeug chip", async () => {
    state.groups = [grp({ stopIds: [] })]
    state.vehicleDrivers = new Map([["TLF 1", "Muster Hans"]])
    getGroupResources.mockReturnValue({
      vehicles: [{ assignmentId: "va", resourceId: "v1", name: "TLF 1", driverStay: false }],
      personnel: [],
      materials: [],
    })
    const user = userEvent.setup()
    renderSheet()

    await user.click(screen.getByRole("button", { name: "Auftrag auf-/zuklappen" }))

    expect(await screen.findByText("TLF 1 (Muster Hans)")).toBeInTheDocument()
  })

  it("assigns to the ROUTE even with zero stops", async () => {
    state.groups = [grp({ stopIds: [] })]
    const onAssignRouteResource = vi.fn()
    const user = userEvent.setup()
    renderSheet({ onAssignRouteResource })

    await user.click(screen.getByRole("button", { name: "Auftrag auf-/zuklappen" }))
    // The Ressourcen block now reuses the shared section UI: each "+ Hinzufügen"
    // button carries the assign action as its title (the visible label is generic).
    await user.click(await screen.findByTitle("Fahrzeug zuweisen"))

    expect(onAssignRouteResource).toHaveBeenCalledWith("vehicles", "g1")
  })
})
