import { describe, expect, it, vi } from "vitest"
import { renderHook } from "@testing-library/react"

const board = vi.hoisted(() => ({
  vehicles: [
    { id: "v-dlk", name: "DLK", type: "DLK", status: "available", display_order: 3 },
    { id: "v-tlf", name: "TLF", type: "TLF", status: "available", display_order: 1 },
    { id: "v-mtw", name: "MTW", type: "MTW", status: "unavailable", display_order: 5 },
  ],
}))
vi.mock("../operations-context", () => ({ useOperations: () => board }))

import { useVehicleShortcuts } from "./use-vehicle-shortcuts"

describe("useVehicleShortcuts", () => {
  it("numbers every vehicle by its display_order, in that order – the board's rule, for the map too", () => {
    const { result } = renderHook(() => useVehicleShortcuts())
    expect(result.current.map((v) => [v.key, v.name])).toEqual([
      ["1", "TLF"],
      ["3", "DLK"],
      ["5", "MTW"],
    ])
  })

  it("keeps its answer while the fleet is the same array", () => {
    const { result, rerender } = renderHook(() => useVehicleShortcuts())
    const first = result.current
    rerender()
    expect(result.current).toBe(first)
  })
})
