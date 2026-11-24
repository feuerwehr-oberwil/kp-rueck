/**
 * «Zu erledigen» – what waits for an editor and was started by the system or the field, not by
 * the operator (owner rule 24.11.2026: a popup only answers the operator's own action; everything
 * else is a bell row with its buttons, plus a mark on the card).
 *
 * Pure: the bell (`use-todos.ts`) feeds in the board's lists. Three sources besides the field's
 * requests (which keep their own rows, `FieldRequestInbox`):
 * - **danach** – a free resource's first Danach (`ready`), one row per Einsatz/Auftrag;
 * - **gps_arrival** – GPS sees the vehicle at its Schadenplatz: «Im Einsatz»?
 * - **gps_release** – the vehicle is back at the Magazin: release it?
 *
 * A row the board has answered meanwhile (the card left «Disponiert», the vehicle is gone from
 * the card) is not a to-do any more and is left out. «Verwerfen» keeps a row, greyed: it leaves
 * the count and stops the clock, and its buttons still work (owner pick 24.11.2026).
 */

import type { ApiPlannedAssignment } from "@/lib/api-client"
import type { Notification } from "@/lib/types/notification"

/** Open longer than this → red, and the bell pulses (owner pick 24.11.2026). */
export const TODO_OVERDUE_MS = 5 * 60_000

interface TodoBase {
  id: string
  /** ms epoch – the clock for «seit 6' offen». */
  since: number
  dismissed: boolean
  /** The card it marks (an Einsatz), if any. */
  incidentId: string | null
}

export type Todo =
  | (TodoBase & { kind: "danach"; holderId: string; holderLabel: string; names: string[]; plans: ApiPlannedAssignment[] })
  | (TodoBase & { kind: "gps_arrival"; notification: Notification })
  | (TodoBase & {
      kind: "gps_release"
      notification: Notification
      assignmentId: string
      vehicleId: string
      groupId: string | null
    })

/** The board facts the rows are checked against. */
export interface TodoBoard {
  operations: readonly {
    id: string
    status: string
    vehicles: readonly { vehicleId: string; assignmentId?: string | null }[]
  }[]
  groups: readonly { id: string; name: string; assignments: readonly { id: string }[] }[]
  /** «2 Mühlemattstrasse 12» / the Auftrag's name. */
  holderLabel: (holderId: string) => string
  /** The planned resource's name. */
  resourceName: (plan: ApiPlannedAssignment) => string
}

export const GPS_TODO_TYPES: ReadonlySet<string> = new Set(["gps_arrival", "gps_release"])

const time = (iso: string | Date | null | undefined, fallback: number) =>
  iso ? new Date(iso).getTime() : fallback

function danachTodos(planned: readonly ApiPlannedAssignment[], board: TodoBoard): Todo[] {
  const byHolder = new Map<string, ApiPlannedAssignment[]>()
  for (const plan of planned) {
    if (!plan.ready) continue
    const holderId = plan.incident_id ?? plan.incident_group_id
    if (!holderId) continue
    byHolder.set(holderId, [...(byHolder.get(holderId) ?? []), plan])
  }
  return [...byHolder.entries()].map(([holderId, plans]) => ({
    kind: "danach" as const,
    id: `danach:${holderId}`,
    holderId,
    holderLabel: board.holderLabel(holderId),
    names: plans.map(board.resourceName),
    plans,
    since: Math.min(...plans.map((plan) => time(plan.ready_since ?? plan.planned_at, Date.now()))),
    // A row is dismissed when every plan in it is: a new ready one brings it back.
    dismissed: plans.every((plan) => plan.dismissed_at !== null),
    incidentId: plans[0].incident_id,
  }))
}

function gpsTodos(notifications: readonly Notification[], board: TodoBoard): Todo[] {
  const todos: Todo[] = []
  for (const n of notifications) {
    if (!GPS_TODO_TYPES.has(n.type)) continue
    const p = (n.params ?? {}) as Record<string, unknown>
    const base = { since: time(n.created_at, Date.now()), dismissed: n.dismissed, incidentId: n.incident_id ?? null }
    if (n.type === "gps_arrival") {
      // Only a card still in «Disponiert» can be moved on by it.
      const op = board.operations.find((o) => o.id === n.incident_id)
      if (!op || op.status !== "enroute") continue
      todos.push({ ...base, kind: "gps_arrival", id: `gps:${n.id}`, notification: n })
      continue
    }
    const assignmentId = typeof p.assignment_id === "string" ? p.assignment_id : null
    const vehicleId = typeof p.vehicle_id === "string" ? p.vehicle_id : null
    const groupId = typeof p.group_id === "string" ? p.group_id : null
    if (!assignmentId || !vehicleId) continue
    // Only while that very assignment is still there to release.
    const live = groupId
      ? board.groups.some((g) => g.id === groupId && g.assignments.some((a) => a.id === assignmentId))
      : board.operations.some(
          (o) => o.id === n.incident_id && o.status !== "complete" && o.vehicles.some((v) => v.assignmentId === assignmentId),
        )
    if (!live) continue
    todos.push({ ...base, kind: "gps_release", id: `gps:${n.id}`, notification: n, assignmentId, vehicleId, groupId })
  }
  return todos
}

/** Every to-do, oldest first – open and dismissed alike (the bell splits them). */
export function collectTodos(
  planned: readonly ApiPlannedAssignment[],
  notifications: readonly Notification[],
  board: TodoBoard,
): Todo[] {
  return [...danachTodos(planned, board), ...gpsTodos(notifications, board)].sort((a, b) => a.since - b.since)
}

export function isOverdue(todo: Pick<Todo, "since" | "dismissed">, now: number): boolean {
  return !todo.dismissed && now - todo.since >= TODO_OVERDUE_MS
}
