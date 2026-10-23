"""Training emergency auto-generation, and the simulated field work of the Übungssteuerung."""

import logging
import random
from io import BytesIO
from typing import Any, Literal
from uuid import UUID, uuid4

from fastapi import Request, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.crud import feld as feld_crud
from app.models import (
    DiveraEmergency,
    EmergencyTemplate,
    Incident,
    IncidentAssignment,
    IncidentGroupAssignment,
    Material,
    Notification,
    Personnel,
    Setting,
    TrainingLocation,
    User,
)
from app.schemas import RapportUpdate, SimulateRapportResponse
from app.services import notification_params
from app.services.training_photos import pick_pool_photos
from app.services.training_simulation_data import (
    RAPPORT_SIM_PROFILE,
    generate_intake_caller,
    generate_rapport_data,
    vary_dispatch_numbers,
)

logger = logging.getLogger(__name__)


class TrainingGenerator:
    """Generates realistic training emergencies."""

    def __init__(self, db: AsyncSession):
        self.db = db
        self._cache_templates: list[EmergencyTemplate] = []
        self._cache_locations: list[TrainingLocation] = []

    async def _load_templates(self) -> None:
        """Load all active emergency templates."""
        result = await self.db.execute(select(EmergencyTemplate).where(EmergencyTemplate.is_active))
        self._cache_templates = list(result.scalars().all())

    async def _load_locations(self) -> None:
        """Load all active training locations."""
        result = await self.db.execute(select(TrainingLocation).where(TrainingLocation.is_active))
        self._cache_locations = list(result.scalars().all())

    @staticmethod
    def _pick_title(template: EmergencyTemplate) -> str:
        """Pick a random title from the template's pattern + variations pool."""
        pool = [template.title_pattern]
        if template.title_variations:
            pool.extend(template.title_variations)
        return random.choice(pool)

    @staticmethod
    def _pick_message(template: EmergencyTemplate) -> str:
        """Pick a random message from the template's pattern + variations pool."""
        pool = [template.message_pattern]
        if template.message_variations:
            pool.extend(template.message_variations)
        return random.choice(pool)

    async def _create_incident_from(
        self,
        event_id: UUID,
        template: EmergencyTemplate,
        *,
        address: str,
        latitude: float | None,
        longitude: float | None,
        source: str = "operator",
    ) -> Incident:
        """Materialize an incident from a template + raw location triple.

        Picks random title + message from the template's variations pools so
        repeated spawns of the same template don't read identically. Derives
        priority from category (critical→high, normal→low). Location is given
        as raw `(address, latitude, longitude)` so callers can use either a
        seeded `TrainingLocation` or an ad-hoc map pin. `source` defaults to
        "operator"; pass "intake" to simulate a phone/walk-in alarm (shows the
        Telefon badge) for added training realism.
        """
        priority = "high" if template.category == "critical" else "low"
        # Jitter the concrete figures (depth/volume/length) so repeated spawns of
        # the same template don't read identically.
        description = vary_dispatch_numbers(self._pick_message(template))
        contact = None
        # A simulated phone/walk-in alarm gets a fake caller (Melder) plus a short
        # citizen-perspective context line, so it reads like a real report.
        if source == "intake":
            caller = generate_intake_caller()
            contact = caller["contact"]
            description = f"{description} {caller['context']}"
        incident = Incident(
            event_id=event_id,
            title=self._pick_title(template),
            type=template.incident_type,
            priority=priority,
            status="incoming",
            location_address=address,
            location_lat=latitude,
            location_lng=longitude,
            description=description,
            contact=contact,
            source=source,
        )
        self.db.add(incident)
        await self.db.flush()
        await self.db.refresh(incident)
        return incident

    async def generate_emergency(
        self,
        event_id: UUID,
        category: Literal["normal", "critical"] | None = None,
        settings: dict[str, str] | None = None,
        source: str = "operator",
    ) -> Incident:
        """
        Generate a random training emergency.

        Args:
            event_id: Training event to add incident to
            category: Force specific category, or None for weighted random
            settings: Auto-gen settings (weights, etc.)
            source: "operator" (normal) or "intake" (simulated phone/walk-in)

        Returns:
            Created incident
        """
        # Load templates and locations if not cached
        if not self._cache_templates:
            await self._load_templates()
        if not self._cache_locations:
            await self._load_locations()

        if not self._cache_templates:
            raise ValueError("No emergency templates available. Please run seed_training.py first.")
        if not self._cache_locations:
            raise ValueError("No training locations available. Please run seed_training.py first.")

        # Phone/walk-in alarms are non-critical by definition: for a real fire,
        # citizens call the official dispatch, not the command post. Keep the
        # intake path to normal scenarios (water, fallen tree, stuck lift, ...).
        if source == "intake":
            category = "normal"

        # Determine category (weighted random if not specified)
        if category is None:
            normal_weight = int(settings.get("training_normal_weight", 90)) if settings else 90
            critical_weight = int(settings.get("training_critical_weight", 10)) if settings else 10
            pool: list[Literal["normal", "critical"]] = ["normal", "critical"]
            category = random.choices(pool, weights=[normal_weight, critical_weight], k=1)[0]

        # Filter templates by category
        templates = [t for t in self._cache_templates if t.category == category]
        if not templates:
            raise ValueError(f"No templates found for category: {category}")

        # Select random template and location, avoiding address repeats — see
        # _pick_location for the preference order.
        template = random.choice(templates)
        active_addresses, used_addresses = await self._event_addresses(event_id)
        location = self._pick_location(self._cache_locations, active_addresses, used_addresses)

        incident = await self._create_incident_from(
            event_id,
            template,
            address=location.get_full_address(),
            latitude=location.latitude,
            longitude=location.longitude,
            source=source,
        )
        full_address = incident.location_address

        # Create notification for new training incident
        message, params = notification_params.training_new(incident.title, full_address)
        notification = Notification(
            id=uuid4(),
            type="training_emergency",
            severity="critical" if category == "critical" else "warning",
            message=message,
            params=params,
            incident_id=incident.id,
            event_id=event_id,
            dismissed=False,
        )
        self.db.add(notification)
        await self.db.flush()

        # Log emergency creation
        logger.info("Training emergency created: %s at %s (category: %s)", incident.title, full_address, category)

        return incident

    async def dispatch_specific(
        self,
        event_id: UUID,
        template: EmergencyTemplate,
        *,
        location: TrainingLocation | None = None,
        location_override: tuple[str, float, float] | None = None,
    ) -> Incident:
        """Trainer-driven dispatch: a specific template at a chosen location.

        Location can be either a pre-seeded `TrainingLocation` *or* an ad-hoc
        map pin passed as `(address, latitude, longitude)`. Exactly one of
        `location` / `location_override` must be provided; the API-level
        Pydantic validator already enforces this on the request side.
        """
        if location is not None:
            address = location.get_full_address()
            latitude = location.latitude
            longitude = location.longitude
        elif location_override is not None:
            address, latitude, longitude = location_override
        else:
            raise ValueError("Provide either location or location_override")

        incident = await self._create_incident_from(
            event_id,
            template,
            address=address,
            latitude=latitude,
            longitude=longitude,
        )

        message, params = notification_params.training_new(incident.title, incident.location_address)
        notification = Notification(
            id=uuid4(),
            type="training_emergency",
            severity="critical" if template.category == "critical" else "warning",
            message=message,
            params=params,
            incident_id=incident.id,
            event_id=event_id,
            dismissed=False,
        )
        self.db.add(notification)
        await self.db.flush()

        logger.info(
            "Manual training dispatch: %s at %s (template=%s, category=%s, pin=%s)",
            incident.title,
            incident.location_address,
            template.id,
            template.category,
            location is None,
        )
        return incident

    async def generate_pool_emergency(
        self,
        event_id: UUID,
        category: Literal["normal", "critical"] | None = None,
        settings: dict[str, str] | None = None,
    ) -> DiveraEmergency:
        """Generate a simulated Divera alarm into the emergency pool.

        Instead of materializing an incident on the board, this drops a
        training-marked entry into the Divera pool — alarm sound, toast and the
        attach workflow included — so trainees practice the real alarm-intake
        path. No bell notification is created on purpose: discovering the alarm
        via the pool IS the exercise. The entry is flagged ``is_training`` and
        can only be attached to training events.
        """
        if not self._cache_templates:
            await self._load_templates()
        if not self._cache_locations:
            await self._load_locations()

        if not self._cache_templates:
            raise ValueError("No emergency templates available. Please run seed_training.py first.")
        if not self._cache_locations:
            raise ValueError("No training locations available. Please run seed_training.py first.")

        if category is None:
            normal_weight = int(settings.get("training_normal_weight", 90)) if settings else 90
            critical_weight = int(settings.get("training_critical_weight", 10)) if settings else 10
            pool: list[Literal["normal", "critical"]] = ["normal", "critical"]
            category = random.choices(pool, weights=[normal_weight, critical_weight], k=1)[0]

        templates = [t for t in self._cache_templates if t.category == category]
        if not templates:
            raise ValueError(f"No templates found for category: {category}")

        template = random.choice(templates)
        active_addresses, used_addresses = await self._event_addresses(event_id)
        location = self._pick_location(self._cache_locations, active_addresses, used_addresses)

        # Negative divera_id keeps simulated alarms clear of real Divera IDs
        # (which are positive). Retry on the unlikely collision.
        divera_id = -random.randint(10_000_000, 2_000_000_000)
        for _ in range(5):
            existing = await self.db.execute(select(DiveraEmergency.id).where(DiveraEmergency.divera_id == divera_id))
            if existing.scalar_one_or_none() is None:
                break
            divera_id = -random.randint(10_000_000, 2_000_000_000)

        emergency = DiveraEmergency(
            divera_id=divera_id,
            divera_number=f"UE-{random.randint(100, 999)}",
            title=self._pick_title(template),
            text=vary_dispatch_numbers(self._pick_message(template)),
            address=location.get_full_address(),
            latitude=location.latitude,
            longitude=location.longitude,
            is_training=True,
            raw_payload_json={
                "simulated": True,
                "training_event_id": str(event_id),
                "category": category,
            },
        )
        self.db.add(emergency)
        await self.db.flush()
        await self.db.refresh(emergency)

        logger.info(
            "Simulated Divera alarm created: %s at %s (category: %s)",
            emergency.title,
            emergency.address,
            category,
        )
        return emergency

    @staticmethod
    def _pick_location(
        locations: list[TrainingLocation],
        active_addresses: set[str],
        used_addresses: set[str],
    ) -> TrainingLocation:
        """Pick a spawn location, keeping address repeats rare.

        Preference order: an address this event has never seen → one without a
        still-active incident → the whole pool (only when everything is taken).
        The middle tier is the hard rule (two open alarms must not share an
        address); the first tier is what keeps a long exercise from circling
        back to a Schadenplatz the trainees just closed.
        """
        fresh = [loc for loc in locations if loc.get_full_address() not in used_addresses]
        if fresh:
            return random.choice(fresh)
        inactive = [loc for loc in locations if loc.get_full_address() not in active_addresses]
        return random.choice(inactive or locations)

    async def _event_addresses(self, event_id: UUID) -> tuple[set[str], set[str]]:
        """(active, ever-used) incident addresses of this event.

        Unattached simulated pool alarms count as active too — they are exercise
        load that will land on this board, and a generated incident at the same
        address would read as a duplicate the moment the alarm is attached.
        """
        result = await self.db.execute(
            select(Incident.location_address, Incident.completed_at).where(
                Incident.event_id == event_id,
                Incident.deleted_at.is_(None),
            )
        )
        active: set[str] = set()
        used: set[str] = set()
        for addr, completed_at in result.all():
            if not addr:
                continue
            used.add(addr)
            if completed_at is None:
                active.add(addr)

        pool_result = await self.db.execute(
            select(DiveraEmergency.address).where(
                DiveraEmergency.is_training.is_(True),
                DiveraEmergency.is_archived.is_(False),
                DiveraEmergency.attached_to_event_id.is_(None),
            )
        )
        for (addr,) in pool_result.all():
            if addr:
                used.add(addr)
                active.add(addr)
        return active, used


