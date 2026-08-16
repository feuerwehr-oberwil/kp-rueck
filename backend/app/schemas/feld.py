"""Schemas for the `/feld` field surface (plan 25).

`/feld` is the login-less page every crew in the field opens — not just the Reko
OF. Phase 0 was read-only: the person picker and "meine Einsatzstellen", each row
already carrying the Einsatzleiter, so a crew knows who is normally expected to
file before any form exists.

Phase 1 adds the four field actions — Angekommen, Einsatz beendet (+ the Abholung
follow-up), Abholung, Freitext-Meldung — and their KP twin. ``FieldReportUpdate``
and ``FieldReportState`` are shared by both doors on purpose: the shapes must not
drift, or a field the KP can set stops round-tripping through the field surface.
"""

from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .incidents import IncidentBase, IncidentPriority, IncidentType

# 'none'      – no schadenplatz_reports row for this incident yet
# 'draft'     – a row exists but is_draft is still True
# 'submitted' – filed
RapportState = Literal["none", "draft", "submitted"]

# Why a Schadenplatz is in somebody's list. Mirrors the SOURCE_* constants in
# `crud/feld/visibility.py`, which is where the rule itself lives — this is only
# the shape the phone receives. Only "crew" can owe a Schadenplatz-Rapport.
FeldSourceKind = Literal["crew", "reko", "driver", "magazin"]


class FeldPersonnel(BaseModel):
    """One row of the `/feld` person picker.

    The list holds exactly the people with an assignment in this event, active or
    already released — not the roster. Someone with nothing to file would
    otherwise land on an empty page with no explanation.
    """

    personnel_id: UUID
    name: str
    role: str | None = None
    # Incidents in this event the person is or was assigned to.
    incident_count: int = 0
    # Of those, the ones still actively assigned.
    open_count: int = 0
    # Of those, the ones without a submitted Schadenplatz-Rapport.
    missing_rapport_count: int = 0
    # Present at this Ereignis. The picker is the roster since decision 10, so
    # this is what tells "hier, aber noch ohne Auftrag" apart from "gar nicht da".
    checked_in: bool = False


class FeldPersonnelListResponse(BaseModel):
    """Response for the `/feld` person picker."""

    personnel: list[FeldPersonnel]
    event_id: UUID
    event_name: str


class FeldUnlockRequest(BaseModel):
    """The four digits from under the QR poster."""

    code: str = Field(min_length=1, max_length=8)


class FeldUnlockResponse(BaseModel):
    """The unlocked token, plus the picker it exists to let you read.

    Both in one response because the only thing the caller can do next is find
    their own name, and a second round trip on a phone in the rain buys nothing.
    """

    token: str
    personnel: list[FeldPersonnel]
    event_id: UUID
    event_name: str


class FeldClaimRequest(BaseModel):
    """ "Ich bin das" — the person this device belongs to from now on."""

    personnel_id: UUID


class FeldClaimResponse(BaseModel):
    """The bound token. The device stores this and stops using the link token."""

    token: str
    personnel_id: UUID


class FeldAccessState(BaseModel):
    """What the board shows next to the Ereignis: the code, and who is using it.

    ``device_count`` is live claims, not total ever — the number the KP can act
    on. Editor-only: the code is a credential, however short.
    """

    code: str
    device_count: int


class FeldMaterialLine(BaseModel):
    """One line of the briefing's material list: a name and how many of it.

    Grouped by NAME rather than listed per assignment — "Tauchpumpe ×2" is what
    a crew reads off a slip, while the per-unit rows (keyed on the assignment,
    with their two ticks) are the *rapport's* job and live in
    ``RapportMaterialRow``. Two lists, two questions: this one says what came
    with you, that one asks what you did with it.
    """

    name: str
    count: int = 1


class FeldReko(BaseModel):
    """What the Reko found here — the only *submitted* report, flattened.

    A draft Reko is somebody still typing and is deliberately absent: the field
    briefing must not quote half a sentence back at the next crew as fact.
    ``dangers`` carries the keys of ``DangersAssessment`` that are true, so the
    phone renders the same badges the board does instead of a second wording.
    """

    summary: str | None = None
    notes: str | None = None
    dangers: list[str] = []
    submitted_at: datetime | None = None
    submitted_by_name: str | None = None


