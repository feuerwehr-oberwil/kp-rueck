/**
 * Einsatztagebuch (journal) — `/api/events/{id}/journal`. Append-only: a correction is a
 * row of its own (`corrects_id`), folded into the line it corrects by `lib/journal.ts`.
 */

export type ApiJournalKind =
  | 'manual'
  | 'status'
  | 'incident'
  | 'assignment'
  | 'message'
  | 'field'
  | 'reko'
  | 'alarm'

/** The filter group a row belongs to — decided by the server from `kind`. */
export type ApiJournalCategory = 'manual' | 'field' | 'status' | 'resources'

export interface ApiJournalEntry {
  id: string
  seq: number
  event_id: string
  incident_id: string | null
  /** The Einsatz's title now, or as it was when the Einsatz has since been deleted. */
  incident_title: string | null
  /** The Einsatz has since been deleted (or purged); its lines stay, marked. */
  incident_deleted: boolean
  kind: ApiJournalKind
  category: ApiJournalCategory
  /** What a person wrote (manual line, Meldung, Reko summary) or a German server sentence
   *  (field notification). Derived rows carry their facts in `data` instead. */
  text: string | null
  data: Record<string, unknown> | null
  occurred_at: string
  created_at: string
  author_name: string | null
  corrects_id: string | null
}

export interface ApiJournalPage {
  entries: ApiJournalEntry[]
  latest_seq: number
}
