/**
 * Routen-Editor tests.
 *
 * Rendering the full RoutenEditorModal is impractical in jsdom — it require()s
 * leaflet, react-leaflet, leaflet CSS and images behind an `isClient` guard, none
 * of which mount under jsdom. Per the plan, the modal's substance is tested where
 * it actually lives:
 *   1. "Reihenfolge optimieren" — the pure greedy nearest-neighbour in
 *      `useRoutePlanning.optimize` (+ `route-geo`), driven through the hook.
 *   2. Reorder-persist + the resource drop contract — via `RouteStopList`, the
 *      shared list the modal renders on its right-hand side.
 * pragmatic-drag-and-drop is mocked so we can capture and invoke the monitor /
 * drop-target callbacks deterministically instead of simulating a jsdom drag.
 */

import { describe, expect, it, vi, beforeEach } from "vitest"
import { renderHook, render, waitFor } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import de from "@/messages/de.json"

import type { Operation } from "@/lib/contexts/operations-context"

// --- Fixtures ---------------------------------------------------------------

const UNLOCATED: [number, number] = [47.51637699933488, 7.561800450458299]

// Points on a line (lat 0, varying lng) so nearest-neighbour order is obvious.
const COORDS: Record<string, [number, number]> = {
  A: [0, 0],
  B: [0, 3],
  C: [0, 1],
  D: [0, 2],
  E: UNLOCATED, // sentinel → unlocated, sinks to the end
}

const makeOp = (id: string): Operation =>
  ({ id, location: `Stop ${id}`, status: "incoming", coordinates: COORDS[id], vehicles: [], crew: [] }) as unknown as Operation

// --- Mocks for the useRoutePlanning hook ------------------------------------

const rp = vi.hoisted(() => ({
  groups: [] as unknown[],
  operations: [] as unknown[],
  settings: {} as Record<string, string>,
  positions: [] as unknown[],
}))
const reorderGroupStops = vi.hoisted(() => vi.fn(async () => true))
const refreshGroups = vi.hoisted(() => vi.fn(async () => {}))
const createOperation = vi.hoisted(() => vi.fn())
const refreshOperations = vi.hoisted(() => vi.fn(async () => {}))

vi.mock("@/lib/contexts/groups-context", () => ({
  useGroups: () => ({ groups: rp.groups, reorderGroupStops, refreshGroups }),
}))
vi.mock("@/lib/contexts/operations-context", () => ({
  useOperations: () => ({ operations: rp.operations, createOperation, refreshOperations }),
}))
vi.mock("@/lib/api-client", () => ({
  apiClient: {
    getAllSettings: async () => rp.settings,
    getVehiclePositions: async () => rp.positions,
  },
}))
vi.mock("@/lib/geocoding", () => ({ reverseGeocode: vi.fn(async () => "Adresse") }))

// pragmatic-dnd capture harness (shared by the RouteStopList tests below).
const dnd = vi.hoisted(() => ({
  monitorOnDrop: null as null | ((args: unknown) => void),
  dropTargets: [] as { getData: (arg: unknown) => unknown }[],
}))
vi.mock("@atlaskit/pragmatic-drag-and-drop/element/adapter", () => ({
  draggable: () => () => {},
  dropTargetForElements: (opts: { getData: (arg: unknown) => unknown }) => {
    dnd.dropTargets.push(opts)
    return () => {}
  },
  monitorForElements: (opts: { onDrop: (args: unknown) => void }) => {
    dnd.monitorOnDrop = opts.onDrop
    return () => {}
  },
}))
vi.mock("@atlaskit/pragmatic-drag-and-drop/combine", () => ({
  combine: (...cleanups: (() => void)[]) => () => cleanups.forEach((c) => c?.()),
}))
vi.mock("@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge", () => ({
  // Pass the data straight through so getData() returns the raw drop payload.
  attachClosestEdge: (data: unknown) => data,
  // Deterministic edge for the reorder computation.
  extractClosestEdge: () => "top",
}))
vi.mock("@atlaskit/pragmatic-drag-and-drop-react-drop-indicator/box", () => ({
  DropIndicator: () => null,
}))

import { useRoutePlanning } from "@/lib/hooks/use-route-planning"
import { RouteStopList } from "@/components/map/route-stop-list"

beforeEach(() => {
  rp.groups = []
  rp.operations = []
  rp.settings = {}
  rp.positions = []
  reorderGroupStops.mockClear()
  dnd.monitorOnDrop = null
  dnd.dropTargets = []
})

// --- optimize (nearest-neighbour) -------------------------------------------

