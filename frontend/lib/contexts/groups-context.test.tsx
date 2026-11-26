// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest"
import { act, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"

import type { ApiGroupAssignment, ApiIncident, ApiIncidentGroup } from "@/lib/api-client"

// The Auftrag actions against the real board store: the routes load with the board
// snapshot and every action writes them under the board's one mutation epoch.

// --- Fixtures ---------------------------------------------------------------

const EVENT_ID = "11111111-1111-1111-1111-111111111111"
const GROUP_ID = "22222222-2222-2222-2222-222222222222"

const apiAssignment = (overrides: Partial<ApiGroupAssignment> = {}): ApiGroupAssignment => ({
  id: "a1",
  incident_group_id: GROUP_ID,
  resource_type: "vehicle",
  resource_id: "v1",
  assigned_at: "2026-07-21T00:00:00Z",
  unassigned_at: null,
  assigned_by: null,
  driver_stay: false,
  is_leader: false,
  ...overrides,
})

const apiGroup = (overrides: Partial<ApiIncidentGroup> = {}): ApiIncidentGroup => ({
  id: GROUP_ID,
  event_id: EVENT_ID,
  name: "Sturm-Route West",
  color: "#ef4444",
  notes: null,
  position: 0,
  created_at: "2026-07-21T00:00:00Z",
  updated_at: "2026-07-21T00:00:00Z",
  created_by: null,
  stop_ids: [],
  assignments: [],
  progress: { total: 0, done: 0 },
  last_announced_at: null,
  last_announced_fingerprint: null,
  last_announced_stop_id: null,
  last_announced_full: false,
  ...overrides,
})

// The fields a card needs; the rest of the wire row does not matter here.
const apiIncident = (id: string, overrides: Partial<ApiIncident> = {}): ApiIncident =>
  ({
    id,
    event_id: EVENT_ID,
    title: `Einsatz ${id}`,
    type: "elementarereignis",
    priority: "medium",
    location_address: `Hauptstrasse ${id}`,
    location_lat: null,
    location_lng: null,
    status: "incoming",
    description: "",
    created_at: "2026-07-21T00:00:00Z",
    updated_at: "2026-07-21T00:00:00Z",
    ...overrides,
  }) as ApiIncident

const TLF = { id: "v1", name: "TLF", radio_call_sign: null, display_order: 1, out_of_service: false }

// --- Mocks ------------------------------------------------------------------

// Stable objects: the sync effect keys off `selectedEvent` identity.
const authState = vi.hoisted(() => ({ isAuthenticated: true, loading: false }))
const eventState = vi.hoisted(() => ({
  selectedEvent: { id: "11111111-1111-1111-1111-111111111111" },
  isEventLoaded: true,
}))
vi.mock("@/lib/contexts/auth-context", () => ({ useAuth: () => authState }))
vi.mock("@/lib/contexts/event-context", () => ({ useEvent: () => eventState }))
vi.mock("@/components/ui/top-loading-bar", () => ({ topLoading: { start: () => {}, done: () => {} } }))

// A socket that reports "connected" (so the polling fallback never arms) and lets the test emit.
const ws = vi.hoisted(() => {
  const handlers = new Map<string, Set<(payload?: unknown) => void>>()
  return {
    reset: () => handlers.clear(),
    emit(event: string, payload?: unknown) {
      handlers.get(event)?.forEach((cb) => cb(payload))
    },
    client: {
      on(event: string, cb: (payload?: unknown) => void) {
        const set = handlers.get(event) ?? new Set()
        set.add(cb)
        handlers.set(event, set)
        return () => set.delete(cb)
      },
      onStatusChange: () => () => {},
      getStatus: () => "connected",
      connect: () => {},
      disconnect: () => {},
    },
  }
})
vi.mock("@/lib/websocket-client", () => ({ wsClient: ws.client }))

const api = vi.hoisted(() => ({
  // The board snapshot
  getSyncVersion: vi.fn(),
  getIncidentsWithTotal: vi.fn(),
  getAllPersonnel: vi.fn(),
  getAllMaterials: vi.fn(),
  getMaterialGroups: vi.fn(),
  getAllSettings: vi.fn(),
  getVehicles: vi.fn(),
  getEventRestliste: vi.fn(),
  getEventSpecialFunctions: vi.fn(),
  getAssignmentsByEvent: vi.fn(),
  getEventRekoSummaries: vi.fn(),
  getIncidentGroups: vi.fn(),
  // The Auftrag actions
  createIncidentGroup: vi.fn(),
  updateIncidentGroup: vi.fn(),
  reorderGroupStops: vi.fn(),
  addStopsToGroup: vi.fn(),
  assignGroupResource: vi.fn(),
  unassignGroupResource: vi.fn(),
}))
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  apiClient: api,
}))

