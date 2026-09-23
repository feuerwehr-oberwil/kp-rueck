import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, renderHook, waitFor } from "@testing-library/react"
import { useState, type ReactNode } from "react"

import type { ApiIncident } from "@/lib/api-client"

// The board's sync path against a fake socket and a fake API: how many reloads
// a burst of events costs, whether two reloads can overlap, and which result
// wins when they could have.

const EVENT_A = "11111111-1111-1111-1111-111111111111"
const EVENT_B = "22222222-2222-2222-2222-222222222222"

const incident = (id: string, overrides: Partial<ApiIncident> = {}): ApiIncident =>
  ({
    id,
    event_id: EVENT_A,
    title: `Einsatz ${id}`,
    type: "elementarereignis",
    priority: "medium",
    location_address: `Hauptstrasse ${id}`,
    location_lat: null,
    location_lng: null,
    status: "incoming",
    description: "",
    created_at: "2026-09-23T08:00:00Z",
    updated_at: "2026-09-23T08:00:00Z",
    ...overrides,
  }) as ApiIncident

// --- Mocks ------------------------------------------------------------------

// Stable objects: the sync effect keys off `selectedEvent` identity.
const authState = vi.hoisted(() => ({ isAuthenticated: true, loading: false }))
const eventState = vi.hoisted(() => ({
  selectedEvent: { id: "11111111-1111-1111-1111-111111111111" } as { id: string },
  isEventLoaded: true,
}))
vi.mock("./auth-context", () => ({ useAuth: () => authState }))
vi.mock("./event-context", () => ({ useEvent: () => eventState }))

const refreshPersonnel = vi.hoisted(() => vi.fn())
const refreshMaterials = vi.hoisted(() => vi.fn())
vi.mock("./personnel-context", () => ({
  usePersonnel: () => {
    const [personnel, setPersonnel] = useState<unknown[]>([])
    return { personnel, setPersonnel, refreshPersonnel }
  },
}))
vi.mock("./materials-context", () => ({
  useMaterials: () => {
    const [materials, setMaterials] = useState<unknown[]>([])
    return { materials, setMaterials, refreshMaterials }
  },
}))

// A socket that reports "connected" (so the polling fallback never arms) and
// lets the test emit events.
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
vi.mock("@/components/ui/top-loading-bar", () => ({ topLoading: { start: () => {}, done: () => {} } }))

const api = vi.hoisted(() => ({
  getSyncVersion: vi.fn(),
  getIncidentsWithTotal: vi.fn(),
  getAllSettings: vi.fn(),
  getVehicles: vi.fn(),
  getEventRestliste: vi.fn(),
  getEventSpecialFunctions: vi.fn(),
  getAssignmentsByEvent: vi.fn(),
  getEventRekoSummaries: vi.fn(),
  updateIncident: vi.fn(),
}))
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  apiClient: api,
}))

import { NetworkError } from "@/lib/api-client"
import { OperationsProvider, useBoardSyncStatus, useOperations } from "./operations-context"

const wrapper = ({ children }: { children: ReactNode }) => <OperationsProvider>{children}</OperationsProvider>

/** Incident fetches that hang until the test answers them, oldest first. */
let incidentCalls: Array<{
  eventId: string
  resolve: (incidents: ApiIncident[]) => void
  reject: (error: Error) => void
}>
let maxConcurrentIncidentFetches: number
let openIncidentFetches: number

beforeEach(() => {
  eventState.selectedEvent = { id: EVENT_A }
  ws.reset()
  incidentCalls = []
  maxConcurrentIncidentFetches = 0
  openIncidentFetches = 0
  api.getIncidentsWithTotal.mockReset().mockImplementation(
    (eventId: string) =>
      new Promise((resolve, reject) => {
        openIncidentFetches++
        maxConcurrentIncidentFetches = Math.max(maxConcurrentIncidentFetches, openIncidentFetches)
        incidentCalls.push({
          eventId,
          resolve: (incidents) => {
            openIncidentFetches--
            resolve({ incidents, total: incidents.length })
          },
          reject: (error) => {
            openIncidentFetches--
            reject(error)
          },
        })
      }),
  )
  api.getSyncVersion.mockReset().mockResolvedValue({ version: "v1" })
  api.getAllSettings.mockReset().mockResolvedValue({ home_city: "" })
  api.getVehicles.mockReset().mockResolvedValue([])
  api.getEventRestliste.mockReset().mockResolvedValue(null)
  api.getEventSpecialFunctions.mockReset().mockResolvedValue([])
  api.getAssignmentsByEvent.mockReset().mockResolvedValue({})
  api.getEventRekoSummaries.mockReset().mockResolvedValue({ summaries: {} })
  api.updateIncident.mockReset().mockResolvedValue({})
  refreshPersonnel.mockReset().mockResolvedValue([])
  refreshMaterials.mockReset().mockResolvedValue([])
})

afterEach(() => {
  vi.useRealTimers()
})

