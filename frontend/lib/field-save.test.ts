import { beforeEach, describe, expect, it } from "vitest"

import { ApiError, NetworkError } from "@/lib/api-client"
import {
  classifySaveFailure,
  fieldSaveScope,
  getFieldSave,
  isFieldSaveWatched,
  noteFieldEdit,
  noteFieldQueued,
  noteFieldSend,
  noteFieldSettled,
  resetFieldSaveForTests,
  resolveFieldConflict,
  textConflictOf,
  setFieldSaveScope,
  unsavedFieldDrafts,
  watchFieldSave,
} from "./field-save"

beforeEach(() => {
  resetFieldSaveForTests()
  setFieldSaveScope(fieldSaveScope("user-a", "event-1"))
})

const fail = (incidentId = "inc-1") => {
  const ticket = noteFieldSend(noteFieldQueued(incidentId, { notes: "x" }))
  noteFieldSettled(ticket, { ok: false, reason: "network" })
}

describe("field-save store", () => {
  it("an older request settling late decides nothing about a newer edit", () => {
    noteFieldEdit("inc-1", "notes", "a", "")
    const first = noteFieldSend(noteFieldQueued("inc-1", { notes: "x" }))
    noteFieldEdit("inc-1", "notes", "ab", "")
    const second = noteFieldSend(noteFieldQueued("inc-1", { notes: "x" }))

    noteFieldSettled(second, { ok: true })
    // The first is still in flight: not «saved» yet.
    expect(getFieldSave("inc-1", "notes")?.status).toBe("saving")
    noteFieldSettled(first, { ok: false, reason: "network" })
    expect(getFieldSave("inc-1", "notes")?.status).toBe("saving")
  })

  it("keeps the base of a run of edits across a failure", () => {
    noteFieldEdit("inc-1", "notes", "a", "server")
    fail()
    noteFieldEdit("inc-1", "notes", "ab", "a") // optimistic value is the draft now
    expect(getFieldSave("inc-1", "notes")?.base).toBe("server")
  })

  it("another Ereignis of the same user hides drafts; switching back shows them", () => {
    noteFieldEdit("inc-1", "notes", "a", "")
    fail()
    setFieldSaveScope(fieldSaveScope("user-a", "event-2"))
    expect(getFieldSave("inc-1", "notes")).toBeUndefined()
    // Still this user's unsaved text — the page must still warn before unload.
    expect(unsavedFieldDrafts()).toHaveLength(1)
    setFieldSaveScope(fieldSaveScope("user-a", "event-1"))
    expect(getFieldSave("inc-1", "notes")?.draft).toBe("a")
  })

  it("another user — or signing out — drops them for good", () => {
    noteFieldEdit("inc-1", "notes", "a", "")
    fail()
    setFieldSaveScope(fieldSaveScope(null, "event-1"))
    setFieldSaveScope(fieldSaveScope("user-a", "event-1"))
    expect(getFieldSave("inc-1", "notes")).toBeUndefined()
    expect(unsavedFieldDrafts()).toEqual([])
  })

  it("lists unsaved drafts per incident for the leave guard", () => {
    noteFieldEdit("inc-1", "notes", "a", "")
    fail("inc-1")
    noteFieldEdit("inc-2", "notes", "b", "")
    expect(unsavedFieldDrafts("inc-1")).toEqual([{ incidentId: "inc-1", field: "notes" }])
    // Pending is not «unsaved»: it is on its way.
    expect(unsavedFieldDrafts("inc-2")).toEqual([])
  })

  it("counts watchers per incident", () => {
    const a = watchFieldSave("inc-1")
    const b = watchFieldSave("inc-1")
    a()
    expect(isFieldSaveWatched("inc-1")).toBe(true)
    b()
    expect(isFieldSaveWatched("inc-1")).toBe(false)
  })

  it("names the failure", () => {
    expect(classifySaveFailure(new NetworkError("x"))).toBe("network")
    expect(classifySaveFailure(new ApiError("x", 401))).toBe("session")
    expect(classifySaveFailure(new ApiError("x", 403))).toBe("forbidden")
    expect(classifySaveFailure(new ApiError("x", 409, true))).toBe("conflict")
    expect(classifySaveFailure(new ApiError("x", 422))).toBe("rejected")
    expect(classifySaveFailure(new ApiError("x", 503))).toBe("server")
    expect(classifySaveFailure(new Error("x"))).toBe("unknown")
  })
})

