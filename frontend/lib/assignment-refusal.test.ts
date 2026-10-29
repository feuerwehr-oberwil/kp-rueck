import { describe, expect, it } from "vitest"
import { ApiError } from "@/lib/api-client"
import { assignFailureDescription, refusalReason } from "./assignment-refusal"

describe("assignment refusals (409)", () => {
  it("says the server's reason for a refusal", () => {
    const archived = new ApiError("Dieses Fahrzeug ist archiviert.", 409, true)
    expect(refusalReason(archived)).toBe("Dieses Fahrzeug ist archiviert.")
    expect(assignFailureDescription(archived, "TLF")).toBe("Dieses Fahrzeug ist archiviert.")
  })

  it("keeps the race wording for the generic conflict and a 409 without a detail", () => {
    for (const message of ["Ressource bereits zugewiesen", "Konflikt bei der Verarbeitung", "409 Conflict"]) {
      const race = new ApiError(message, 409, true)
      expect(refusalReason(race)).toBeNull()
      expect(assignFailureDescription(race, "TLF")).toBe("TLF wurde gerade von jemand anderem geändert – bitte erneut versuchen.")
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
