import { describe, expect, it, vi, beforeEach } from "vitest"
import { act, renderHook, waitFor } from "@testing-library/react"

import type { ApiGroupAssignment, ApiIncidentGroup } from "@/lib/api-client"

// --- Fixtures ---------------------------------------------------------------

const EVENT_ID = "11111111-1111-1111-1111-111111111111"
const GROUP_ID = "22222222-2222-2222-2222-222222222222"
const EVENT_ID_2 = "33333333-3333-3333-3333-333333333333"

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

// --- Mocks ------------------------------------------------------------------

// Stable auth/event objects: the mount effect keys off `selectedEvent` identity,
// so returning a fresh object per render would re-fire the initial load.
const authState = vi.hoisted(() => ({ isAuthenticated: true, loading: false }))
const eventState = vi.hoisted(() => ({
  selectedEvent: { id: "11111111-1111-1111-1111-111111111111" },
  isEventLoaded: true,
}))
vi.mock("@/lib/contexts/auth-context", () => ({ useAuth: () => authState }))
vi.mock("@/lib/contexts/event-context", () => ({ useEvent: () => eventState }))
// The provider resolves resource names via these sibling contexts.
vi.mock("@/lib/contexts/personnel-context", () => ({ usePersonnel: () => ({ personnel: [] }) }))
vi.mock("@/lib/contexts/materials-context", () => ({ useMaterials: () => ({ materials: [] }) }))

// Controllable WebSocket stub mirroring the shape operations-context uses:
// on(event, cb) / onStatusChange(cb) / getStatus(). `getStatus` reports
// "connected" so the polling fallback never arms (no timers in the test).
const ws = vi.hoisted(() => {
  const handlers = new Map<string, Set<(payload?: unknown) => void>>()
  const statusHandlers = new Set<(status: string) => void>()
  return {
    handlers,
    statusHandlers,
    reset() {
      handlers.clear()
      statusHandlers.clear()
    },
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
      onStatusChange(cb: (status: string) => void) {
        statusHandlers.add(cb)
        return () => statusHandlers.delete(cb)
      },
      getStatus: () => "connected",
    },
  }
})
vi.mock("@/lib/websocket-client", () => ({ wsClient: ws.client }))

const getIncidentGroups = vi.fn()
const getSyncVersion = vi.fn()
const getVehicles = vi.fn()
const createIncidentGroup = vi.fn()
const updateIncidentGroup = vi.fn()
const deleteIncidentGroup = vi.fn()
const reorderIncidentGroups = vi.fn()
const reorderGroupStops = vi.fn()
const addStopsToGroup = vi.fn()
const removeStopFromGroup = vi.fn()
const getAllPersonnel = vi.fn()
const assignGroupResource = vi.fn()
const unassignGroupResource = vi.fn()

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    getIncidentGroups: (...a: unknown[]) => getIncidentGroups(...a),
    getSyncVersion: (...a: unknown[]) => getSyncVersion(...a),
    getVehicles: (...a: unknown[]) => getVehicles(...a),
    getAllPersonnel: (...a: unknown[]) => getAllPersonnel(...a),
    createIncidentGroup: (...a: unknown[]) => createIncidentGroup(...a),
    updateIncidentGroup: (...a: unknown[]) => updateIncidentGroup(...a),
    deleteIncidentGroup: (...a: unknown[]) => deleteIncidentGroup(...a),
    reorderIncidentGroups: (...a: unknown[]) => reorderIncidentGroups(...a),
    reorderGroupStops: (...a: unknown[]) => reorderGroupStops(...a),
    addStopsToGroup: (...a: unknown[]) => addStopsToGroup(...a),
    removeStopFromGroup: (...a: unknown[]) => removeStopFromGroup(...a),
    assignGroupResource: (...a: unknown[]) => assignGroupResource(...a),
    unassignGroupResource: (...a: unknown[]) => unassignGroupResource(...a),
  },
}))

