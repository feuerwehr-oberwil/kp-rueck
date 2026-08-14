"""What a share link may show — the narrow shapes behind `/api/viewer/data`.

That endpoint has no session behind it: the token in the URL is the only gate,
and a URL gets forwarded, screenshotted and taped to a wall. So every model here
is an **allowlist**, built from what `frontend/lib/viewer-data.ts` actually
renders — not a response model with two fields deleted. The difference matters
in a year: a column added to `Incident` shows up on the board by itself, and
must NOT show up on a shared link by itself.

`ViewerRekoSummary` (`schemas/reko.py`) narrows the Reko result the same way and
for the same reason; these models extend that rule to the rest of the payload.

What is deliberately NOT here, per model:

* **Incident** — `contact` / `contact_phone` (a resident's name and phone
  number: the caller is not part of the situation, the address is) and
  `internal_notes` (by its own name not for sharing). Also the workflow fields
  the display never draws: the Schadenplatz-Rapport flags (whether the KP has
  filed its paperwork is the office's state, not the situation's), `pickup_note`
  (unbounded operator free text that only ever surfaces in a tooltip, and nobody
  hovers a wall display — the badge and its "seit HH:MM" read fine without it),
  the field/Reko provenance ids, `pickup_requested_by`, `source_ref` and
  `created_by` — personnel and user UUIDs that no wall needs and that identify
  people across events.

  `pickup_needed` / `pickup_requested_at` DO ride along: "this crew is finished
  and cannot get itself back" is a fact about the situation, not about a person
  — a boolean and a timestamp, naming nobody — and a crew standing at the kerb
  is the last thing a wall display may keep to itself.
* **Personnel** — `divera_user_id` (an account identity in another system),
  the raw `status` column and the check-in stamps. The display computes
  "assigned vs. available" from this event's assignments; the roster is already
  scoped to who is checked in here.
* **Material** — the free-text `description` and the raw `status` column (the
  display derives "assigned vs. available" from this event's assignments).
* **Vehicle** — nothing. `schemas.Vehicle` carries no personal data, and its
  `radio_call_sign` is drawn next to the vehicle on a card; a call sign is
  painted on the truck and spoken on an open channel, so hiding it here would
  cost readability and buy nothing. The fleet and material lists likewise stay
  station-wide on purpose: "what is still in the depot" is the question the
  status display exists to answer.
* **Assignment / special function** — `assigned_by` (the operator's user id),
  `assigned_at`, `unassigned_at`. The display needs to know *that* a resource is
  on an incident, never who put it there or when. `is_leader` stays: the crew's
  names are already on the wire, and the flag adds no person — it only marks
  which of those shared names leads, which is what the board's own
  `sortCrewByLeader` is for. Its Auftrag sibling has always kept it.
* **Auftrag (group)** — `created_by` and the Funkdurchsage bookkeeping (a
  display draws the route, it never makes an announcement). Its assignment rows
  stay, narrowed the same way as an incident's: the shared board names the
  resources a route owns.
"""

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_serializer

from .events import FunctionType
from .groups import GroupProgress
from .incidents import AssignedVehicle, IncidentPriority, IncidentStatus, IncidentType

__all__ = [
    "ViewerAssignment",
    "ViewerGroup",
    "ViewerGroupAssignment",
    "ViewerIncident",
    "ViewerMaterial",
    "ViewerPersonnel",
    "ViewerSpecialFunction",
]


