import { describe, expect, it } from "vitest"
import type { ResourceBinding } from "./board-sidebar"
import { REKO_TARGET, RESOURCES_TARGET } from "./detail-target"
import { personChecklist, personFunctionItems, type ChecklistRow, type VehicleOperation } from "./person-functions"

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

const nowhere: VehicleOperation = () => null
const trawaOn14: VehicleOperation = (vehicleId) => (vehicleId === "v-trawa" ? { id: "op-14", label: "14 · Poststrasse 6" } : null)

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
    const list = personChecklist([], items, nowhere)
    expect(list.held.map(rowName)).toEqual(["kommandoposten"])
    // Fahrer last among the free ones: it needs a vehicle first.
    expect(list.free.map(rowName)).toEqual(["reko", "magazin", "telefondienst", "Fahrer"])
    expect(list.count).toBe(1)
  })

  it("counts a driver who is crew on the vehicle's Einsatz once (UX.15)", () => {
    const items = personFunctionItems({ id: "p1", isDriver: true, driverVehicleId: "v-trawa" }, fleet, new Map())
    const list = personChecklist([crewOn("op-14", "14 · Poststrasse 6")], items, trawaOn14)
    expect(list.count).toBe(1)
    // One row: the place says «fährt Trawa», no Fahrer row repeats it.
    expect(list.held).toEqual([expect.objectContaining({ kind: "place", drives: "Trawa" })])
  })

  it("names the vehicle's Einsatz on the Fahrer row when the person is not crew there", () => {
    const items = personFunctionItems({ id: "p1", isDriver: true, driverVehicleId: "v-trawa" }, fleet, new Map())
    const list = personChecklist([], items, trawaOn14)
    expect(list.count).toBe(1)
    expect(list.held).toEqual([expect.objectContaining({ kind: "driver", where: "14 · Poststrasse 6" })])
  })

  it("counts the Reko function once when its Einsätze are listed", () => {
    const reko: ResourceBinding = { ...crewOn("op-3", "3 · Bahnhof"), key: "reko-op-3", detail: "Reko", target: REKO_TARGET }
    const items = personFunctionItems({ id: "p1", isReko: true }, fleet, new Map())
    const list = personChecklist([reko], items, nowhere)
    expect(list.held.map(rowName)).toEqual(["3 · Bahnhof", "reko"])
    expect(list.count).toBe(1)
  })

  it("counts a crew row drawn as Reko apart from the Reko function (S3)", () => {
    const crewAsReko: ResourceBinding = { ...crewOn("op-3", "3 · Bahnhof"), key: "reko-op-3", target: REKO_TARGET, purpose: "crew" }
    const items = personFunctionItems({ id: "p1", isReko: true }, fleet, new Map())
    expect(personChecklist([crewAsReko], items, nowhere).count).toBe(2)
  })

  it("gives each vehicle a person drives its own Fahrer row (S4)", () => {
    const both = new Map([
      ["v-tlf", { name: "Muster", personnelId: "p1" }],
      ["v-trawa", { name: "Muster", personnelId: "p1" }],
    ])
    const items = personFunctionItems({ id: "p1" }, fleet, both)
    const list = personChecklist([crewOn("op-14", "14 · Poststrasse 6")], items, trawaOn14)
    // Trawa stands on op-14 where the person is crew: one place, counted once; TLF on its own.
    expect(list.held).toEqual([
      expect.objectContaining({ kind: "place", drives: "Trawa" }),
      expect.objectContaining({ kind: "driver", held: expect.objectContaining({ vehicleId: "v-tlf" }), where: null }),
    ])
    expect(list.count).toBe(2)
    expect(list.free.map(rowName)).not.toContain("Fahrer")
  })
})