const toastError = vi.fn()
const toastSuccess = vi.fn()
vi.mock("sonner", () => ({
  toast: {
    error: (...a: unknown[]) => toastError(...a),
    success: (...a: unknown[]) => toastSuccess(...a),
  },
}))

import { GroupsProvider, useGroups } from "@/lib/contexts/groups-context"

const wrapper = ({ children }: { children: React.ReactNode }) => <GroupsProvider>{children}</GroupsProvider>

beforeEach(() => {
  eventState.selectedEvent = { id: EVENT_ID }
  ws.reset()
  getIncidentGroups.mockReset().mockResolvedValue([])
  getSyncVersion.mockReset().mockResolvedValue({ version: "v1" })
  getVehicles.mockReset().mockResolvedValue([])
  getAllPersonnel.mockReset().mockResolvedValue([])
  createIncidentGroup.mockReset()
  updateIncidentGroup.mockReset()
  deleteIncidentGroup.mockReset()
  reorderIncidentGroups.mockReset()
  reorderGroupStops.mockReset()
  addStopsToGroup.mockReset()
  removeStopFromGroup.mockReset()
  assignGroupResource.mockReset()
  unassignGroupResource.mockReset()
  toastError.mockReset()
  toastSuccess.mockReset()
})

// Mount the provider and wait for the initial load to resolve.
async function renderLoaded() {
  const rendered = renderHook(() => useGroups(), { wrapper })
  await waitFor(() => expect(rendered.result.current.isLoaded).toBe(true))
  return rendered
}

describe("GroupsProvider — createGroup optimistic + reconcile", () => {
  it("adds a placeholder immediately, then reconciles it with the API result", async () => {
    const { result } = await renderLoaded()

    let resolveCreate!: (g: ApiIncidentGroup) => void
    createIncidentGroup.mockReturnValue(
      new Promise<ApiIncidentGroup>((resolve) => {
        resolveCreate = resolve
      }),
    )

    // Fire without awaiting: the synchronous optimistic setState must land first.
    let pending!: Promise<unknown>
    await act(async () => {
      pending = result.current.createGroup({ name: "Sturm-Route West", color: "#ef4444" })
    })

    expect(result.current.groups).toHaveLength(1)
    expect(result.current.groups[0].id).toMatch(/^temp-/)
    expect(result.current.groups[0].name).toBe("Sturm-Route West")

    // Resolve the API call — the temp row is replaced by the reconciled server row.
    await act(async () => {
      resolveCreate(apiGroup({ id: "99999999-9999-9999-9999-999999999999", name: "Sturm-Route West" }))
      await pending
    })

    expect(result.current.groups).toHaveLength(1)
    expect(result.current.groups[0].id).toBe("99999999-9999-9999-9999-999999999999")
    expect(toastError).not.toHaveBeenCalled()
  })

  it("rolls the optimistic group back and toasts when the API errors", async () => {
    const { result } = await renderLoaded()
    createIncidentGroup.mockRejectedValue(new Error("boom"))

    await act(async () => {
      await result.current.createGroup({ name: "Sturm-Route West", color: "#ef4444" })
    })

    expect(result.current.groups).toHaveLength(0)
    expect(toastError).toHaveBeenCalledTimes(1)
  })
})

describe("GroupsProvider — group_update WS event", () => {
  it("refreshes the list when a group_update broadcast arrives", async () => {
    const { result } = await renderLoaded()
    await waitFor(() => expect(getIncidentGroups).toHaveBeenCalledTimes(1))

    // The refresh reload returns a populated list so we can observe the fold-in.
    getIncidentGroups.mockResolvedValueOnce([apiGroup({ name: "Nach WS" })])

    await act(async () => {
      ws.emit("group_update", { action: "update", group_id: "x" })
    })

    await waitFor(() => expect(getIncidentGroups).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(result.current.groups.map((g) => g.name)).toContain("Nach WS"))
  })

  it.each(["assignment_update", "incident_update"])("refreshes on %s", async (event) => {
    await renderLoaded()
    await waitFor(() => expect(getIncidentGroups).toHaveBeenCalledTimes(1))
    ws.emit(event, {})
    await waitFor(() => expect(getIncidentGroups).toHaveBeenCalledTimes(2))
  })
})

