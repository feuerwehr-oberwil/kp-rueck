import { describe, expect, it } from "vitest"

import { fieldNudgeForNotification } from "@/lib/notification-field-action"
import type { Operation, OperationStatus } from "@/lib/contexts/operations-context"

function operation(status: OperationStatus): Operation {
  return { id: "i1", status } as Operation
}

describe("fieldNudgeForNotification", () => {
  it("offers the move to EINSATZ only while the card has not got there yet", () => {
    expect(fieldNudgeForNotification("field_arrived", operation("enroute"))).toEqual({ kind: "arrived" })
    // Already in EINSATZ, or past it — the report has been overtaken.
    expect(fieldNudgeForNotification("field_arrived", operation("active"))).toBeNull()
    expect(fieldNudgeForNotification("field_arrived", operation("returning"))).toBeNull()
  })

  it("offers the move to BEENDET / RÜCKFAHRT only while the card has not got there yet", () => {
    expect(fieldNudgeForNotification("field_complete", operation("active"))).toEqual({ kind: "complete" })
    // The move has been made — offering it again lets the same answer be given
    // twice, which is what the reviewer could click.
    expect(fieldNudgeForNotification("field_complete", operation("returning"))).toBeNull()
    expect(fieldNudgeForNotification("field_complete", operation("complete"))).toBeNull()
  })

  it("stays silent for notifications that are not a field report", () => {
    expect(fieldNudgeForNotification("time_overdue", operation("active"))).toBeNull()
    expect(fieldNudgeForNotification("reko_submitted", operation("reko"))).toBeNull()
  })
})
