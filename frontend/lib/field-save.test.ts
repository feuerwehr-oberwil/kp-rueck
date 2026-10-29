import { beforeEach, describe, expect, it } from "vitest"

import { ApiError, NetworkError } from "@/lib/api-client"
import {
  classifySaveFailure,
  fieldSaveScope,
  fieldSaveUser,
  getFieldSave,
  getFieldSaveScope,
  isSavedTextField,
  isFieldSaveWatched,
  noteFieldEdit,
  noteFieldQueued,
  noteFieldSend,
  noteFieldSettled,
  resetFieldSaveForTests,
  resolveFieldConflict,
  textConflictOf,
  setFieldSaveScope,
  subscribeFieldSave,
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
    expect(getFieldSave("inc-1", "notes")).toMatchObject({ draft: "Mine", acked: "Theirs", conflict: null })
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

describe("field-save contracts", () => {
  it.each([
    ["notes", "description"], ["contact", "contact"], ["contactPhone", "contact_phone"],
    ["internalNotes", "internal_notes"], ["nachbarhilfeNote", "nachbarhilfe_note"], ["amWartenNote", "am_warten_note"],
  ] as const)("sends and confirms %s using its API column %s", (field, apiField) => {
    noteFieldEdit("inc-1", field, "new text", "server text")
    expect(isSavedTextField(field)).toBe(true)
    expect(getFieldSave("inc-1", field)).toMatchObject({
      status: "pending", draft: "new text", base: "server text", acked: "server text", inFlight: 0, version: 1,
    })
    const ticket = noteFieldSend(noteFieldQueued("inc-1", { [field]: "new text" }))
    expect(ticket.textBase).toEqual({ [apiField]: "server text" })
    expect(getFieldSave("inc-1", field)).toMatchObject({ status: "saving", inFlight: 1, draft: "new text" })
    noteFieldSettled(ticket, { ok: true })
    expect(getFieldSave("inc-1", field)).toMatchObject({
      status: "saved", draft: null, acked: "new text", inFlight: 0, reason: null, conflict: null,
    })
    expect(getFieldSave("inc-1", field)?.savedAt).toBeInstanceOf(Date)
    expect(unsavedFieldDrafts()).toEqual([])
    expect(textConflictOf(new ApiError("conflict", 409, true, "text_conflict", { field: apiField, current: "theirs" })))
      .toEqual({ field, conflict: { text: "theirs", by: null, at: null } })
  })

  it("keeps a cleared field as a draft and preserves it after rejection", () => {
    noteFieldEdit("inc-1", "notes", "", "server")
    const ticket = noteFieldSend(noteFieldQueued("inc-1", { notes: "" }))
    noteFieldSettled(ticket, { ok: false, reason: "forbidden" })
    expect(getFieldSave("inc-1", "notes")).toMatchObject({
      status: "failed", draft: "", base: "server", acked: "server", reason: "forbidden", inFlight: 0, savedAt: null,
    })
    expect(unsavedFieldDrafts()).toEqual([{ incidentId: "inc-1", field: "notes" }])
    noteFieldEdit("inc-1", "notes", "retry", "")
    expect(getFieldSave("inc-1", "notes")).toMatchObject({ base: "server", acked: "server", reason: null, version: 2 })
  })

  it("does not recreate another user's draft when a late response arrives", () => {
    noteFieldEdit("inc-1", "notes", "private", "server")
    const ticket = noteFieldSend(noteFieldQueued("inc-1", { notes: "private" }))
    setFieldSaveScope(fieldSaveScope("user-b", "event-1"))
    noteFieldSettled(ticket, { ok: false, reason: "network" })
    expect(unsavedFieldDrafts()).toEqual([])
    expect(getFieldSave("inc-1", "notes")).toBeUndefined()
    setFieldSaveScope(fieldSaveScope("user-a", "event-1"))
    expect(getFieldSave("inc-1", "notes")).toBeUndefined()
  })

  it("scopes the leave guard to the selected event when an incident is specified", () => {
    noteFieldEdit("inc-1", "notes", "a", "")
    fail()
    setFieldSaveScope(fieldSaveScope("user-a", "event-2"))
    expect(unsavedFieldDrafts("inc-1")).toEqual([])
    noteFieldEdit("inc-1", "contact", "b", "")
    const ticket = noteFieldSend(noteFieldQueued("inc-1", { contact: "b" }))
    noteFieldSettled(ticket, { ok: false, reason: "network" })
    expect(unsavedFieldDrafts("inc-1")).toEqual([{ incidentId: "inc-1", field: "contact" }])
    expect(unsavedFieldDrafts()).toHaveLength(2)
  })

  it("a conflict on one field leaves sibling fields and the confirmed base intact", () => {
    noteFieldEdit("inc-1", "notes", "mine", "old")
    noteFieldEdit("inc-1", "contact", "Meier", "Muster")
    const ticket = noteFieldSend(noteFieldQueued("inc-1", { notes: "mine", contact: "Meier" }))
    noteFieldSettled(ticket, { ok: false, reason: "conflict", conflict: {
      field: "notes", conflict: { text: "theirs", by: null, at: null },
    } })
    expect(getFieldSave("inc-1", "notes")).toMatchObject({ acked: "old", conflict: { text: "theirs" } })
    expect(getFieldSave("inc-1", "contact")).toMatchObject({ acked: "Muster", conflict: null })
    noteFieldEdit("inc-1", "notes", "mine again", "optimistic")
    expect(getFieldSave("inc-1", "notes")?.conflict?.text).toBe("theirs")
  })

  it("notifies subscribers of changes and respects unsubscribe", () => {
    let notifications = 0
    const unsubscribe = subscribeFieldSave(() => notifications++)
    setFieldSaveScope(getFieldSaveScope())
    expect(notifications).toBe(0)
    noteFieldEdit("inc-1", "notes", "x", "")
    expect(notifications).toBe(1)
    unsubscribe()
    noteFieldEdit("inc-1", "notes", "xy", "")
    expect(notifications).toBe(1)
  })

  it("notifies the field as a save starts, settles and leaves the current event", () => {
    const seen: Array<string | undefined> = []
    const unsubscribe = subscribeFieldSave(() => seen.push(getFieldSave("inc-1", "notes")?.status))
    noteFieldEdit("inc-1", "notes", "new", "old")
    noteFieldSettled(noteFieldSend(noteFieldQueued("inc-1", { notes: "new" })), { ok: true })
    setFieldSaveScope(fieldSaveScope("user-a", "event-2"))
    unsubscribe()
    expect(seen).toEqual(["pending", "saving", "saved", undefined])
    setFieldSaveScope(null)
    expect(unsavedFieldDrafts()).toEqual([])
  })

  it("untracked fields do not acquire save state", () => {
    expect(isSavedTextField("priority")).toBe(false)
    expect(noteFieldSend(noteFieldQueued("unknown", { notes: "x" })).textBase).toEqual({})
    expect(getFieldSave("unknown", "notes")).toBeUndefined()
    resolveFieldConflict("unknown", "notes", "mine")
    expect(getFieldSave("unknown", "notes")).toBeUndefined()
  })

  it("identifies users even before an event is selected", () => {
    expect(fieldSaveScope(null, "event")).toBeNull()
    expect(fieldSaveScope(undefined, "event")).toBeNull()
    expect(fieldSaveScope("u", null)).toBe("u:")
    expect(fieldSaveUser("u:event")).toBe("u")
    expect(fieldSaveUser(null)).toBeNull()
  })

  it.each([[399, "unknown"], [400, "rejected"], [499, "rejected"], [500, "server"]] as const)(
    "classifies HTTP %s as %s", (status, reason) => expect(classifySaveFailure(new ApiError("x", status))).toBe(reason),
  )

  it("keeps absent conflict authors and timestamps absent", () => {
    // Decode the wire payload: API conflict metadata can contain JSON nulls.
    const params = JSON.parse('{"field":"description","current":null,"changed_by":null,"changed_at":null}')
    expect(textConflictOf(new ApiError("conflict", 409, true, "text_conflict", params)))
      .toEqual({ field: "notes", conflict: { text: "", by: null, at: null } })
  })

  it("rejects errors that are not a supported field's text conflict", () => {
    expect(textConflictOf(new Error("offline"))).toBeNull()
    expect(textConflictOf(new ApiError("x", 500, true, "text_conflict", { field: "description" }))).toBeNull()
    expect(textConflictOf(new ApiError("x", 409, true, "text_conflict", { field: "priority" }))).toBeNull()
    expect(textConflictOf(new ApiError("x", 409, true, "text_conflict"))).toBeNull()
  })
})
