import { describe, expect, it } from "vitest"
import {
  materialResourceState,
  isPersonOccupied,
  personResourceState,
  personMatchesQuery,
  summarizeMaterials,
  summarizeRoster,
  vehicleResourceState,
  toResourceState,
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

  it("matches any tag, rather than requiring every tag", () => {
    expect(personMatchesQuery({ ...base, tags: ["Sanität", "Atemschutz"] }, "ATEMSCHUTZ")).toBe(true)
    expect(personMatchesQuery({ ...base, tags: [] }, "missing")).toBe(false)
    expect(personMatchesQuery({ name: "Meier", role: null, tags: null }, "missing")).toBe(false)
  })

  it.each(["isReko", "isDriver", "isMagazin", "isTelefondienst", "isKommandoposten"] as const)(
    "%s is not a match for an unrelated query", (role) => {
      expect(personMatchesQuery({ ...base, [role]: true }, "nobody")).toBe(false)
    },
  )

  it("does not assign special functions to someone who does not hold them", () => {
    for (const query of ["reko", "fahrer", "driver", "magazin"]) expect(personMatchesQuery(base, query)).toBe(false)
    expect(personMatchesQuery({ ...base, isDriver: true }, "driver")).toBe(true)
  })
})

describe("person resource state", () => {
  it.each([
    ["available", "available"], ["assigned", "assigned"], ["planned", "assigned"], ["maintenance", "maintenance"],
    ["unavailable", "unavailable"], ["unknown", "unavailable"], [null, "unavailable"], [undefined, "unavailable"],
  ] as const)("normalizes %s to %s", (input, expected) => expect(toResourceState(input)).toBe(expected))

  it("binds available Reko and route crew without overriding unavailability", () => {
    expect(personResourceState({ status: "available" })).toBe("available")
    expect(personResourceState({ status: "available", isReko: true })).toBe("assigned")
    expect(personResourceState({ status: "available", isOnAuftrag: true })).toBe("assigned")
    expect(personResourceState({ status: "unavailable", isReko: true })).toBe("unavailable")
    expect(personResourceState({ status: "maintenance", isOnAuftrag: true })).toBe("maintenance")
  })

  it("distinguishes occupied functions from free and checked-out people", () => {
    expect(isPersonOccupied({ status: "available" })).toBe(false)
    expect(isPersonOccupied({ status: "unavailable" })).toBe(false)
    expect(isPersonOccupied({ status: "assigned" })).toBe(true)
    for (const role of ["isReko", "isOnAuftrag", "isDriver", "isMagazin", "isTelefondienst", "isKommandoposten"] as const) {
      expect(isPersonOccupied({ status: "available", [role]: true })).toBe(true)
    }
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

  it("counts an uneven mix and an empty inventory", () => {
    expect(summarizeMaterials([{ status: "available" }, { status: "assigned" }, { status: "available", outOfService: true }]))
      .toEqual({ free: 1, bound: 2, total: 3 })
    expect(summarizeMaterials([])).toEqual({ free: 0, bound: 0, total: 0 })
  })
})
