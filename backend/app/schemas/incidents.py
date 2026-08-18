"""Incident + status-transition + timeline schemas."""

from datetime import datetime
from decimal import Decimal
from enum import Enum
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, field_serializer, field_validator

# The only two provenances an editor may claim from the board (plan 26 §6).
# "operator" = typed in at the KP, "intake" = the operator took the call and
# says so. Everything else that writes `Incident.source` — the Divera adapter,
# the generic alarm webhooks, the training generator — keeps its own write path
# and passes the slug as a keyword to `crud.create_incident`; those names are
# reserved (`schemas.alarms.RESERVED_ALARM_SOURCES`) and a board request naming
# one is a 422. A card claiming to come from a system that has never heard of it
# is a worse lie than the one this field exists to fix.
EditorIncidentSource = Literal["operator", "intake"]


class IncidentType(str, Enum):
    """Incident type enumeration."""

    BRANDBEKAEMPFUNG = "brandbekaempfung"
    ELEMENTAREREIGNIS = "elementarereignis"
    STRASSENRETTUNG = "strassenrettung"
    TECHNISCHE_HILFELEISTUNG = "technische_hilfeleistung"
    OELWEHR = "oelwehr"
    CHEMIEWEHR = "chemiewehr"
    STRAHLENWEHR = "strahlenwehr"
    EINSATZ_BAHNANLAGEN = "einsatz_bahnanlagen"
    BMA_UNECHTE_ALARME = "bma_unechte_alarme"
    DIENSTLEISTUNGEN = "dienstleistungen"
    DIVERSE_EINSAETZE = "diverse_einsaetze"
    GERETTETE_MENSCHEN = "gerettete_menschen"
    GERETTETE_TIERE = "gerettete_tiere"


class IncidentPriority(str, Enum):
    """Incident priority enumeration."""

    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class IncidentStatus(str, Enum):
    """Incident status enumeration."""

    INCOMING = "incoming"
    REKO = "reko"
    REKO_DONE = "reko_done"
    ENROUTE = "enroute"
    ACTIVE = "active"
    RETURNING = "returning"
    COMPLETE = "complete"


class IncidentBase(BaseModel):
    """Base incident schema."""

    title: str
    type: IncidentType
    priority: IncidentPriority
    location_address: str | None = None
    location_lat: str | Decimal | None = None
    location_lng: str | Decimal | None = None
    status: IncidentStatus = IncidentStatus.INCOMING
    description: str | None = None
    contact: str | None = None
    contact_phone: str | None = None
    internal_notes: str | None = None
    nachbarhilfe: bool = False
    nachbarhilfe_note: str | None = None
    am_warten: bool = False
    am_warten_note: str | None = None
    zu_fuss: bool = False
    # Auftrag (incident group) membership. Lets the streamlined "add stop" create
    # an incident already attached to a route.
    group_id: UUID | None = None

    @field_validator("title")
    @classmethod
    def validate_title(cls, v: str) -> str:
        """Validate incident title."""
        if not v or not v.strip():
            raise ValueError("Title cannot be empty")
        if len(v) > 200:
            raise ValueError("Title must be 200 characters or less")
        return v.strip()

    @field_validator("location_lat")
    @classmethod
    def validate_latitude(cls, v: str | Decimal | None) -> str | Decimal | None:
        """Validate latitude is within valid range."""
        if v is not None:
            try:
                lat_val = float(str(v))
                if not -90 <= lat_val <= 90:
                    raise ValueError("Latitude must be between -90 and 90 degrees")
            except (ValueError, TypeError) as e:
                if "Latitude must be between" not in str(e):
                    raise ValueError("Invalid latitude value") from e
                raise
        return v

    @field_validator("location_lng")
    @classmethod
    def validate_longitude(cls, v: str | Decimal | None) -> str | Decimal | None:
        """Validate longitude is within valid range."""
        if v is not None:
            try:
                lng_val = float(str(v))
                if not -180 <= lng_val <= 180:
                    raise ValueError("Longitude must be between -180 and 180 degrees")
            except (ValueError, TypeError) as e:
                if "Longitude must be between" not in str(e):
                    raise ValueError("Invalid longitude value") from e
                raise
        return v

    @field_validator("description")
    @classmethod
    def validate_description(cls, v: str | None) -> str | None:
        """Validate description length if provided."""
        if v and len(v) > 2000:
            raise ValueError("Description must be 2000 characters or less")
        return v.strip() if v else v


