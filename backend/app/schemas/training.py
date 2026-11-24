"""Training-mode schemas: Excel imports, emergency templates, training locations, simulation."""

import re
from datetime import datetime
from decimal import Decimal
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, field_serializer, field_validator, model_validator


# Excel import/export
class ExcelImportDeletions(BaseModel):
    """What the chosen import mode would DELETE – zero throughout for `append`.

    `incident_assignments` is the number that matters and that no operator can
    guess: an assignment references its resource by a bare UUID with no foreign
    key, so a `replace` leaves those rows behind pointing at deleted personnel,
    vehicles and materials. `active_incident_assignments` is the subset still on
    the board, i.e. the damage visible on a running incident.
    `incident_group_assignments` is the identical hazard on Aufträge, whose
    resources hang off the route rather than off any of its stops.

    `cascade_*` are the rows that do the opposite and disappear without trace:
    `personnel.id` is a real FK with ON DELETE CASCADE in all three, so a roster
    replace silently wipes the check-ins of a running event.

    The fields below the first five default to 0 so an older client that never
    sends or reads them keeps working – they were added after the shape shipped.
    """

    personnel: int
    vehicles: int
    materials: int
    incident_assignments: int
    active_incident_assignments: int
    incident_group_assignments: int = 0
    active_incident_group_assignments: int = 0
    cascade_event_attendance: int = 0
    cascade_event_special_functions: int = 0
    cascade_personnel_identities: int = 0


class ExcelImportPreview(BaseModel):
    """Preview of Excel import data."""

    personnel_preview: list[dict[str, Any]]
    personnel_total: int
    vehicles_preview: list[dict[str, Any]]
    vehicles_total: int
    materials_preview: list[dict[str, Any]]
    materials_total: int
    # The preview used to show only what would be ADDED, which reads as harmless
    # no matter which mode is selected. These two say what it would cost.
    mode: Literal["replace", "append"]
    deletions: ExcelImportDeletions


class ExcelImportResult(BaseModel):
    """Result of Excel import operation."""

    success: bool
    mode: str
    counts: dict[str, int]
    timestamp: datetime


# Emergency templates
class EmergencyTemplateBase(BaseModel):
    """Base schema for emergency template."""

    title_pattern: str
    incident_type: str
    category: str  # 'normal' or 'critical'
    message_pattern: str
    # Optional alternates — generator rotates between these and the *_pattern
    # canonical values so spawns of the same template don't read identically.
    title_variations: list[str] | None = None
    message_variations: list[str] | None = None


class EmergencyTemplateResponse(EmergencyTemplateBase):
    """Schema for emergency template response."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    created_at: datetime
    is_active: bool


class ManualDispatchRequest(BaseModel):
    """Trainer-driven manual dispatch.

    Pick a template, then choose the location in one of two ways:
      - `location_id` — a pre-seeded `TrainingLocation`
      - `latitude` + `longitude` + `address` — any point on the map
        (trainer drops a pin, reverse-geocoded address is sent along)

    Exactly one of the two paths must be provided.
    """

    template_id: UUID
    location_id: UUID | None = None
    latitude: float | None = None
    longitude: float | None = None
    address: str | None = None

    @model_validator(mode="after")
    def exactly_one_location_source(self) -> "ManualDispatchRequest":
        has_seeded = self.location_id is not None
        has_pin = self.latitude is not None and self.longitude is not None and bool(self.address)
        if has_seeded and has_pin:
            raise ValueError("Provide either location_id OR (latitude, longitude, address), not both")
        if not has_seeded and not has_pin:
            raise ValueError("Provide either location_id OR (latitude, longitude, address)")
        return self


# Training locations
class TrainingLocationBase(BaseModel):
    """Base schema for training location."""

    street: str
    house_number: str
    # Required, not defaulted: a training location that quietly claims to be in
    # one particular town is wrong for every station but that one.
    postal_code: str
    city: str
    building_type: str | None = None
    latitude: str | Decimal | None = None
    longitude: str | Decimal | None = None

    @field_validator("street")
    @classmethod
    def validate_street(cls, v: str) -> str:
        """Validate street name."""
        if not v or not v.strip():
            raise ValueError("Street cannot be empty")
        if len(v) > 100:
            raise ValueError("Street must be 100 characters or less")
        return v.strip()

    @field_validator("house_number")
    @classmethod
    def validate_house_number(cls, v: str) -> str:
        """Validate house number format."""
        if not v or not v.strip():
            raise ValueError("House number cannot be empty")
        if not re.match(r"^[\d]+[a-zA-Z\-\/]*$", v.strip()):
            raise ValueError("Invalid house number format")
        return v.strip()

    @field_validator("postal_code")
    @classmethod
    def validate_postal_code(cls, v: str) -> str:
        """Validate Swiss postal code shape (4 digits).

        Shape only, no regional range: Response must accept legacy/demo data
        (e.g. the '0000' demo placeholder), otherwise the GET endpoint 500s
        through Pydantic.
        """
        if not re.match(r"^\d{4}$", v):
            raise ValueError("Postal code must be 4 digits")
        return v

    @field_validator("latitude")
    @classmethod
    def validate_latitude(cls, v: str | Decimal | None) -> str | Decimal | None:
        """Validate latitude is within Basel-Landschaft area."""
        if v is not None:
            try:
                lat_val = float(str(v))
                if not (47.3 <= lat_val <= 47.6):
                    raise ValueError("Latitude should be within Basel-Landschaft area (47.3 to 47.6)")
            except (ValueError, TypeError) as e:
                if "Latitude should be" not in str(e):
                    raise ValueError("Invalid latitude value") from e
                raise
        return v

    @field_validator("longitude")
    @classmethod
    def validate_longitude(cls, v: str | Decimal | None) -> str | Decimal | None:
        """Validate longitude is within Basel-Landschaft area."""
        if v is not None:
            try:
                lng_val = float(str(v))
                if not (7.3 <= lng_val <= 7.9):
                    raise ValueError("Longitude should be within Basel-Landschaft area (7.3 to 7.9)")
            except (ValueError, TypeError) as e:
                if "Longitude should be" not in str(e):
                    raise ValueError("Invalid longitude value") from e
                raise
        return v

    @field_serializer("latitude", "longitude")
    def serialize_decimal(self, value: Decimal | None) -> str | None:
        """Convert Decimal to string for JSON serialization."""
        if value is None:
            return None
        return str(value)


class TrainingLocationResponse(TrainingLocationBase):
    """Schema for training location response."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    is_active: bool

    def get_full_address(self) -> str:
        return f"{self.street} {self.house_number}, {self.postal_code} {self.city}"


