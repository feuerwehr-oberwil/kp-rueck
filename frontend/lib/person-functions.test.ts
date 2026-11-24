import { describe, expect, it } from "vitest"
import type { ResourceBinding } from "./board-sidebar"
import { REKO_TARGET, RESOURCES_TARGET } from "./detail-target"
import { personChecklist, personFunctionItems, type ChecklistRow } from "./person-functions"

const fleet = [
  { id: "v-tlf", name: "TLF" },
  { id: "v-trawa", name: "Trawa" },
]

const crewOn = (opId: string, label: string): ResourceBinding => ({
  key: `incident-${opId}`,
  kind: "incident",
  targetId: opId,
  label,
  detail: "Mannschaft",
  target: RESOURCES_TARGET,
})

const rowName = (row: ChecklistRow) =>
  row.kind === "place" ? row.binding.label : row.kind === "driver" ? "Fahrer" : row.item.functionType

describe("personFunctionItems", () => {
  it("is the right-click menu's list: one driver item per vehicle, then the four functions", () => {
    const items = personFunctionItems({ id: "p1", isMagazin: true }, fleet, new Map())
    expect(items.map((item) => item.key)).toEqual(["driver-v-tlf", "driver-v-trawa", "reko", "magazin", "telefondienst", "kommandoposten"])
    expect(items.filter((item) => item.held).map((item) => item.key)).toEqual(["magazin"])
  })

  it("names the other driver of a vehicle and trusts the live map over a stale flag", () => {
    const drivers = new Map([["v-tlf", { name: "Keller Marco", personnelId: "p2" }]])
    const items = personFunctionItems({ id: "p1", isDriver: true, driverVehicleId: "v-tlf" }, fleet, drivers)
    const tlf = items.find((item) => item.key === "driver-v-tlf")
    expect(tlf).toMatchObject({ held: false, holder: { personnelId: "p2" } })
  })
})

describe("personChecklist", () => {
  it("puts what is held on top and the rest below", () => {
    const items = personFunctionItems({ id: "p1", isKommandoposten: true }, fleet, new Map())
    const list = personChecklist([], items, null)
    expect(list.held.map(rowName)).toEqual(["kommandoposten"])
    // Fahrer last among the free ones: it needs a vehicle first.
    expect(list.free.map(rowName)).toEqual(["reko", "magazin", "telefondienst", "Fahrer"])
    expect(list.count).toBe(1)
  })

  it("counts a driver who is crew on the vehicle's Einsatz once (UX.15)", () => {
    const items = personFunctionItems({ id: "p1", isDriver: true, driverVehicleId: "v-trawa" }, fleet, new Map())
    const list = personChecklist([crewOn("op-14", "14 · Poststrasse 6")], items, { id: "op-14", label: "14 · Poststrasse 6" })
    expect(list.count).toBe(1)
    expect(list.held[0]).toMatchObject({ kind: "place", drives: "Trawa" })
    // The Fahrer tick stays, so the role can still be ended – but it names no second place.
    expect(list.held[1]).toMatchObject({ kind: "driver", held: { vehicleId: "v-trawa" }, where: null })
  })

  it("names the vehicle's Einsatz on the Fahrer row when the person is not crew there", () => {
    const items = personFunctionItems({ id: "p1", isDriver: true, driverVehicleId: "v-trawa" }, fleet, new Map())
    const list = personChecklist([], items, { id: "op-14", label: "14 · Poststrasse 6" })
    expect(list.count).toBe(1)
    expect(list.held).toEqual([expect.objectContaining({ kind: "driver", where: "14 · Poststrasse 6" })])
  })

  it("counts the Reko function once when its Einsätze are listed", () => {
    const reko: ResourceBinding = { ...crewOn("op-3", "3 · Bahnhof"), key: "reko-op-3", detail: "Reko", target: REKO_TARGET }
    const items = personFunctionItems({ id: "p1", isReko: true }, fleet, new Map())
    const list = personChecklist([reko], items, null)
    expect(list.held.map(rowName)).toEqual(["3 · Bahnhof", "reko"])
    expect(list.count).toBe(1)
  })
})