class IncidentCreate(IncidentBase):
    """Schema for creating incident."""

    event_id: UUID
    # "Telefonisch gemeldet" on the new-emergency modal. Off by default, because
    # typing a card on the board IS the operator case.
    source: EditorIncidentSource = "operator"


class PublicIncidentCreate(BaseModel):
    """Lean schema for alarms created via the public token-gated intake form.

    Intentionally narrow: a phone operator / walk-in only provides the essentials.
    The event comes from the token, status is forced to ``incoming`` and the
    operator-only flags (nachbarhilfe, am_warten, zu_fuss, the Auftrag, …) are set
    later by an editor on the board. Validators mirror ``IncidentBase``.

    The two free-text columns are NOT interchangeable, and the form's two text
    fields land in them the way the board reads them: ``description`` is what the
    board labels «Meldung» — what the caller said the thing IS — and
    ``internal_notes`` is «Notizen», the extra hints that came with the call.
    Before this, the form's Meldung went into ``title``, which the board only ever
    shows as a fallback for a missing address, so the one sentence the caller
    actually gave was invisible on a card that had an address.
    """

    title: str
    type: IncidentType
    priority: IncidentPriority
    location_address: str | None = None
    location_lat: str | Decimal | None = None
    location_lng: str | Decimal | None = None
    description: str | None = None  # «Meldung» — what was reported
    contact: str | None = None  # "Melder / Anrufer"
    contact_phone: str | None = None  # Direct phone number
    internal_notes: str | None = None  # «Notizen» — further hints from the call

    # Reuse the shared validators from IncidentBase. `.__func__` unwraps the classmethod so it
    # can be re-registered here; mypy sees the already-bound method and doesn't model the
    # descriptor, hence the narrow ignores. The runtime behaviour is pydantic's documented way
    # of sharing validators between models.
    _validate_title = field_validator("title")(IncidentBase.validate_title.__func__)  # type: ignore[attr-defined]
    _validate_lat = field_validator("location_lat")(IncidentBase.validate_latitude.__func__)  # type: ignore[attr-defined]
    _validate_lng = field_validator("location_lng")(IncidentBase.validate_longitude.__func__)  # type: ignore[attr-defined]
    _validate_description = field_validator("description")(IncidentBase.validate_description.__func__)  # type: ignore[attr-defined]
    # Same rule for the notes: free text through a login-less door needs the same
    # 2000-character cap, and the same strip, as the Meldung next to it.
    _validate_notes = field_validator("internal_notes")(IncidentBase.validate_description.__func__)  # type: ignore[attr-defined]


class IncidentUpdate(BaseModel):
    """Schema for updating incident."""

    title: str | None = None
    type: IncidentType | None = None
    priority: IncidentPriority | None = None
    location_address: str | None = None
    location_lat: str | Decimal | None = None
    location_lng: str | Decimal | None = None
    status: IncidentStatus | None = None
    description: str | None = None
    contact: str | None = None
    contact_phone: str | None = None
    internal_notes: str | None = None
    nachbarhilfe: bool | None = None
    nachbarhilfe_note: str | None = None
    am_warten: bool | None = None
    am_warten_note: str | None = None
    zu_fuss: bool | None = None
    # Attach/detach from an Auftrag (incident group) via a normal PATCH.
    group_id: UUID | None = None
    # Correctable after the fact (decision 8): the realistic sequence is "type it
    # in, then realise it was a phone call", so create-only would miss the common
    # case. Both directions, and only ever between these two values.
    source: EditorIncidentSource = "operator"