class FeldAssignment(BaseModel):
    """One Schadenplatz a person is (or was) assigned to in this event.

    Since §18.22 the row also carries the **briefing**: the Meldung, the Melder,
    what the board dispatched (crew, vehicles, material) and what the Reko
    found. It rides on this response rather than on a per-incident endpoint of
    its own for the same reason ``message_chips`` does — a crew on the edge of
    coverage taps a row and must get a screen, not a second round trip — and
    because the list row itself shows a condensed form of the same facts.

    Released assignments are included in ``crew`` / ``vehicles`` / ``materials``
    on purpose, exactly like the row itself survives its own release: completing
    an incident releases everything while the crew is still standing at the
    address filing, and a briefing that empties out underneath them at 02:00 is
    worse than one that names a vehicle which has already driven off.
    """

    incident_id: UUID
    incident_title: str
    incident_type: str
    incident_status: str
    # The Meldung — what the dispatch said this is. The single most-asked
    # question of a crew standing in front of an address.
    description: str | None = None
    # The Melder: who to ring when nobody answers the door. Already reachable
    # through this door via the rapport prefill's `melder_*`, so it widens no
    # exposure (§9) — it just stops being a thing you have to open a form for.
    contact: str | None = None
    contact_phone: str | None = None
    crew: list[str] = []
    vehicles: list[str] = []
    materials: list[FeldMaterialLine] = []
    reko: FeldReko | None = None
    location_address: str | None = None
    # Server-computed short label (home city stripped). The crew's phone paints
    # the address before its settings have loaded, so formatting it client-side
    # showed the long form first and swapped it a beat later.
    location_display: str | None = None
    location_lat: str | None = None
    location_lng: str | None = None
    # False once the board released the person — they may still file (and often
    # only file then), so the row stays visible.
    is_active_assignment: bool = True
    # WHY this row is in the list (plan 26 §2.2): the person's own assignment
    # ("crew"), a Reko auftrag ("reko"), a vehicle they drive ("driver"), or
    # material still out and they hold the Magazin function ("magazin").
    #
    # The phone labels only the unusual ones — an own assignment needs no
    # explanation and gets none; the *absence* of a label is what says "meins".
    # `source_vehicle` is set for driver rows only, so the label can name the
    # vehicle that brought the row in rather than leaving it a mystery.
    source: FeldSourceKind = "crew"
    source_vehicle: str | None = None
    rapport_state: RapportState = "none"
    # The Schadenplatz was disponiert at least once (§18.27). False means the
    # rapport does not exist for this row: no form, no "Kein Rapport" chip, no
    # line in anybody's missing count. A crew that is standing at an address the
    # board never dispatched has nothing to file, and an empty form is noise.
    has_been_dispatched: bool = False
    arrived_at: datetime | None = None
    # True when the GPS automation stamped the arrival rather than the crew
    # (§18.24). `/feld` words the line accordingly instead of letting a crew
    # that never tapped "Angekommen" read the report as its own.
    arrived_by_automation: bool = False
    field_complete_reported_at: datetime | None = None
    # "Abholung nötig" — carried on the list row so a crew reopening /feld sees
    # its own open request, not just the response of the tap that made it.
    pickup_needed: bool = False
    pickup_note: str | None = None
    pickup_requested_at: datetime | None = None
    # The Einsatzleiter of THIS incident (decision 22): briefed, never enforced.
    # Both stay None when nobody carries the role, which the UI must render as
    # "kein EL erfasst" rather than a blank line.
    leader_personnel_id: UUID | None = None
    leader_name: str | None = None


class FeldAssignmentsResponse(BaseModel):
    """Response for "meine Einsatzstellen"."""

    personnel_id: UUID
    personnel_name: str
    personnel_role: str | None = None
    # Present at this Ereignis (decision 10). The field surface carries the
    # individual half of the roll call; `/check-in` stays the door tablet.
    checked_in: bool = False
    # The roles this person holds in this Ereignis (plan 26, decision 5). The
    # page shows a section per role; the roles themselves are data, the sections
    # are code. Names only — this grants nothing, every permission still goes
    # through the visibility union.
    functions: list[str] = []
    event_id: UUID
    event_name: str
    assignments: list[FeldAssignment]
    # The station's Freitext-Meldung chips (decision 20). Carried on this
    # response rather than on an endpoint of their own: the detail view is one
    # tap away from this call, and a separate GET would be a second public
    # surface to guard for four strings.
    message_chips: list[str] = []