describe("GroupsProvider — stop reorder sequencing", () => {
  it("does not send a newer order until the older request settles", async () => {
    getIncidentGroups.mockResolvedValue([apiGroup({ stop_ids: ["a", "b", "c"] })])
    const { result } = await renderLoaded()
    await waitFor(() => expect(result.current.groups).toHaveLength(1))
    let resolveFirst!: () => void
    let resolveSecond!: () => void
    reorderGroupStops
      .mockReturnValueOnce(new Promise<void>((resolve) => { resolveFirst = resolve }))
      .mockReturnValueOnce(new Promise<void>((resolve) => { resolveSecond = resolve }))

    let first!: Promise<boolean>
    let second!: Promise<boolean>
    act(() => { first = result.current.reorderGroupStops(GROUP_ID, ["b", "a", "c"]) })
    act(() => { second = result.current.reorderGroupStops(GROUP_ID, ["c", "b", "a"]) })
    await waitFor(() => expect(reorderGroupStops).toHaveBeenCalledTimes(1))
    await act(async () => { resolveFirst(); await first })
    expect(reorderGroupStops).toHaveBeenCalledTimes(2)
    await act(async () => { resolveSecond(); await second })
    expect(result.current.groups[0].stopIds).toEqual(["c", "b", "a"])
  })
})

describe("GroupsProvider — event scope", () => {
  it("clears the old scope and ignores an out-of-order event load", async () => {
    let resolveFirst!: (groups: ApiIncidentGroup[]) => void
    getIncidentGroups.mockImplementation((eventId: string) => {
      if (eventId === EVENT_ID) return new Promise<ApiIncidentGroup[]>((resolve) => { resolveFirst = resolve })
      return Promise.resolve([apiGroup({ event_id: EVENT_ID_2, name: "Event 2" })])
    })
    const rendered = renderHook(() => useGroups(), { wrapper })
    await waitFor(() => expect(getIncidentGroups).toHaveBeenCalledWith(EVENT_ID))

    eventState.selectedEvent = { id: EVENT_ID_2 }
    rendered.rerender()
    expect(rendered.result.current.groups).toEqual([])
    expect(rendered.result.current.isLoaded).toBe(false)
    await waitFor(() => expect(rendered.result.current.groups.map((g) => g.name)).toEqual(["Event 2"]))

    await act(async () => { resolveFirst([apiGroup({ name: "Stale Event 1" })]) })
    expect(rendered.result.current.groups.map((g) => g.name)).toEqual(["Event 2"])
  })

  it("derives route-occupied resource ids without mutating resource contexts", async () => {
    getIncidentGroups.mockResolvedValue([apiGroup({ assignments: [
      apiAssignment({ resource_type: "vehicle", resource_id: "v1" }),
      apiAssignment({ id: "a2", resource_type: "personnel", resource_id: "p1" }),
      apiAssignment({ id: "a3", resource_type: "material", resource_id: "m1" }),
    ] })])
    const { result } = await renderLoaded()
    await waitFor(() => expect(result.current.groups).toHaveLength(1))
    expect(result.current.occupiedResourceIds.vehicle.has("v1")).toBe(true)
    expect(result.current.occupiedResourceIds.personnel.has("p1")).toBe(true)
    expect(result.current.occupiedResourceIds.material.has("m1")).toBe(true)
  })
})