class IncidentReorder(BaseModel):
    """Persist the manual top-to-bottom card order for one status column."""

    event_id: UUID
    ordered_ids: list[UUID]


class AssignedVehicle(BaseModel):
    """Vehicle with assignment information."""

    model_config = ConfigDict(from_attributes=True)

    assignment_id: UUID
    vehicle_id: UUID
    name: str
    type: str
    assigned_at: datetime
    driver_stay: bool = False


class IncidentResponse(IncidentBase):
    """Full incident schema with database fields."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    event_id: UUID
    position: int = 0
    # Auftrag (incident group) membership + order of this stop within it.
    group_id: UUID | None = None
    group_position: int = 0
    source: str = "operator"
    # The alarm's id in the delivering system (pool source_id), when the
    # incident was created from a pool alarm.
    source_ref: str | None = None
    created_at: datetime
    updated_at: datetime
    created_by: UUID | None = None
    completed_at: datetime | None = None
    status_changed_at: datetime | None = None
    assigned_vehicles: list[AssignedVehicle] = []
    has_completed_reko: bool = False
    reko_arrived_at: datetime | None = None
    # True when an operator logged "Reko meldet: vor Ort" from a radio message
    # rather than the crew tapping it on `/reko`. The Feldmeldungen row is the one
    # place the arrival is shown (plan 26, decision 15) and it names its channel.
    reko_arrived_by_kp: bool = False
    # Field crew reported the incident finished; operator decides to close it.
    field_complete_reported_at: datetime | None = None
    # NULL when the KP took the message over the radio — provenance is never
    # faked (decision 28), so "im KP erfasst" is the absence of a personnel id,
    # not a guessed one.
    field_complete_reported_by: UUID | None = None
    # "Angekommen" from /feld (batched off schadenplatz_reports).
    field_arrived_at: datetime | None = None
    field_arrived_by: UUID | None = None
    # True when the GPS automation stamped the arrival (§18.24): an assigned
    # vehicle was confirmed at the address and the automation advanced the
    # incident. Its own provenance — never a person, never "im KP erfasst".
    field_arrived_by_automation: bool = False
    # A *submitted* Schadenplatz-Rapport exists. Same query as the arrival, so
    # it is free here; the "kein Rapport" card marker that reads it lands with
    # the form in phase 2.
    has_schadenplatz_rapport: bool = False
    # A *draft* one exists — somebody started and walked away. Mutually
    # exclusive with the flag above: a report row is either filed or it is not,
    # so exactly one of the two can be true. Do NOT "fix" one to imply the
    # other; the detail's Rapport tab needs to tell "erfasst" from "Entwurf",
    # and at 02:00 those two read very differently.
    has_schadenplatz_rapport_draft: bool = False
    # The incident has been disponiert at least once — `enroute` or anything
    # past it, ever, not right now (see `services.incident_dispatch`). Every
    # rapport surface hangs off this: a Schadenplatz nobody was ever sent to has
    # nothing to report on, and an empty rapport on it is noise on the card, in
    # the detail and on the Restliste alike.
    has_been_dispatched: bool = False
    # "Abholung nötig" (decision 24): the crew is finished and cannot get back on
    # its own. NOT a status, and deliberately NOT cleared when the card moves to
    # `complete` — that transition releases the personnel while they are still
    # standing at the address, which is exactly when this must survive.
    pickup_needed: bool = False
    pickup_note: str | None = None
    pickup_requested_at: datetime | None = None
    pickup_requested_by: UUID | None = None
    # The effective Einsatzleiter's name (services.incident_leader): the active
    # `is_leader` assignment when one exists, the leader of record
    # (`Incident.leader_personnel_id`) otherwise. Carried on the list response
    # because a CLOSED incident has no assignments left — the board can only
    # name who led it (the person the KP phones about the rapport) from here.
    leader_name: str | None = None
    # Server-computed short label for location_address (home city stripped) so
    # clients can render the final string on first paint — no reformat flash
    # once the home_city setting loads client-side. "" when the address is only
    # the home city; None when there is no address (or on older backends).
    location_display: str | None = None

    @field_validator(
        "pickup_needed",
        "has_schadenplatz_rapport",
        "has_schadenplatz_rapport_draft",
        "has_been_dispatched",
        mode="before",
    )
    @classmethod
    def _false_when_unset(cls, value: object) -> object:
        """None means "not set yet", not "invalid".

        ``Incident.pickup_needed`` carries a Python-side default that SQLAlchemy
        only applies on flush, so an incident validated straight after
        construction — which is what the training generator and every
        create-then-broadcast path does — still has ``None`` on the attribute.
        The two ``has_schadenplatz_rapport*`` flags and ``has_been_dispatched``
        are transients the board query attaches, so they are simply absent
        anywhere else. All of them mean "no", and a 500 on a freshly built card
        is the wrong way to say it.
        """
        return False if value is None else value

    @field_serializer("location_lat", "location_lng")
    def serialize_decimal(self, value: str | Decimal | None) -> str | None:
        """Convert Decimal to string for JSON serialization."""
        if value is None:
            return None
        return str(value)


# Status transitions
class StatusTransitionCreate(BaseModel):
    """Schema for creating status transition."""

    from_status: IncidentStatus
    to_status: IncidentStatus
    notes: str | None = None


class StatusTransitionResponse(BaseModel):
    """Status transition response schema."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    incident_id: UUID
    from_status: str
    to_status: str
    timestamp: datetime
    user_id: UUID | None = None
    notes: str | None = None