async def generate_training_emergency(
    db: AsyncSession,
    event_id: UUID,
    category: Literal["normal", "critical"] | None = None,
    count: int = 1,
    source: str = "operator",
) -> list[Incident]:
    """
    Generate one or more training emergencies.

    Args:
        db: Database session
        event_id: Training event ID
        category: Optional category filter
        count: Number of emergencies to generate (for burst)
        source: "operator" (normal) or "intake" (simulated phone/walk-in alarm)

    Returns:
        List of created incidents
    """
    # Load settings
    settings_result = await db.execute(select(Setting))
    settings_rows = settings_result.scalars().all()
    settings = {s.key: s.value for s in settings_rows}

    generator = TrainingGenerator(db)
    incidents = []

    for _ in range(count):
        incident = await generator.generate_emergency(event_id, category, settings, source=source)
        incidents.append(incident)

    return incidents


async def generate_training_divera_emergency(
    db: AsyncSession,
    event_id: UUID,
    category: Literal["normal", "critical"] | None = None,
) -> DiveraEmergency:
    """Generate a simulated Divera alarm into the pool for a training event."""
    settings_result = await db.execute(select(Setting))
    settings = {s.key: s.value for s in settings_result.scalars().all()}

    generator = TrainingGenerator(db)
    return await generator.generate_pool_emergency(event_id, category, settings)