const toastError = vi.hoisted(() => vi.fn())
vi.mock("sonner", () => ({ toast: { error: toastError, success: vi.fn(), info: vi.fn() } }))

import { ApiError } from "@/lib/api-client"
import { OperationsProvider, useOperations } from "@/lib/contexts/operations-context"
import { useGroups } from "@/lib/contexts/groups-context"

const wrapper = ({ children }: { children: ReactNode }) => <OperationsProvider>{children}</OperationsProvider>

beforeEach(() => {
  eventState.selectedEvent = { id: EVENT_ID }
  ws.reset()
  api.getSyncVersion.mockReset().mockResolvedValue({ version: "v1" })
  api.getIncidentsWithTotal.mockReset().mockResolvedValue({ incidents: [], total: 0 })
  api.getAllPersonnel.mockReset().mockResolvedValue([])
  api.getAllMaterials.mockReset().mockResolvedValue([])
  api.getMaterialGroups.mockReset().mockResolvedValue([])
  api.getAllSettings.mockReset().mockResolvedValue({ home_city: "" })
  api.getVehicles.mockReset().mockResolvedValue([TLF])
  api.getEventRestliste.mockReset().mockResolvedValue(null)
  api.getEventSpecialFunctions.mockReset().mockResolvedValue([])
  api.getAssignmentsByEvent.mockReset().mockResolvedValue({})
  api.getEventRekoSummaries.mockReset().mockResolvedValue({ summaries: {} })
  api.getIncidentGroups.mockReset().mockResolvedValue([])
  api.createIncidentGroup.mockReset()
  api.updateIncidentGroup.mockReset()
  api.reorderGroupStops.mockReset()
  api.addStopsToGroup.mockReset()
  api.assignGroupResource.mockReset()
  api.unassignGroupResource.mockReset()
  toastError.mockReset()
})

// Mount the board and wait for its first load.
async function renderLoaded() {
  const rendered = renderHook(() => ({ ...useGroups(), board: useOperations() }), { wrapper })
  await waitFor(() => expect(rendered.result.current.isLoaded).toBe(true))
  return rendered
}

/** The next Aufträge fetch hangs until the test answers it. */
function holdNextGroupsFetch() {
  let answer: (groups: ApiIncidentGroup[]) => void = () => {}
  api.getIncidentGroups.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)))
  return (groups: ApiIncidentGroup[]) => act(async () => answer(groups))
}

