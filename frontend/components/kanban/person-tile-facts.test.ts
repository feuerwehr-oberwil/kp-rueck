import { describe, expect, it } from "vitest"

import { einsatzWhere } from "./person-tile-facts"

// The Fahrer and Reko pickers named only Einsätze: an Auftrag's crew holds no row on its
// stops, so somebody out on «Sturmholz» read as free there (23.11.2026).
describe("einsatzWhere", () => {
  const sturmholz = { name: "Sturmholz", assignments: [{ id: "a1", resourceType: "personnel" as const, resourceId: "keller", driverStay: false, isLeader: false }] }

  it("names the Auftrag of an Auftrag crew", () => {
    expect(einsatzWhere("keller", [], [sturmholz])).toEqual({ head: "Sturmholz", full: "Sturmholz" })
  })

  it("leaves a person on nothing without a where", () => {
    expect(einsatzWhere("egger", [], [sturmholz])).toBeNull()
  })
})
