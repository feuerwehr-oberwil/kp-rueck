import { describe, expect, it } from "vitest"
import { buildLabel } from "./build-info"

describe("buildLabel", () => {
  it("reads «v<version> · <commit> · <build date>», like KP Front", () => {
    expect(buildLabel({ version: "0.7.0", sha: "1a2b3c4", time: "2026-10-03T08:00:00Z" })).toBe("v0.7.0 · 1a2b3c4 · 03.10.2026")
  })
  it("leaves out what the build did not know", () => {
    expect(buildLabel({ version: "0.7.0", sha: "", time: "2026-10-03T08:00:00Z" })).toBe("v0.7.0 · 03.10.2026")
    expect(buildLabel({ version: "0.7.0", sha: "", time: "" })).toBe("v0.7.0")
  })
})
