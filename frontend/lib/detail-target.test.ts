import { describe, expect, it } from "vitest"

import {
  FELD_TARGET,
  HISTORY_TARGET,
  OVERVIEW_TARGET,
  REKO_TARGET,
  RESOURCES_TARGET,
  detailTargetForJournalEntry,
  phoneSheetBlock,
} from "@/lib/detail-target"
import type { ApiJournalKind } from "@/lib/api/types/journal"

const entry = (kind: ApiJournalKind, data: Record<string, unknown> | null = null) => ({ kind, data })

describe("detailTargetForJournalEntry – a Verlauf chip opens the tab that shows its fact", () => {
  it("sends a Reko-Bericht and «Reko vor Ort» to the Reko tab", () => {
    expect(detailTargetForJournalEntry(entry("reko"))).toEqual(REKO_TARGET)
    expect(detailTargetForJournalEntry(entry("field", { type: "reko_arrived" }))).toEqual(REKO_TARGET)
    expect(detailTargetForJournalEntry(entry("field", { type: "reko_arrived_cleared" }))).toEqual(REKO_TARGET)
  })

  it("sends the rest of the field and the message thread to Feld, without a caret", () => {
    for (const type of ["field_arrived", "field_pickup_requested", "rapport_submitted", "field_request_open"]) {
      expect(detailTargetForJournalEntry(entry("field", { type }))).toEqual(FELD_TARGET)
    }
    expect(detailTargetForJournalEntry(entry("field"))).toEqual(FELD_TARGET)
    expect(detailTargetForJournalEntry(entry("message", { direction: "to_field" }))).toEqual(FELD_TARGET)
    expect(FELD_TARGET.section).toBeUndefined()
  })

  it("sends an assignment to Ressourcen, a release to Chronik", () => {
    expect(detailTargetForJournalEntry(entry("assignment", { action: "assigned" }))).toEqual(RESOURCES_TARGET)
    expect(detailTargetForJournalEntry(entry("assignment", { action: "unassigned" }))).toEqual(HISTORY_TARGET)
  })

  it("sends status changes and merges to Chronik, a new Einsatz to Übersicht", () => {
    expect(detailTargetForJournalEntry(entry("status", { from_status: "eingegangen", to_status: "reko" }))).toEqual(HISTORY_TARGET)
    for (const action of ["merge", "merged_into", "unmerge", "items_moved", "items_returned"]) {
      expect(detailTargetForJournalEntry(entry("incident", { action }))).toEqual(HISTORY_TARGET)
    }
    expect(detailTargetForJournalEntry(entry("incident", { action: "created" }))).toEqual(OVERVIEW_TARGET)
  })

  it("names no tab for what no tab shows: KP-Journal lines and alarms", () => {
    expect(detailTargetForJournalEntry(entry("manual"))).toBeUndefined()
    expect(detailTargetForJournalEntry(entry("alarm", { recipients: 12 }))).toBeUndefined()
  })
})

describe("phoneSheetBlock – the phone sheet scrolls to the block a target names", () => {
  it("lands Reko on the Reko-Bericht and a resources target on the resource lists", () => {
    expect(phoneSheetBlock(REKO_TARGET)).toBe("reko")
    expect(phoneSheetBlock(RESOURCES_TARGET)).toBe("resources")
    expect(phoneSheetBlock({ tab: "reko", section: "newReport" })).toBe("reko")
  })

  it("stays at the top for Übersicht, Chronik, Feld and no target", () => {
    expect(phoneSheetBlock(OVERVIEW_TARGET)).toBeNull()
    expect(phoneSheetBlock(HISTORY_TARGET)).toBeNull()
    expect(phoneSheetBlock(FELD_TARGET)).toBeNull()
    expect(phoneSheetBlock(undefined)).toBeNull()
  })
})
