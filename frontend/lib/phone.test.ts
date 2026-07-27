import { describe, expect, it } from "vitest"
import { telHref } from "./phone"

// Numbers arrive as people type them. Two of the three call sites used to strip whitespace
// only, so anything in brackets rode into the href and the link quietly did nothing.
describe("telHref", () => {
  it("dials a Swiss number written with spaces", () => {
    expect(telHref("061 401 12 34")).toBe("tel:0614011234")
  })

  it("keeps a leading + for international numbers", () => {
    expect(telHref("+41 61 401 12 34")).toBe("tel:+41614011234")
  })

  it("drops a note in brackets instead of putting it in the href", () => {
    expect(telHref("079 123 45 67 (Nachbar)")).toBe("tel:0791234567")
  })

  it("survives slashes, dots and dashes", () => {
    expect(telHref("061/401.12-34")).toBe("tel:0614011234")
  })

  it("returns null when there is nothing dialable, so the caller renders plain text", () => {
    expect(telHref("")).toBeNull()
    expect(telHref(null)).toBeNull()
    expect(telHref(undefined)).toBeNull()
    expect(telHref("siehe Meldung")).toBeNull()
    expect(telHref("  ")).toBeNull()
  })
})