# ---------------------------------------------------------------------------
# Simulated field work, for the Übungssteuerung's injects (api/training_simulate.py)
# ---------------------------------------------------------------------------


async def has_vehicle(db: AsyncSession, incident: Incident) -> bool:
    """Is a vehicle actually with this crew — directly or through its Auftrag?

    An Auftrag owns its resources for every stop, so a stop with no assignment
    row of its own can still have a vehicle standing in front of it. Getting
    this wrong would strand a squad that has its Pio parked next to it.
    """
    direct = await db.execute(
        select(IncidentAssignment.id)
        .where(
            IncidentAssignment.incident_id == incident.id,
            IncidentAssignment.resource_type == "vehicle",
            IncidentAssignment.unassigned_at.is_(None),
        )
        .limit(1)
    )
    if direct.first() is not None:
        return True
    if incident.group_id is None:
        return False
    grouped = await db.execute(
        select(IncidentGroupAssignment.id)
        .where(
            IncidentGroupAssignment.incident_group_id == incident.group_id,
            IncidentGroupAssignment.resource_type == "vehicle",
            IncidentGroupAssignment.unassigned_at.is_(None),
        )
        .limit(1)
    )
    return grouped.first() is not None


def stranded_pickup_note(incident: Incident) -> str:
    """Why this crew is stuck, in the words the field would use.

    Two situations cover practically every real pickup: the Trupp walked there,
    or the vehicle that brought them drove on to the next Schadenplatz.
    """
    return "Trupp zu Fuss vor Ort" if incident.zu_fuss else "Fahrzeug ist weitergefahren"