describe("text_base (review F05)", () => {
  const conflict = { field: "notes" as const, conflict: { text: "Theirs", by: "Koch René", at: "2026-10-26T18:31:00Z" } }

  it("sends the last text the server confirmed as the base, not the start of the run", () => {
    noteFieldEdit("inc-1", "notes", "a", "server")
    const first = noteFieldSend(noteFieldQueued("inc-1", { notes: "a" }))
    expect(first.textBase).toEqual({ description: "server" })
    noteFieldSettled(first, { ok: true })

    noteFieldEdit("inc-1", "notes", "ab", "a")
    expect(noteFieldSend(noteFieldQueued("inc-1", { notes: "ab" })).textBase).toEqual({ description: "a" })
  })

  it("«Meinen Text speichern» makes the other text the base for the retry", () => {
    noteFieldEdit("inc-1", "notes", "Mine", "server")
    noteFieldSettled(noteFieldSend(noteFieldQueued("inc-1", { notes: "Mine" })), { ok: false, reason: "conflict", conflict })
    expect(getFieldSave("inc-1", "notes")?.conflict?.text).toBe("Theirs")

    resolveFieldConflict("inc-1", "notes", "mine")
    noteFieldEdit("inc-1", "notes", "Mine", "Theirs")
    expect(noteFieldSend(noteFieldQueued("inc-1", { notes: "Mine" })).textBase).toEqual({ description: "Theirs" })
    expect(getFieldSave("inc-1", "notes")?.conflict).toBeNull()
  })

  it("«Diese Fassung übernehmen» drops the draft", () => {
    noteFieldEdit("inc-1", "notes", "Mine", "server")
    noteFieldSettled(noteFieldSend(noteFieldQueued("inc-1", { notes: "Mine" })), { ok: false, reason: "conflict", conflict })

    resolveFieldConflict("inc-1", "notes", "theirs")
    expect(getFieldSave("inc-1", "notes")).toBeUndefined()
    expect(unsavedFieldDrafts()).toHaveLength(0)
  })

  it("reads the field and the other text out of a 409 text_conflict only", () => {
    const params = { field: "description", current: "Theirs", changed_by: "Koch René", changed_at: "2026-10-26T18:31:00Z" }
    expect(textConflictOf(new ApiError("x", 409, true, "text_conflict", params))).toEqual(conflict)
    expect(textConflictOf(new ApiError("x", 409, true, "incident_status_changed", params))).toBeNull()
  })

  it("a batch is the edit it was cut from: a newer keystroke stays unsaved and never becomes the base", () => {
    // Review round 1: B waited in the queue while C was typed; B's answer cleared C's draft,
    // and the next keystroke then took the unsent C as the server's text – a false conflict.
    noteFieldEdit("inc-1", "notes", "B", "A")
    const b = noteFieldQueued("inc-1", { notes: "B" })
    noteFieldEdit("inc-1", "notes", "BC", "B")
    noteFieldSettled(noteFieldSend(b), { ok: true })

    expect(getFieldSave("inc-1", "notes")?.status).toBe("pending")
    expect(getFieldSave("inc-1", "notes")?.draft).toBe("BC")
    noteFieldEdit("inc-1", "notes", "BCD", "BC")
    expect(noteFieldSend(noteFieldQueued("inc-1", { notes: "BCD" })).textBase).toEqual({ description: "B" })
  })

  it("a batch typed in one Ereignis keeps its base after a switch to another", () => {
    noteFieldEdit("inc-1", "notes", "Mine", "server")
    const queued = noteFieldQueued("inc-1", { notes: "Mine" })
    setFieldSaveScope(fieldSaveScope("user-a", "event-2"))

    const sent = noteFieldSend(queued)
    expect(sent.textBase).toEqual({ description: "server" })
    noteFieldSettled(sent, { ok: true })
    setFieldSaveScope(fieldSaveScope("user-a", "event-1"))
    expect(getFieldSave("inc-1", "notes")?.status).toBe("saved")
  })
})
