import { describe, expect, it } from "vitest"
import {
  materialResourceState,
  personMatchesQuery,
  summarizeMaterials,
  summarizeRoster,
  vehicleResourceState,
} from "./resource-status"

// The one roster matcher, shared by the sidebar filter and the assignment
// dialogs. The regression it guards: searching "telefondienst" or
// "kommandoposten" found nobody, because only reko/fahrer/magazin were wired.
describe("personMatchesQuery", () => {
  const base = { name: "Egger Olivier", role: "Soldat" }

  it("matches name and rank, case-insensitively", () => {
    expect(personMatchesQuery(base, "egger")).toBe(true)
    expect(personMatchesQuery(base, "soldat")).toBe(true)
    expect(personMatchesQuery(base, "müller")).toBe(false)
  })

  it("finds the person holding Telefondienst / Kommandoposten by the function name", () => {
    expect(personMatchesQuery({ ...base, isTelefondienst: true }, "telefondienst")).toBe(true)
    expect(personMatchesQuery({ ...base, isTelefondienst: true }, "telefon")).toBe(true)
    expect(personMatchesQuery({ ...base, isKommandoposten: true }, "kommandoposten")).toBe(true)
    expect(personMatchesQuery({ ...base, isKommandoposten: true }, "kommando")).toBe(true)
    // …but never someone who does not hold the function.
    expect(personMatchesQuery(base, "telefondienst")).toBe(false)
    expect(personMatchesQuery(base, "kommandoposten")).toBe(false)
  })

  it("keeps the established function matches: reko, fahrer, magazin, vehicle name", () => {
    expect(personMatchesQuery({ ...base, isReko: true }, "reko")).toBe(true)
    expect(personMatchesQuery({ ...base, isDriver: true }, "fahrer")).toBe(true)
    expect(personMatchesQuery({ ...base, isDriver: true, driverVehicleName: "TLF" }, "tlf")).toBe(true)
    expect(personMatchesQuery({ ...base, isMagazin: true }, "magazin")).toBe(true)
  })

  it("matches tags and treats a blank query as match-all", () => {
    expect(personMatchesQuery({ ...base, tags: ["F"] }, "f")).toBe(true)
    expect(personMatchesQuery(base, "  ")).toBe(true)
  })
})

// The three-state precedence and the two counters that have to agree with the
// lists above them. Both were real board bugs, not hypotheticals: the recompute
// on load derived a material's whole state from the assignments and thereby
// erased a recorded defect, and the sidebar footer counted a raw API field while
// the list next to it counted something else.
describe("materialResourceState precedence", () => {
  it("puts «nicht einsatzbereit» above deployment", () => {
    expect(materialResourceState({ status: "assigned", outOfService: true })).toBe("unavailable")
  })

  it("puts «nicht einsatzbereit» above the consumable exemption", () => {
    // A broken barrel of Ölbindemittel is not "unlimited", it is broken.
    expect(materialResourceState({ consumable: true, outOfService: true })).toBe("unavailable")
  })

  it("leaves deployment above available, and consumables always free", () => {
    expect(materialResourceState({ status: "assigned" })).toBe("assigned")
    expect(materialResourceState({ status: "assigned", consumable: true })).toBe("available")
    expect(materialResourceState({ status: "available" })).toBe("available")
  })
})

describe("vehicleResourceState", () => {
  it("answers all three states — vehicles used to consult none of them", () => {
    expect(vehicleResourceState({ outOfService: true, assigned: true })).toBe("unavailable")
    expect(vehicleResourceState({ assigned: true })).toBe("assigned")
    expect(vehicleResourceState({})).toBe("available")
  })
})

describe("summarizeRoster", () => {
  it("counts a Fahrer, a Reko and a Magaziner as bound, not as free", () => {
    // The footer read `status === "available"` and got 4 here, over a list that
    // showed one row.
    const summary = summarizeRoster([
      { status: "available" },
      { status: "available", isReko: true },
      { status: "available", isDriver: true },
      { status: "available", isMagazin: true },
      { status: "assigned" },
    ])
    expect(summary).toEqual({ free: 1, bound: 4, total: 5 })
  })
})

describe("summarizeMaterials", () => {
  it("counts an out-of-service device as bound and a consumable as free", () => {
    const summary = summarizeMaterials([
      { status: "available" },
      { status: "assigned" },
      { status: "available", outOfService: true },
      { status: "assigned", consumable: true },
    ])
    expect(summary).toEqual({ free: 2, bound: 2, total: 4 })
  })
})
