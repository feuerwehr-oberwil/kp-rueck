import { act, renderHook, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { ApiMaterialGroup } from "@/lib/api-client"

const api = vi.hoisted(() => ({ getAllMaterials: vi.fn(), getMaterialGroups: vi.fn() }))
vi.mock("@/lib/api-client", () => ({ apiClient: api }))
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }))

import { useMaterialList } from "./use-resource-lists"

const EVENT = "11111111-1111-1111-1111-111111111111"

function module(name: string): ApiMaterialGroup {
  return {
    id: "g1",
    name,
    description: null,
    location: "Magazin",
    location_sort_order: 0,
    materials: [],
    created_at: "2026-11-25T10:00:00Z",
    updated_at: "2026-11-25T10:00:00Z",
  }
}

describe("useMaterialList (hunt follow-up 25.11.)", () => {
  it("a depot reload brings a Modul renamed in Einstellungen", async () => {
    api.getAllMaterials.mockResolvedValue([])
    api.getMaterialGroups.mockResolvedValue([module("Modul 1")])
    const { result } = renderHook(() => useMaterialList(EVENT, true))
    await waitFor(() => expect(result.current.materialGroups.map((group) => group.name)).toEqual(["Modul 1"]))

    // The board's load after the sync version moved.
    api.getMaterialGroups.mockResolvedValue([module("Pumpenmodul")])
    await act(() => result.current.refreshMaterials({ skipStateUpdate: true }))
    await waitFor(() => expect(result.current.materialGroups.map((group) => group.name)).toEqual(["Pumpenmodul"]))
  })
})
