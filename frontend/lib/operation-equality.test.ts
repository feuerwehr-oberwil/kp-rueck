import { describe, expect, it } from "vitest"

import { areOperationListsEqual, areOperationsEqual, sameCrew, sameVehicles } from "./operation-equality"
import { crewMember, assignedVehicle } from "@/test-utils/operation-fixtures"

/** Minimal operation-shaped object; tests override single fields from here. */
function op(overrides: Record<string, unknown> = {}) {
  return {
    id: "op-1",
    location: "Hauptstrasse 1",
    vehicle: "tlf",
    vehicles: [assignedVehicle("TLF 1", { callsign: "Florian 10", driverStay: true })],
    incidentType: "brand",
    dispatchTime: new Date("2026-07-30T12:00:00Z"),
    crew: [crewMember("Meier"), crewMember("Müller")],
    priority: "high",
    status: "active",
    coordinates: { lat: 47.5, lng: 7.6 },
    materials: ["Schlauch"],
    notes: "",
    contact: "",
    contactPhone: "",
    internalNotes: "",
    nachbarhilfe: false,
    nachbarhilfeNote: "",
    amWarten: false,
    amWartenNote: "",
    zuFuss: false,
    groupId: null,
    groupPosition: 0,
    statusChangedAt: null,
    hasCompletedReko: false,
    rekoArrivedAt: null,
    rekoSummary: null,
    assignedReko: null,
    materialAssignments: new Map<string, string>(),
    ...overrides,
  }
}

describe("areOperationsEqual", () => {
  it("treats a freshly rebuilt but identical operation as equal", () => {
    // The ApiIncident → Operation mapper rebuilds arrays, Dates and Maps on every sync.
    // Identity comparison would report "changed" on every 5s poll; value comparison must not.
    expect(areOperationsEqual(op(), op())).toBe(true)
  })

  // Fields of this kind kept falling out of the hand-written memo comparators while the
  // cards rendered them, leaving stale content on the board with no self-heal.
  it.each([
    ["incidentType", { incidentType: "verkehrsunfall" }],
    ["nachbarhilfeNote", { nachbarhilfeNote: "Nachbarwehr Oberwil" }],
    ["a vehicle's call sign", { vehicles: [assignedVehicle("TLF 1", { callsign: "Florian 11", driverStay: true })] }],
    ["dispatchTime", { dispatchTime: new Date("2026-07-30T13:00:00Z") }],
    ["statusChangedAt", { statusChangedAt: new Date("2026-07-30T12:30:00Z") }],
  ])("detects a change to %s", (_label, overrides) => {
    expect(areOperationsEqual(op(), op(overrides))).toBe(false)
  })

  it("detects changes to the fields the old comparator did cover", () => {
    expect(areOperationsEqual(op(), op({ status: "completed" }))).toBe(false)
    expect(areOperationsEqual(op(), op({ crew: [crewMember("Meier")] }))).toBe(false)
    expect(areOperationsEqual(op(), op({ priority: "low" }))).toBe(false)
    expect(areOperationsEqual(op(), op({ vehicles: [assignedVehicle("TLF 1", { callsign: "Florian 10", driverStay: false })] }))).toBe(false)
  })

  it("detects a nested object change", () => {
    expect(areOperationsEqual(op(), op({ coordinates: { lat: 47.5, lng: 7.7 } }))).toBe(false)
    expect(areOperationsEqual(op(), op({ assignedReko: { id: "r1", name: "Reko 1" } }))).toBe(false)
  })

  it("distinguishes null from a value and from undefined", () => {
    expect(areOperationsEqual(op({ statusChangedAt: null }), op({ statusChangedAt: undefined }))).toBe(false)
    expect(areOperationsEqual(op({ groupId: null }), op({ groupId: "g1" }))).toBe(false)
  })

  it("distinguishes a map key mapped to undefined from a missing key", () => {
    const withKey = new Map<string, string | undefined>([["m-1", undefined]])
    expect(areOperationsEqual(op({ materialAssignments: withKey }), op({ materialAssignments: new Map() }))).toBe(false)
  })

  it("is order-sensitive for crew and vehicle lists", () => {
    expect(areOperationsEqual(op(), op({ crew: [crewMember("Müller"), crewMember("Meier")] }))).toBe(false)
  })

  it("covers a field added to Operation without being told about it", () => {
    // The point of the structural walk: a new field participates automatically.
    expect(areOperationsEqual(op(), op({ someFutureField: "x" }))).toBe(false)
    expect(areOperationsEqual(op({ someFutureField: "x" }), op({ someFutureField: "y" }))).toBe(false)
  })

  it.each([
    [new Date(0), {}], [{}, new Date(0)], [[], {}], [{}, []],
    [new Map(), {}], [{}, new Map()], [new Set(), {}], [{}, new Set()],
    [null, {}], [{}, undefined], ["1", 1], [false, 0],
  ])("keeps different value shapes distinct (%s, %s)", (a, b) => {
    expect(areOperationsEqual(a, b)).toBe(false)
  })

  it("compares map keys and values, including undefined values at different keys", () => {
    expect(areOperationsEqual(new Map([["m1", 1]]), new Map([["m1", 1]]))).toBe(true)
    expect(areOperationsEqual(new Map([["m1", 1]]), new Map([["m1", 2]]))).toBe(false)
    expect(areOperationsEqual(new Map([["m1", undefined]]), new Map([["m2", undefined]]))).toBe(false)
  })

  it("compares set membership regardless of insertion order", () => {
    expect(areOperationsEqual(new Set(["a", "b"]), new Set(["b", "a"]))).toBe(true)
    expect(areOperationsEqual(new Set(["a"]), new Set(["b"]))).toBe(false)
    expect(areOperationsEqual(new Set(["a"]), new Set(["a", "b"]))).toBe(false)
  })

  it("compares own object keys, even when all values are undefined", () => {
    expect(areOperationsEqual({ a: undefined }, { b: undefined })).toBe(false)
    expect(areOperationsEqual({ a: undefined }, { a: undefined })).toBe(true)
  })

  it("requires every array item and both collection sizes to match", () => {
    expect(areOperationsEqual([1, 2], [1, 3])).toBe(false)
    expect(areOperationsEqual([1], [1, 2])).toBe(false)
    expect(areOperationsEqual([1, 2], [1])).toBe(false)
    expect(areOperationsEqual(new Map([["a", 1]]), new Map([["a", 1], ["b", 2]]))).toBe(false)
    expect(areOperationsEqual({}, "")).toBe(false)
    expect(areOperationsEqual("", {})).toBe(false)
    expect(areOperationListsEqual([{ id: "a" }, { id: "b" }], [{ id: "a" }, { id: "changed" }])).toBe(false)
  })
})

