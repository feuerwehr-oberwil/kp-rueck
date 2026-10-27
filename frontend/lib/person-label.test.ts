import { describe, expect, it } from "vitest"
import { ambiguousNameKeys, nameKey, personLabelText, shownKennung } from "./person-label"

const roster = [
  { name: "Meier Alex", kennung: "1985" },
  { name: "  meier   alex ", kennung: null },
  { name: "Muster Hans", kennung: "412" },
]

describe("Kennung shown only for namesakes", () => {
  it("compares names like the backend's name_key: trimmed, collapsed, case-insensitive", () => {
    expect(nameKey("  Meier   ALEX ")).toBe("meier alex")
    expect(ambiguousNameKeys(roster)).toEqual(new Set(["meier alex"]))
  })

  it("names a namesake with the Kennung, or «?» when it has none", () => {
    const ambiguous = ambiguousNameKeys(roster)
    expect(shownKennung(roster[0], ambiguous)).toBe("1985")
    expect(shownKennung(roster[1], ambiguous)).toBe("?")
    expect(personLabelText(roster[0], ambiguous)).toBe("Meier Alex (1985)")
    expect(personLabelText(roster[0], ambiguous, "inline")).toBe("Meier Alex · 1985")
  })

  it("keeps a unique name plain, Kennung or not", () => {
    const ambiguous = ambiguousNameKeys(roster)
    expect(shownKennung(roster[2], ambiguous)).toBeNull()
    expect(personLabelText(roster[2], ambiguous)).toBe("Muster Hans")
  })
})