async def simulated_material_units(db: AsyncSession, incident_id: UUID) -> list[dict[str, Any]]:
    """The checklist rows to answer, with the ``type`` the bucket rule needs.

    Released units included, the same as the real prefill: a pump that came back
    early still belongs in the record. ``Material.type`` is a
    station-configurable free string, which is why it travels to the generator
    instead of being mapped to an enum on the way.
    """
    result = await db.execute(
        select(IncidentAssignment.id, Material.name, Material.type, Material.consumable)
        .join(Material, Material.id == IncidentAssignment.resource_id)
        .where(
            IncidentAssignment.incident_id == incident_id,
            IncidentAssignment.resource_type == "material",
        )
        .order_by(Material.location_sort_order, Material.name)
    )
    return [
        {"assignment_id": assignment_id, "name": name, "type": material_type, "consumable": consumable}
        for assignment_id, name, material_type, consumable in result.all()
    ]


async def simulated_filer(
    db: AsyncSession,
    incident: Incident,
    current_user: User,
    rng: random.Random,
) -> feld_crud.FieldActor:
    """Who files this simulated rapport (§16.1): the EL 70 %, someone else 30 %.

    The leader comes from ``services.incident_leader`` through
    ``get_incident_leaders``, never from the raw ``is_leader`` flag — a
    completed incident has no active leader row left, and completed incidents
    are exactly the ones this inject exists for.

    An incident with nobody assigned falls back to the editor, which renders as
    "im KP erfasst". That is the truth of the situation and not worth faking.
    """
    leaders = await feld_crud.get_incident_leaders(db, [incident.id])
    leader = leaders.get(incident.id)

    crew_result = await db.execute(
        select(Personnel.id, Personnel.name)
        .join(IncidentAssignment, IncidentAssignment.resource_id == Personnel.id)
        .where(
            IncidentAssignment.incident_id == incident.id,
            IncidentAssignment.resource_type == "personnel",
        )
        .order_by(Personnel.name)
    )
    crew = sorted({(row[0], row[1]) for row in crew_result.all()}, key=lambda entry: entry[1])
    others = [entry for entry in crew if leader is None or entry[0] != leader[0]]

    if leader is not None and (not others or rng.random() < RAPPORT_SIM_PROFILE.filed_by_leader):
        return feld_crud.FieldActor(personnel_id=leader[0], personnel_name=leader[1])
    if others:
        personnel_id, name = rng.choice(others)
        return feld_crud.FieldActor(personnel_id=personnel_id, personnel_name=name)
    return feld_crud.FieldActor(user=current_user)