describe("Aufträge in the board snapshot", () => {
  it("load with the board, and a group_update reloads it", async () => {
    api.getIncidentGroups.mockResolvedValue([apiGroup()])
    const { result } = await renderLoaded()
    expect(result.current.groups.map((g) => g.name)).toEqual(["Sturm-Route West"])

    api.getIncidentGroups.mockResolvedValue([apiGroup({ name: "Nach WS" })])
    act(() => ws.emit("group_update", { action: "update", group_id: GROUP_ID }))
    await waitFor(() => expect(result.current.groups.map((g) => g.name)).toEqual(["Nach WS"]))
  })

  it("a route order set here is not turned back by a reload that read before it", async () => {
    api.getIncidentGroups.mockResolvedValue([apiGroup({ stop_ids: ["a", "b"] })])
    const { result } = await renderLoaded()
    const order = () => result.current.groups[0].stopIds

    // A reload is out and has already read the old order.
    const answerReload = holdNextGroupsFetch()
    act(() => ws.emit("incident_update"))
    await waitFor(() => expect(api.getIncidentGroups).toHaveBeenCalledTimes(2))
    api.reorderGroupStops.mockResolvedValue(undefined)
    await act(async () => {
      await result.current.reorderGroupStops(GROUP_ID, ["b", "a"])
    })

    await answerReload([apiGroup({ stop_ids: ["a", "b"] })])
    expect(order()).toEqual(["b", "a"])
  })

  it("a failed first load says so, and a refresh that gets through clears it", async () => {
    api.getIncidentGroups.mockRejectedValueOnce(new Error("offline"))
    const { result } = await renderLoaded()
    expect(result.current.loadFailed).toBe(true)

    api.getIncidentGroups.mockResolvedValue([apiGroup()])
    await act(async () => {
      await result.current.board.refreshOperations()
    })
    expect(result.current.loadFailed).toBe(false)
    expect(result.current.groups).toHaveLength(1)
  })
})

describe("createGroup", () => {
  it("adds a placeholder at once, then takes the server's row", async () => {
    const { result } = await renderLoaded()
    let resolveCreate: (g: ApiIncidentGroup) => void = () => {}
    api.createIncidentGroup.mockReturnValue(new Promise<ApiIncidentGroup>((resolve) => (resolveCreate = resolve)))

    let pending: Promise<unknown> = Promise.resolve()
    act(() => {
      pending = result.current.createGroup({ name: "Sturm-Route West", color: "#ef4444" })
    })
    expect(result.current.groups[0].id).toMatch(/^temp-/)

    await act(async () => {
      resolveCreate(apiGroup({ id: "99999999-9999-9999-9999-999999999999" }))
      await pending
    })
    expect(result.current.groups.map((g) => g.id)).toEqual(["99999999-9999-9999-9999-999999999999"])
  })

  it("rolls the placeholder back and toasts when the API refuses", async () => {
    const { result } = await renderLoaded()
    api.createIncidentGroup.mockRejectedValue(new Error("boom"))
    await act(async () => {
      await result.current.createGroup({ name: "Sturm-Route West", color: "#ef4444" })
    })
    expect(result.current.groups).toHaveLength(0)
    expect(toastError).toHaveBeenCalledTimes(1)
  })
})

describe("stop order", () => {
  it("does not send a newer order until the older request settles", async () => {
    api.getIncidentGroups.mockResolvedValue([apiGroup({ stop_ids: ["a", "b", "c"] })])
    const { result } = await renderLoaded()
    let resolveFirst = () => {}
    let resolveSecond = () => {}
    api.reorderGroupStops
      .mockReturnValueOnce(new Promise<void>((resolve) => (resolveFirst = resolve)))
      .mockReturnValueOnce(new Promise<void>((resolve) => (resolveSecond = resolve)))

    let first: Promise<boolean> = Promise.resolve(true)
    let second: Promise<boolean> = Promise.resolve(true)
    act(() => {
      first = result.current.reorderGroupStops(GROUP_ID, ["b", "a", "c"])
    })
    act(() => {
      second = result.current.reorderGroupStops(GROUP_ID, ["c", "b", "a"])
    })
    await waitFor(() => expect(api.reorderGroupStops).toHaveBeenCalledTimes(1))
    await act(async () => {
      resolveFirst()
      await first
    })
    expect(api.reorderGroupStops).toHaveBeenCalledTimes(2)
    await act(async () => {
      resolveSecond()
      await second
    })
    expect(result.current.groups[0].stopIds).toEqual(["c", "b", "a"])
  })

  it("an undo against a route somebody changed reports a conflict, quietly, and reloads", async () => {
    api.getIncidentGroups.mockResolvedValue([apiGroup({ stop_ids: ["b", "c", "a"] })])
    const { result } = await renderLoaded()
    const loads = api.getIncidentGroups.mock.calls.length
    api.reorderGroupStops.mockRejectedValueOnce(new ApiError("Auftrag wurde inzwischen geändert", 409, true))

    let outcome = ""
    await act(async () => {
      outcome = await result.current.restoreGroupStops(GROUP_ID, ["a", "b", "c"], ["c", "a", "b"])
    })

    expect(api.reorderGroupStops).toHaveBeenCalledWith(GROUP_ID, ["a", "b", "c"], ["c", "a", "b"])
    expect(outcome).toBe("conflict")
    expect(result.current.groups[0].stopIds).toEqual(["b", "c", "a"])
    await waitFor(() => expect(api.getIncidentGroups.mock.calls.length).toBeGreaterThan(loads))
    expect(toastError).not.toHaveBeenCalled()
  })
})

