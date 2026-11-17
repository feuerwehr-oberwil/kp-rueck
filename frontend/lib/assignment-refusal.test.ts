import { describe, expect, it } from "vitest"
import { ApiError } from "@/lib/api-client"
import { ASSIGNMENT_RACE_CODE, assignFailureDescription, refusalReason } from "./assignment-refusal"

describe("assignment refusals (409)", () => {
  it("says the server's reason for a refusal", () => {
    const archived = new ApiError("Dieses Fahrzeug ist archiviert.", 409, true)
    expect(refusalReason(archived)).toBe("Dieses Fahrzeug ist archiviert.")
    expect(assignFailureDescription(archived, "TLF")).toBe("Dieses Fahrzeug ist archiviert.")
  })

  it("keeps the race wording for the race code – whatever its sentence – and a 409 without a detail", () => {
    for (const race of [
      new ApiError("Ressource bereits zugewiesen", 409, true, ASSIGNMENT_RACE_CODE),
      new ApiError("Irgendein neuer Wortlaut", 409, true, ASSIGNMENT_RACE_CODE),
      new ApiError("409 Conflict", 409, true),
    ]) {
      expect(refusalReason(race)).toBeNull()
      expect(assignFailureDescription(race, "TLF")).toBe("TLF wurde gerade von jemand anderem geändert – nichts zugewiesen.")
    }
  })

  it("is not a refusal when the call failed otherwise", () => {
    expect(refusalReason(new ApiError("Serverfehler", 500))).toBeNull()
    expect(assignFailureDescription(new Error("offline"), "TLF")).toBe("TLF konnte nicht zugewiesen werden.")
  })

  it("trims a refusal and only treats a leading HTTP status as generic", () => {
    expect(refusalReason(new ApiError("  Fahrzeug ist archiviert.  ", 409, true))).toBe("Fahrzeug ist archiviert.")
    expect(refusalReason(new ApiError("  ", 409, true))).toBeNull()
    expect(refusalReason(new ApiError("Konflikt mit Einsatz 409", 409, true))).toBe("Konflikt mit Einsatz 409")
  })
})
