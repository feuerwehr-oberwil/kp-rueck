import { describe, it, expect } from "vitest"
import { renderHook } from "@testing-library/react"
import { useResourceFiltering } from "./use-resource-filtering"
import type { Person, Material } from "@/lib/contexts/operations-context"

const person = (over: Partial<Person> & { name: string }): Person =>
  ({ id: over.name, status: "available", role: "Mannschaft", ...over }) as Person

const material = (over: Partial<Material> & { name: string }): Material =>
  ({ id: over.name, status: "available", category: "Depot", ...over }) as Material

// The sidebar toggle must hide exactly what the cards draw as busy — including
// people who are only tied up by a special function (Fahrer/Reko/Magazin) and
// therefore still carry status "available".
const PERSONNEL = [
  person({ name: "Frei Anna" }),
  person({ name: "Zugewiesen Bea", status: "assigned" }),
  person({ name: "Fahrer Cem", isDriver: true, driverVehicleName: "Pio" }),
  person({ name: "Reko Dina", isReko: true }),
  person({ name: "Magazin Elio", isMagazin: true }),
]

const MATERIALS = [
  material({ name: "Tauchpumpe" }),
  material({ name: "Motorsäge", status: "assigned" }),
  // Consumables are stock, not lent out — handing some out does not make the
  // depot empty, so they stay visible under the filter.
  material({ name: "Ölbindemittel", status: "assigned", consumable: true }),
]

const names = (groups: Record<string, Array<{ name: string }>>) =>
  Object.values(groups).flat().map((x) => x.name).sort()

describe("useResourceFiltering — availableOnly", () => {
  it("returns everything when the toggle is off", () => {
    const { result } = renderHook(() =>
      useResourceFiltering(PERSONNEL, MATERIALS, "", "", "Andere"),
    )
    expect(names(result.current.groupedPersonnel)).toHaveLength(5)
    expect(names(result.current.groupedMaterials)).toHaveLength(3)
  })

  it("hides assigned people AND those tied up by a special function", () => {
    const { result } = renderHook(() =>
      useResourceFiltering(PERSONNEL, MATERIALS, "", "", "Andere", { personnel: true }),
    )
    expect(names(result.current.groupedPersonnel)).toEqual(["Frei Anna"])
    // material list untouched by the personnel toggle
    expect(names(result.current.groupedMaterials)).toHaveLength(3)
  })

  it("hides assigned material but keeps consumables", () => {
    const { result } = renderHook(() =>
      useResourceFiltering(PERSONNEL, MATERIALS, "", "", "Andere", { materials: true }),
    )
    expect(names(result.current.groupedMaterials)).toEqual(["Tauchpumpe", "Ölbindemittel"].sort())
    expect(names(result.current.groupedPersonnel)).toHaveLength(5)
  })

  it("combines with the search query instead of replacing it", () => {
    const { result } = renderHook(() =>
      useResourceFiltering(PERSONNEL, MATERIALS, "frei", "", "Andere", { personnel: true }),
    )
    expect(names(result.current.groupedPersonnel)).toEqual(["Frei Anna"])
  })

  it("recomputes when the toggle flips", () => {
    const { result, rerender } = renderHook(
      ({ on }: { on: boolean }) =>
        useResourceFiltering(PERSONNEL, MATERIALS, "", "", "Andere", { personnel: on }),
      { initialProps: { on: false } },
    )
    expect(names(result.current.groupedPersonnel)).toHaveLength(5)
    rerender({ on: true })
    expect(names(result.current.groupedPersonnel)).toEqual(["Frei Anna"])
  })
})
