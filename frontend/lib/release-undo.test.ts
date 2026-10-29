import { describe, expect, it } from "vitest"
import { checkRestore, type Released, type RestoreState } from "./release-undo"

const op = (id: string, over: Partial<RestoreState["operations"][number]> = {}) => ({
  id,
  status: "active",
  crew: [] as { personnelId: string }[],
  vehicles: [] as { vehicleId: string }[],
  materials: [] as string[],
  groupId: null as string | null,
  ...over,
})

const state = (over: Partial<RestoreState> = {}): RestoreState => ({
  operations: [op("e1"), op("e2")],
  groups: [],
  personnel: [{ id: "p1", name: "Meier", status: "available" }],
  materials: [
    { id: "m1", consumable: false, outOfService: false },
    { id: "m2", consumable: true, outOfService: false },
  ],
  outOfServiceVehicleIds: new Set(),
  labelOf: (id) => (id === "e2" ? "Bahnhofstrasse 3" : id),
  ...over,
})

const person: Released = { kind: "personnel", operationId: "e1", personId: "p1", name: "Meier", targetLabel: "Hauptstrasse 5" }

describe("checkRestore", () => {
  it("lets the undo re-assign when nothing changed", () => {
    expect(checkRestore(person, state())).toBeNull()
  })

  it("keeps newer work: another device put the person elsewhere", () => {
    const s = state({ operations: [op("e1"), op("e2", { crew: [{ personnelId: "p1" }] })] })
    expect(checkRestore(person, s)).toEqual({ reason: "elsewhere", where: "Bahnhofstrasse 3" })
  })

  it("a namesake elsewhere is not the released person", () => {
    // Another «Meier» on e2 must not block the undo for p1.
    const s = state({ operations: [op("e1"), op("e2", { crew: [{ personnelId: "p2" }] })] })
    expect(checkRestore(person, s)).toBeNull()
  })

  it("does nothing twice: already back", () => {
    expect(checkRestore(person, state({ operations: [op("e1", { crew: [{ personnelId: "p1" }] })] }))).toEqual({ reason: "alreadyBack" })
  })

  it("refuses for a closed or vanished Einsatz and for a checked-out person", () => {
    expect(checkRestore(person, state({ operations: [op("e1", { status: "complete" })] }))).toEqual({ reason: "targetClosed" })
    expect(checkRestore(person, state({ operations: [] }))).toEqual({ reason: "targetGone" })
    expect(checkRestore(person, state({ personnel: [] }))).toEqual({ reason: "resourceGone" })
  })

  it("respects «nicht einsatzbereit» for vehicles and material", () => {
    const vehicle: Released = { kind: "vehicle", operationId: "e1", vehicleId: "v1", name: "TLF", targetLabel: "x" }
    expect(checkRestore(vehicle, state({ outOfServiceVehicleIds: new Set(["v1"]) }))).toEqual({ reason: "outOfService" })
    const material: Released = { kind: "material", operationId: "e1", materialId: "m1", name: "Pumpe", targetLabel: "x" }
    expect(
      checkRestore(material, state({ materials: [{ id: "m1", consumable: false, outOfService: true }] })),
    ).toEqual({ reason: "outOfService" })
  })

  it("never treats a consumable on another Einsatz as a conflict", () => {
    const material: Released = { kind: "material", operationId: "e1", materialId: "m2", name: "Bindemittel", targetLabel: "x" }
    expect(checkRestore(material, state({ operations: [op("e1"), op("e2", { materials: ["m2"] })] }))).toBeNull()
  })

  it("a stop that joined another Auftrag meanwhile stays there", () => {
    const stop: Released = { kind: "stop", groupId: "g1", incidentId: "e1", name: "Hauptstrasse 5", targetLabel: "West" }
    const s = state({
      operations: [op("e1", { groupId: "g2" })],
      groups: [
        { id: "g1", name: "West", stopIds: [], assignments: [] },
        { id: "g2", name: "Ost", stopIds: ["e1"], assignments: [] },
      ],
    })
    expect(checkRestore(stop, s)).toEqual({ reason: "elsewhere", where: "Ost" })
  })

  it("finds the exact incident and person after unrelated rows", () => {
    expect(checkRestore(person, state({
      operations: [op("other", { status: "complete" }), op("e1")],
      personnel: [{ id: "p2", name: "Other", status: "unavailable" }, { id: "p1", name: "Meier", status: "available" }],
    }))).toBeNull()
    expect(checkRestore(person, state({ personnel: [{ id: "p1", name: "Meier", status: "unavailable" }] })))
      .toEqual({ reason: "unavailable" })
  })

  it("ignores historical assignments on completed incidents", () => {
    expect(checkRestore(person, state({ operations: [op("e1"), op("e2", { status: "complete", crew: [{ personnelId: "p1" }] })] })))
      .toBeNull()
  })

  const vehicle: Released = { kind: "vehicle", operationId: "e1", vehicleId: "v1", name: "TLF", targetLabel: "x" }
  const material: Released = { kind: "material", operationId: "e1", materialId: "m1", name: "Pumpe", targetLabel: "x" }

  it("lets a free vehicle return and ignores an unrelated unavailable vehicle", () => {
    expect(checkRestore(vehicle, state({ outOfServiceVehicleIds: new Set(["v2"]) }))).toBeNull()
  })

  it("detects the exact vehicle assignment and its current holder", () => {
    expect(checkRestore(vehicle, state({ operations: [op("e1", { vehicles: [{ vehicleId: "v1" }] })] })))
      .toEqual({ reason: "alreadyBack" })
    expect(checkRestore(vehicle, state({ operations: [op("e1"), op("e2", { vehicles: [{ vehicleId: "v1" }] })] })))
      .toEqual({ reason: "elsewhere", where: "Bahnhofstrasse 3" })
    expect(checkRestore(vehicle, state({ operations: [op("e1"), op("e2", { vehicles: [{ vehicleId: "v2" }] })] }))).toBeNull()
    expect(checkRestore(vehicle, state({ operations: [op("e1"), op("e2", { status: "complete", vehicles: [{ vehicleId: "v1" }] })] })))
      .toBeNull()
  })

  it("restores reusable material only when it is free and still exists", () => {
    expect(checkRestore(material, state())).toBeNull()
    expect(checkRestore(material, state({ materials: [] }))).toEqual({ reason: "resourceGone" })
    expect(checkRestore(material, state({ operations: [op("e1", { materials: ["m1"] })] }))).toEqual({ reason: "alreadyBack" })
    expect(checkRestore(material, state({ operations: [op("e1"), op("e2", { materials: ["m1"] })] })))
      .toEqual({ reason: "elsewhere", where: "Bahnhofstrasse 3" })
    expect(checkRestore(material, state({ operations: [op("e1"), op("e2", { status: "complete", materials: ["m1"] })] })))
      .toBeNull()
  })
})