# ============================================
# Field reports — shared by BOTH doors
# ============================================


class FieldReportState(BaseModel):
    """The three field reports of one Schadenplatz.

    Returned identically by `/api/feld/...` and by the editor twin, because they
    are one CRUD module underneath. ``*_by`` is a personnel id and is populated
    **only** for a field write — a KP write leaves it NULL and puts the user in
    the audit log (decision 28). That asymmetry is the provenance rule; do not
    "fix" it by filling in the operator.
    """

    incident_id: UUID
    arrived_at: datetime | None = None
    arrived_by_personnel_id: UUID | None = None
    # True when the GPS automation stamped it: an assigned vehicle was confirmed
    # at the address and the automation advanced the incident (§18.24). Its own
    # provenance, never folded into either of the other two — a machine's
    # inference must not be worded as a person's report.
    arrived_by_automation: bool = False
    # True when the arrival was entered in the KP: a time, no personnel id, and
    # not the automation. The UI needs to tell "im KP erfasst" from "nobody has
    # reported it" and from "die Automatik hat es gesehen".
    arrived_in_kp: bool = False
    field_complete_reported_at: datetime | None = None
    field_complete_reported_by: UUID | None = None
    pickup_needed: bool = False
    pickup_note: str | None = None
    pickup_requested_at: datetime | None = None
    pickup_requested_by: UUID | None = None


class FieldReportUpdate(BaseModel):
    """The KP twin's payload: set **or clear** any of the three (decision 28).

    Every field is optional and the handler acts only on the ones actually
    present (``model_fields_set``), so ``null`` means "clear this" and absence
    means "leave it alone". Without that distinction an operator correcting the
    pickup note would silently wipe the arrival time.
    """

    arrived_at: datetime | None = None
    field_complete_reported_at: datetime | None = None
    pickup_needed: bool | None = None
    pickup_note: str | None = Field(default=None, max_length=500)
    pickup_requested_at: datetime | None = None


class FeldPickupRequest(BaseModel):
    """The Abholung answer from `/feld`.

    ``needed=False`` is the crew tapping *abgeholt*, and it is also the
    *"Wir fahren selbst"* half of the follow-up that "Einsatz beendet" asks
    (decision 24).
    """

    needed: bool
    note: str | None = Field(default=None, max_length=500)


class FeldMessageRequest(BaseModel):
    """Freitext-Meldung an den KP — a chip or a typed sentence."""

    message: str = Field(min_length=1, max_length=500)


# ============================================
# The Schadenplatz-Rapport itself — shared by BOTH doors
# ============================================
#
# One set of shapes, two mounts (decision 28 / §6.1). The board's detail section
# renders the same form over the same schemas with a different transport and a
# different identity; a second shape here is how the KP path silently loses a
# field six months later.


class RapportMaterialRow(BaseModel):
    """One material unit on the checklist (decision 14).

    Keyed on the **assignment**, not the material: the same pump assigned twice
    is two units on the slip, and the assignment id is also what the board's
    "Material zurück – freigeben" list releases against.

    ``used`` is a plain bool defaulting to **true** (§18.32). It used to be
    nullable, with `null` meaning "die Crew hat nicht geantwortet"; a three-state
    control is too fiddly for a thumb on a phone, and the unit was sent to this
    Schadenplatz in the first place — "gebraucht" is the common case and the crew
    only unticks the exceptions, exactly like the vehicle list. ``left_on_site``
    is likewise a plain bool: not ticking it means the unit came back.
    """

    assignment_id: UUID
    material_id: UUID
    name: str
    # The depot the unit lives in, so a crew with fourteen units reads them in
    # the order it knows. None for a unit whose material row has gone.
    location: str | None = None
    # A consumable that was used is gone: it renders `gebraucht` only, never
    # "vor Ort verblieben", and never appears in the return list (decision 26).
    consumable: bool = False
    used: bool = True
    left_on_site: bool = False
    # False once the board no longer has this unit assigned. The row survives
    # only because the crew contradicted the board's own answer — it unticked
    # "gebraucht" or ticked "vor Ort verblieben". Deleting such a row would lose
    # exactly what the checklist exists to capture.
    on_board: bool = True


