import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, renderHook, waitFor } from "@testing-library/react"

const ws = vi.hoisted(() => {
  const handlers = new Map<string, (payload: unknown) => void>()
  return {
    handlers,
    client: {
      getStatus: () => "connected",
      onStatusChange: () => () => {},
      on(event: string, cb: (payload: unknown) => void) {
        handlers.set(event, cb)
        return () => handlers.delete(event)
      },
    },
  }
})
vi.mock("@/lib/websocket-client", () => ({ wsClient: ws.client }))

const api = vi.hoisted(() => ({ getTraccarStatus: vi.fn(), getVehiclePositions: vi.fn() }))
vi.mock("@/lib/api-client", () => ({ apiClient: api }))

import { useVehiclePositions } from "./use-vehicle-positions"

const fix = (device_name: string) => ({ device_name, latitude: 47.5, longitude: 7.5 })

beforeEach(() => {
  ws.handlers.clear()
  api.getTraccarStatus.mockReset()
  api.getVehiclePositions.mockReset().mockResolvedValue([fix("TLF")])
})

describe("useVehiclePositions", () => {
  it("asks for positions only once Traccar says it is configured, then takes the pushes", async () => {
    api.getTraccarStatus.mockResolvedValue({ configured: true })
    const { result } = renderHook(() => useVehiclePositions())
    await waitFor(() => expect(result.current.positions).toEqual([fix("TLF")]))
    expect(result.current.configured).toBe(true)

    act(() => ws.handlers.get("vehicle_positions_update")?.({ data: [fix("Pio")] }))
    expect(result.current.positions).toEqual([fix("Pio")])
  })

  it("asks nothing more on a station without Traccar", async () => {
    api.getTraccarStatus.mockResolvedValue({ configured: false })
    const { result } = renderHook(() => useVehiclePositions())
    await waitFor(() => expect(api.getTraccarStatus).toHaveBeenCalled())
    expect(result.current.configured).toBe(false)
    expect(api.getVehiclePositions).not.toHaveBeenCalled()
    expect(ws.handlers.has("vehicle_positions_update")).toBe(false)
  })

  it("asks nothing at all when disabled (token mode)", () => {
    renderHook(() => useVehiclePositions({ enabled: false }))
    expect(api.getTraccarStatus).not.toHaveBeenCalled()
  })
})
