/**
 * `/feld` — the login-less field surface (plan 25).
 *
 * Phase 0 is the door: the person picker and "meine Einsatzstellen". Every row
 * already names the Einsatzleiter of that Schadenplatz, because the crew has to
 * know who is normally expected to file before any form exists (decision 22).
 */

import type { In, Out } from '../wire'

/** 'none' – no rapport row yet · 'draft' – started · 'submitted' – filed. */
export type ApiFeldRapportState = Out<'FeldAssignment'>['rapport_state']

/**
 * Why a Schadenplatz is in somebody's list (plan 26 §2.2). The rule itself lives
 * server-side in `crud/feld/visibility.py`; this is only the shape the phone
 * receives.
 *
 * The page labels the unusual ones and says nothing about `crew` — an own
 * assignment needs no explanation, and the absence of a label is what reads as
 * "meins". Only `crew` can owe a Schadenplatz-Rapport.
 */
export type ApiFeldSourceKind = Out<'FeldAssignment'>['source']

/** The Feld-Code and how many devices redeemed it. Editor only. */
export type ApiFeldAccessState = Out<'FeldAccessState'>

/** The door's proof of place — readable with the LINK token, before the code.
 *  Station + Ereignis above the code prompt, so whoever scanned a poster in
 *  the rain can tell they reached the right brigade before typing anything. */
export type ApiFeldContextResponse = Out<'FeldContextResponse'>

/** What the Feld-Code buys: an unlocked token, and the picker to use it on. */
export type ApiFeldUnlockResponse = Out<'FeldUnlockResponse'>

/** The bound token. The device stores this and stops using the link token. */
export type ApiFeldClaimResponse = Out<'FeldClaimResponse'>

export type ApiFeldPersonnel = Out<'FeldPersonnel'>

/** One vehicle on the briefing, with whoever drives it in this Ereignis.
 *  `driver` is null when the KP has not named one — «TLF 1» alone left a crew
 *  unable to say who is sitting outside in it. */
export type ApiFeldVehicleLine = Out<'FeldVehicleLine'>

/** One line of the briefing's material list: a name, how many of it, and the
 *  depot it lives in (`Material.location`) — the squad has to know where to
 *  fetch it. Grouped per (name, depot); null when the catalogue names none. */
export type ApiFeldMaterialLine = Out<'FeldMaterialLine'>

/**
 * What the Reko found here. Only ever a *submitted* report — a draft is
 * somebody still typing, and half a sentence quoted back at the next crew as
 * fact is worse than nothing. `dangers` are `DangersAssessment` keys, rendered
 * with the board's own `reko.reportSection.dangerBadges` labels.
 */
export type ApiFeldReko = Out<'FeldReko'>

/** One «Meldung an den Trupp» — KP → field (sweep 27 §P3.2). `author_name` is
 *  the sender's display name, denormalised server-side: the login-less phone
 *  never resolves users. */
export type ApiFeldKpMessage = Out<'KpFieldMessage'>

/** What a request from the field asks for (R13). `pickup` mirrors the Abholung flag. */
export type ApiFieldRequestKind = Out<'FieldRequestResponse'>['kind']
/** offen → in Arbeit (optional) → erledigt. */
export type ApiFieldRequestStatus = Out<'FieldRequestResponse'>['status']

/**
 * One workable request from the field (R13) — the same shape on the board card,
 * in the detail, in the notification sidebar and on `/feld`. `label` is the
 * server's German one-liner; clients render their own from kind/item/quantity
 * (`lib/field-requests.ts`) and fall back to it.
 */
export type ApiFieldRequest = Out<'FieldRequestResponse'>

/** A Meldung or a structured request, from either door (same payload). */
export type ApiFieldRequestCreate = In<'FeldMessageRequest'>

export type ApiFeldAssignment = Out<'FeldAssignment'>

/** One unit and where it is right now — the Magazin's own view (plan 26).
 *  `at` names the Schadenplatz it is standing on; null means the Magazin. */
export type ApiFeldMaterialItem = Out<'FeldMaterialItem'>

export type ApiFeldMaterialResponse = Out<'FeldMaterialResponse'>

/** A «Danach» of this person: where they go after their current work. Not active. */
export type ApiFeldPlanned = Out<'FeldPlanned'>

export type ApiFeldAssignmentsResponse = Out<'FeldAssignmentsResponse'>

/**
 * The three field reports of one Schadenplatz, returned identically by `/feld`
 * and by the editor twin `/api/incidents/{id}/field-report` — one CRUD module
 * underneath, two thin routers over it.
 *
 * `*_by` is a personnel id and is populated **only** for a field write. A KP
 * write leaves it null and puts the operator in the audit log instead
 * (decision 28: provenance is never faked). `arrived_in_kp` is what tells
 * "im KP erfasst" apart from "nobody has reported it".
 */
export type ApiFieldReportState = Out<'FieldReportState'>

/**
 * The KP twin's payload. A key present with a value sets it, present as `null`
 * clears it, **absent leaves it alone** — without that distinction an operator
 * amending the pickup note would silently wipe the arrival time.
 */
export type ApiFieldReportUpdate = In<'FieldReportUpdate'>

// ============================================
// The Schadenplatz-Rapport — one shape, two mounts
// ============================================
//
// `/feld` and the board's detail section render the SAME form component over
// these types (decision 28, §6.1); only the transport and the identity differ.
// A second shape here is how the KP path silently loses a field six months
// later.

/**
 * One material unit on the checklist, keyed on the **assignment** rather than
 * the material: the same pump assigned twice is two units on the slip, and the
 * assignment id is what "Material zurück – freigeben" releases against.
 */
export type ApiRapportMaterialRow = Out<'RapportMaterialRow'>

