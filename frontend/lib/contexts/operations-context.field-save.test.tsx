import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, renderHook, waitFor } from "@testing-library/react"
import { useState, type ReactNode } from "react"

import type { ApiIncident } from "@/lib/api-client"

// The save state of the detail's text fields, driven through the real
// provider: what «Gespeichert» waits for, what a failure keeps, what a reload
// may not touch, and what a session switch must never send.

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

import { NetworkError } from "@/lib/api-client"
import { getFieldSave, resetFieldSaveForTests, unsavedFieldDrafts, watchFieldSave } from "@/lib/field-save"
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
  serverIncidents = [incident("1", { description: "Keller unter Wasser" })]
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
})

async function renderLoaded() {
  const rendered = renderHook(() => useOperations(), { wrapper })
  await waitFor(() => expect(rendered.result.current.isLoaded).toBe(true))
  await waitFor(() => expect(rendered.result.current.operations).toHaveLength(1))
  return rendered
}

const notesState = () => getFieldSave("1", "notes")

describe("text field save state", () => {
  it("is «pending» through the debounce and «saving» until the server answers — then «saved»", async () => {
    const { result } = await renderLoaded()

    act(() => result.current.updateOperation("1", { notes: "Keller unter Wasser, 40 cm" }))
    expect(notesState()?.status).toBe("pending")
    expect(notesState()?.draft).toBe("Keller unter Wasser, 40 cm")

    // The debounce fires; the PATCH is out but not answered.
    await waitFor(() => expect(patches).toHaveLength(1))
    expect(patches[0].body).toEqual({ description: "Keller unter Wasser, 40 cm" })
    expect(notesState()?.status).toBe("saving")

    // Typing on while it is in flight keeps the field away from «saved» even
    // when the older request is confirmed.
    act(() => result.current.updateOperation("1", { notes: "Keller unter Wasser, 40 cm, Pumpe läuft" }))
    await act(async () => patches[0].resolve())
    expect(notesState()?.status).toBe("pending")

    // The newer batch waits for the older one, then is confirmed.
    await waitFor(() => expect(patches).toHaveLength(2))
    expect(patches[1].body).toEqual({ description: "Keller unter Wasser, 40 cm, Pumpe läuft" })
    await act(async () => patches[1].resolve())
    expect(notesState()?.status).toBe("saved")
    expect(notesState()?.draft).toBeNull()
    expect(notesState()?.savedAt).toBeInstanceOf(Date)
  })

  it("a failure keeps the text as a draft and never says «saved»", async () => {
    const { result } = await renderLoaded()
    const unwatch = watchFieldSave("1")

    act(() => result.current.updateOperation("1", { notes: "Pumpe läuft" }))
    await waitFor(() => expect(patches).toHaveLength(1))
    await act(async () => patches[0].reject(new NetworkError()))

    expect(notesState()).toMatchObject({ status: "failed", draft: "Pumpe läuft", reason: "network" })
    expect(unsavedFieldDrafts()).toEqual([{ incidentId: "1", field: "notes" }])
    // Said at the field, which is on screen — not a second time as a toast.
    expect(toastMock.error).not.toHaveBeenCalled()
    unwatch()
  })

  it("still toasts when no field is on screen to say it", async () => {
    const { result } = await renderLoaded()
    act(() => result.current.updateOperation("1", { notes: "Pumpe läuft" }))
    await waitFor(() => expect(patches).toHaveLength(1))
    await act(async () => patches[0].reject(new NetworkError()))
    expect(toastMock.error).toHaveBeenCalled()
  })

  it("a background reload does not replace the kept draft", async () => {
    const { result } = await renderLoaded()

    act(() => result.current.updateOperation("1", { notes: "Pumpe läuft" }))
    await waitFor(() => expect(patches).toHaveLength(1))
    await act(async () => patches[0].reject(new NetworkError()))

    // Somebody else's change arrives; the board reloads.
    serverIncidents = [incident("1", { description: "Keller unter Wasser (Nachtrag KP)" })]
    const loadsBefore = api.getIncidentsWithTotal.mock.calls.length
    await new Promise((r) => setTimeout(r, 600)) // cooldown grace
    act(() => ws.emit("incident_update"))
    await waitFor(() => expect(api.getIncidentsWithTotal.mock.calls.length).toBeGreaterThan(loadsBefore))
    await waitFor(() => expect(result.current.operations[0].notes).toBe("Keller unter Wasser (Nachtrag KP)"))

    // The board shows the server; the draft is still held for the field.
    expect(notesState()).toMatchObject({ status: "failed", draft: "Pumpe läuft", base: "Keller unter Wasser" })
  })

  it("«Erneut speichern» sends exactly the kept field, and only that", async () => {
    const { result } = await renderLoaded()

    act(() => result.current.updateOperation("1", { notes: "Pumpe läuft", contact: "Frau Meier" }))
    await waitFor(() => expect(patches).toHaveLength(1))
    await act(async () => patches[0].reject(new NetworkError()))
    expect(getFieldSave("1", "contact")?.status).toBe("failed")

    const draft = notesState()!.draft!
    act(() => result.current.updateOperation("1", { notes: draft }))
    await waitFor(() => expect(patches).toHaveLength(2))
    expect(patches[1].body).toEqual({ description: "Pumpe läuft" })
    await act(async () => patches[1].resolve())

    expect(notesState()?.status).toBe("saved")
    // The other failed field is untouched — not resent behind the operator's back.
    expect(getFieldSave("1", "contact")).toMatchObject({ status: "failed", draft: "Frau Meier" })
  })

  it("a user switch drops the previous operator's drafts and never sends their queued write", async () => {
    const { result, rerender } = await renderLoaded()

    // A failed draft…
    act(() => result.current.updateOperation("1", { contact: "Frau Meier" }))
    await waitFor(() => expect(patches).toHaveLength(1))
    await act(async () => patches[0].reject(new NetworkError()))
    expect(getFieldSave("1", "contact")?.status).toBe("failed")

    // …and an edit still in the debounce when the session changes hands.
    act(() => result.current.updateOperation("1", { notes: "Text von A" }))
    authState.user = { id: "user-b" }
    rerender()

    await waitFor(() => expect(getFieldSave("1", "contact")).toBeUndefined())
    expect(getFieldSave("1", "notes")).toBeUndefined()
    expect(unsavedFieldDrafts()).toEqual([])
    await new Promise((r) => setTimeout(r, 700))
    expect(patches).toHaveLength(1)
  })
})
