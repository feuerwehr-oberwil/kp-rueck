/**
 * Einsatztagebuch — the pure half of the journal drawer (idea R8).
 *
 * The server keeps one append-only log per Ereignis (`journal_entries`): the board's own
 * facts, written as they happen, and the operator's manual lines. A correction is a NEW
 * row pointing at the line it corrects; this file folds it in so the drawer shows one line
 * with the newest wording and says «korrigiert», exactly as the PDF prints it.
 */

import type { ApiJournalCategory, ApiJournalEntry } from "@/lib/api/types"

/** The filter chips, in their order. «Alle» is the empty selection. */
export const JOURNAL_CATEGORIES: readonly ApiJournalCategory[] = ["manual", "field", "status", "resources"]

export interface JournalLine {
  /** The original row — its time, its Einsatz, its author. */
  entry: ApiJournalEntry
  /** What the line says now: the newest correction's text, else the row's own. */
  text: string | null
  /** The corrections, oldest first. Empty for a line nobody corrected. */
  corrections: ApiJournalEntry[]
}

/** Add a fetched page to what is already held — by id, so a page fetched twice (a poll
 *  racing the WebSocket nudge) never doubles a row. Kept in seq order. */
export function mergeJournal(held: readonly ApiJournalEntry[], page: readonly ApiJournalEntry[]): ApiJournalEntry[] {
  if (page.length === 0) return held as ApiJournalEntry[]
  const ids = new Set(held.map((e) => e.id))
  const fresh = page.filter((e) => !ids.has(e.id))
  if (fresh.length === 0) return held as ApiJournalEntry[]
  return [...held, ...fresh].sort((a, b) => a.seq - b.seq)
}

/** The log as the drawer lists it: corrections folded into their line, newest first. */
export function foldJournal(entries: readonly ApiJournalEntry[]): JournalLine[] {
  const corrections = new Map<string, ApiJournalEntry[]>()
  for (const e of entries) {
    if (!e.corrects_id) continue
    const list = corrections.get(e.corrects_id) ?? []
    list.push(e)
    corrections.set(e.corrects_id, list)
  }
  const lines: JournalLine[] = []
  for (const entry of entries) {
    if (entry.corrects_id) continue
    const own = (corrections.get(entry.id) ?? []).sort((a, b) => a.seq - b.seq)
    lines.push({ entry, text: own.length ? own[own.length - 1].text : entry.text, corrections: own })
  }
  // When it happened, newest on top; seq breaks a tie (two rows of one flush).
  return lines.sort((a, b) => {
    const t = Date.parse(b.entry.occurred_at) - Date.parse(a.entry.occurred_at)
    return t !== 0 ? t : b.entry.seq - a.entry.seq
  })
}

/**
 * Einsätze merged into another card and not unmerged since → the title of that card.
 * Read from the log itself, in seq order — the same rule the PDF applies
 * (`services/journal.merged_into`).
 */
export function mergedInto(entries: readonly ApiJournalEntry[]): Map<string, string> {
  const out = new Map<string, string>()
  for (const e of [...entries].sort((a, b) => a.seq - b.seq)) {
    if (e.kind !== "incident" || !e.incident_id || !e.data) continue
    const action = e.data.action
    if (action === "merged_into") out.set(e.incident_id, typeof e.data.other_title === "string" ? e.data.other_title : "")
    else if (action === "unmerge" || action === "restored") out.delete(e.incident_id)
  }
  return out
}

/** Rows of the ticked categories; nothing ticked = «Alle». */
export function filterJournal(lines: readonly JournalLine[], ticked: ReadonlySet<ApiJournalCategory>): JournalLine[] {
  if (ticked.size === 0) return lines as JournalLine[]
  return lines.filter((l) => ticked.has(l.entry.category))
}

/** How many lines each chip would show. */
export function journalCounts(lines: readonly JournalLine[]): Record<ApiJournalCategory, number> {
  const counts: Record<ApiJournalCategory, number> = { manual: 0, field: 0, status: 0, resources: 0 }
  for (const l of lines) counts[l.entry.category] += 1
  return counts
}

/**
 * The `#…` being typed at the end of the input, or null.
 *
 * `#` opens a pick-list: `#14` matches the Einsatz number exactly, `#garten` narrows
 * by address/type, and `#` alone offers the running Einsätze. Only at
 * the END of the text (where the caret is in a one-line input) and only as a word of its
 * own — «Tel. #2» halfway through a sentence is text, not a link.
 */
export function incidentQuery(text: string): string | null {
  const m = /(?:^|\s)#([^\s#]*)$/.exec(text)
  return m ? m[1] : null
}

/** Drop the `#…` token the operator just turned into a link. */
export function stripIncidentQuery(text: string): string {
  return text.replace(/(?:^|\s)#[^\s#]*$/, "").trimEnd()
}

export interface IncidentChoice {
  id: string
  label: string
  /** R4's server-assigned Einsatz number; absent on older/optimistic cards. */
  number?: number | null
  /** a second, muted word — the incident type */
  detail?: string
  /** closed Einsätze sink below running ones */
  closed?: boolean
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
}

/** Up to `limit` Einsätze for the `#` pick-list: every word typed must start a word of
 *  the label or the detail (as KP Front's name suggestions do — a substring anywhere
 *  matches nonsense). A numeric query is the exact Einsatz number, never a house number
 *  or a prefix of another Einsatz's number. Running Einsätze first, then by label. */
export function suggestIncidents(query: string, choices: readonly IncidentChoice[], limit = 5): IncidentChoice[] {
  const words = norm(query).split(/\s+/).filter(Boolean)
  const number = /^\d+$/.test(query.trim()) ? Number(query.trim()) : null
  const hit = (c: IncidentChoice) => {
    if (number !== null) return c.number === number
    const hay = norm(`${c.label} ${c.detail ?? ""}`).split(/[\s,./()-]+/)
    return words.every((w) => hay.some((h) => h.startsWith(w)))
  }
  return choices
    .filter(hit)
    .sort((a, b) => Number(!!a.closed) - Number(!!b.closed) || a.label.localeCompare(b.label, "de"))
    .slice(0, limit)
}

/** The board's clock format: HH:MM today, «dd.mm. HH:MM» on another day. */
export function formatJournalTime(iso: string, now: Date = new Date()): string {
  const d = new Date(iso)
  const hh = String(d.getHours()).padStart(2, "0")
  const mm = String(d.getMinutes()).padStart(2, "0")
  const sameDay =
    d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  if (sameDay) return `${hh}:${mm}`
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}. ${hh}:${mm}`
}

/** A fresh id for one line being written — kept until the server confirmed it, so a retry
 *  of the same line is recognised and written once. */
export function newClientId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID()
  return `j${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}
