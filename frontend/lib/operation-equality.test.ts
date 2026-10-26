import { describe, expect, it } from "vitest"

import { areOperationListsEqual, areOperationsEqual } from "./operation-equality"
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
})

describe("areOperationListsEqual", () => {
  it("compares element-wise and in order", () => {
    expect(areOperationListsEqual([op({ id: "a" }), op({ id: "b" })], [op({ id: "a" }), op({ id: "b" })])).toBe(true)
    expect(areOperationListsEqual([op({ id: "a" }), op({ id: "b" })], [op({ id: "b" }), op({ id: "a" })])).toBe(false)
    expect(areOperationListsEqual([op()], [])).toBe(false)
  })
})