# Auto-generation + simulation
class GenerateEmergencyRequest(BaseModel):
    """Schema for manual emergency generation request."""

    category: str | None = None  # 'normal', 'critical', or None for random
    count: int = 1  # For burst generation (1-10)
    source: str = "operator"  # 'operator' (normal) or 'intake' (simulated phone/walk-in alarm)


class SimulateCheckinRequest(BaseModel):
    """Schema for simulating personnel check-in during training."""

    count: int = 10  # Number of personnel to check in (1-50)
    # 0 = check everyone in immediately; >0 = trickle the check-ins randomly
    # over this many minutes (max 30), mirroring how AdF actually arrive.
    over_minutes: int = 0


class SimulateCheckinResponse(BaseModel):
    """Response for simulated check-ins."""

    checked_in: list[str]
    total_checked_in: int
    total_available: int
    # Trickle mode: names scheduled to check in over the window (checked_in
    # stays empty — they arrive one by one via WebSocket updates).
    scheduled: list[str] = []
    trickle_minutes: int = 0


class SimulateCheckinStopResponse(BaseModel):
    """Result of stopping a trickled check-in: how many people will no longer arrive."""

    stopped: int


class AutogenRun(BaseModel):
    """The Automatik's current run, stored as JSON in the ``training_autogen.run`` settings row.

    Written by ``PUT /api/training/events/{id}/autogen`` when the switch goes on, read by the
    background task: which Übung it feeds, and since when (the «heisse Phase» counts from
    there). ``stopped`` says why the task switched itself off.
    """

    event_id: UUID
    started_at: datetime
    stopped: Literal["max"] | None = None


class AutogenSwitchRequest(BaseModel):
    """Switch the Automatik on (for this Übung) or off."""

    enabled: bool


class AutogenStateResponse(BaseModel):
    """What the Übungssteuerung shows for the Automatik. ``run`` is None before the first start."""

    enabled: bool
    run: AutogenRun | None


# Regie (Übungs-Steuerung): the Autopilot, tempo, pause and «Vorhin». See services/training_regie.py.
RegieStepKey = Literal[
    "reko_arrived",
    "reko_report",
    "drive_to_incident",
    "vehicle_on_scene",
    "field_complete",
    "drive_to_magazin",
    "rapport",
]
RegieTempo = Literal["ruhig", "normal", "sturm"]
RegieBy = Literal["autopilot", "trainer"]


class RegieHistoryItem(BaseModel):
    """One line of «Vorhin»: a step, inject or alarm that went through the Regie."""

    at: datetime
    incident_id: UUID | None
    text: str  # German, e.g. «Reko vor Ort · Im Lohgraben 26»
    by: RegieBy


