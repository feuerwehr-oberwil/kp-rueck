import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, renderHook, waitFor } from "@testing-library/react"

import type { ApiAutogenState, ApiRegieState } from "@/lib/api/types"

const api = vi.hoisted(() => ({ getRegie: vi.fn() }))
const ws = vi.hoisted(() => ({ handlers: new Map<string, () => void>() }))
vi.mock("@/lib/api-client", () => ({ apiClient: api }))
vi.mock("@/lib/websocket-client", () => ({
  wsClient: {
    getStatus: () => "connected",
    onStatusChange: () => () => {},
    on: (event: string, handler: () => void) => {
      ws.handlers.set(event, handler)
      return () => ws.handlers.delete(event)
    },
  },
}))

import { useTrainingRegie } from "./use-training-regie"

const automatik = (enabled: boolean, stopped: "max" | null = null, event_id = "A"): ApiAutogenState => ({
  enabled,
  run: { event_id, started_at: "2026-11-24T19:00:00Z", stopped },
})
const regie = (overrides: Partial<ApiRegieState> = {}): ApiRegieState => ({
  event_id: "A",
  autopilot: false,
  tempo: "normal",
  paused_at: null,
  started_at: null,
  automatik: { enabled: false, run: null },
  automatik_next_at: null,
  incidents: [],
  history: [],
  gps_available: true,
  magazin_configured: true,
  ...overrides,
})

beforeEach(() => {
  api.getRegie.mockReset()
  ws.handlers.clear()
})

describe("useTrainingRegie", () => {
  it("refetches on the Regie's own broadcast and on a board change", async () => {
    api.getRegie.mockResolvedValueOnce(regie())
    const { result } = renderHook(() => useTrainingRegie("A", () => {}))
    await waitFor(() => expect(result.current.state?.autopilot).toBe(false))
    expect(api.getRegie).toHaveBeenCalledWith("A")

    api.getRegie.mockResolvedValueOnce(regie({ autopilot: true }))
    await act(async () => ws.handlers.get("training_regie")!())
    expect(result.current.state?.autopilot).toBe(true)

    api.getRegie.mockResolvedValueOnce(regie({ tempo: "sturm" }))
    await act(async () => ws.handlers.get("incident_update")!())
    expect(result.current.state?.tempo).toBe("sturm")
  })

  it("folds a burst of broadcasts into one refetch after the running one", async () => {
    api.getRegie.mockResolvedValue(regie())
    renderHook(() => useTrainingRegie("A", () => {}))
    await waitFor(() => expect(api.getRegie).toHaveBeenCalledTimes(1))

    let finish = () => {}
    api.getRegie.mockImplementationOnce(() => new Promise<ApiRegieState>((resolve) => (finish = () => resolve(regie()))))
    await act(async () => {
      ws.handlers.get("incident_update")!()
      ws.handlers.get("incident_update")!()
      ws.handlers.get("training_regie")!()
    })
    expect(api.getRegie).toHaveBeenCalledTimes(2)
    await act(async () => finish())
    await waitFor(() => expect(api.getRegie).toHaveBeenCalledTimes(3))
  })

  it("announces the Automatik's stop at the max once, for this Übung only", async () => {
    const stopped = vi.fn()
    api.getRegie.mockResolvedValueOnce(regie({ automatik: automatik(true) }))
    const { result } = renderHook(() => useTrainingRegie("A", stopped))
    await waitFor(() => expect(result.current.state?.automatik.enabled).toBe(true))

    api.getRegie.mockResolvedValueOnce(regie({ automatik: automatik(false, "max") }))
    await act(async () => ws.handlers.get("training_autogen")!())
    expect(stopped).toHaveBeenCalledTimes(1)

    // Another broadcast with the same state is no news.
    api.getRegie.mockResolvedValueOnce(regie({ automatik: automatik(false, "max") }))
    await act(async () => ws.handlers.get("training_autogen")!())
    expect(stopped).toHaveBeenCalledTimes(1)

    // A stop for another Übung is not this page's news either.
    act(() => result.current.apply(regie({ automatik: automatik(true, null, "B") })))
    api.getRegie.mockResolvedValueOnce(regie({ automatik: automatik(false, "max", "B") }))
    await act(async () => ws.handlers.get("training_autogen")!())
    expect(stopped).toHaveBeenCalledTimes(1)
  })

  it("loads nothing outside a training Ereignis", () => {
    const { result } = renderHook(() => useTrainingRegie(null, () => {}))
    expect(api.getRegie).not.toHaveBeenCalled()
    expect(result.current.state).toBeNull()
  })
})
