import { describe, expect, it } from "vitest"
import { personMatchesQuery } from "./resource-status"

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
