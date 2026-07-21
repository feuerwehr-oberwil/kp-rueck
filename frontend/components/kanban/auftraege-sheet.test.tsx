import { describe, expect, it, vi, beforeEach } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { renderWithIntl } from "@/test-utils/render-with-intl"

import type { IncidentGroup } from "@/lib/types/groups"

// --- Fixtures ---------------------------------------------------------------

const grp = (overrides: Partial<IncidentGroup> = {}): IncidentGroup => ({
  id: "g1",
  eventId: "e1",
  name: "Sturm-Route West",
  color: "#ef4444",
  mode: "squad",
  notes: null,
  position: 0,
  createdAt: new Date("2026-07-21"),
  updatedAt: new Date("2026-07-21"),
  createdBy: null,
  stopIds: [],
  progress: { total: 0, done: 0 },
  ...overrides,
})

// Loose Operation stub — the sheet only reads id/location/status/vehicles/crew.
const op = (id: string, status: string, location: string, extra: Record<string, unknown> = {}) =>
  ({ id, status, location, vehicles: [], crew: [], ...extra }) as unknown as Record<string, unknown>

// --- Mocks ------------------------------------------------------------------

// Mutable state the mocked hooks read from, re-seeded per test.
const state = vi.hoisted(() => ({ groups: [] as unknown[], operations: [] as unknown[] }))

const createGroup = vi.hoisted(() => vi.fn())
const updateGroup = vi.hoisted(() => vi.fn())
const deleteGroup = vi.hoisted(() => vi.fn())
const reorderGroupStops = vi.hoisted(() => vi.fn())
const removeStop = vi.hoisted(() => vi.fn())
const copySquad = vi.hoisted(() => vi.fn())
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
    copySquad,
    refreshGroups: vi.fn(),
    reorderGroups: vi.fn(),
    addStops: vi.fn(),
  }),
}))
vi.mock("@/lib/contexts/operations-context", () => ({
  useOperations: () => ({ operations: state.operations, updateOperation }),
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
      onAssignResource={noop}
      onOpenDetail={noop}
      onOpenRoutenEditor={noop}
      {...overrides}
    />,
  )
}

beforeEach(() => {
  state.groups = []
  state.operations = []
  createGroup.mockReset().mockResolvedValue(grp({ id: "new" }))
  updateGroup.mockReset().mockResolvedValue(true)
  deleteGroup.mockReset()
  reorderGroupStops.mockReset()
  removeStop.mockReset()
  copySquad.mockReset().mockResolvedValue({ copied: 3, skipped: 1 })
  updateOperation.mockReset()
  toastSuccess.mockReset()
})

describe("AuftraegeSheet — derived checklist + progress", () => {
  it("renders offen/läuft/erledigt per stop status and progress as done/total", async () => {
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

    // Expand the card to reveal the checklist.
    await user.click(screen.getByRole("button", { name: "Auftrag auf-/zuklappen" }))

    expect(await screen.findByText("Baum Hauptstr. 12")).toBeInTheDocument()
    expect(screen.getByText("Keller Ringstr. 8")).toBeInTheDocument()
    expect(screen.getByText("Ast Bahnhofstr. 2")).toBeInTheDocument()

    // Derived per-stop state labels (each status appears exactly once).
    expect(screen.getByText("erledigt")).toBeInTheDocument()
    expect(screen.getByText("läuft")).toBeInTheDocument()
    expect(screen.getByText("offen")).toBeInTheDocument()
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

describe("AuftraegeSheet — copy to all stops", () => {
  it("calls copySquad with the source stop + selected types and toasts the result", async () => {
    state.groups = [grp({ stopIds: ["i1", "i2"], mode: "squad" })]
    state.operations = [op("i1", "active", "Stop 1"), op("i2", "incoming", "Stop 2")]
    const user = userEvent.setup()
    renderSheet()

    await user.click(screen.getByRole("button", { name: "Auftrag auf-/zuklappen" }))
    await user.click(await screen.findByRole("button", { name: /Auf alle übernehmen/ }))

    // Popover confirm.
    const confirm = await screen.findByRole("button", { name: "Übernehmen" })
    await user.click(confirm)

    await waitFor(() => expect(copySquad).toHaveBeenCalledTimes(1))
    // squad mode → all three resource types pre-checked; source = first stop.
    expect(copySquad).toHaveBeenCalledWith("g1", "i1", ["vehicle", "personnel", "material"])
    expect(toastSuccess).toHaveBeenCalledWith("Auf 3 Stops übernommen · 1 bereits zugewiesen")
  })
})

describe("AuftraegeSheet — mode toggle", () => {
  it("calls updateGroup({ mode }) when switching to 'Nur Fahrzeug'", async () => {
    state.groups = [grp({ stopIds: ["i1"], mode: "squad" })]
    state.operations = [op("i1", "incoming", "Stop 1")]
    const user = userEvent.setup()
    renderSheet()

    await user.click(screen.getByRole("button", { name: "Nur Fahrzeug" }))

    expect(updateGroup).toHaveBeenCalledWith("g1", { mode: "vehicle_only" })
  })

  it("vehicle_only mode defaults the copy picker to vehicle-only", async () => {
    state.groups = [grp({ stopIds: ["i1", "i2"], mode: "vehicle_only" })]
    state.operations = [op("i1", "active", "Stop 1"), op("i2", "incoming", "Stop 2")]
    const user = userEvent.setup()
    renderSheet()

    await user.click(screen.getByRole("button", { name: "Auftrag auf-/zuklappen" }))
    await user.click(await screen.findByRole("button", { name: /Auf alle übernehmen/ }))
    await user.click(await screen.findByRole("button", { name: "Übernehmen" }))

    await waitFor(() => expect(copySquad).toHaveBeenCalledTimes(1))
    expect(copySquad).toHaveBeenCalledWith("g1", "i1", ["vehicle"])
  })
})
