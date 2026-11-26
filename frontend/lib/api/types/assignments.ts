/**
 * Incident-assignment + transfer types.
 */

import type { In, Out } from '../wire'

export type ApiAssignment = Out<'AssignmentResponse'>

export type AssignmentPurpose = Out<'AssignmentResponse'>['purpose']

export type ApiAssignmentCreate = In<'AssignmentCreate'>

/** «Abgeholt – freigeben» answered: the release time, the undo's token. */
export type ApiMaterialCollected = Out<'MaterialCollectedResponse'>

export type ApiTransferAssignmentsResponse = Out<'TransferAssignmentsResponse'>

/** A «Danach» (Jetzt / Danach, 24.11.2026): a resource planned for an Einsatz or an Auftrag
 *  after its current work. Exactly one of `incident_id` / `incident_group_id`. */
export type ApiPlannedAssignment = Out<'PlannedAssignmentResponse'>

export type ApiPlannedAssignmentCreate = In<'PlannedAssignmentCreate'>