class ViewerIncident(BaseModel):
    """One card on a shared board / map / status display.

    The situation — where, what, how urgent, how far along — and nothing about
    the person who reported it. See the module docstring for the full omission
    list; the two that the audit found rendered are `contact`/`contact_phone`
    (the Melder block) and `internal_notes` (the detail dialog).
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    # Kept: the map view builds its domain object from this payload and the
    # token names this event anyway, so it reveals nothing the caller lacks.
    event_id: UUID
    title: str
    type: IncidentType
    priority: IncidentPriority
    status: IncidentStatus
    location_address: str | None = None
    # Server-computed short label (home city stripped) — the display renders it
    # on first paint instead of reformatting once its settings load.
    location_display: str | None = None
    location_lat: str | Decimal | None = None
    location_lng: str | Decimal | None = None
    # "Meldung" — what came in. The situation, and the reason the link exists.
    description: str | None = None
    # Drives the "Telefon" badge on the card.
    source: str = "operator"
    nachbarhilfe: bool = False
    nachbarhilfe_note: str | None = None
    am_warten: bool = False
    am_warten_note: str | None = None
    zu_fuss: bool = False
    # "Abholung nötig" — the crew is finished and cannot get back on its own.
    # Operational, and nobody's personal data: a flag and a timestamp. The
    # free-text `pickup_note` and the requesting operator stay behind.
    pickup_needed: bool = False
    pickup_requested_at: datetime | None = None
    # Auftrag membership + this stop's place in the route.
    group_id: UUID | None = None
    group_position: int = 0
    created_at: datetime
    updated_at: datetime
    completed_at: datetime | None = None
    status_changed_at: datetime | None = None
    # Names and call signs of the vehicles on the card — operational, and what
    # a wall display is read for.
    assigned_vehicles: list[AssignedVehicle] = []
    has_completed_reko: bool = False
    reko_arrived_at: datetime | None = None

    @field_serializer("location_lat", "location_lng")
    def serialize_decimal(self, value: str | Decimal | None) -> str | None:
        """Coordinates travel as strings, exactly as on the board's own payload."""
        if value is None:
            return None
        return str(value)


class ViewerPersonnel(BaseModel):
    """A checked-in person on the shared roster — name, role, sorting.

    Enough to draw the roster panel and to sort it the way the board does. The
    availability the display shows is derived from this event's assignments, so
    the raw `status` column is not carried; nor is any external account id.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    role: str | None = None
    role_sort_order: int = 0
    tags: list[str] | None = None


class ViewerMaterial(BaseModel):
    """A unit of equipment on the shared material panel."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    type: str
    # The depot/vehicle it lives in — the display's grouping ("category").
    location: str
    location_sort_order: int = 0
    consumable: bool = False
    group_id: UUID | None = None


class ViewerAssignment(BaseModel):
    """One resource on one incident — the shape the display reconciles with.

    `driver_stay` rides along because the board draws the "Fahrer bleibt" marker
    from it, and `is_leader` because the display sorts the crew leader-first —
    it names nobody new, it only marks one of the names already on the wire.
    Who assigned it, and when, do not.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    resource_type: str  # 'personnel' | 'vehicle' | 'material'
    resource_id: UUID
    driver_stay: bool = False
    is_leader: bool = False


class ViewerGroupAssignment(BaseModel):
    """A resource the route owns — the shared board names them under the Auftrag."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    resource_type: str  # 'personnel' | 'vehicle' | 'material'
    resource_id: UUID
    # The display skips released rows; the board's own list does the same.
    unassigned_at: datetime | None = None
    driver_stay: bool = False
    is_leader: bool = False


class ViewerGroup(BaseModel):
    """An Auftrag (route) as a display draws it: name, colour, stops, progress."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    event_id: UUID
    name: str
    color: str | None = None
    notes: str | None = None
    position: int = 0
    created_at: datetime
    updated_at: datetime
    stop_ids: list[UUID] = []
    progress: GroupProgress = Field(default_factory=GroupProgress)
    assignments: list[ViewerGroupAssignment] = []


class ViewerSpecialFunction(BaseModel):
    """A Reko / driver / Magazin role for the event, as the display reads it.

    The display resolves the person from the roster it already has, so the
    denormalised `personnel_name` is dropped; the vehicle name is kept because a
    driver's vehicle is drawn next to their name.
    """

    model_config = ConfigDict(from_attributes=True)

    personnel_id: UUID
    function_type: FunctionType
    vehicle_id: UUID | None = None
    vehicle_name: str | None = None
