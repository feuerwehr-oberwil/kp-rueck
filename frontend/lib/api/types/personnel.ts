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

/** The roll-call header's numbers (`GET /api/personnel/check-in/stats`). */
export type ApiCheckInStats = Out<'CheckInStats'>

export type ApiPersonnelCreate = In<'PersonnelCreate'>

export type ApiPersonnelUpdate = In<'PersonnelUpdate'>
