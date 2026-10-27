import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, renderHook, waitFor } from "@testing-library/react"
import { useState, type ReactNode } from "react"

import type { ApiIncident } from "@/lib/api-client"

// Two operators, seconds apart: a status move says which status this board
// showed, a refusal opens «Gerade geändert» and puts the card back, and
// «Trotzdem» resends with the override (lib/status-conflict.ts).

const EVENT_A = "11111111-1111-1111-1111-111111111111"

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

const authState = vi.hoisted(() => ({
  isAuthenticated: true,
  loading: false,
  user: { id: "user-a" } as { id: string } | null,
}))
const eventState = vi.hoisted(() => ({
  selectedEvent: { id: "11111111-1111-1111-1111-111111111111" } as { id: string },
  isEventLoaded: true,
}))
vi.mock("./auth-context", () => ({ useAuth: () => authState }))
vi.mock("./event-context", () => ({ useEvent: () => eventState }))

const refreshPersonnel = vi.hoisted(() => vi.fn())
const refreshMaterials = vi.hoisted(() => vi.fn())
// The roster/depot loaders the provider owns: the board load calls their
// refreshers (with skipStateUpdate) and writes the reconciled lists.
const NO_GROUPS = vi.hoisted(() => [] as unknown[])
const setMaterialOutOfService = vi.hoisted(() => vi.fn())
vi.mock("./operations/use-resource-lists", () => ({
  usePersonnelList: () => {
    const [personnel, setPersonnel] = useState<unknown[]>([])
    return { personnel, setPersonnel, refreshPersonnel }
  },
  useMaterialList: () => {
    const [materials, setMaterials] = useState<unknown[]>([])
    return { materials, setMaterials, materialGroups: NO_GROUPS, refreshMaterials, setMaterialOutOfService }
  },
}))

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

const toastMock = vi.hoisted(() => ({ error: vi.fn(), info: vi.fn(), success: vi.fn() }))
vi.mock("sonner", () => ({ toast: toastMock }))

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

import { ApiError } from "@/lib/api-client"
import { resetFieldSaveForTests } from "@/lib/field-save"
import { dismissStatusConflict, useStatusConflict } from "@/lib/status-conflict"
import { OperationsProvider, useOperations } from "./operations-context"

const wrapper = ({ children }: { children: ReactNode }) => <OperationsProvider>{children}</OperationsProvider>

/** What the server holds — every board load returns it. */
let serverIncidents: ApiIncident[]

/** PATCHes that hang until the test settles them, oldest first. */
let patches: Array<{ id: string; body: Record<string, unknown>; resolve: () => void; reject: (e: Error) => void }>

beforeEach(() => {
  resetFieldSaveForTests()
  authState.user = { id: "user-a" }
  authState.isAuthenticated = true
  eventState.selectedEvent = { id: EVENT_A }
  ws.reset()
  serverIncidents = [incident("1", { status: "reko_done" })]
  patches = []
  api.getIncidentsWithTotal
    .mockReset()
    .mockImplementation(async () => ({ incidents: serverIncidents, total: serverIncidents.length }))
  api.getSyncVersion.mockReset().mockResolvedValue({ version: "v1" })
  api.getAllSettings.mockReset().mockResolvedValue({ home_city: "" })
  api.getVehicles.mockReset().mockResolvedValue([])
  api.getEventRestliste.mockReset().mockResolvedValue(null)
  api.getEventSpecialFunctions.mockReset().mockResolvedValue([])
  api.getAssignmentsByEvent.mockReset().mockResolvedValue({})
  api.getEventRekoSummaries.mockReset().mockResolvedValue({ summaries: {} })
  api.updateIncident.mockReset().mockImplementation(
    (id: string, body: Record<string, unknown>) =>
      new Promise<void>((resolve, reject) => {
        patches.push({ id, body, resolve, reject })
      }),
  )
  refreshPersonnel.mockReset().mockResolvedValue([])
  refreshMaterials.mockReset().mockResolvedValue([])
  toastMock.error.mockReset()
  toastMock.info.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
  act(() => dismissStatusConflict())
})

async function renderLoaded() {
  const rendered = renderHook(() => ({ ...useOperations(), conflict: useStatusConflict() }), { wrapper })
  await waitFor(() => expect(rendered.result.current.isLoaded).toBe(true))
  await waitFor(() => expect(rendered.result.current.operations).toHaveLength(1))
  return rendered
}

const refusal = () =>
  new ApiError("Status geändert", 409, true, "incident_status_changed", {
    status: "complete",
    changed_by: "Fischer Thomas",
    seconds_ago: 4,
    released: "Suter Beat",
  })

describe("status moves from a stale board", () => {
  it("a move says which status the board showed – the first one, when two quick moves merge", async () => {
    const { result } = await renderLoaded()

    act(() => result.current.updateOperation("1", { status: "enroute" }))
    act(() => result.current.updateOperation("1", { status: "active" }))

    await waitFor(() => expect(patches).toHaveLength(1))
    expect(patches[0].body).toMatchObject({ status: "active", from_status: "reko_done" })
    expect(patches[0].body).not.toHaveProperty("override_status")
  })

  it("a refusal opens «Gerade geändert» and the card goes back to where the server has it", async () => {
    const { result } = await renderLoaded()

    act(() => result.current.updateOperation("1", { status: "enroute" }))
    await waitFor(() => expect(patches).toHaveLength(1))
    expect(result.current.operations[0].status).toBe("enroute")

    serverIncidents = [incident("1", { status: "complete" })]
    await act(async () => patches[0].reject(refusal()))

    await waitFor(() => expect(result.current.operations[0].status).toBe("complete"))
    expect(result.current.conflict).toMatchObject({
      operationId: "1",
      seen: "reko_done",
      wanted: "enroute",
      current: "complete",
      changedBy: "Fischer Thomas",
      secondsAgo: 4,
      released: "Suter Beat",
    })
    // The dialog says it; no second, generic voice.
    expect(toastMock.error).not.toHaveBeenCalled()
    expect(toastMock.info).not.toHaveBeenCalled()
  })

  it("«Trotzdem» sends the stale view it was made from and the state it overrides", async () => {
    serverIncidents = [incident("1", { status: "complete" })]
    const { result } = await renderLoaded()

    act(() => result.current.updateOperation("1", { status: "enroute" }, { seen: "reko_done", override: "complete" }))

    await waitFor(() => expect(patches).toHaveLength(1))
    expect(patches[0].body).toMatchObject({ status: "enroute", from_status: "reko_done", override_status: "complete" })
  })

  it("an edit without a status says nothing about one", async () => {
    const { result } = await renderLoaded()
    act(() => result.current.updateOperation("1", { contact: "Frau Meier" }))
    await waitFor(() => expect(patches).toHaveLength(1))
    expect(patches[0].body).toEqual({ contact: "Frau Meier", text_base: { contact: "" } })
  })
})
