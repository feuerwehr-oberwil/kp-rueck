/**
 * The board↔API status bridge has to stay total and reversible.
 *
 * It used to be three hand-written tables in `operations-context.tsx`; a status added to two
 * of the three would have desynced the UI without any test noticing. These pin the properties
 * that make the single map safe to rely on.
 */

import { describe, expect, it } from "vitest"

import {
  INCIDENT_STATUS_BY_OPERATION_STATUS,
  OPERATION_STATUS_BY_INCIDENT_STATUS,
  toIncidentStatus,
  toOperationStatus,
  type OperationStatus,
} from "@/lib/incident-status"

/** The CHECK constraint on `incidents.status` (backend/app/models.py). */
const API_STATUSES = [
  "eingegangen",
  "reko",
  "reko_done",
  "disponiert",
  "einsatz",
  "einsatz_beendet",
  "abschluss",
] as const

describe("incident status bridge", () => {
  it("covers every status the API is allowed to send", () => {
    expect(Object.keys(OPERATION_STATUS_BY_INCIDENT_STATUS).sort()).toEqual([...API_STATUSES].sort())
  })

  it("maps each API status to a distinct board status", () => {
    const boardStatuses = Object.values(OPERATION_STATUS_BY_INCIDENT_STATUS)
    expect(new Set(boardStatuses).size).toBe(boardStatuses.length)
  })

  it("round-trips every API status", () => {
    for (const status of API_STATUSES) {
      expect(toIncidentStatus(toOperationStatus(status))).toBe(status)
    }
  })

  it("round-trips every board status", () => {
    for (const status of Object.keys(INCIDENT_STATUS_BY_OPERATION_STATUS) as OperationStatus[]) {
      expect(toOperationStatus(toIncidentStatus(status))).toBe(status)
    }
  })

  it("keeps an unknown status on the board instead of dropping it", () => {
    // A newer backend is likelier than corruption; the first column keeps the card visible.
    expect(toOperationStatus("a_status_from_the_future")).toBe("incoming")
    expect(toOperationStatus("")).toBe("incoming")
  })
})
