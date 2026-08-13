import { describe, expect, it } from "vitest"
import { rekoDangerTypes } from "@/lib/contexts/operations-context"

// The board's two load paths used to derive these chips twice, and the copies
// drifted: the poll path never checked `fire_danger`, so a Reko whose only
// danger was Brandgefahr showed its chips after a manual refresh and lost them
// again on the next tick. One derivation now, with the case that broke first.
describe("rekoDangerTypes", () => {
  const none = {
    fire: false,
    fire_danger: false,
    explosion: false,
    collapse: false,
    chemical: false,
    electrical: false,
  }

  it("reads Brandgefahr — the only fire flag the Reko form ever writes", () => {
    expect(rekoDangerTypes({ ...none, fire_danger: true })).toEqual(["Brandgefahr"])
  })

  it("keeps the labels in reading order", () => {
    expect(rekoDangerTypes({ ...none, fire_danger: true, electrical: true, collapse: true })).toEqual([
      "Brandgefahr",
      "Einsturz",
      "Elektrisch",
    ])
  })

  it("says nothing when the Reko ticked nothing, and nothing when there is no assessment", () => {
    expect(rekoDangerTypes(none)).toEqual([])
    expect(rekoDangerTypes(null)).toEqual([])
  })
})
