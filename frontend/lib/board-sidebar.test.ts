import { describe, it, expect } from "vitest"
import {
  aggregateByName,
  isNavigableBinding,
  shortDate,
  soleDestination,
  type ResourceBinding,
} from "./board-sidebar"
import type { Material } from "@/lib/contexts/materials-context"

function mat(id: string, name: string, overrides: Partial<Material> = {}): Material {
  return {
    id,
    name,
    category: "Depot",
    type: "type",
    status: "available",
    outOfService: false,
    outOfServiceSince: null,
    categorySortOrder: 0,
    consumable: false,
    groupId: null,
    ...overrides,
  }
}

const binding = (key: string, kind: ResourceBinding["kind"], targetId: string | null): ResourceBinding => ({
  key,
  kind,
  targetId,
  label: key,
  detail: "",
})

describe("isNavigableBinding", () => {
  it("follows an incident or a route that still has a target", () => {
    expect(isNavigableBinding(binding("i", "incident", "op-1"))).toBe(true)
    expect(isNavigableBinding(binding("r", "route", "g-1"))).toBe(true)
  })

  it("refuses a station function and anything that lost its target", () => {
    expect(isNavigableBinding(binding("fn", "function", null))).toBe(false)
    // A function is never followed, even if something put an id on it.
    expect(isNavigableBinding(binding("fn", "function", "op-1"))).toBe(false)
    expect(isNavigableBinding(binding("i", "incident", null))).toBe(false)
    expect(isNavigableBinding(binding("i", "incident", ""))).toBe(false)
  })
})

describe("soleDestination", () => {
  it("jumps straight to the one reachable place, whatever its kind", () => {
    const incident = binding("i", "incident", "op-1")
    expect(soleDestination([incident])).toBe(incident)
    const route = binding("r", "route", "g-1")
    expect(soleDestination([route])).toBe(route)
  })

  it("asks when there is a choice", () => {
    expect(soleDestination([binding("a", "incident", "op-1"), binding("b", "route", "g-1")])).toBeNull()
  })

  it("asks when one place is reachable but another binding exists beside it", () => {
    // One incident + the Fahrer function: the popover must still name both.
    expect(soleDestination([binding("a", "incident", "op-1"), binding("fn", "function", null)])).toBeNull()
  })

  it("has nowhere to go for nothing, or for a lone station function", () => {
    expect(soleDestination([])).toBeNull()
    expect(soleDestination([binding("fn", "function", null)])).toBeNull()
  })
})

describe("shortDate", () => {
  it("stamps day and month, zero-padded, with the trailing dots", () => {
    expect(shortDate("2026-08-19T10:00:00")).toBe("19.08.")
    expect(shortDate("2026-01-05T10:00:00")).toBe("05.01.")
  })

  it("says nothing for a missing or unreadable value", () => {
    expect(shortDate(null)).toBe("")
    expect(shortDate("")).toBe("")
    expect(shortDate("not a date")).toBe("")
  })
})

describe("aggregateByName", () => {
  it("folds identical devices into one bundle, in order of first appearance", () => {
    const a1 = mat("a1", "Wassersauger")
    const b1 = mat("b1", "Motorsäge")
    const a2 = mat("a2", "Wassersauger")
    const a3 = mat("a3", "Wassersauger")
    expect(aggregateByName([a1, b1, a2, a3])).toEqual([[a1, a2, a3], [b1]])
  })

  it("keeps consumables single even when they share a name", () => {
    const s1 = mat("s1", "Schlauch", { consumable: true })
    const s2 = mat("s2", "Schlauch", { consumable: true })
    expect(aggregateByName([s1, s2])).toEqual([[s1], [s2]])
  })

  it("does not fold a consumable into a same-named device bundle", () => {
    const d1 = mat("d1", "Sandsack")
    const c1 = mat("c1", "Sandsack", { consumable: true })
    const d2 = mat("d2", "Sandsack")
    expect(aggregateByName([d1, c1, d2])).toEqual([[d1, d2], [c1]])
  })

  it("returns nothing for nothing", () => {
    expect(aggregateByName([])).toEqual([])
  })
})
