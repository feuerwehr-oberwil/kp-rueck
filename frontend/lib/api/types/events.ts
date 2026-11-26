/**
 * Event + special-function + event-stats types.
 */

import type { In, Out } from '../wire'

export type ApiEvent = Out<'EventResponse'>

export type ApiEventCreate = In<'EventCreate'>

export type ApiEventListResponse = Out<'EventListResponse'>

/**
 * The roles a person can hold for one Ereignis.
 *
 * Backed by the `special_function_types` table since plan 26 — a station can
 * seed a fourth without a migration. This union stays hand-written because the
 * *sections* each role unlocks are code, not data: `driver` needs a vehicle,
 * `magazin` opens the material table, `telefondienst` turns «Melden» into the
 * call form, `kommandoposten` unlocks nothing at all and exists to say the
 * person is busy running the board. A role the UI does not know about is simply
 * a name.
 */
export type FunctionType = 'driver' | 'reko' | 'magazin' | 'telefondienst' | 'kommandoposten'

export type ApiEventSpecialFunctionCreate = In<'EventSpecialFunctionCreate'>

export type ApiEventSpecialFunctionDelete = In<'EventSpecialFunctionDelete'>

export type ApiEventSpecialFunctionResponse = Out<'EventSpecialFunctionResponse'>

/** Median and nearest-rank P90 of one stage time, over `count` incidents. */
export type ApiStageFigures = Out<'StageFigures'>

/** Counts and reaction times for one priority, or `all`. */
export type ApiPriorityFigures = Out<'PriorityFigures'>

/**
 * The Kennzahlen of one Ereignis (`backend/app/services/reaction_times.py`, the
 * same stage times as the PDF's Reaktionszeiten table).
 */
export type ApiEventFigures = Out<'EventFigures'>

/** One checked-in person's time on duty (backend `PersonnelActivity`, longest on duty first). */
export type ApiPersonnelActivity = Out<'PersonnelActivity'>
