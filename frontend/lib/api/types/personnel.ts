/**
 * Personnel resource types.
 */

import type { In, Out } from '../wire'

export type ApiPersonnel = Out<'Personnel'>

export type ApiPersonnelListItem = Out<'PersonnelListItem'>

/** A check-in/-out write's answer. `changed` is false when the request found its state
 *  already there and wrote nothing (somebody else had already checked the person out): no
 *  undo for it. */
export type ApiCheckInResponse = Out<'PersonnelCheckInResponse'>

/**
 * «kommt um» / «geht um» for one person at one Ereignis (`PUT …/check-in/{id}/plan`,
 * `PUT /api/feld/attendance/{id}/plan`). A PATCH: a key left out stays, `null` clears it.
 * Instants, resolved from the typed «22:00» by `lib/planned-times.ts`.
 */
export type ApiAttendancePlan = { planned_from?: string | null; planned_until?: string | null }

export interface ApiCheckInStats {
  /** Everybody the roll-call offers — the Mannschaft. */
  total_available: number
  /** Present right now. */
  checked_in: number
  /** Simply not present, whether they came and went or never came. */
  checked_out: number
  /** Came and went. "Gegangen" is a statement, not an absence. */
  left: number
}

export type ApiPersonnelCreate = In<'PersonnelCreate'>

export type ApiPersonnelUpdate = In<'PersonnelUpdate'>
