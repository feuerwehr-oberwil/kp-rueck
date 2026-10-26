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
import type { IncidentTextField } from "@/lib/api/types/incidents"

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

/** The incident column behind each field – the name in `text_base` and in a conflict. */
export const SAVED_TEXT_API_FIELD = {
  notes: "description",
  contact: "contact",
  contactPhone: "contact_phone",
  internalNotes: "internal_notes",
  nachbarhilfeNote: "nachbarhilfe_note",
  amWartenNote: "am_warten_note",
} as const satisfies Record<SavedTextField, IncidentTextField>

/**
 * Somebody else saved this field after our run of edits began (409 `text_conflict`).
 * `by`/`at` are null when the server cannot say who (e.g. a write from the Feld door).
 */
export interface FieldConflict {
  text: string
  by: string | null
  at: string | null
}

/** The field and the other writer's text out of a 409 `text_conflict`, else null. */
export function textConflictOf(error: unknown): { field: SavedTextField; conflict: FieldConflict } | null {
  if (!(error instanceof ApiError) || error.status !== 409 || error.code !== "text_conflict") return null
  const params = error.params ?? {}
  const field = SAVED_TEXT_FIELDS.find((f) => SAVED_TEXT_API_FIELD[f] === params.field)
  if (!field) return null
  return {
    field,
    conflict: {
      text: String(params.current ?? ""),
      by: params.changed_by === undefined ? null : String(params.changed_by),
      at: params.changed_at === undefined ? null : String(params.changed_at),
    },
  }
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
  /** What this window believes the server holds now: `base`, then the text of
   *  each PATCH the server confirmed. Sent as `text_base`, so the server can
   *  refuse a save that would silently overwrite somebody else's (review F05). */
  acked: string
  /** The other writer's text after a 409 `text_conflict`; null otherwise. */
  conflict: FieldConflict | null
  /** When the server last confirmed this field from this window. */
  savedAt: Date | null
  reason: FieldSaveFailure | null
  /** Bumped by every edit; a settle only counts if it carried the newest one. */
  version: number
  /** Requests carrying this field that have not settled yet. */
  inFlight: number
}

/**
 * Per-request receipt: which version and which text of which field it carried,
 * and the `text_base` to send with it – per field, the text this window last saw
 * the server confirm.
 */
export type FieldSaveTicket = {
  scope: string | null
  incidentId: string
  versions: Partial<Record<SavedTextField, number>>
  texts: Partial<Record<SavedTextField, string>>
  textBase: Partial<Record<IncidentTextField, string>>
}

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
    acked: holdsDraft ? prev.acked : serverValue,
    // Typing on does not answer the question; only a choice in the block does.
    conflict: holdsDraft ? prev.conflict : null,
    savedAt: prev?.savedAt ?? null,
    reason: null,
    version: (prev?.version ?? 0) + 1,
    inFlight: prev?.inFlight ?? 0,
  })
  emit()
}

/**
 * A batch carrying these texts was cut and waits in the per-incident queue.
 * The receipt pins WHICH edit it carries (the field versions now, not when it
 * finally leaves: a newer keystroke typed meanwhile is the next batch's) and
 * in which user + Ereignis it was typed, so a later switch cannot move it.
 */
export function noteFieldQueued(
  incidentId: string,
  texts: Partial<Record<SavedTextField, string>>,
  atScope: string | null = scope,
): FieldSaveTicket {
  const versions: FieldSaveTicket["versions"] = {}
  for (const field of Object.keys(texts).filter(isSavedTextField)) {
    const entry = entries.get(keyOf(atScope, incidentId, field))
    if (entry) versions[field] = entry.version
  }
  return { scope: atScope, incidentId, versions, texts, textBase: {} }
}

/**
 * The queued batch is leaving now. Call it at the moment of sending (inside the
 * per-incident queue), so the confirmation of the PATCH ahead has already moved
 * `acked`; the returned receipt carries the `text_base` to send.
 */
export function noteFieldSend(ticket: FieldSaveTicket): FieldSaveTicket {
  const textBase: FieldSaveTicket["textBase"] = {}
  const fields = Object.keys(ticket.versions).filter(isSavedTextField)
  for (const field of fields) {
    const key = keyOf(ticket.scope, ticket.incidentId, field)
    const entry = entries.get(key)
    if (!entry) continue
    textBase[SAVED_TEXT_API_FIELD[field]] = entry.acked
    // «Wird gespeichert» only if this batch carries the newest text; a newer one still waits.
    const carriesNewest = entry.version === ticket.versions[field]
    put(key, {
      ...entry,
      inFlight: entry.inFlight + 1,
      status: carriesNewest && entry.status === "pending" ? "saving" : entry.status,
    })
  }
  if (fields.length) emit()
  return { ...ticket, textBase }
}

/**
 * The PATCH settled. Only a request that carried the field's NEWEST version
 * may decide its state — an older one landing late says nothing about the
 * text on screen. And «Gespeichert» waits until nothing for that field is in
 * flight any more.
 */
export function noteFieldSettled(
  ticket: FieldSaveTicket,
  outcome: { ok: true } | { ok: false; reason: FieldSaveFailure; conflict?: { field: SavedTextField; conflict: FieldConflict } | null },
): void {
  let changed = false
  for (const [field, version] of Object.entries(ticket.versions) as [SavedTextField, number][]) {
    const key = keyOf(ticket.scope, ticket.incidentId, field)
    const entry = entries.get(key)
    if (!entry) continue
    changed = true
    const inFlight = Math.max(0, entry.inFlight - 1)
    // Even an older version that was confirmed is what the server holds now.
    const acked = outcome.ok ? (ticket.texts[field] ?? entry.acked) : entry.acked
    if (entry.version !== version) {
      put(key, { ...entry, inFlight, acked })
      continue
    }
    if (outcome.ok) {
      put(key, inFlight > 0
        ? { ...entry, inFlight, acked }
        : { ...entry, inFlight, acked, status: "saved", draft: null, conflict: null, savedAt: new Date(), reason: null })
    } else {
      const conflict = outcome.conflict?.field === field ? outcome.conflict.conflict : entry.conflict
      put(key, { ...entry, inFlight, status: "failed", reason: outcome.reason, conflict })
    }
  }
  if (changed) emit()
}

/**
 * The operator's answer to a conflict. `mine`: the other text is now the known
 * base, so the next save (the caller's retry) deliberately replaces it. `theirs`:
 * the draft is dropped and the field shows the board's value again.
 */
export function resolveFieldConflict(incidentId: string, field: SavedTextField, choice: "mine" | "theirs"): void {
  const key = keyOf(scope, incidentId, field)
  const entry = entries.get(key)
  if (!entry?.conflict) return
  if (choice === "theirs") entries.delete(key)
  else put(key, { ...entry, acked: entry.conflict.text, conflict: null })
  emit()
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