describe("areOperationListsEqual", () => {
  it("compares element-wise and in order", () => {
    expect(areOperationListsEqual([op({ id: "a" }), op({ id: "b" })], [op({ id: "a" }), op({ id: "b" })])).toBe(true)
    expect(areOperationListsEqual([op({ id: "a" }), op({ id: "b" })], [op({ id: "b" }), op({ id: "a" })])).toBe(false)
    expect(areOperationListsEqual([op()], [])).toBe(false)
  })
})

describe("crew and vehicle chip equality", () => {
  it("treats rebuilt chip lists as unchanged", () => {
    expect(sameCrew([], [])).toBe(true)
    expect(sameCrew([crewMember("Meier")], [crewMember("Meier")])).toBe(true)
    expect(sameVehicles([], [])).toBe(true)
    expect(sameVehicles([assignedVehicle("TLF")], [assignedVehicle("TLF")])).toBe(true)
  })

  it.each(["personnelId", "assignmentId", "name"] as const)("detects a changed crew %s", (field) => {
    const member = crewMember("Meier")
    expect(sameCrew([member], [{ ...member, [field]: "different" }])).toBe(false)
  })

  it.each(["vehicleId", "assignmentId", "name", "callsign"] as const)("detects a changed vehicle %s", (field) => {
    const vehicle = assignedVehicle("TLF")
    expect(sameVehicles([vehicle], [{ ...vehicle, [field]: "different" }])).toBe(false)
  })

  it("detects driver-stay changes, removed chips and reordering", () => {
    const vehicle = assignedVehicle("TLF", { driverStay: true })
    expect(sameVehicles([vehicle], [{ ...vehicle, driverStay: false }])).toBe(false)
    expect(sameVehicles([vehicle], [])).toBe(false)
    expect(sameCrew([crewMember("Meier")], [])).toBe(false)
    expect(sameCrew([crewMember("Meier"), crewMember("Muster")], [crewMember("Muster"), crewMember("Meier")])).toBe(false)
    expect(sameVehicles([assignedVehicle("TLF"), assignedVehicle("Pio")], [assignedVehicle("Pio"), assignedVehicle("TLF")])).toBe(false)
  })
})
