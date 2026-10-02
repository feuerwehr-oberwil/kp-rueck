/**
 * What the Einsatz detail says under a text field: «Wird gespeichert …»,
 * «Gespeichert – 09:41», «Nicht gespeichert».
 *
 * «Gespeichert» means ONE thing here: the server answered the PATCH that
 * carried the newest text of that field. Not «the request left», not «the
 * debounce fired», and never while a newer keystroke is still queued or in
 * flight behind it. That is Front's rule (`combinedSyncStatus`: saving is done
 * only when every change is acknowledged) without Front's IndexedDB outbox —
 * Rück's server stays the only store, so a failed write is held as a DRAFT in
 * memory, shown in the field it came from, and sent again only when the
 * operator says so («Erneut speichern»). There is no queue that retries on its
 * own: a confirmed change is never resent, and an unconfirmed one is resent by
 * a person who can see what they are sending.
 *
 * Bound to user + Ereignis + incident. The scope is `<userId>:<eventId>`; a
 * different user (or a signed-out session) drops every draft of the previous
 * one, so nothing an earlier operator typed can be sent under the next
 * operator's session. Another Ereignis only hides them — they are the same
 * person's, and switching back shows them again.
 *
 * Fed from the one funnel every incident edit passes through
 * (`updateOperation` in operations-context), read by the field components
 * through `useFieldSave` (useSyncExternalStore). Module-level like the REST
 * reachability in `api/http.ts`: one per tab.
 */

import { ApiError, NetworkError } from "@/lib/api-client"

/** The free-text fields of an incident that report their own save state. */
export const SAVED_TEXT_FIELDS = [
  "notes",
  "contact",
  "contactPhone",
  "internalNotes",
  "nachbarhilfeNote",
  "amWartenNote",
] as const
export type SavedTextField = (typeof SAVED_TEXT_FIELDS)[number]

export function isSavedTextField(key: string): key is SavedTextField {
  return (SAVED_TEXT_FIELDS as readonly string[]).includes(key)
}

/** Why a save failed, in the words the field will use. */
export type FieldSaveFailure = "network" | "session" | "forbidden" | "conflict" | "rejected" | "server" | "unknown"

export function classifySaveFailure(error: unknown): FieldSaveFailure {
  if (error instanceof NetworkError) return "network"
  if (error instanceof ApiError) {
    if (error.status === 401) return "session"
    if (error.status === 403) return "forbidden"
    if (error.status === 409) return "conflict"
    if (error.status >= 500) return "server"
    if (error.status >= 400) return "rejected"
  }
  return "unknown"
}

export type FieldSaveStatus = "pending" | "saving" | "saved" | "failed"

export interface FieldSaveEntry {
  status: FieldSaveStatus
  /** The text the operator wants stored. Held until the server confirms it;
   *  null once it has (the field then shows the board's value again). */
  draft: string | null
  /** The field's server value when this run of edits began — what «inzwischen
   *  geändert» is measured against. */
  base: string
  /** When the server last confirmed this field from this window. */
  savedAt: Date | null
  reason: FieldSaveFailure | null
  /** Bumped by every edit; a settle only counts if it carried the newest one. */
  version: number
  /** Requests carrying this field that have not settled yet. */
  inFlight: number
}

/** Per-request receipt: which version of which field it carried. */
export type FieldSaveTicket = { scope: string | null; incidentId: string; versions: Partial<Record<SavedTextField, number>> }

type Listener = () => void

let scope: string | null = null
const entries = new Map<string, FieldSaveEntry>()
const listeners = new Set<Listener>()
const watchers = new Map<string, number>()

const keyOf = (s: string | null, incidentId: string, field: SavedTextField) => `${s ?? "-"}|${incidentId}|${field}`
const userOf = (s: string | null) => (s === null ? null : s.split(":")[0] || null)
const userOfKey = (key: string) => {
  const entryScope = key.split("|")[0]
  return entryScope === "-" ? null : userOf(entryScope)
}

function emit() {
  listeners.forEach((listener) => listener())
}

function put(key: string, entry: FieldSaveEntry) {
  entries.set(key, entry)
}

