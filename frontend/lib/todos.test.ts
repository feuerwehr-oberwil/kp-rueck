import { describe, expect, it } from "vitest"
import type { ApiPlannedAssignment } from "@/lib/api-client"
import type { Notification } from "@/lib/types/notification"
import { collectTodos, isOverdue, TODO_OVERDUE_MS, type TodoBoard } from "./todos"
import { UNSET_NOTIFICATION_FIELDS } from '@/test-utils/notification-fixtures'

const board: TodoBoard = {
  operations: [
    { id: "op-2", status: "incoming", vehicles: [] },
    { id: "op-12", status: "enroute", vehicles: [{ vehicleId: "v-mowa", assignmentId: "a-mowa" }] },
    { id: "op-14", status: "active", vehicles: [{ vehicleId: "v-trawa", assignmentId: "a-trawa" }] },
  ],
  groups: [{ id: "g-1", name: "Route West", assignments: [{ id: "ga-tlf" }] }],
  holderLabel: (id) => (id === "op-2" ? "2 Mühlemattstrasse 12" : id),
  resourceName: (plan) => plan.resource_id,
}

function plan(over: Partial<ApiPlannedAssignment>): ApiPlannedAssignment {
  return {
    id: "p",
    event_id: "e",
    incident_id: "op-2",
    incident_group_id: null,
    resource_type: "personnel",
    resource_id: "Lisa",
    planned_at: "2026-11-24T19:00:00Z",
    planned_by: null,
    dismissed_at: null,
    position: 1,
    ready: true,
    ready_since: "2026-11-24T19:30:00Z",
    ...over,
  }
}

function gps(type: "gps_arrival" | "gps_release", incident: string, params: Record<string, string>): Notification {
  return {
    ...UNSET_NOTIFICATION_FIELDS,
    id: `n-${incident}`,
    type,
    severity: "info",
    message: "",
    params,
    incident_id: incident,
    created_at: new Date("2026-11-24T19:31:00Z"),
    dismissed: false,
  }
}

describe("collectTodos", () => {
  it("one Danach row per target, only the ready plans, the clock from the release", () => {
    const todos = collectTodos(
      [plan({ id: "p1" }), plan({ id: "p2", resource_id: "TLF" }), plan({ id: "p3", resource_id: "Max", ready: false })],
      [],
      board,
    )
    expect(todos).toHaveLength(1)
    expect(todos[0]).toMatchObject({ kind: "danach", holderLabel: "2 Mühlemattstrasse 12", names: ["Lisa", "TLF"] })
    expect(todos[0].since).toBe(Date.parse("2026-11-24T19:30:00Z"))
  })

  it("«Verwerfen» keeps the row, greyed – until every plan in it is dismissed", () => {
    const one = collectTodos([plan({ id: "p1", dismissed_at: "x" }), plan({ id: "p2", resource_id: "TLF" })], [], board)
    expect(one[0].dismissed).toBe(false)
    const both = collectTodos([plan({ id: "p1", dismissed_at: "x" })], [], board)
    expect(both[0].dismissed).toBe(true)
  })

  it("leaves out GPS questions the board has answered meanwhile", () => {
    const todos = collectTodos(
      [],
      [
        gps("gps_arrival", "op-12", { vehicle: "Mowa", place: "12" }), // still Disponiert → asks
        gps("gps_arrival", "op-14", { vehicle: "Trawa", place: "14" }), // already Im Einsatz → answered
        gps("gps_release", "op-14", { vehicle_id: "v-trawa", assignment_id: "a-trawa" }), // still on the card
        gps("gps_release", "op-12", { vehicle_id: "v-x", assignment_id: "a-gone" }), // released already
      ],
      board,
    )
    expect(todos.map((t) => [t.kind, t.incidentId])).toEqual([
      ["gps_arrival", "op-12"],
      ["gps_release", "op-14"],
    ])
  })

  it("a route vehicle's release checks the Auftrag", () => {
    const route = gps("gps_release", "op-2", { vehicle_id: "v-tlf", assignment_id: "ga-tlf", group_id: "g-1" })
    expect(collectTodos([], [route], board)).toHaveLength(1)
    const gone = gps("gps_release", "op-2", { vehicle_id: "v-tlf", assignment_id: "ga-old", group_id: "g-1" })
    expect(collectTodos([], [gone], board)).toHaveLength(0)
  })
})

describe("isOverdue", () => {
  it("turns red after five minutes, never once dismissed", () => {
    expect(isOverdue({ since: 0, dismissed: false }, TODO_OVERDUE_MS - 1)).toBe(false)
    expect(isOverdue({ since: 0, dismissed: false }, TODO_OVERDUE_MS)).toBe(true)
    expect(isOverdue({ since: 0, dismissed: true }, TODO_OVERDUE_MS * 10)).toBe(false)
  })
})