async def attach_simulated_rapport_photos(
    db: AsyncSession,
    incident: Incident,
    *,
    actor: feld_crud.FieldActor,
    request: Request,
) -> int:
    """Put 0-2 curated scene photos on the Schadenplatz-Rapport; returns how many.

    The same offline pool the simulated Reko reports draw from
    (``services/training_photos``), but through ``crud.feld.add_photo`` rather
    than the storage service directly: a rapport photo carries its own audit
    entry and its own ``updated_by``, and going around that door would leave a
    file on the report that nobody filed. So the exercise shows the KP a rapport
    photo that is indistinguishable from a crew's.

    Degrades to fewer or no photos on any per-file failure — a stripped or
    unreadable pool must never break the inject.
    """
    attached = 0
    for path in pick_pool_photos(incident.type):
        try:
            upload = UploadFile(file=BytesIO(path.read_bytes()), filename=path.name)
            await feld_crud.add_photo(db, incident, actor=actor, file=upload, request=request)
            attached += 1
        except Exception as exc:  # a bad pool image is not a failed exercise
            logger.warning("Skipping training pool photo %s for rapport: %s", path, exc)
    return attached


async def file_simulated_rapport(
    db: AsyncSession,
    incident: Incident,
    *,
    current_user: User,
    rng: random.Random,
    request: Request,
) -> SimulateRapportResponse:
    """Generate one plausible rapport and file it through the shared upsert.

    Everything the KP feels — the card badge, "Material zurück – freigeben", the
    Restliste, the Einsätze export — comes out of this one call, because it
    is the same ``save_rapport`` an operator and a crew both reach.

    Photos go on **before** the rapport is filed, which is the order a crew
    works in: they photograph the Schadenplatz while filling the form.
    """
    actor = await simulated_filer(db, incident, current_user, rng)
    photos = await attach_simulated_rapport_photos(db, incident, actor=actor, request=request)
    view = await feld_crud.get_rapport(db, incident, actor=actor)
    prefill = view["prefill"]
    units = await simulated_material_units(db, incident.id)

    data = generate_rapport_data(
        incident_type=incident.type,
        title=incident.title,
        description=incident.description,
        materials=units,
        # The prefilled checklist itself, which is what a crew answers against.
        # Only the rows the board dispatched (§18.33 put the whole fleet on the
        # list): a simulated crew correcting the board by unticking is realistic,
        # a simulated crew inventing a vehicle that was never sent is not.
        vehicles=[{"vehicle_id": row["vehicle_id"]} for row in view["vehicles"] if row["on_board"]],
        board_personnel_count=prefill["board_personnel_count"],
        rng=rng,
    )
    saved = await feld_crud.save_rapport(db, incident, actor=actor, payload=RapportUpdate(**data), request=request)

    ticked = sum(1 for row in saved["materials"] if row["used"] or row["left_on_site"])
    return SimulateRapportResponse(
        incident_id=incident.id,
        incident_title=incident.title,
        filed_by=actor.personnel_name,
        vehicles_present=sum(1 for row in saved["vehicles"] if row["present"]),
        materials_ticked=ticked,
        photos=photos,
        message=f"Rapport erfasst: {incident.location_address or incident.title}{actor.suffix}",
    )
