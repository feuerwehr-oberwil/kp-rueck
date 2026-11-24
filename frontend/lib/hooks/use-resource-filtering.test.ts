import { describe, it, expect } from "vitest"
import { renderHook } from "@testing-library/react"
import { useResourceFiltering } from "./use-resource-filtering"
import type { Person, Material } from "@/lib/contexts/operations-context"

const person = (over: Partial<Person> & { name: string }): Person =>
  ({ id: over.name, status: "available", role: "Mannschaft", ...over }) as Person

const material = (over: Partial<Material> & { name: string }): Material =>
  ({ id: over.name, status: "available", category: "Depot", ...over }) as Material

const personNames = (people: Person[]) => people.map((p) => p.name)

// The material search reads all three axes: the device, its Typ («alle Sägen») and its
// Standort («alles auf dem Pio»).
describe("useResourceFiltering — material search", () => {
  const DEPOT = [
    material({ name: "Motorsäge", type: "Sägen", category: "Pio" }),
    material({ name: "Tauchpumpe", type: "Pumpen", category: "TLF" }),
  ]
  const search = (query: string) =>
    renderHook(() => useResourceFiltering([], DEPOT, "", query)).result.current.filteredMaterials.map((m) => m.name)

  it("finds a device by its Typ and by its Standort", () => {
    expect(search("sägen")).toEqual(["Motorsäge"])
    expect(search("tlf")).toEqual(["Tauchpumpe"])
  })
})

// The search must find people by the Ereignis function they carry — the person
// on the phone desk IS "telefondienst" for the operator typing that.
describe("useResourceFiltering — search by special function", () => {
  const ROSTER = [
    person({ name: "Telefon Fritz", isTelefondienst: true }),
    person({ name: "Posten Gina", isKommandoposten: true }),
    person({ name: "Frei Anna" }),
  ]

  it("finds the Telefondienst by function name", () => {
    const { result } = renderHook(() =>
      useResourceFiltering(ROSTER, [], "telefondienst", ""),
    )
    expect(personNames(result.current.filteredPersonnel)).toEqual(["Telefon Fritz"])
  })

  it("finds the Kommandoposten by function name", () => {
    const { result } = renderHook(() =>
      useResourceFiltering(ROSTER, [], "kommandoposten", ""),
    )
    expect(personNames(result.current.filteredPersonnel)).toEqual(["Posten Gina"])
  })
})