class RapportMaterialUpdate(BaseModel):
    """The two ticks, as the form sends them back."""

    assignment_id: UUID
    used: bool = True
    left_on_site: bool = False


class RapportExtraMaterialRow(BaseModel):
    """One entry of "Weiteres gebrauchtes Material" (§18.35).

    A **name and one tick**, and the asymmetry with the checklist above is the
    point:

    * there is no ``used`` here, because listing something on this line already
      means it was used — a second tick would only ever be ticked;
    * there is no id here, and there must not be one (decision 18). The
      catalogue is offered as a multi-select so nobody spells "Tauchpumpe TP-4"
      from memory, but picking a name is not picking a unit and `/feld` never
      writes an assignment. Anything typed by hand is equally valid.

    ``left_on_site`` is the one thing nothing else in the system knows: an
    improvised pump left in a cellar is a device standing at an address. It
    therefore reaches the Restliste and the Abholliste — but never "Material
    zurück – freigeben", which releases *assignments*, and a name has none.
    """

    name: str
    left_on_site: bool = False


class RapportExtraMaterialUpdate(BaseModel):
    """One entry, as the form sends it back. Same shape, names only."""

    name: str = Field(min_length=1, max_length=200)
    left_on_site: bool = False


class RapportVehicleRow(BaseModel):
    """One vehicle on the checklist — the crew confirms *which*, not how many.

    **The whole fleet, not only the assigned vehicles (§18.33).** The board is
    routinely behind reality on a storm night: a vehicle drives along without
    anybody assigning it, and one that was assigned never rolls. So every vehicle
    the station has gets a row, the assigned ones arrive ticked, and the crew's
    job is to correct both directions rather than to retype the fleet. Same
    reasoning as the "Weiteres Material" list next to it.

    Keyed on the **vehicle**, therefore, not on an assignment: a vehicle that was
    never dispatched has no assignment to key on.

    ``present`` has no third state: the list carries the board's own answer
    already, so "keine Angabe" would only mean "did not correct it".
    """

    vehicle_id: UUID
    name: str
    present: bool = True
    # True when the board has (or had) this vehicle assigned to the incident.
    # False for the rest of the fleet — and for a ticked vehicle that has since
    # left the fleet entirely, whose row survives because the crew ticked it.
    on_board: bool = True


class RapportVehicleUpdate(BaseModel):
    """The one tick, as the form sends it back."""

    vehicle_id: UUID
    present: bool = True


class RapportPersonnelRow(BaseModel):
    """One name on the crew checklist — the crew confirms *who*, not how many.

    The people checked in at the Ereignis, with the ones the board has on this
    incident arriving ticked. A number could answer neither of the two questions
    the KP has the morning after: was somebody there that nobody aufgeboten, and
    did somebody leave that nobody tracked. Both directions are corrections the
    crew is the only party able to make — the same argument the vehicle list
    settled in §18.33.

    Keyed on the **person**, not on an assignment: somebody who came along was
    never assigned, so there is no assignment to key the row on.
    """

    personnel_id: UUID
    name: str
    present: bool = True
    # True when the board has (or had) this person assigned to the incident.
    on_board: bool = True


class RapportPersonnelUpdate(BaseModel):
    """The one tick, as the form sends it back.

    ``name`` travels so a person who has meanwhile left the roll-call can still be
    recorded as present — the row would otherwise have nothing to be called.
    """

    personnel_id: UUID
    present: bool = True
    name: str | None = Field(default=None, max_length=100)


class RapportExtraPersonnelRow(BaseModel):
    """Somebody on no roster of this station: a neighbouring brigade, the Werkhof.

    **Names, never ids** — the same rule the extra material follows (decision 18).
    `/feld` writes no attendance and no personnel row; it records who was standing
    there. The note is free text rather than an "Einheit" column because it also
    has to carry "kam um 21:00" or "nur Verkehrsdienst".
    """

    name: str
    note: str = ""


class RapportExtraPersonnelUpdate(BaseModel):
    name: str = Field(max_length=100)
    note: str = Field(default="", max_length=200)