const route = (id = "g1", over: Partial<RestoreState["groups"][number]> = {}) => ({
  id, name: id === "g1" ? "West" : "Ost", stopIds: [] as string[],
  assignments: [] as { resourceType: string; resourceId: string }[], ...over,
})

describe("route stop undo", () => {
  const stop: Released = { kind: "stop", groupId: "g1", incidentId: "e1", name: "Hauptstrasse 5", targetLabel: "West" }

  it("needs the original route and incident to still exist", () => {
    expect(checkRestore(stop, state())).toEqual({ reason: "targetGone" })
    expect(checkRestore(stop, state({ groups: [route()], operations: [op("other")] }))).toEqual({ reason: "resourceGone" })
  })

  it("lets a detached stop return to its own route", () => {
    expect(checkRestore(stop, state({ groups: [route("g2"), route()], operations: [op("other"), op("e1")] }))).toBeNull()
  })

  it("recognizes an already restored stop from either side of a sync", () => {
    expect(checkRestore(stop, state({ groups: [route("g1", { stopIds: ["e1"] })] }))).toEqual({ reason: "alreadyBack" })
    expect(checkRestore(stop, state({ groups: [route()], operations: [op("e1", { groupId: "g1" })] })))
      .toEqual({ reason: "alreadyBack" })
  })
})

describe.each(["personnel", "vehicle", "material"] as const)("route %s undo", (resourceType) => {
  const resourceId = resourceType === "personnel" ? "p1" : resourceType === "vehicle" ? "v1" : "m1"
  const released: Released = { kind: "routeResource", groupId: "g1", resourceType, resourceId, name: "Resource", targetLabel: "West" }

  it("requires the original route and permits an unassigned resource", () => {
    expect(checkRestore(released, state())).toEqual({ reason: "targetGone" })
    expect(checkRestore(released, state({ groups: [route("other"), route()] }))).toBeNull()
  })

  it("recognizes the resource already back on the original route", () => {
    expect(checkRestore(released, state({ groups: [route("unrelated"), route("g1", { assignments: [{ resourceType, resourceId }] })] })))
      .toEqual({ reason: "alreadyBack" })
  })

  it("preserves a newer assignment on another route", () => {
    expect(checkRestore(released, state({ groups: [route(), route("unrelated"), route("g2", { assignments: [{ resourceType, resourceId }] })] })))
      .toEqual({ reason: "elsewhere", where: "Ost" })
  })

  it("compares both the resource type and id", () => {
    const otherType = resourceType === "personnel" ? "vehicle" : "personnel"
    const unrelated = [{ resourceType, resourceId: "another" }, { resourceType: otherType, resourceId }]
    expect(checkRestore(released, state({ groups: [route("g1", { assignments: unrelated }), route("g2", { assignments: unrelated })] })))
      .toBeNull()
  })

  it("does not restore a vehicle merely because an unrelated incident comes first", () => {
    const released: Released = { kind: "vehicle", operationId: "e1", vehicleId: "v1", name: "TLF", targetLabel: "West" }
    expect(checkRestore(released, state({ operations: [op("unrelated"), op("e1"), op("e2", { vehicles: [{ vehicleId: "v1" }] })] })))
      .toEqual({ reason: "elsewhere", where: "Bahnhofstrasse 3" })
  })
})

describe("route resource availability", () => {
  const material: Released = { kind: "routeResource", groupId: "g1", resourceType: "material", resourceId: "m1", name: "Pumpe", targetLabel: "West" }
  const vehicle: Released = { ...material, resourceType: "vehicle", resourceId: "v1" }

  it("refuses unavailable vehicles, missing material and defective material", () => {
    expect(checkRestore(vehicle, state({ groups: [route()], outOfServiceVehicleIds: new Set(["v1"]) })))
      .toEqual({ reason: "outOfService" })
    expect(checkRestore(material, state({ groups: [route()], materials: [] }))).toEqual({ reason: "resourceGone" })
    expect(checkRestore(material, state({ groups: [route()], materials: [{ id: "m1", consumable: true, outOfService: true }] })))
      .toEqual({ reason: "outOfService" })
  })

  it("permits consumables held by another route", () => {
    expect(checkRestore({ ...material, resourceId: "m2" }, state({ groups: [route(), route("g2", { assignments: [{ resourceType: "material", resourceId: "m2" }] })] })))
      .toBeNull()
  })
})
