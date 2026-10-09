import { describe, expect, it } from "vitest"

import { printNumbering } from "./print-view"

describe("printNumbering", () => {
  it("prints every Einsatz under its own number, which is also its map marker", () => {
    const numbering = printNumbering([
      { id: "a", number: 14 },
      { id: "b", number: 3 },
    ])
    expect([...numbering]).toEqual([
      ["a", 14],
      ["b", 3],
    ])
  })

  it("counts in print order when any Einsatz has no number (never two under one)", () => {
    const numbering = printNumbering([
      { id: "a", number: 2 },
      { id: "b", number: null },
      { id: "c" },
    ])
    expect([...numbering]).toEqual([
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ])
  })
})