class ConcurrentEditor(BaseModel):
    """ "Frey Marc bearbeitet diesen Rapport gerade" (§3).

    Visibility, **not a lock**: a real lock in the field is worse than the
    problem it solves. Present only when the last save was somebody else inside
    the last five minutes.
    """

    name: str
    at: datetime
    # True when it was an editor working from the board rather than a crew.
    in_kp: bool = False


class RapportPrefill(BaseModel):
    """What the board knows, computed on every GET and never written (§4).

    These are defaults and orientation, never authoritative once the crew has
    touched the form. The board's head count stays on the response after a
    correction as well — that is what lets the form (and the export) say
    "vom Board: 6" next to a corrected 8.
    """

    location_address: str | None = None
    # The incident's own reference as the exports use it.
    incident_ref: str
    # Read-only, and resolved through `services.incident_leader` rather than the
    # raw `is_leader` flag: a completed incident has no active leader row left,
    # and that is exactly the state a crew files its rapport in.
    leader_personnel_id: UUID | None = None
    leader_name: str | None = None
    # "Melder übernehmen" (§4): one tap PREFILLS the two owner inputs with these.
    # Copies, never equates — Melder ≠ Eigentümer stays correctable. Since §18.31
    # the target is Name + Telefon, so the phone travels too; the street and the
    # city stayed behind, because neither has an input to land in any more.
    melder_name: str | None = None
    melder_phone: str | None = None
    board_personnel_count: int = 0
    # Names from the material catalogue for the "Weiteres Material" autosuggest.
    # A naming aid, nothing else: it deliberately carries NO ids, precisely so no
    # client can turn it into a picker. `/feld` must never write an assignment —
    # that is a different authorization and a different conflict problem — and a
    # suggestion that cannot be resolved to a unit cannot become one by accident.
    material_name_suggestions: list[str] = []


class SchadenplatzRapport(BaseModel):
    """The Schadenplatz-Rapport as both doors return it."""

    model_config = ConfigDict(from_attributes=True)

    incident_id: UUID
    # False when nothing has been filed yet: the GET computed a prefill and
    # deliberately did NOT write a row.
    exists: bool = False
    is_draft: bool = True
    submitted_at: datetime | None = None

    # No Beginn/Ende Tätigkeit: the crew never told the board anything it did not
    # already know, so the window is derived at output time instead of typed in
    # the field. See the model.
    materials: list[RapportMaterialRow] = []
    # The whole fleet (§18.33), with the board's assigned vehicles ticked. The
    # crew unticks what did not roll and ticks what came along unannounced.
    vehicles: list[RapportVehicleRow] = []
    personnel: list[RapportPersonnelRow] = []
    extra_personnel: list[RapportExtraPersonnelRow] = []
    # Filenames, not URLs. Read back through the shared
    # `GET /api/photos/{incident_id}/{filename}` — the same endpoint the Reko
    # form uses, because the bytes on disk are not per-door. Both mounts render
    # them: the crew photographs the cellar, the KP attaches what arrived by
    # WhatsApp (§6.1).
    photos: list[str] = []
    # Material that was never on the board, one entry per item (§18.35). A list
    # rather than the old comma-separated note, because *vor Ort verblieben* is a
    # question per item and a string can only answer it once.
    extra_materials: list[RapportExtraMaterialRow] = []

    kurzbericht: str | None = None
    handed_over_to: str | None = None

    # Name + Telefon (§18.31), the same pair the incident carries for the Melder.
    owner_name: str | None = None
    owner_phone: str | None = None

    personnel_count: int | None = None
    personnel_count_corrected: bool = False
    # Frozen at submit; null while the report is a draft.
    cost_snapshot_json: list[dict[str, str | None]] | None = None

    arrived_at: datetime | None = None

    # "Erfasst von Muster Hans (Feld), 14:32" versus "Erfasst im KP durch
    # B. Eichenberger (Funkmeldung), 14:32". A mixed report shows both lines,
    # which is why all four names travel rather than one resolved string.
    created_by_name: str | None = None
    created_in_kp: bool = False
    updated_by_name: str | None = None
    updated_in_kp: bool = False
    updated_at: datetime | None = None

    concurrent_editor: ConcurrentEditor | None = None
    prefill: RapportPrefill