# Timeline
class IncidentTimelineEvent(BaseModel):
    """A single event on the incident timeline.

    Flat shape with optional fields differentiated by `event_type`:
    - status_change → from_status, to_status, notes
    - assignment    → assignment_action ('assigned' | 'unassigned'),
                      resource_type, resource_name
    - field_message → message, source ('feld' | 'kp')
    """

    event_type: str  # 'status_change' | 'assignment' | 'field_message'
    timestamp: datetime
    actor_name: str | None = None

    # status_change fields
    from_status: str | None = None
    to_status: str | None = None
    notes: str | None = None

    # assignment fields
    assignment_action: str | None = None
    resource_type: str | None = None
    resource_name: str | None = None

    # field_message fields — the crew's own words, verbatim. `source` says which
    # door they came through: the field surface, or an operator typing what came
    # over the radio.
    message: str | None = None
    source: str | None = None


class IncidentTimelineResponse(BaseModel):
    """Timeline events for an incident, sorted oldest → newest."""

    events: list[IncidentTimelineEvent]


class IncidentParticipant(BaseModel):
    """One resource that was on an incident at some point — the "Beteiligt" roll-up.

    Completing an incident releases its crew, so the board's own crew list
    answers "who is on this now" and, for a closed incident, nobody. The
    question that gets asked weeks later is "who was there" — which the
    assignment rows have always been able to answer (they are soft-released via
    ``unassigned_at``, never deleted), just never been asked.

    One row per resource, not per assignment: a person taken off and put back on
    appears once, with ``first_assigned_at`` / ``last_released_at`` spanning
    their involvement and ``stints`` counting how many separate times.
    """

    resource_type: str  # 'personnel' | 'vehicle' | 'material'
    resource_id: UUID
    # None when the underlying resource has since been deleted from the roster —
    # the assignment row survives, so the participation is still reported.
    name: str | None = None
    first_assigned_at: datetime
    # None while the resource is still assigned.
    last_released_at: datetime | None = None
    stints: int = 1
    # Personnel only: this person held the Reko function for the event, so they
    # were here on reconnaissance rather than as crew. Worth distinguishing —
    # "who was there" and "who went to look" are different answers.
    is_reko: bool = False
    # Personnel only: led the incident (or its Auftrag) while assigned.
    is_leader: bool = False


class IncidentParticipantsResponse(BaseModel):
    """Everyone and everything that was on an incident, longest-serving first."""

    participants: list[IncidentParticipant]
