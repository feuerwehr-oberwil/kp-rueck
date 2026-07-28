import { describe, expect, it } from "vitest"
import { findAuftragForStop } from "./kanban-utils"

const auftrag = (id: string, stopIds: string[]) => ({ id, stopIds })

describe("findAuftragForStop", () => {
  const routes = [auftrag("g1", ["i1", "i2"]), auftrag("g2", ["i3"])]

  it("resolves through the incident's own groupId", () => {
    expect(findAuftragForStop(routes, { id: "i3", groupId: "g2" })?.id).toBe("g2")
  })

  it("finds the route of a stop whose groupId has not arrived yet", () => {
    // The window right after «+ Stop»: the route knows the stop, the incident
    // does not yet know the route. Without this the stop reads as a lone
    // Einsatz — wrong Funkdurchsage, wrong assignment target, wrong checklist.
    expect(findAuftragForStop(routes, { id: "i2", groupId: null })?.id).toBe("g1")
  })

  it("falls back to the stop lists when groupId points at a route that is gone", () => {
    expect(findAuftragForStop(routes, { id: "i1", groupId: "deleted" })?.id).toBe("g1")
  })

  it("returns undefined for an incident that really is ungrouped", () => {
    expect(findAuftragForStop(routes, { id: "loner", groupId: null })).toBeUndefined()
    expect(findAuftragForStop(routes, null)).toBeUndefined()
  })
})
