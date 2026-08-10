import { describe, expect, it } from "vitest"

import { isDispatchedStatus, rapportApplies } from "@/lib/rapport-visibility"

describe("rapportApplies", () => {
  it("hides the rapport on a Schadenplatz nobody was ever sent to", () => {
    expect(rapportApplies({ hasBeenDispatched: false, status: "incoming" })).toBe(false)
    expect(rapportApplies({ hasBeenDispatched: false, status: "reko" })).toBe(false)
    expect(rapportApplies({ hasBeenDispatched: false, status: "reko_done" })).toBe(false)
  })

  it("answers 'ever', not 'now' — a closed incident keeps its rapport", () => {
    // The state most rapports are filed in: the crew is home, the card is
    // archived, and the paperwork is what is left.
    expect(rapportApplies({ hasBeenDispatched: true, status: "complete" })).toBe(true)
  })

  it("reveals the rapport the moment a card is dragged into a working column", () => {
    // The backend flag is one refetch behind an optimistic drag, so the current
    // status counts on its own.
    expect(rapportApplies({ hasBeenDispatched: false, status: "enroute" })).toBe(true)
    expect(rapportApplies({ hasBeenDispatched: false, status: "active" })).toBe(true)
    expect(rapportApplies({ hasBeenDispatched: false, status: "returning" })).toBe(true)
  })

  it("does not read `complete` as proof that anybody went", () => {
    // Eingegangen → Abgeschlossen in one drag is the false alarm, the duplicate,
    // the call that resolved itself. That is the noise this rule removes, and
    // it is the case the whole feature exists for.
    expect(rapportApplies({ hasBeenDispatched: false, status: "complete" })).toBe(false)
    expect(isDispatchedStatus("complete")).toBe(false)
  })

  it("never hides a rapport somebody already filed", () => {
    // Data older than the rule, or a card whose history says otherwise: written
    // work always wins over the gate.
    expect(rapportApplies({ hasBeenDispatched: false, status: "incoming", hasReport: true })).toBe(true)
  })

  it("says no when it knows nothing at all", () => {
    expect(rapportApplies({})).toBe(false)
  })
})