class RegieRun(BaseModel):
    """The Regie of one Übung, stored as JSON in the ``training_regie.state`` settings row.

    One per installation, like the Automatik run: a write for another Übung starts a fresh one.
    ``autopilot_by`` is the trainer who switched the Autopilot on – it acts in their name.
    ``started_at`` is the first switch-on of the Autopilot or the Automatik.
    """

    event_id: UUID
    autopilot: bool = False
    autopilot_by: UUID | None = None
    tempo: RegieTempo = "normal"
    started_at: datetime | None = None
    paused_at: datetime | None = None
    pauses: list[tuple[datetime, datetime]] = []  # closed pauses, for shifting clocks
    held: list[UUID] = []  # incident ids the Autopilot leaves alone
    history: list[RegieHistoryItem] = []  # newest first, max 20


class RegieStep(BaseModel):
    """A field step of an incident. ``due_at`` is None while held, Mitspieler, under way or not scheduled."""

    incident_id: UUID
    key: RegieStepKey
    due_at: datetime | None
    rolling: bool  # a GPS drive for this step is under way
    progress: float | None  # 0..1 of the slowest drive, when rolling
    eta_seconds: float | None


class RegieIncident(BaseModel):
    incident_id: UUID
    held: bool
    mitspieler: bool
    steps: list[RegieStep]  # primary first


class RegieStateResponse(BaseModel):
    """What the Regie page shows; computed on every read from the stored run and the board."""

    event_id: UUID
    autopilot: bool
    tempo: RegieTempo
    paused_at: datetime | None
    started_at: datetime | None
    automatik: AutogenStateResponse
    automatik_next_at: datetime | None
    incidents: list[RegieIncident]
    history: list[RegieHistoryItem]
    gps_available: bool
    magazin_configured: bool


class RegieUpdateRequest(BaseModel):
    """Switch the Autopilot, set the tempo, pause or resume. Absent fields stay."""

    autopilot: bool | None = None
    tempo: RegieTempo | None = None
    paused: bool | None = None


class RegieHoldRequest(BaseModel):
    held: bool


class RegieStepRequest(BaseModel):
    """Run one step now. ``pickup_needed`` answers «Kommt der Trupp selbst zurück?» for field_complete."""

    key: RegieStepKey
    pickup_needed: bool | None = None


class SimulateDiveraRequest(BaseModel):
    """Schema for injecting a simulated Divera alarm into the pool."""

    category: str | None = None  # 'normal', 'critical', or None for weighted random


class SimulateInjectResponse(BaseModel):
    """Generic result of a trainer inject (reinforcement request etc.)."""

    message: str


class SimulateVehicleBreakdownResponse(BaseModel):
    """Result of a simulated vehicle breakdown."""

    vehicle_name: str
    message: str


class SimulateFieldCompleteRequest(BaseModel):
    """The follow-up "Einsatz beendet" asks in the field (decision 24).

    ``pickup_needed=None`` is the default and means *die Lage entscheidet*: the
    simulator rolls it from the situation — a crew that walked there or whose
    vehicle drove on is usually stranded. The Übungsleiter can always override
    by sending the answer explicitly, which is the same choice the crew has on
    `/feld`.
    """

    pickup_needed: bool | None = None
    pickup_note: str | None = None


class SimulatePickupRequest(BaseModel):
    """ "Abholung nötig" / "abgeholt" as a standalone report (decision 24).

    The crew that asks for a pickup an hour after "Einsatz beendet" — or calls
    in that the bus has been and gone — is a report of its own, not a follow-up
    question. ``note=None`` lets the simulator derive one from the situation
    (zu Fuss / kein Fahrzeug), the same way the completion inject does.
    """

    needed: bool = True
    note: str | None = None


class SimulateRapportResponse(BaseModel):
    """One simulated Schadenplatz-Rapport, as the console reports it back."""

    incident_id: UUID
    incident_title: str
    # The person the rapport was filed by — the Einsatzleiter most of the time
    # (decision 22). None when the incident had nobody assigned and the KP had
    # to enter it, which is the honest provenance for that case.
    filed_by: str | None = None
    # How many of the board's vehicles the simulated crew confirmed were there.
    vehicles_present: int = 0
    materials_ticked: int = 0
    # Scene photos the simulated crew attached, from the same offline pool the
    # simulated Reko reports use. 0 most of the time — a real crew rarely does.
    photos: int = 0
    message: str


class SimulateBulkRapportResponse(BaseModel):
    """The bulk inject: 80 % of the rapports arrive, the rest stay missing.

    ``skipped`` is not a failure count — the gaps are the exercise. They are
    what the Restliste exists to surface, and finding them is the skill being
    trained.
    """

    candidates: int
    covered: int
    skipped: int
    rapports: list[SimulateRapportResponse] = []
    message: str
