import { describe, expect, it } from "vitest"

import type { ApiJournalEntry } from "@/lib/api/types"
import {
  filterJournal,
  foldJournal,
  formatJournalTime,
  incidentQuery,
  journalCounts,
  mergeJournal,
  mergedInto,
  stripIncidentQuery,
  suggestIncidents,
} from "./journal"

let seq = 0
function row(over: Partial<ApiJournalEntry> = {}): ApiJournalEntry {
  seq += 1
  return {
    id: `r${seq}`,
    seq,
    event_id: "e1",
    incident_id: null,
    incident_title: null,
    incident_deleted: false,
    kind: "manual",
    category: "manual",
    text: `Zeile ${seq}`,
    data: null,
    occurred_at: new Date(Date.UTC(2026, 9, 8, 10, seq)).toISOString(),
    created_at: new Date(Date.UTC(2026, 9, 8, 10, seq)).toISOString(),
    author_name: "Dispo",
    corrects_id: null,
    ...over,
  }
}

describe("foldJournal", () => {
  it("lists newest first by when it happened, not by when it was written", () => {
    const late = row({ occurred_at: "2026-10-08T12:00:00Z" })
    const early = row({ occurred_at: "2026-10-08T09:00:00Z" }) // backfilled: higher seq, older fact
    expect(foldJournal([late, early]).map((l) => l.entry.id)).toEqual([late.id, early.id])
  })

  it("folds corrections into their line: newest wording, original kept", () => {
    const original = row({ text: "Strom Nord aus" })
    const fix1 = row({ text: "Strom Süd aus", corrects_id: original.id })
    const fix2 = row({ text: "Strom Süd und Ost aus", corrects_id: original.id })
    const lines = foldJournal([original, fix1, fix2])
    expect(lines).toHaveLength(1)
    expect(lines[0].entry.id).toBe(original.id)
    expect(lines[0].text).toBe("Strom Süd und Ost aus")
    expect(lines[0].corrections.map((c) => c.id)).toEqual([fix1.id, fix2.id])
  })
})

describe("filterJournal", () => {
  const lines = foldJournal([
    row({ category: "manual" }),
    row({ kind: "status", category: "status", text: null }),
    row({ kind: "message", category: "field" }),
    row({ kind: "assignment", category: "resources", text: null }),
  ])

  it("nothing ticked is «Alle»", () => {
    expect(filterJournal(lines, new Set())).toHaveLength(4)
  })

  it("ticks OR together", () => {
    const shown = filterJournal(lines, new Set(["manual", "field"]))
    expect(shown.map((l) => l.entry.category).sort()).toEqual(["field", "manual"])
  })

  it("counts per category", () => {
    expect(journalCounts(lines)).toEqual({ manual: 1, field: 1, status: 1, resources: 1 })
  })
})

describe("mergeJournal", () => {
  it("never doubles a row fetched twice and keeps seq order", () => {
    const a = row()
    const b = row()
    const c = row()
    expect(mergeJournal([a, b], [b, c]).map((r) => r.id)).toEqual([a.id, b.id, c.id])
    expect(mergeJournal([c], [a]).map((r) => r.id)).toEqual([a.id, c.id])
  })
})

describe("the # link", () => {
  it("is read only as a word of its own at the end of the text", () => {
    expect(incidentQuery("#")).toBe("")
    expect(incidentQuery("Anwohner evakuiert #gart")).toBe("gart")
    expect(incidentQuery("Tel.#2 angerufen")).toBeNull()
    expect(incidentQuery("#garten danach")).toBeNull()
  })

  it("is removed from the text once picked", () => {
    expect(stripIncidentQuery("Anwohner evakuiert #gart")).toBe("Anwohner evakuiert")
    expect(stripIncidentQuery("#")).toBe("")
  })

  const choices = [
    { id: "1", label: "Gartenweg 4", detail: "Brandbekämpfung" },
    { id: "2", label: "Hauptstrasse 12", detail: "Elementarereignis" },
    { id: "3", label: "Gartenstrasse 9", detail: "Elementarereignis", closed: true },
  ]

  it("matches word starts, running Einsätze first", () => {
    expect(suggestIncidents("gart", choices).map((c) => c.id)).toEqual(["1", "3"])
    expect(suggestIncidents("element", choices).map((c) => c.id)).toEqual(["2", "3"])
    // a substring in the middle of a word is not a match
    expect(suggestIncidents("strasse", choices)).toEqual([])
  })

  it("an empty # offers everything, umlauts ignored", () => {
    expect(suggestIncidents("", choices)).toHaveLength(3)
    expect(suggestIncidents("brandbekampf", choices).map((c) => c.id)).toEqual(["1"])
  })

  it("matches the exact Einsatz number, never a number prefix or a house number", () => {
    const numbered = [
      { id: "1", number: 14, label: "14 · Gartenweg 4" },
      { id: "2", number: 140, label: "140 · Hauptstrasse 14" },
      { id: "3", label: "Schulstrasse 14" },
    ]
    expect(suggestIncidents("14", numbered).map((c) => c.id)).toEqual(["1"])
    expect(suggestIncidents("014", numbered).map((c) => c.id)).toEqual(["1"])
    expect(suggestIncidents("1", numbered)).toEqual([])
    expect(suggestIncidents("4", numbered)).toEqual([])
    expect(suggestIncidents("schul", numbered).map((c) => c.id)).toEqual(["3"])
    expect(suggestIncidents("gart", numbered).map((c) => c.id)).toEqual(["1"])
  })
})

describe("formatJournalTime", () => {
  it("always «dd.mm. HH:MM», today included, so every row is the same width", () => {
    expect(formatJournalTime(new Date().toISOString())).toMatch(/^\d{2}\.\d{2}\. \d{2}:\d{2}$/)
    expect(formatJournalTime(new Date(2026, 9, 8, 9, 5).toISOString())).toBe("08.10. 09:05")
    expect(formatJournalTime(new Date(2026, 9, 7, 23, 59).toISOString())).toBe("07.10. 23:59")
  })
})

describe("mergedInto", () => {
  it("follows merge and unmerge in seq order", () => {
    const into = row({ kind: "incident", category: "status", incident_id: "dup", data: { action: "merged_into", other_title: "Gartenweg 4" } })
    expect(mergedInto([into]).get("dup")).toBe("Gartenweg 4")
    const undo = row({ kind: "incident", category: "status", incident_id: "dup", data: { action: "unmerge", other_title: "Gartenweg 4" } })
    expect(mergedInto([undo, into]).has("dup")).toBe(false)
  })
})