class RapportUpdate(BaseModel):
    """The upsert payload. ``is_draft=False`` is the submit.

    Every field is optional and only the ones actually present are written
    (``model_fields_set``), for the same reason the field-report twin works that
    way: an autosave that carries half the form must not blank the other half.
    """

    # True = autosave, False = "Rapport abschliessen": stamps `submitted_at`,
    # freezes `cost_snapshot_json` and emits `rapport_submitted`.
    is_draft: bool = True

    materials: list[RapportMaterialUpdate] | None = None
    vehicles: list[RapportVehicleUpdate] | None = None
    personnel: list[RapportPersonnelUpdate] | None = None
    # The whole list every time it is present at all — there is no id to patch
    # against, so a partial write has nothing to key on. Capped so a stuck client
    # cannot grow the row without bound.
    extra_materials: list[RapportExtraMaterialUpdate] | None = Field(default=None, max_length=50)
    extra_personnel: list[RapportExtraPersonnelUpdate] | None = Field(default=None, max_length=50)

    kurzbericht: str | None = Field(default=None, max_length=5000)
    handed_over_to: str | None = Field(default=None, max_length=200)

    owner_name: str | None = Field(default=None, max_length=200)
    owner_phone: str | None = Field(default=None, max_length=50)

    # Derived from `personnel` + `extra_personnel` whenever either is present.
    # Still accepted on its own for a client that speaks the pre-checklist shape
    # (a phone replaying a queued payload, the training seeder).
    personnel_count: int | None = Field(default=None, ge=0, le=999)


class RestlisteIncident(BaseModel):
    """One Schadenplatz on the Restliste, in the shape both lists need."""

    incident_id: UUID
    title: str
    location_address: str | None = None
    status: str
    # Only on the "ohne Rapport" list: 'none' and 'draft' read very differently
    # at 02:00 — nobody touched it, versus somebody started and walked away.
    rapport_state: RapportState | None = None
    # Only on the pickup list.
    pickup_note: str | None = None
    since: datetime | None = None


class RestlisteUnit(BaseModel):
    """One material unit still standing at an address — an Abholliste line.

    Address · unit · since when, which is exactly the sheet somebody takes along
    the next morning (decision 25). Material left on site is a **different day's**
    job and stays separate from the Trupp-Abholung flag.

    Two kinds of line, one list (§18.35). Most rows are a **tracked unit**: an
    open material assignment, with the ids the board can act on. The rest are
    entries from "Weiteres gebrauchtes Material" — improvised or borrowed things
    the board never had, carrying a name and nothing else. Both are a device
    standing at an address, so both belong on the sheet somebody drives out with;
    only the first can be released, which is what ``tracked`` says.
    """

    incident_id: UUID
    incident_title: str
    location_address: str | None = None
    # None on an untracked entry: there is no assignment and no catalogue unit
    # behind a name (decision 18).
    assignment_id: UUID | None = None
    material_id: UUID | None = None
    name: str
    # The depot the unit belongs to, so it goes back where it came from. Unknown
    # for an untracked entry — it may not belong to this station at all.
    location: str | None = None
    since: datetime | None = None
    # False for a "Weiteres Material" entry. It is on the Abholliste like every
    # other line and it is deliberately NOT in "Material zurück – freigeben":
    # there is no assignment to free.
    tracked: bool = True


class EventRestliste(BaseModel):
    """The three open counts of one Ereignis (§6, V-8).

    All three are lists rather than numbers, because the count is only the way
    in: nobody clicks twenty-three cards individually, so each one has to be
    clickable through to the incidents behind it.
    """

    event_id: UUID
    # The denominator of "4 von 23 Schadenplätzen ohne Rapport" — the
    # Schadenplätze a rapport is *owed* for, not every card in the Ereignis. One
    # that was never disponiert is on neither side of the "von" (§18.27).
    incident_total: int = 0
    missing_rapport: list[RestlisteIncident] = []
    material_on_site: list[RestlisteUnit] = []
    open_pickups: list[RestlisteIncident] = []


class RapportPhotosResponse(BaseModel):
    """What both photo doors answer: the rapport's photo list after the write.

    The whole list rather than just the one filename, so a client that lost a
    response (a phone at the edge of coverage retrying an upload) re-syncs from
    the next answer instead of accumulating a duplicate.
    """

    incident_id: UUID
    photos: list[str] = []
    # The file just stored; None on a delete.
    filename: str | None = None


