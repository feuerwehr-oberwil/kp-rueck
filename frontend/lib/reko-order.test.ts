import { describe, expect, it } from "vitest"
import type { Operation } from "@/lib/contexts/operations-context"
import { mergeOpenOrder, openRekosByPerson, rekosOf } from "./reko-order"

const op = (id: string, person: string | null, rekoPosition: number | null, extra: Partial<Operation> = {}): Operation =>
  ({
    id,
    status: "reko",
    hasCompletedReko: false,
    assignedReko: person ? { id: person, name: person } : null,
    rekoPosition,
    ...extra,
  }) as Operation

describe("rekosOf", () => {
  it("lists a person's Rekos in their order, unnumbered ones last as they came", () => {
    const ops = [op("late", "p1", null), op("b", "p1", 1), op("other", "p2", 0), op("a", "p1", 0), op("later", "p1", null)]
    expect(rekosOf(ops, "p1").map((o) => o.id)).toEqual(["a", "b", "late", "later"])
  })
})

describe("openRekosByPerson", () => {
  it("keeps only open Rekos, in order, and leaves out people with none open", () => {
    const ops = [
      op("b", "p1", 1),
      op("done", "p1", 0, { hasCompletedReko: true }),
      op("a", "p1", 2),
      op("closed", "p2", 0, { status: "complete" }),
    ]
    const byPerson = openRekosByPerson(ops)
    expect(byPerson.get("p1")?.map((o) => o.id)).toEqual(["b", "a"])
    expect(byPerson.has("p2")).toBe(false)
  })
})

describe("mergeOpenOrder", () => {
  it("puts the open ones in their new order into their own places; done ones stay", () => {
    // done sits between two open Rekos and keeps its slot.
    expect(mergeOpenOrder(["a", "done", "b", "c"], ["a", "b", "c"], ["c", "a", "b"])).toEqual(["c", "done", "a", "b"])
  })

  it("is null when nothing moves", () => {
    expect(mergeOpenOrder(["a", "b"], ["a", "b"], ["a", "b"])).toBeNull()
  })
})