export type ApiRapportMaterialUpdate = In<'RapportMaterialUpdate'>

/**
 * One vehicle on the confirmation list — **only what the board disponiert here**,
 * arriving ticked. The whole fleet used to get a row, which made the rapport a
 * fleet inventory; the rest of the fleet now lives in `prefill.vehicle_candidates`
 * and gets a row (`on_board: false`) only once the crew adds it.
 */
export type ApiRapportVehicleRow = Out<'RapportVehicleRow'>

export type ApiRapportVehicleUpdate = In<'RapportVehicleUpdate'>

/**
 * One name on the crew confirmation list (§18.36) — **only who the board
 * aufgeboten here**, arriving ticked. The Appell used to be the list too, which
 * on a storm night is half the brigade in a rapport about one cellar; everybody
 * else lives in `prefill.personnel_candidates` and gets a row (`on_board: false`)
 * only once the crew adds them.
 */
export type ApiRapportPersonnelRow = Out<'RapportPersonnelRow'>

export type ApiRapportPersonnelUpdate = In<'RapportPersonnelUpdate'>

/**
 * Somebody on no roster of this station — a neighbouring brigade, the Werkhof.
 * Names never ids, like the extra material: `/feld` writes no attendance row.
 * The note is free text on purpose, so it can carry "FW Allschwil" *or* "kam um
 * 21:00" *or* both.
 */
export type ApiRapportExtraPersonnel = Out<'RapportExtraPersonnelRow'>

/**
 * One entry of "Weiteres gebrauchtes Material" (§18.35).
 *
 * A name and one tick. No `used`: listing something here already means it was
 * used, so a second tick would only ever be ticked. No id either, and there
 * must not be one — picking a catalogue name is not picking a unit, and `/feld`
 * never writes an assignment (decision 18).
 */
export type ApiRapportExtraMaterial = Out<'RapportExtraMaterialRow'>

/** "Frey Marc bearbeitet diesen Rapport gerade" — visibility, never a lock. */
export type ApiRapportConcurrentEditor = Out<'ConcurrentEditor'>

/**
 * Somebody the crew can ADD to the rapport, as opposed to confirm: everybody on
 * the roster the board did not send here. `checked_in` marks the Appell so the
 * search offers those first.
 *
 * It carries an id, unlike `material_name_suggestions`, and that widens nothing:
 * the crew list has always been keyed on the person, and adding a row writes no
 * assignment and no attendance (decision 18). What the id buys is what free text
 * cannot — a nachgetragene Person stays the same person the roster knows.
 */
export type ApiRapportPersonnelCandidate = Out<'RapportPersonnelCandidate'>

/** A vehicle the crew can add: the rest of the fleet, behind one fold. */
export type ApiRapportVehicleCandidate = Out<'RapportVehicleCandidate'>

/** What the board knows. Computed on every GET, never written (§4). */
export type ApiRapportPrefill = Out<'RapportPrefill'>

export type ApiSchadenplatzRapport = Out<'SchadenplatzRapport'>

/**
 * The upsert payload. `is_draft: false` files the rapport.
 *
 * Only the keys actually sent are written, the same rule the field-report twin
 * follows: an autosave carrying half the form must not blank the other half.
 */
export type ApiRapportUpdate = In<'RapportUpdate'>

/** One Schadenplatz on the Restliste (§6, V-8). */
export type ApiRestlisteIncident = Out<'RestlisteIncident'>

/**
 * One material unit still standing at an address — an Abholliste line.
 *
 * Address · unit · since when: the sheet somebody takes along the next morning
 * (decision 25). A *different day's* job, kept apart from the Trupp-Abholung.
 */
export type ApiRestlisteUnit = Out<'RestlisteUnit'>

export type ApiEventRestliste = Out<'EventRestliste'>

/**
 * What both photo doors answer.
 *
 * The whole list rather than just the new filename, so a phone at the edge of
 * coverage that retried an upload re-syncs from the next answer instead of
 * accumulating a duplicate.
 */
export type ApiRapportPhotosResponse = Out<'RapportPhotosResponse'>

/** One row of "Material zurück – freigeben" (decision 17). */
export type ApiMaterialReturnUnit = Out<'MaterialReturnUnit'>

export type ApiMaterialReturnResponse = Out<'MaterialReturnResponse'>

/**
 * «Neue Meldung» from the field.
 *
 * Narrower than the board's create and slightly wider than the phone desk's:
 * no Melder fields, because the reporter IS the Melder and their name is on the
 * audit row already.
 */
export type ApiFeldIncidentCreate = In<'FeldIncidentCreate'>

/**
 * A correction to a Meldung that has not been disponiert yet.
 *
 * Every field optional, and an omitted key means "unchanged" rather than
 * "clear it" — the sheet sends the whole form back, and a Meldung whose
 * description was fixed must not lose its address on the way.
 */
export type ApiFeldIncidentUpdate = In<'FeldIncidentUpdate'>

/**
 * One Meldung this person sent in — the «Von mir gemeldet» list.
 *
 * NOT an assignment: a reported tree the KP gave to somebody else is not a
 * Schadenplatz of theirs, and this list deliberately answers the other
 * question, "what did I send in". `editable` is the server's answer to "may I
 * still correct this", so the phone never has to know the status vocabulary.
 */
export type ApiFeldOwnReport = Out<'FeldOwnReport'>

/**
 * What became of it. `takeover` lets the confirmation be specific:
 *
 *   none    — reported; the KP disposes
 *   stop    — appended to the Auftrag the crew is already working
 *   auftrag — their single job became a route, this is its second stop
 *   solo    — nobody was on anything, so it is theirs alone
 */
export type ApiFeldIncidentCreated = Out<'FeldIncidentCreated'>
