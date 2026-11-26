/**
 * Einsatztagebuch (journal) — `/api/events/{id}/journal`. Append-only: a correction is a
 * row of its own (`corrects_id`), folded into the line it corrects by `lib/journal.ts`.
 */

import type { Out } from '../wire'

export type ApiJournalKind = Out<'JournalEntryOut'>['kind']

/** The filter group a row belongs to — decided by the server from `kind`. */
export type ApiJournalCategory = Out<'JournalEntryOut'>['category']

export type ApiJournalEntry = Out<'JournalEntryOut'>

export type ApiJournalPage = Out<'JournalPage'>