export function subscribeFieldSave(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** `<userId>:<eventId>`, or null when nobody is signed in. */
export function fieldSaveScope(userId: string | null | undefined, eventId: string | null | undefined): string | null {
  if (!userId) return null
  return `${userId}:${eventId ?? ""}`
}

export function getFieldSaveScope(): string | null {
  return scope
}

/** The user part of a scope — what decides whether a queued write may still go out. */
export function fieldSaveUser(s: string | null): string | null {
  return userOf(s)
}

/**
 * Move to another user/Ereignis. A different user (or none) takes every draft
 * of the previous one with it; a different Ereignis of the same user only
 * hides them.
 */
export function setFieldSaveScope(next: string | null): void {
  if (next === scope) return
  const nextUser = userOf(next)
  for (const key of [...entries.keys()]) {
    if (nextUser === null || userOfKey(key) !== nextUser) entries.delete(key)
  }
  scope = next
  emit()
}

export function getFieldSave(incidentId: string, field: SavedTextField): FieldSaveEntry | undefined {
  return entries.get(keyOf(scope, incidentId, field))
}

/** An edit was made (optimistically shown, about to be debounced). */
export function noteFieldEdit(incidentId: string, field: SavedTextField, value: string, serverValue: string): void {
  const key = keyOf(scope, incidentId, field)
  const prev = entries.get(key)
  const holdsDraft = prev && prev.draft !== null
  put(key, {
    status: "pending",
    draft: value,
    // The base is the value BEFORE this run of edits; a run continues as long
    // as a draft is held (typing on through a failure is the same run).
    base: holdsDraft ? prev.base : serverValue,
    savedAt: prev?.savedAt ?? null,
    reason: null,
    version: (prev?.version ?? 0) + 1,
    inFlight: prev?.inFlight ?? 0,
  })
  emit()
}

/** A PATCH carrying these fields is leaving now. */
export function noteFieldSend(incidentId: string, fields: readonly SavedTextField[]): FieldSaveTicket {
  const versions: FieldSaveTicket["versions"] = {}
  for (const field of fields) {
    const key = keyOf(scope, incidentId, field)
    const entry = entries.get(key)
    if (!entry) continue
    versions[field] = entry.version
    put(key, { ...entry, inFlight: entry.inFlight + 1, status: entry.status === "pending" ? "saving" : entry.status })
  }
  if (fields.length) emit()
  return { scope, incidentId, versions }
}

/**
 * The PATCH settled. Only a request that carried the field's NEWEST version
 * may decide its state — an older one landing late says nothing about the
 * text on screen. And «Gespeichert» waits until nothing for that field is in
 * flight any more.
 */
export function noteFieldSettled(ticket: FieldSaveTicket, outcome: { ok: true } | { ok: false; reason: FieldSaveFailure }): void {
  let changed = false
  for (const [field, version] of Object.entries(ticket.versions) as [SavedTextField, number][]) {
    const key = keyOf(ticket.scope, ticket.incidentId, field)
    const entry = entries.get(key)
    if (!entry) continue
    changed = true
    const inFlight = Math.max(0, entry.inFlight - 1)
    if (entry.version !== version) {
      put(key, { ...entry, inFlight })
      continue
    }
    if (outcome.ok) {
      put(key, inFlight > 0
        ? { ...entry, inFlight }
        : { ...entry, inFlight, status: "saved", draft: null, savedAt: new Date(), reason: null })
    } else {
      put(key, { ...entry, inFlight, status: "failed", reason: outcome.reason })
    }
  }
  if (changed) emit()
}

/** A queued write was dropped before it left (session switch) — the field is
 *  then simply not this window's business any more. */
export function noteFieldDropped(ticket: FieldSaveTicket): void {
  let changed = false
  for (const field of Object.keys(ticket.versions) as SavedTextField[]) {
    if (entries.delete(keyOf(ticket.scope, ticket.incidentId, field))) changed = true
  }
  if (changed) emit()
}

/** Drafts that did NOT reach the server, for the current user (any Ereignis). */
export function unsavedFieldDrafts(incidentId?: string): Array<{ incidentId: string; field: SavedTextField }> {
  const user = userOf(scope)
  if (user === null) return []
  const out: Array<{ incidentId: string; field: SavedTextField }> = []
  for (const [key, entry] of entries) {
    if (entry.status !== "failed") continue
    const [entryScope, id, field] = key.split("|")
    if (userOfKey(key) !== user) continue
    if (incidentId !== undefined && (id !== incidentId || entryScope !== (scope ?? "-"))) continue
    out.push({ incidentId: id, field: field as SavedTextField })
  }
  return out
}

/**
 * A field display is on screen for this incident. While one is, a failure is
 * said THERE — the context skips its own toast, because two red notices for
 * one fact is noise. Nobody watching (panel closed): the toast is the only
 * place left to say it.
 */
export function watchFieldSave(incidentId: string): () => void {
  watchers.set(incidentId, (watchers.get(incidentId) ?? 0) + 1)
  return () => {
    const n = (watchers.get(incidentId) ?? 1) - 1
    if (n <= 0) watchers.delete(incidentId)
    else watchers.set(incidentId, n)
  }
}

export function isFieldSaveWatched(incidentId: string): boolean {
  return (watchers.get(incidentId) ?? 0) > 0
}

/** Tests only. */
export function resetFieldSaveForTests(): void {
  scope = null
  entries.clear()
  watchers.clear()
  emit()
}
