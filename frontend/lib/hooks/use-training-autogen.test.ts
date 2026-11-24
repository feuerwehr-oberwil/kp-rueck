import { describe, expect, it, vi } from "vitest"
import { act, renderHook, waitFor } from "@testing-library/react"

import type { ApiAutogenState } from "@/lib/api/types"

const api = vi.hoisted(() => ({ getAutogen: vi.fn() }))
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

import { useTrainingAutogen } from "./use-training-autogen"

const run = (event_id: string, stopped: "max" | null = null) => ({
  event_id,
  started_at: "2026-11-24T19:00:00Z",
  stopped,
})
const on: ApiAutogenState = { enabled: true, run: run("A") }

describe("useTrainingAutogen", () => {
  it("announces the stop at the max for this Übung only, and only when it was running", async () => {
    const stopped = vi.fn()
    api.getAutogen.mockResolvedValueOnce(on)
    const { result } = renderHook(() => useTrainingAutogen("A", stopped))
    await waitFor(() => expect(result.current.state).toEqual(on))

    // The monitor switched itself off at the max – the socket says so.
    api.getAutogen.mockResolvedValueOnce({ enabled: false, run: run("A", "max") })
    await act(async () => ws.handlers.get("training_autogen")!())
    expect(stopped).toHaveBeenCalledTimes(1)

    // Another broadcast with the same state is no news.
    api.getAutogen.mockResolvedValueOnce({ enabled: false, run: run("A", "max") })
    await act(async () => ws.handlers.get("training_autogen")!())
    expect(stopped).toHaveBeenCalledTimes(1)

    // A stop for another Übung is not this page's news either.
    act(() => result.current.apply({ enabled: true, run: run("B") }))
    api.getAutogen.mockResolvedValueOnce({ enabled: false, run: run("B", "max") })
    await act(async () => ws.handlers.get("training_autogen")!())
    expect(stopped).toHaveBeenCalledTimes(1)
  })
})
