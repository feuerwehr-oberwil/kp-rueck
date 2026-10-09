import { describe, expect, it } from "vitest"

import { getIncidentRefLabel } from "./incident-types"

describe("getIncidentRefLabel", () => {
  const op = { location: "Bachweg 3, 4104 Oberwil", locationDisplay: "Bachweg 3", incidentType: "elementarereignis", notes: "Wasser im Keller" }

  it("leads with the Einsatz number, as on the card and in ⌘K", () => {
    expect(getIncidentRefLabel({ ...op, number: 14 })).toBe("14 · Bachweg 3 (Elementarereignis: Wasser im Keller)")
  })

  it("reads as before for an Einsatz without a number", () => {
    expect(getIncidentRefLabel(op)).toBe("Bachweg 3 (Elementarereignis: Wasser im Keller)")
    expect(getIncidentRefLabel({ ...op, number: null })).toBe("Bachweg 3 (Elementarereignis: Wasser im Keller)")
  })
})