/** Answer the oldest open incident fetch and let the reload finish. */
async function answer(incidents: ApiIncident[]) {
  const call = incidentCalls.shift()
  if (!call) throw new Error("no incident fetch is waiting")
  await act(async () => {
    call.resolve(incidents)
  })
}

async function renderLoaded(initial: ApiIncident[] = [incident("1")]) {
  const rendered = renderHook(() => useOperations(), { wrapper })
  await waitFor(() => expect(incidentCalls).toHaveLength(1))
  await answer(initial)
  await waitFor(() => expect(rendered.result.current.isLoaded).toBe(true))
  return rendered
}

describe("OperationsProvider — reload scheduling", () => {
  it("turns a burst of socket events into one reload", async () => {
    await renderLoaded()
    expect(api.getIncidentsWithTotal).toHaveBeenCalledTimes(1)

    // A Reko submit: incident + assignment + personnel within milliseconds.
    act(() => {
      ws.emit("incident_update")
      ws.emit("assignment_update", { action: "create" })
      ws.emit("personnel_update")
      ws.emit("incident_update")
    })

    await waitFor(() => expect(api.getIncidentsWithTotal).toHaveBeenCalledTimes(2))
    await answer([incident("1")])
    // Give a would-be second reload time to appear.
    await new Promise((r) => setTimeout(r, 300))
    expect(api.getIncidentsWithTotal).toHaveBeenCalledTimes(2)
  })

  it("never overlaps two reloads, and the NEWEST fetch is what the board shows", async () => {
    const { result } = await renderLoaded()

    act(() => ws.emit("incident_update"))
    await waitFor(() => expect(incidentCalls).toHaveLength(1))

    // More news while that reload is still out: it must queue, not start a
    // second request that could come back first.
    act(() => ws.emit("incident_update"))
    await new Promise((r) => setTimeout(r, 300))
    expect(incidentCalls).toHaveLength(1)

    await answer([incident("1"), incident("2")])
    await waitFor(() => expect(incidentCalls).toHaveLength(1))
    await answer([incident("1"), incident("2"), incident("3")])

    await waitFor(() => expect(result.current.operations.map((o) => o.id)).toEqual(["1", "2", "3"]))
    expect(maxConcurrentIncidentFetches).toBe(1)
  })

  it("an explicit refresh waits for a reload that started after it was asked for", async () => {
    const { result } = await renderLoaded()

    act(() => ws.emit("incident_update"))
    await waitFor(() => expect(incidentCalls).toHaveLength(1))

    let refreshed = false
    act(() => {
      void result.current.refreshOperations().then(() => {
        refreshed = true
      })
    })
    await answer([incident("1")]) // fetched before the refresh was asked for
    expect(refreshed).toBe(false)

    await waitFor(() => expect(incidentCalls).toHaveLength(1))
    await answer([incident("1"), incident("9")])
    await waitFor(() => expect(refreshed).toBe(true))
    expect(result.current.operations.map((o) => o.id)).toEqual(["1", "9"])
    expect(maxConcurrentIncidentFetches).toBe(1)
  })

  it("drops a reload for the previous Ereignis that lands after the switch", async () => {
    const { result, rerender } = await renderLoaded()

    act(() => ws.emit("incident_update"))
    await waitFor(() => expect(incidentCalls).toHaveLength(1))

    eventState.selectedEvent = { id: EVENT_B }
    rerender()
    await waitFor(() => expect(incidentCalls).toHaveLength(2))
    expect(incidentCalls[1].eventId).toBe(EVENT_B)

    // Event B answers first; A's late answer must not paint over it.
    const stale = incidentCalls.shift()!
    await answer([incident("b1", { event_id: EVENT_B })])
    await act(async () => {
      stale.resolve([incident("a-late")])
    })

    await waitFor(() => expect(result.current.operations.map((o) => o.id)).toEqual(["b1"]))
  })

  it("keeps an optimistic edit when a reload that was already in flight lands", async () => {
    const { result } = await renderLoaded([incident("1", { description: "alt" })])

    act(() => ws.emit("incident_update"))
    await waitFor(() => expect(incidentCalls).toHaveLength(1))

    act(() => result.current.updateOperation("1", { notes: "neu" }))
    expect(result.current.operations[0].notes).toBe("neu")

    // The in-flight reload was fetched before the edit: discarded, not applied.
    await answer([incident("1", { description: "alt" })])
    expect(result.current.operations[0].notes).toBe("neu")

    // Once the PATCH settles and the cooldown clears, the replay reconciles.
    await waitFor(() => expect(api.updateIncident).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(incidentCalls).toHaveLength(1), { timeout: 2000 })
    await answer([incident("1", { description: "neu" })])
    expect(result.current.operations[0].notes).toBe("neu")
    expect(maxConcurrentIncidentFetches).toBe(1)
  })
})

