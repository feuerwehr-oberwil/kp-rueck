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
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

# 'none'      – no schadenplatz_reports row for this incident yet
# 'draft'     – a row exists but is_draft is still True
# 'submitted' – filed
RapportState = Literal["none", "draft", "submitted"]


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


class FeldPersonnelListResponse(BaseModel):
    """Response for the `/feld` person picker."""

    personnel: list[FeldPersonnel]
    event_id: UUID
    event_name: str


class FeldAssignment(BaseModel):
    """One Schadenplatz a person is (or was) assigned to in this event."""

    incident_id: UUID
    incident_title: str
    incident_type: str
    incident_status: str
    location_address: str | None = None
    location_lat: str | None = None
    location_lng: str | None = None
    # False once the board released the person — they may still file (and often
    # only file then), so the row stays visible.
    is_active_assignment: bool = True
    rapport_state: RapportState = "none"
    arrived_at: datetime | None = None
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
    # True when the arrival was entered in the KP: no personnel id AND a time.
    # The UI needs to tell "im KP erfasst" from "nobody has reported it".
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

# The paper's damage-type checkboxes. Deliberately NOT `IncidentType`, which
# carries the Swiss statistics vocabulary — this is a sub-classification of one
# of its values and writing it into `Incident.type` would corrupt that vocabulary
# for the sake of a checkbox (decision 8). Mirrors the `valid_damage_type`
# CheckConstraint; keep the two in step.
DamageType = Literal["wasserschaden", "sturmschaden", "schneebruch", "anderes"]


class RapportMaterialRow(BaseModel):
    """One material unit on the checklist (decision 14).

    Keyed on the **assignment**, not the material: the same pump assigned twice
    is two units on the slip, and the assignment id is also what the board's
    "Material zurück – freigeben" list releases against.

    ``used`` is nullable on purpose — "die Crew hat nicht geantwortet" is a third
    answer and every output has to be able to show it. ``left_on_site`` is a
    plain bool: not answering it means the unit came back.
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
    used: bool | None = None
    left_on_site: bool = False
    # False once the board no longer has this unit assigned. The row survives
    # only because it was already answered — the crew saw it and used it, and
    # deleting it would lose exactly what the checklist exists to capture.
    on_board: bool = True


class RapportMaterialUpdate(BaseModel):
    """The two ticks, as the form sends them back."""

    assignment_id: UUID
    used: bool | None = None
    left_on_site: bool = False


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
    touched the form. The two board counts stay on the response after a
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
    # "Melder übernehmen" (§4): one tap copies these into the owner block.
    # Copies, never equates — Melder ≠ Eigentümer stays correctable.
    melder_name: str | None = None
    melder_street: str | None = None
    melder_city: str | None = None
    board_personnel_count: int = 0
    board_vehicle_count: int = 0
    # The prefill defaults for the two time fields, kept separate from the
    # stored values so the form can tell "board says" from "crew typed".
    default_work_started_at: datetime | None = None
    default_work_ended_at: datetime | None = None


class SchadenplatzRapport(BaseModel):
    """The Schadenplatz-Rapport as both doors return it."""

    model_config = ConfigDict(from_attributes=True)

    incident_id: UUID
    # False when nothing has been filed yet: the GET computed a prefill and
    # deliberately did NOT write a row.
    exists: bool = False
    is_draft: bool = True
    submitted_at: datetime | None = None

    damage_type: DamageType | None = None
    damage_type_other: str | None = None
    work_started_at: datetime | None = None
    work_ended_at: datetime | None = None

    materials: list[RapportMaterialRow] = []
    extra_material_note: str | None = None

    kurzbericht: str | None = None
    handed_over_to: str | None = None

    owner_name: str | None = None
    owner_street: str | None = None
    owner_city: str | None = None
    vehicle_plate: str | None = None
    vehicle_model: str | None = None

    personnel_count: int | None = None
    personnel_count_corrected: bool = False
    vehicle_count: int | None = None
    vehicle_count_corrected: bool = False
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

    damage_type: DamageType | None = None
    damage_type_other: str | None = Field(default=None, max_length=200)
    work_started_at: datetime | None = None
    work_ended_at: datetime | None = None

    materials: list[RapportMaterialUpdate] | None = None
    extra_material_note: str | None = Field(default=None, max_length=1000)

    kurzbericht: str | None = Field(default=None, max_length=5000)
    handed_over_to: str | None = Field(default=None, max_length=200)

    owner_name: str | None = Field(default=None, max_length=200)
    owner_street: str | None = Field(default=None, max_length=200)
    owner_city: str | None = Field(default=None, max_length=200)
    vehicle_plate: str | None = Field(default=None, max_length=50)
    vehicle_model: str | None = Field(default=None, max_length=100)

    personnel_count: int | None = Field(default=None, ge=0, le=999)
    vehicle_count: int | None = Field(default=None, ge=0, le=999)


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