describe("GroupsProvider — assign / unassign route resources", () => {
  it("optimistically adds an assignment then reconciles from the server", async () => {
    getIncidentGroups.mockResolvedValue([apiGroup({ assignments: [] })])
    assignGroupResource.mockResolvedValue(apiAssignment({ id: "a1", resource_type: "vehicle", resource_id: "v1" }))

    const { result } = await renderLoaded()
    await waitFor(() => expect(result.current.groups).toHaveLength(1))

    // The reconciling refresh returns the persisted assignment.
    getIncidentGroups.mockResolvedValueOnce([
      apiGroup({ assignments: [apiAssignment({ id: "a1", resource_type: "vehicle", resource_id: "v1" })] }),
    ])

    await act(async () => {
      await result.current.assignResource(GROUP_ID, "vehicle", "v1")
    })

    expect(assignGroupResource).toHaveBeenCalledWith(GROUP_ID, { resource_type: "vehicle", resource_id: "v1" })
    await waitFor(() => expect(result.current.groups[0].assignments).toHaveLength(1))
    expect(result.current.groups[0].assignments[0].resourceId).toBe("v1")
  })

  it("rolls back and toasts when the assign fails", async () => {
    getIncidentGroups.mockResolvedValue([apiGroup({ assignments: [] })])
    assignGroupResource.mockRejectedValue(new Error("boom"))

    const { result } = await renderLoaded()
    await waitFor(() => expect(result.current.groups).toHaveLength(1))

    await act(async () => {
      await result.current.assignResource(GROUP_ID, "vehicle", "v1")
    })

    expect(result.current.groups[0].assignments).toHaveLength(0)
    expect(toastError).toHaveBeenCalledTimes(1)
  })

  it("optimistically removes an assignment on unassign", async () => {
    getIncidentGroups.mockResolvedValue([
      apiGroup({ assignments: [apiAssignment({ id: "a1", resource_type: "personnel", resource_id: "p1" })] }),
    ])
    unassignGroupResource.mockResolvedValue(undefined)

    const { result } = await renderLoaded()
    await waitFor(() => expect(result.current.groups[0].assignments).toHaveLength(1))

    getIncidentGroups.mockResolvedValueOnce([apiGroup({ assignments: [] })])

    await act(async () => {
      await result.current.unassignResource(GROUP_ID, "a1")
    })

    expect(unassignGroupResource).toHaveBeenCalledWith(GROUP_ID, "a1")
    await waitFor(() => expect(result.current.groups[0].assignments).toHaveLength(0))
  })

  it("getGroupResources splits the route's assignments by kind", async () => {
    getIncidentGroups.mockResolvedValue([
      apiGroup({
        assignments: [
          apiAssignment({ id: "a1", resource_type: "vehicle", resource_id: "v1" }),
          apiAssignment({ id: "a2", resource_type: "personnel", resource_id: "p1" }),
          apiAssignment({ id: "a3", resource_type: "material", resource_id: "m1" }),
        ],
      }),
    ])

    const { result } = await renderLoaded()
    await waitFor(() => expect(result.current.groups[0].assignments).toHaveLength(3))

    const res = result.current.getGroupResources(GROUP_ID)
    expect(res.vehicles.map((v) => v.resourceId)).toEqual(["v1"])
    expect(res.personnel.map((p) => p.resourceId)).toEqual(["p1"])
    expect(res.materials.map((m) => m.resourceId)).toEqual(["m1"])
    // A name that could not be resolved is NEVER the raw id — that string also
    // goes into the Funkspruch, the WhatsApp text and the printout.
    expect(res.vehicles[0].name).toBe("Unbekannt")
    expect(res.vehicles[0].assignmentId).toBe("a1")
  })

  it("names a route member who has checked out", async () => {
    // The staging bug: `usePersonnel()` only carries checked-IN people, a route
    // assignment deliberately outlives a check-out, and the chip fell back to
    // the raw UUID. The roster is the list that still knows the name.
    getAllPersonnel.mockResolvedValue([{ id: "p1", name: "BRUNNER Marco" }])
    getIncidentGroups.mockResolvedValue([
      apiGroup({ assignments: [apiAssignment({ id: "a2", resource_type: "personnel", resource_id: "p1" })] }),
    ])

    const { result } = await renderLoaded()
    await waitFor(() => expect(result.current.getGroupResources(GROUP_ID).personnel[0]?.name).toBe("BRUNNER Marco"))
  })
})
