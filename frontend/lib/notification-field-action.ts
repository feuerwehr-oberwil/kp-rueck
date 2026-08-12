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
 * report; a card in ABGESCHLOSSEN has overtaken everything.
 */
const STATUS_ORDER: OperationStatus[] = columns.map((column) => column.id)
const ACTIVE_INDEX = STATUS_ORDER.indexOf("active")

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
    return operation.status !== "complete" ? { kind: "complete" } : null
  }
  return null
}
