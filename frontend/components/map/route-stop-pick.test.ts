/**
 * The click rule both Auftrag maps share (Routen-Editor + stop picker): the numbers a pick
 * gets, and what a click on a pin does.
 */

import { describe, expect, it } from "vitest"
import type { IncidentGroup } from "@/lib/types/groups"
import { stopPinClick, stopSequence } from "./route-stop-pick"

const south = { id: "g-south", name: "Auftrag Süd" } as IncidentGroup
const otherRouteOf = (id: string) => (id === "taken" ? south : undefined)

describe("stopSequence", () => {
  it("keeps the route's order, then appends picks in click order", () => {
    expect(stopSequence(["a", "b"], new Set(["a", "b", "y", "x"]))).toEqual(["a", "b", "y", "x"])
  })

  it("renumbers when a stop or a pick is dropped", () => {
    expect(stopSequence(["a", "b", "c"], new Set(["a", "c", "x"]))).toEqual(["a", "c", "x"])
  })

  it("follows the route's order, not the order the picks were ticked in", () => {
    expect(stopSequence(["a", "b"], new Set(["b", "a"]))).toEqual(["a", "b"])
  })
})

describe("stopPinClick", () => {
  const sequence = new Set(["a", "x"])

  it("drops a pin already in the sequence", () => {
    expect(stopPinClick("x", sequence, otherRouteOf)).toEqual({ kind: "drop" })
  })

  it("adds a free incident as the next stop", () => {
    expect(stopPinClick("free", sequence, otherRouteOf)).toEqual({ kind: "add" })
  })

  it("asks before moving another Auftrag's stop, naming that Auftrag", () => {
    expect(stopPinClick("taken", sequence, otherRouteOf)).toEqual({ kind: "move", from: south })
  })
})
