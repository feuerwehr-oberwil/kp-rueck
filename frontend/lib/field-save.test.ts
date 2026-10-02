import { beforeEach, describe, expect, it } from "vitest"

import { ApiError, NetworkError } from "@/lib/api-client"
import {
  classifySaveFailure,
  fieldSaveScope,
  getFieldSave,
  isFieldSaveWatched,
  noteFieldEdit,
  noteFieldSend,
  noteFieldSettled,
  resetFieldSaveForTests,
  setFieldSaveScope,
  unsavedFieldDrafts,
  watchFieldSave,
} from "./field-save"

beforeEach(() => {
  resetFieldSaveForTests()
  setFieldSaveScope(fieldSaveScope("user-a", "event-1"))
})

const fail = (incidentId = "inc-1") => {
  const ticket = noteFieldSend(incidentId, ["notes"])
  noteFieldSettled(ticket, { ok: false, reason: "network" })
}

describe("field-save store", () => {
  it("an older request settling late decides nothing about a newer edit", () => {
    noteFieldEdit("inc-1", "notes", "a", "")
    const first = noteFieldSend("inc-1", ["notes"])
    noteFieldEdit("inc-1", "notes", "ab", "")
    const second = noteFieldSend("inc-1", ["notes"])

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