describe("OperationsProvider — render cost", () => {
  it("hands out the same value when the provider re-renders with nothing new", async () => {
    const { result, rerender } = await renderLoaded()
    const before = result.current
    rerender()
    expect(result.current).toBe(before)
  })

  it("keeps its actions stable across a reload — and they act on the latest board", async () => {
    const { result } = await renderLoaded([incident("1")])
    const updateOperation = result.current.updateOperation

    act(() => ws.emit("incident_update"))
    await waitFor(() => expect(incidentCalls).toHaveLength(1))
    await answer([incident("1"), incident("2")])
    await waitFor(() => expect(result.current.operations).toHaveLength(2))

    expect(result.current.updateOperation).toBe(updateOperation)
    // The wrapper captured before the reload still sees incident 2.
    act(() => updateOperation("2", { notes: "neu" }))
    expect(result.current.operations.find((o) => o.id === "2")?.notes).toBe("neu")
  })

  it("keeps the sync timestamp off the main context", async () => {
    const { result } = await renderLoaded()
    expect("lastSyncAt" in result.current).toBe(false)
  })
})

describe("OperationsProvider — a failed load is not an empty board", () => {
  async function renderBoard(initial: ApiIncident[] = [incident("1"), incident("2")]) {
    const rendered = renderHook(() => ({ ops: useOperations(), sync: useBoardSyncStatus() }), { wrapper })
    await waitFor(() => expect(incidentCalls).toHaveLength(1))
    await answer(initial)
    await waitFor(() => expect(rendered.result.current.ops.isLoaded).toBe(true))
    return rendered
  }

  async function reloadFailing(fail: () => void) {
    act(() => ws.emit("incident_update"))
    await waitFor(() => expect(incidentCalls).toHaveLength(1))
    fail()
  }

  it("keeps the last good board when the incident fetch dies, and says so", async () => {
    const { result } = await renderBoard()
    const syncedAt = result.current.sync.lastSyncAt
    expect(syncedAt).not.toBeNull()
    expect(result.current.sync.loadError).toBeNull()

    await reloadFailing(() => incidentCalls.shift()!.reject(new NetworkError()))

    await waitFor(() => expect(result.current.sync.loadError).toBeInstanceOf(NetworkError))
    expect(result.current.ops.operations.map((o) => o.id)).toEqual(["1", "2"])
    expect(result.current.sync.lastSyncAt).toBe(syncedAt)
  })

  it.each([
    ["assignments", () => api.getAssignmentsByEvent.mockResolvedValueOnce(undefined)],
    ["special functions", () => api.getEventSpecialFunctions.mockRejectedValueOnce(new Error("500"))],
    ["reko summaries", () => api.getEventRekoSummaries.mockResolvedValueOnce(undefined)],
    ["vehicles", () => api.getVehicles.mockResolvedValueOnce(undefined)],
    ["personnel", () => refreshPersonnel.mockRejectedValueOnce(new Error("500"))],
  ])("does not paint a partial snapshot when %s fail", async (_what, breakIt) => {
    const { result } = await renderBoard()
    const before = result.current.ops.operations

    breakIt()
    await reloadFailing(() => void answer([incident("1")]))

    await waitFor(() => expect(result.current.sync.loadError).not.toBeNull())
    expect(result.current.ops.operations).toBe(before)
  })

  it("a failed FIRST load reports the error instead of passing for an empty Ereignis", async () => {
    const { result } = renderHook(() => ({ ops: useOperations(), sync: useBoardSyncStatus() }), { wrapper })
    await waitFor(() => expect(incidentCalls).toHaveLength(1))
    await act(async () => incidentCalls.shift()!.reject(new NetworkError()))

    await waitFor(() => expect(result.current.sync.loadError).not.toBeNull())
    expect(result.current.sync.lastSyncAt).toBeNull()
    expect(result.current.ops.operations).toEqual([])
  })

  it("keeps the previous home city and Restliste when only those fail", async () => {
    api.getAllSettings.mockResolvedValue({ home_city: "Oberwil" })
    const { result } = await renderBoard()
    expect(result.current.ops.homeCity).toBe("Oberwil")

    api.getAllSettings.mockRejectedValueOnce(new Error("500"))
    act(() => ws.emit("incident_update"))
    await waitFor(() => expect(incidentCalls).toHaveLength(1))
    await answer([incident("1"), incident("2"), incident("3")])

    await waitFor(() => expect(result.current.ops.operations).toHaveLength(3))
    expect(result.current.ops.homeCity).toBe("Oberwil")
    expect(result.current.sync.loadError).toBeNull()
  })

  it("retries by polling even with the socket up, and a good load clears the error", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { result } = renderHook(() => ({ ops: useOperations(), sync: useBoardSyncStatus() }), { wrapper })
    await waitFor(() => expect(incidentCalls).toHaveLength(1))
    await act(async () => incidentCalls.shift()!.reject(new NetworkError()))
    await waitFor(() => expect(result.current.sync.loadError).not.toBeNull())

    // No socket event is coming: the poll (~5 s ± jitter) has to try again.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_500)
    })
    await waitFor(() => expect(incidentCalls).toHaveLength(1))
    await answer([incident("1")])

    await waitFor(() => expect(result.current.sync.loadError).toBeNull())
    expect(result.current.ops.operations.map((o) => o.id)).toEqual(["1"])
    expect(result.current.sync.lastSyncAt).not.toBeNull()
  })
})
