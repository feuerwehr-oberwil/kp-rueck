import { columns } from "@/lib/kanban-utils"
import type { Operation, OperationStatus } from "@/lib/contexts/operations-context"
import type { FieldNudgeKind } from "@/components/kanban/field-status-nudge"

/**
 * Which board move a field-report notification is asking for — or null when
 * there is nothing left to ask.
 *
 * Same predicate the card's own `FieldStatusNudge` uses, and deliberately so:
 * the question is offered in two places (on the card, in the bell) and they must
 * disappear together. A card already in EINSATZ has overtaken its arrival
 * report; one in BEENDET / RÜCKFAHRT has overtaken the completion report.
 */
const STATUS_ORDER: OperationStatus[] = columns.map((column) => column.id)
const ACTIVE_INDEX = STATUS_ORDER.indexOf("active")
const RETURNING_INDEX = STATUS_ORDER.indexOf("returning")

function statusRank(status: OperationStatus): number {
  const index = STATUS_ORDER.indexOf(status)
  return index === -1 ? 0 : index
}

export function fieldNudgeForNotification(
  notificationType: string,
  operation: Operation,
): { kind: FieldNudgeKind } | null {
  if (notificationType === "field_arrived") {
    return statusRank(operation.status) < ACTIVE_INDEX ? { kind: "arrived" } : null
  }
  if (notificationType === "field_complete") {
    // BEENDET / RÜCKFAHRT is the move this row offers, so a card that is there
    // has been answered — the button used to stay until ABGESCHLOSSEN and could
    // be pressed a second time on a question that was already settled.
    return statusRank(operation.status) < RETURNING_INDEX ? { kind: "complete" } : null
  }
  return null
}
