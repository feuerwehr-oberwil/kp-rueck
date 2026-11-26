/**
 * Incident + status-transition + timeline types.
 */

import type { In, Out } from '../wire'
import type { ApiJournalKind } from './journal'

export type IncidentType = Out<'IncidentType'>

export type IncidentPriority = Out<'IncidentPriority'>

/** The provenances an editor may claim from the board: "operator" = typed in at
 *  the KP, "intake" = the operator took the call and says so, "feld" = a Trupp
 *  standing in front of the thing reported it (usually written by `/feld` itself;
 *  the KP claims it for a radio message they typed in). `ApiIncident.source`
 *  stays a plain string, because a card can also carry a delivering system's slug. */
export type EditorIncidentSource = NonNullable<In<'IncidentCreate'>['source']>

export type IncidentStatus = Out<'IncidentStatus'>

/** One card as the board loads it (backend `IncidentResponse`). */
export type ApiIncident = Out<'IncidentResponse'>

/** An open incident that is probably the same Schadenplatz
 *  (`GET /api/incidents/duplicate-candidates`). The backend publishes `type` and
 *  `status` as `str`; they are the card's own fields. */
export type ApiDuplicateCandidate = Omit<Out<'DuplicateCandidate'>, 'type' | 'status'> & {
  type: IncidentType
  status: IncidentStatus
}

export type ApiDuplicateCandidatesResponse = { candidates: ApiDuplicateCandidate[] }

/** What `/feld` gets: the minimum to answer the hint — no coordinates, status,
 *  Einsatzart or full address (a login-less door must not map the board). */
export type ApiFeldDuplicateCandidate = Out<'FeldDuplicateCandidate'>

export type ApiFeldDuplicateCandidatesResponse = Out<'FeldDuplicateCandidatesResponse'>

/** The card a report went into, and the hidden report row — the undo's handle. */
export type ApiMergeResponse = Out<'MergeResponse'>

/** «Trennen»: the report is its own card again. `note_removed` is false when
 *  the Nachtrag had been edited since and stays in «Notizen» as it was left. */
export type ApiUnmergeResponse = Out<'UnmergeResponse'>

export type ApiIncidentCreate = In<'IncidentCreate'>

/** `text_base`: per free-text field in this body, the text the client last saw the server
 *  hold. If somebody else saved that field since, the server refuses with 409
 *  `text_conflict` (params: field, current, changed_by?, changed_at?). The backend keys it
 *  by `IncidentTextField` but publishes a plain string map. */
export type ApiIncidentUpdate = Omit<In<'IncidentUpdate'>, 'text_base'> & {
  text_base?: Partial<Record<IncidentTextField, string>>
}

/** The free-text incident columns guarded by `text_base`. */
export type IncidentTextField =
  | 'description'
  | 'contact'
  | 'contact_phone'
  | 'internal_notes'
  | 'nachbarhilfe_note'
  | 'am_warten_note'

/** One row of an incident's Chronik (backend `IncidentTimelineEvent`): a flat shape whose
 *  fields depend on `event_type`. The backend publishes these vocabularies as `str`; this
 *  says which values it writes (`services/incident_history.py`, `services/reko_history.py`).
 *  `kp_message` is the KP's own «Meldung an den Trupp», the other direction of
 *  `field_message`. */
export type ApiIncidentTimelineEvent = Omit<
  Out<'IncidentTimelineEvent'>,
  'event_type' | 'assignment_action' | 'resource_type' | 'journal_kind' | 'reko_field'
> & {
  event_type: 'status_change' | 'assignment' | 'field_message' | 'kp_message' | 'merge' | 'unmerge' | 'journal' | 'reko_change'
  assignment_action: 'assigned' | 'unassigned' | null
  resource_type: ApiResourceType | null
  journal_kind: ApiJournalKind | null
  reko_field: RekoChangeField | null
}

/** The three kinds of resource an assignment holds. */
export type ApiResourceType = Out<'AssignmentResponse'>['resource_type']

/** The Reko report's fields as the Chronik names them (`backend/app/services/reko_history.py`). */
export type RekoChangeField =
  | 'is_relevant'
  | 'dangers'
  | 'dangers_other'
  | 'personnel_count'
  | 'estimated_duration_hours'
  | 'vehicles_needed'
  | 'equipment_needed'
  | 'power_supply'
  | 'summary_text'
  | 'additional_notes'
  | 'photos'

/** A Reko field's raw value: yes/no, a number, a text, or a list (Gefahren keys, photo files …). */
export type RekoChangeValue = Out<'IncidentTimelineEvent'>['old_value']

/** One KP → Trupp message as `/api/incidents/{id}/field-messages` returns it. */
export type ApiKpFieldMessage = Out<'KpFieldMessage'>

export type ApiIncidentTimelineResponse = { events: ApiIncidentTimelineEvent[] }

/**
 * One resource that was on an incident at some point — the "Beteiligt" roll-up.
 * One entry per resource, not per assignment: someone taken off and put back on
 * appears once, with `stints` counting how many separate times. The backend publishes
 * `resource_type` as `str`.
 */
export type ApiIncidentParticipant = Omit<Out<'IncidentParticipant'>, 'resource_type'> & {
  resource_type: ApiResourceType
}

export type ApiIncidentParticipantsResponse = { participants: ApiIncidentParticipant[] }
