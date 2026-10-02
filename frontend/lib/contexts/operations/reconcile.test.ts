import { describe, expect, it } from "vitest"
import { buildEventState, type EventSnapshot } from "./reconcile"

// The provider-level golden (operations-context.snapshot.test.tsx) covers the
// whole load; this pins the transform on its own, and that it is pure.

const person = (id: string, name: string) => ({ id, name, role: "AdF", status: "available" as const, roleSortOrder: 0 })
const material = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: id,
  category: "Depot",
  type: "Pumpe",
  status: "assigned" as const,
  outOfService: false,
  outOfServiceSince: null,
  categorySortOrder: 0,
  consumable: false,
  groupId: null,
  ...extra,
})
const incident = (id: string) =>
  ({ id, title: id, location_address: id, priority: "medium", status: "active", created_at: "2026-09-23T08:00:00Z" }) as EventSnapshot["apiIncidents"][number]
const row = (id: string, resource_type: string, resource_id: string, extra: Record<string, unknown> = {}) =>
  ({ id, resource_type, resource_id, is_leader: false, driver_stay: false, ...extra }) as EventSnapshot["assignmentsByIncident"][string][number]

function snapshot(overrides: Partial<EventSnapshot> = {}): EventSnapshot {
  return {
    apiIncidents: [incident("i-1"), incident("i-2")],
    personnelList: [person("p-1", "Anna"), person("p-2", "Beat"), person("p-reko", "Reko"), person("p-3", "Frei")],
    materialsList: [material("m-1"), material("m-2", { outOfService: true })],
    vehiclesList: [
      { id: "v-2", name: "MTW", display_order: 2, radio_call_sign: null },
      { id: "v-1", name: "TLF", display_order: 1, radio_call_sign: "Omega 1" },
    ] as EventSnapshot["vehiclesList"],
    specialFunctions: [{ personnel_id: "p-reko", function_type: "reko" }] as EventSnapshot["specialFunctions"],
    assignmentsByIncident: {
      "i-1": [
        row("a-1", "personnel", "p-1"),
        row("a-2", "personnel", "p-2", { is_leader: true }),
        row("a-r", "personnel", "p-reko"),
        row("a-mtw", "vehicle", "v-2"),
        row("a-tlf", "vehicle", "v-1", { driver_stay: true }),
        row("a-m", "material", "m-1"),
      ],
    },
    rekoSummaries: { summaries: {}, total: 0 },
    ...overrides,
  }
}

describe("buildEventState", () => {
  it("folds the assignments onto the cards: crew, leader, Reko, vehicles in display order, material", () => {
    const { ops } = buildEventState(snapshot())
    const [first, second] = ops
    expect(first.crew).toEqual(["Anna", "Beat"])
    expect(first.leaderName).toBe("Beat")
    expect(first.assignedReko).toEqual({ id: "p-reko", name: "Reko" })
    expect(first.vehicles).toEqual(["TLF", "MTW"])
    expect(first.vehicleCallsigns).toEqual(new Map([["TLF", "Omega 1"]]))
    expect(first.vehicleDriverStay).toEqual(new Map([["MTW", false], ["TLF", true]]))
    expect(first.materials).toEqual(["m-1"])
    expect(second.crew).toEqual([])
  })

  it("scopes the roster and the depot to this Ereignis", () => {
    const { eventScopedPersonnel, eventScopedMaterials } = buildEventState(snapshot())
    expect(eventScopedPersonnel.map((p) => [p.id, p.status, p.isReko])).toEqual([
      ["p-1", "assigned", false],
      ["p-2", "assigned", false],
      ["p-reko", "available", true],
      ["p-3", "available", false],
    ])
    expect(eventScopedMaterials.map((m) => [m.id, m.status, m.outOfService])).toEqual([
      ["m-1", "assigned", false],
      ["m-2", "available", true],
    ])
  })

  it("puts a completed Reko's summary and danger chips on its card", () => {
    const { ops } = buildEventState(
      snapshot({
        rekoSummaries: {
          total: 1,
          summaries: {
            "i-2": {
              incident_id: "i-2",
              has_completed_reko: true,
              arrived_at: null,
              is_relevant: null,
              dangers_json: { fire: false, fire_danger: false, explosion: false, collapse: false, chemical: true, electrical: false, other_notes: "" },
              effort_json: null,
              summary_text: null,
              photos_json: [],
              submitted_at: null,
              submitted_by_personnel_name: null,
            },
          },
        } as EventSnapshot["rekoSummaries"],
      }),
    )
    expect(ops[1].hasCompletedReko).toBe(true)
    expect(ops[1].rekoSummary).toEqual({
      isRelevant: false,
      hasDangers: true,
      dangerTypes: ["Gefahrstoffe"],
      personnelCount: null,
      estimatedDuration: null,
      summaryText: null,
      photos: [],
    })
  })

  it("is pure: the fetched lists come out untouched, and a second run gives the same answer", () => {
    const input = snapshot()
    const before = JSON.stringify(input)
    const first = buildEventState(input)
    expect(JSON.stringify(input)).toBe(before)
    const second = buildEventState(input)
    expect(second).toEqual(first)
    expect(second.ops[0]).not.toBe(first.ops[0])
    expect(first.eventScopedPersonnel[0]).not.toBe(input.personnelList[0])
  })
})
