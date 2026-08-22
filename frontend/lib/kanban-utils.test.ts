import { describe, expect, it } from "vitest"
import { findAuftragForStop, remainingRouteStops, startableNextStop } from "./kanban-utils"
import type { OperationStatus } from "./contexts/operations-context"

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

describe("remainingRouteStops", () => {
  const stop = (id: string, status: OperationStatus) => ({ id, status })
  const route = { stopIds: ["i1", "i2", "i3"] }

  it("is empty for the last stop still open — that one really ends the Auftrag", () => {
    const operations = [stop("i1", "complete"), stop("i2", "returning"), stop("i3", "active")]
    expect(remainingRouteStops(route, operations, "i3")).toEqual([])
  })

  it("hands back what is still ahead, in route order", () => {
    const operations = [stop("i1", "returning"), stop("i2", "incoming"), stop("i3", "reko")]
    expect(remainingRouteStops(route, operations, "i1").map((s) => s.id)).toEqual(["i2", "i3"])
  })

  it("counts «Beendet / Rückfahrt» as done, like the board does", () => {
    // The squad has left that scene, so nothing about it is still ahead of them.
    const operations = [stop("i1", "active"), stop("i2", "returning"), stop("i3", "complete")]
    expect(remainingRouteStops(route, operations, "i1")).toEqual([])
  })

  it("ignores stop ids the operations list does not carry", () => {
    // A stop filtered out by the training/live split, or removed a moment ago.
    expect(remainingRouteStops(route, [stop("i1", "active")], "i1")).toEqual([])
  })
})

describe("startableNextStop", () => {
  const stop = (id: string, status: OperationStatus) => ({ id, status })
  const route = { stopIds: ["i1", "i2", "i3"] }

  it("names the first stop nobody has driven to yet, in route order", () => {
    const operations = [stop("i1", "returning"), stop("i2", "reko"), stop("i3", "incoming")]
    expect(startableNextStop(route, operations, "i1")?.id).toBe("i2")
  })

  it("offers nothing while another stop of the Auftrag is in Einsatz", () => {
    // The squad is not free — offering to start a stop would be offering work
    // they are already doing.
    const operations = [stop("i1", "returning"), stop("i2", "active"), stop("i3", "incoming")]
    expect(startableNextStop(route, operations, "i1")).toBeNull()
  })

  it("offers nothing for the last stop of a route", () => {
    const operations = [stop("i1", "complete"), stop("i2", "complete"), stop("i3", "returning")]
    expect(startableNextStop(route, operations, "i3")).toBeNull()
  })

  it("is unaffected by the state of the stop being closed", () => {
    // The prompt asks from «Beendet», the completion gate from «Abgeschlossen»
    // — the closing stop is excluded by id, so both see the same next stop.
    const operations = [stop("i1", "complete"), stop("i2", "incoming"), stop("i3", "incoming")]
    expect(startableNextStop(route, operations, "i1")?.id).toBe("i2")
  })
})