class MaterialReturnUnit(BaseModel):
    """One row of "Material zurück – freigeben" (decision 17).

    The board is *offered* the units the crew did not mark as left on site and
    clicks; `/feld` never writes an assignment itself. Units marked *vor Ort
    verblieben* come back in ``left_on_site`` and are NOT in the release set;
    consumables are in neither list — a consumable that was used is gone.
    """

    assignment_id: UUID
    material_id: UUID
    name: str
    location: str | None = None
    used: bool | None = None
    # Did the crew actually say something about this unit? An unanswered row
    # lands in ``returned`` because *not marked as left on site* is its default,
    # which is right for the release list and wrong for the completion gate: the
    # gate prefills from the rapport and still has to ask about the rest.
    answered: bool = False


class MaterialReturnResponse(BaseModel):
    """Everything the board needs to stop asking the crew's question twice.

    The two lists are the release view (decision 17). The attribution is what the
    completion gate puts over the answers it prefilled — "aus dem Rapport von
    Muster Hans" — so the operator confirms somebody's word instead of a dialog
    that decided by itself.
    """

    returned: list[MaterialReturnUnit] = []
    # Listed separately and deliberately NOT in the release set (decision 15).
    left_on_site: list[MaterialReturnUnit] = []
    # Names from "Weiteres gebrauchtes Material" the crew marked *vor Ort
    # verblieben* (§18.35). They travel so the release list can SHOW them and say
    # why they have no button: these are names, not units the board dispatched,
    # so there is no assignment to free — while the Abholliste still sends
    # somebody to fetch them. An operator who is told nothing here would either
    # believe the address is clear or wonder where the pump went.
    left_on_site_named: list[str] = []
    # None when there is no rapport to answer from; then there is nothing to
    # prefill and the gate asks from scratch, exactly as it always did.
    rapport_by: str | None = None
    rapport_submitted_at: datetime | None = None
    # True when these answers come from a rapport the crew has NOT filed
    # (§18.23). Only ever true for a caller that asked for drafts, and the
    # caller has to say so — "Aus dem Rapport-Entwurf von X" — because an
    # operator weighing a half-finished answer must know it is half-finished.
    rapport_is_draft: bool = False


class FeldIncidentCreate(BaseModel):
    """«Neue Meldung» — a Schadenplatz reported by somebody standing in front of it.

    Deliberately narrower than the board's create and slightly wider than the
    phone-desk one: no Melder fields, because the reporter *is* the Melder and
    the audit row already carries their name.

    ``take_over`` is decision 3 and 14 together — "wir übernehmen das gleich".
    What it does depends on what the crew is already working; the endpoint
    answers with which of the three it was.
    """

    title: str
    type: IncidentType
    priority: IncidentPriority
    location_address: str | None = None
    location_lat: str | Decimal | None = None
    location_lng: str | Decimal | None = None
    description: str | None = None
    take_over: bool = False
    # The Telefondienst variant (plan 26, decision 6): the phone desk is a ROLE,
    # not a page. Somebody holding it is writing down a call, so the report gets
    # the Melder it was taken from and `source='intake'` — the board draws that
    # differently from a firefighter standing in front of the thing. Ignored,
    # and the source stays 'feld', for anybody without the role.
    as_phone_call: bool = False
    contact: str | None = None
    contact_phone: str | None = None

    _validate_title = field_validator("title")(IncidentBase.validate_title.__func__)  # type: ignore[attr-defined]
    _validate_lat = field_validator("location_lat")(IncidentBase.validate_latitude.__func__)  # type: ignore[attr-defined]
    _validate_lng = field_validator("location_lng")(IncidentBase.validate_longitude.__func__)  # type: ignore[attr-defined]
    _validate_description = field_validator("description")(  # type: ignore[attr-defined]
        IncidentBase.validate_description.__func__
    )


class FeldIncidentCreated(BaseModel):
    """What the phone gets back: the new Schadenplatz, and what became of it.

    ``takeover`` says which of the three shapes happened, so the confirmation can
    be specific — "als Stop 3 im Auftrag" reads very differently from "gemeldet".
    """

    incident_id: UUID
    takeover: Literal["none", "stop", "auftrag", "solo"]
