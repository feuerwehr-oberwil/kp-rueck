import { describe, expect, it, vi, beforeEach } from "vitest"
import { act, renderHook, waitFor } from "@testing-library/react"

import type { ApiIncidentGroup } from "@/lib/api-client"

// --- Fixtures ---------------------------------------------------------------

const EVENT_ID = "11111111-1111-1111-1111-111111111111"

const apiGroup = (overrides: Partial<ApiIncidentGroup> = {}): ApiIncidentGroup => ({
  id: "22222222-2222-2222-2222-222222222222",
  event_id: EVENT_ID,
  name: "Sturm-Route West",
  color: "#ef4444",
  mode: "squad",
  notes: null,
  position: 0,
  created_at: "2026-07-21T00:00:00Z",
  updated_at: "2026-07-21T00:00:00Z",
  created_by: null,
  stop_ids: [],
  progress: { total: 0, done: 0 },
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
const createIncidentGroup = vi.fn()
const updateIncidentGroup = vi.fn()
const deleteIncidentGroup = vi.fn()
const reorderIncidentGroups = vi.fn()
const reorderGroupStops = vi.fn()
const addStopsToGroup = vi.fn()
const removeStopFromGroup = vi.fn()
const copyGroupSquad = vi.fn()

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    getIncidentGroups: (...a: unknown[]) => getIncidentGroups(...a),
    getSyncVersion: (...a: unknown[]) => getSyncVersion(...a),
    createIncidentGroup: (...a: unknown[]) => createIncidentGroup(...a),
    updateIncidentGroup: (...a: unknown[]) => updateIncidentGroup(...a),
    deleteIncidentGroup: (...a: unknown[]) => deleteIncidentGroup(...a),
    reorderIncidentGroups: (...a: unknown[]) => reorderIncidentGroups(...a),
    reorderGroupStops: (...a: unknown[]) => reorderGroupStops(...a),
    addStopsToGroup: (...a: unknown[]) => addStopsToGroup(...a),
    removeStopFromGroup: (...a: unknown[]) => removeStopFromGroup(...a),
    copyGroupSquad: (...a: unknown[]) => copyGroupSquad(...a),
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
  ws.reset()
  getIncidentGroups.mockReset().mockResolvedValue([])
  getSyncVersion.mockReset().mockResolvedValue({ version: "v1" })
  createIncidentGroup.mockReset()
  updateIncidentGroup.mockReset()
  deleteIncidentGroup.mockReset()
  reorderIncidentGroups.mockReset()
  reorderGroupStops.mockReset()
  addStopsToGroup.mockReset()
  removeStopFromGroup.mockReset()
  copyGroupSquad.mockReset()
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
})

describe("GroupsProvider — updateGroup mode", () => {
  it("updates the group's mode in state", async () => {
    getIncidentGroups.mockResolvedValue([apiGroup({ mode: "squad" })])
    updateIncidentGroup.mockImplementation(async (_id: string, patch: { mode?: string }) =>
      apiGroup({ mode: (patch.mode as ApiIncidentGroup["mode"]) ?? "squad" }),
    )

    const { result } = await renderLoaded()
    await waitFor(() => expect(result.current.groups).toHaveLength(1))
    expect(result.current.groups[0].mode).toBe("squad")

    await act(async () => {
      await result.current.updateGroup(result.current.groups[0].id, { mode: "vehicle_only" })
    })

    expect(updateIncidentGroup).toHaveBeenCalledWith(
      "22222222-2222-2222-2222-222222222222",
      { mode: "vehicle_only" },
    )
    expect(result.current.groups[0].mode).toBe("vehicle_only")
  })
})
