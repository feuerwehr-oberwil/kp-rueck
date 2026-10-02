import { describe, expect, it } from "vitest"
import { checkRestore, type Released, type RestoreState } from "./release-undo"

const op = (id: string, over: Partial<RestoreState["operations"][number]> = {}) => ({
  id,
  status: "active",
  crew: [] as string[],
  vehicles: [] as string[],
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
    const s = state({ operations: [op("e1"), op("e2", { crew: ["Meier"] })] })
    expect(checkRestore(person, s)).toEqual({ reason: "elsewhere", where: "Bahnhofstrasse 3" })
  })

  it("does nothing twice: already back", () => {
    expect(checkRestore(person, state({ operations: [op("e1", { crew: ["Meier"] })] }))).toEqual({ reason: "alreadyBack" })
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
})