describe("useRoutePlanning.optimize", () => {
  it("greedy nearest-neighbour from the first stop; unlocated stops sink to the end", async () => {
    rp.groups = [{ id: "g1", stopIds: ["A", "B", "E", "C", "D"], mode: "squad" }]
    rp.operations = ["A", "B", "C", "D", "E"].map(makeOp)

    const { result } = renderHook(() => useRoutePlanning("g1"))
    await waitFor(() => expect(result.current.group).toBeDefined())

    // Located NN from A[0,0]: A→C→D→B, then the unlocated E appended last.
    expect(result.current.optimize("first")).toEqual(["A", "C", "D", "B", "E"])
  })

  it("re-sorts from the Magazin anchor when station coords are configured", async () => {
    rp.groups = [{ id: "g1", stopIds: ["B", "D", "A", "C"], mode: "squad" }]
    rp.operations = ["A", "B", "C", "D"].map(makeOp)
    rp.settings = { "gps.station_lat": "0", "gps.station_lng": "-1" }

    const { result } = renderHook(() => useRoutePlanning("g1"))
    await waitFor(() => expect(result.current.magazinCoords).not.toBeNull())

    // From [0,-1]: nearest is A, then C, D, B.
    expect(result.current.optimize("magazin")).toEqual(["A", "C", "D", "B"])
  })

  it("returns the order unchanged when there is at most one located stop", async () => {
    rp.groups = [{ id: "g1", stopIds: ["A", "E"], mode: "squad" }]
    rp.operations = [makeOp("A"), makeOp("E")]

    const { result } = renderHook(() => useRoutePlanning("g1"))
    await waitFor(() => expect(result.current.group).toBeDefined())

    expect(result.current.optimize("first")).toEqual(["A", "E"])
  })

  it("reorder() persists the new order via reorderGroupStops", async () => {
    rp.groups = [{ id: "g1", stopIds: ["A", "B", "C"], mode: "squad" }]
    rp.operations = ["A", "B", "C"].map(makeOp)

    const { result } = renderHook(() => useRoutePlanning("g1"))
    await waitFor(() => expect(result.current.group).toBeDefined())

    await result.current.reorder(["C", "A", "B"])
    expect(reorderGroupStops).toHaveBeenCalledWith("g1", ["C", "A", "B"])
  })
})

// --- RouteStopList (the list the modal renders) -----------------------------

function renderList(props: Partial<React.ComponentProps<typeof RouteStopList>> = {}) {
  const onReorder = vi.fn()
  const stopIds = props.stopIds ?? ["A", "B", "C"]
  const operationsById = new Map(["A", "B", "C"].map((id) => [id, makeOp(id)]))
  render(
    <NextIntlClientProvider locale="de" messages={de} timeZone="Europe/Zurich">
      <RouteStopList
        groupId="g1"
        stopIds={stopIds}
        displayOrder={props.displayOrder ?? stopIds}
        operationsById={operationsById}
        changedPositions={new Set()}
        reorderDisabled={false}
        onReorder={onReorder}
        focusStopId={null}
        onSelectStop={() => {}}
        enabled
        {...props}
      />
    </NextIntlClientProvider>,
  )
  return { onReorder }
}

describe("RouteStopList — reorder persistence", () => {
  it("computes the new order and calls onReorder when a route-stop-drag drops on a stop", () => {
    const { onReorder } = renderList({ stopIds: ["A", "B", "C"] })
    expect(dnd.monitorOnDrop).toBeTypeOf("function")

    // Drag B onto A (edge 'top' via the extractClosestEdge mock) → [B, A, C].
    dnd.monitorOnDrop!({
      source: { data: { type: "route-stop-drag", groupId: "g1", incidentId: "B" } },
      location: {
        current: {
          dropTargets: [{ data: { type: "group-stop", groupId: "g1", incidentId: "A" } }],
        },
      },
    })

    expect(onReorder).toHaveBeenCalledWith(["B", "A", "C"])
  })
})

describe("RouteStopList — resource drop contract", () => {
  it("each stop row exposes a { type: 'group-stop', groupId, incidentId } drop target", () => {
    renderList({ stopIds: ["A", "B", "C"] })
    expect(dnd.dropTargets.length).toBeGreaterThan(0)

    // getData() returns the payload a dropped vehicle/person is matched against by
    // the page-level useKanbanDragDrop monitor to assign the resource to that stop.
    const shapes = dnd.dropTargets.map((d) => d.getData({ input: {}, element: {} }))
    expect(shapes).toContainEqual(
      expect.objectContaining({ type: "group-stop", groupId: "g1", incidentId: "A" }),
    )
    expect(shapes).toContainEqual(
      expect.objectContaining({ type: "group-stop", groupId: "g1", incidentId: "B" }),
    )
  })
})