describe("#23 stop add for a vehicle", () => {
  it("calls an Auftrag the server no longer has «changed», quietly", async () => {
    api.getIncidentGroups.mockResolvedValue([apiGroup()])
    const { result } = await renderLoaded()
    api.addStopsToGroup.mockRejectedValueOnce(new ApiError("Auftrag nicht gefunden", 404))

    let outcome = ""
    await act(async () => {
      outcome = await result.current.addStopForVehicle(GROUP_ID, "op-1", "v1")
    })
    expect(outcome).toBe("changed")
    expect(toastError).not.toHaveBeenCalled()
  })

  it("calls an Auftrag this board already dropped «changed» without a request", async () => {
    const { result } = await renderLoaded()
    let outcome = ""
    await act(async () => {
      outcome = await result.current.addStopForVehicle(GROUP_ID, "op-1", "v1")
    })
    expect(outcome).toBe("changed")
    expect(api.addStopsToGroup).not.toHaveBeenCalled()
  })
})

describe("route resources", () => {
  it("assigns optimistically, then takes the server's row from the answer", async () => {
    api.getIncidentGroups.mockResolvedValue([apiGroup()])
    const { result } = await renderLoaded()
    api.assignGroupResource.mockResolvedValue(apiAssignment())

    await act(async () => {
      await result.current.assignResource(GROUP_ID, "vehicle", "v1")
    })
    expect(api.assignGroupResource).toHaveBeenCalledWith(GROUP_ID, { resource_type: "vehicle", resource_id: "v1" })
    expect(result.current.groups[0].assignments.map((a) => a.id)).toEqual(["a1"])
  })

  it("keeps an assignment whose placeholder a rename's answer dropped while the POST was out", async () => {
    api.getIncidentGroups.mockResolvedValue([apiGroup()])
    const { result } = await renderLoaded()
    let answerAssign: (row: ApiGroupAssignment) => void = () => {}
    api.assignGroupResource.mockImplementation(() => new Promise((resolve) => (answerAssign = resolve)))
    api.updateIncidentGroup.mockResolvedValue(apiGroup({ name: "Neu" }))

    let assigned: Promise<boolean> = Promise.resolve(true)
    act(() => {
      assigned = result.current.assignResource(GROUP_ID, "material", "m1")
    })
    await act(async () => {
      await result.current.updateGroup(GROUP_ID, { name: "Neu" })
    })
    await act(async () => {
      answerAssign(apiAssignment({ resource_type: "material", resource_id: "m1" }))
      await assigned
    })
    expect(result.current.groups[0].name).toBe("Neu")
    expect(result.current.groups[0].assignments.map((a) => a.id)).toEqual(["a1"])
  })

  it("keeps a confirmed assignment when an older rename answer lands after it", async () => {
    api.getIncidentGroups.mockResolvedValue([apiGroup()])
    const { result } = await renderLoaded()
    let answerRename: (g: ApiIncidentGroup) => void = () => {}
    api.updateIncidentGroup.mockImplementation(() => new Promise((resolve) => (answerRename = resolve)))
    api.assignGroupResource.mockResolvedValue(apiAssignment({ resource_type: "material", resource_id: "m1" }))

    let renamed: Promise<boolean> = Promise.resolve(true)
    act(() => {
      renamed = result.current.updateGroup(GROUP_ID, { name: "Neu" })
    })
    await act(async () => {
      await result.current.assignResource(GROUP_ID, "material", "m1")
    })
    // The rename left the server before the assign landed: its route has no assignment.
    await act(async () => {
      answerRename(apiGroup({ name: "Neu" }))
      await renamed
    })
    expect(result.current.groups[0].name).toBe("Neu")
    expect(result.current.groups[0].assignments.map((a) => a.id)).toEqual(["a1"])
  })

  it("asks for a driver for a route vehicle nobody drives, and stays «settling» until it asked", async () => {
    api.getIncidentGroups.mockResolvedValue([apiGroup()])
    const { result } = await renderLoaded()
    api.assignGroupResource.mockResolvedValue(apiAssignment())
    let answerDrivers: (functions: unknown[]) => void = () => {}
    api.getEventSpecialFunctions.mockImplementationOnce(() => new Promise((resolve) => (answerDrivers = resolve)))

    await act(async () => {
      await result.current.assignResource(GROUP_ID, "vehicle", "v1")
    })
    await waitFor(() => expect(result.current.board.isAssignmentSettling()).toBe(true))

    await act(async () => answerDrivers([]))
    await waitFor(() => expect(result.current.board.isAssignmentSettling()).toBe(false))
    expect(result.current.board.vehicleNeedingDriver).toEqual({ vehicleId: "v1", vehicleName: "TLF", groupId: GROUP_ID })
  })

  it("refuses an out-of-service vehicle before it reaches the route", async () => {
    api.getVehicles.mockResolvedValue([{ ...TLF, out_of_service: true }])
    api.getIncidentGroups.mockResolvedValue([apiGroup()])
    const { result } = await renderLoaded()

    let ok = true
    await act(async () => {
      ok = await result.current.assignResource(GROUP_ID, "vehicle", "v1")
    })
    expect(ok).toBe(false)
    expect(api.assignGroupResource).not.toHaveBeenCalled()
    expect(result.current.groups[0].assignments).toHaveLength(0)
    expect(toastError).toHaveBeenCalledTimes(1)
  })

  it("rolls back and toasts when the assign fails", async () => {
    api.getIncidentGroups.mockResolvedValue([apiGroup()])
    const { result } = await renderLoaded()
    api.assignGroupResource.mockRejectedValue(new Error("boom"))
    await act(async () => {
      await result.current.assignResource(GROUP_ID, "vehicle", "v1")
    })
    expect(result.current.groups[0].assignments).toHaveLength(0)
    expect(toastError).toHaveBeenCalledTimes(1)
  })

  // A staged «Jetzt verschieben» whose Auftrag holder was released elsewhere meanwhile goes on
  // with the assign – the 404 says the resource is free already.
  it("counts a 404 on unassign as released, without a toast", async () => {
    const onRoute = apiAssignment({ resource_type: "personnel", resource_id: "p1" })
    api.getIncidentGroups.mockResolvedValue([apiGroup({ assignments: [onRoute] })])
    const { result } = await renderLoaded()
    api.unassignGroupResource.mockRejectedValueOnce(new ApiError("Zuweisung nicht gefunden", 404, true))

    let ok: boolean | undefined
    await act(async () => {
      ok = await result.current.unassignResource(GROUP_ID, "a1")
    })
    expect(ok).toBe(true)
    expect(toastError).not.toHaveBeenCalled()
    expect(result.current.groups[0].assignments).toHaveLength(0)
  })
})

describe("what the routes mean for the board", () => {
  it("names each route's resources once, never by id, and marks its crew «auf Auftrag»", async () => {
    // The roster call that knows checked-out people too (no `checked_in_only`).
    api.getAllPersonnel.mockImplementation(async (params?: { checked_in_only?: boolean }) =>
      params?.checked_in_only
        ? [{ id: "p2", name: "MEIER Anna", role: "AdF", status: "available", tags: [], role_sort_order: 0 }]
        : [{ id: "p1", name: "BRUNNER Marco" }],
    )
    api.getIncidentGroups.mockResolvedValue([
      apiGroup({
        assignments: [
          apiAssignment({ resource_type: "vehicle", resource_id: "v-unknown" }),
          apiAssignment({ id: "a2", resource_type: "personnel", resource_id: "p1" }),
          apiAssignment({ id: "a3", resource_type: "personnel", resource_id: "p2" }),
        ],
      }),
    ])
    const { result } = await renderLoaded()

    await waitFor(() =>
      expect(result.current.getGroupResources(GROUP_ID).personnel.map((p) => p.name)).toEqual([
        "BRUNNER Marco",
        "MEIER Anna",
      ]),
    )
    // A name nobody knows is «Unbekannt» – this string also goes into the Funkspruch.
    expect(result.current.getGroupResources(GROUP_ID).vehicles[0].name).toBe("Unbekannt")
    expect(result.current.occupiedResourceIds.personnel.has("p1")).toBe(true)
    expect(result.current.board.personnel.find((p) => p.id === "p2")?.isOnAuftrag).toBe(true)
  })

  it("puts each stop's route resources on its card, and follows an assign", async () => {
    // «b» is a stop by the route's stopIds only: its `group_id` arrives with a later reload.
    api.getIncidentsWithTotal.mockResolvedValue({
      incidents: [apiIncident("a", { group_id: GROUP_ID }), apiIncident("b"), apiIncident("c")],
      total: 3,
    })
    api.getIncidentGroups.mockResolvedValue([apiGroup({ stop_ids: ["a", "b"], assignments: [apiAssignment()] })])
    const { result } = await renderLoaded()
    const card = (id: string) => result.current.board.operations.find((op) => op.id === id)

    await waitFor(() => expect(card("a")?.auftragResources?.vehicles.map((v) => v.name)).toEqual(["TLF"]))
    expect(card("b")?.auftragResources).toBe(card("a")?.auftragResources)
    expect(card("c")?.auftragResources).toBeNull()

    const untouched = card("c")
    api.assignGroupResource.mockResolvedValue(apiAssignment({ id: "a2", resource_type: "material", resource_id: "m1" }))
    await act(async () => {
      await result.current.assignResource(GROUP_ID, "material", "m1")
    })
    expect(card("a")?.auftragResources?.materials.map((m) => m.resourceId)).toEqual(["m1"])
    // A card off every route keeps its identity, so its memo gate stays shut.
    expect(card("c")).toBe(untouched)
  })

  it("keeps the card list when a route change leaves every card as it was", async () => {
    api.getIncidentsWithTotal.mockResolvedValue({ incidents: [apiIncident("a")], total: 1 })
    api.getIncidentGroups.mockResolvedValue([apiGroup()])
    const { result } = await renderLoaded()
    const before = result.current.board.operations

    api.updateIncidentGroup.mockResolvedValue(apiGroup({ name: "Umbenannt" }))
    await act(async () => {
      await result.current.updateGroup(GROUP_ID, { name: "Umbenannt" })
    })
    expect(result.current.groups[0].name).toBe("Umbenannt")
    expect(result.current.board.operations).toBe(before)
  })
})
