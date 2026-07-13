"""Training emergency auto-generation service."""

import logging
import random
from typing import Literal
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import DiveraEmergency, EmergencyTemplate, Incident, Notification, Setting, TrainingLocation
from app.services.training_simulation_data import generate_intake_caller, vary_dispatch_numbers

logger = logging.getLogger(__name__)


class TrainingGenerator:
    """Generates realistic training emergencies."""

    def __init__(self, db: AsyncSession):
        self.db = db
        self._cache_templates: list[EmergencyTemplate] = []
        self._cache_locations: list[TrainingLocation] = []

    async def _load_templates(self):
        """Load all active emergency templates."""
        result = await self.db.execute(select(EmergencyTemplate).where(EmergencyTemplate.is_active))
        self._cache_templates = list(result.scalars().all())

    async def _load_locations(self):
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
            status="eingegangen",
            location_address=address,
            location_lat=latitude,
            location_lng=longitude,
            description=description,
            contact=contact,
            source=source,
        )
        self.db.add(incident)
        await self.db.commit()
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
            category = random.choices(["normal", "critical"], weights=[normal_weight, critical_weight], k=1)[0]

        # Filter templates by category
        templates = [t for t in self._cache_templates if t.category == category]
        if not templates:
            raise ValueError(f"No templates found for category: {category}")

        # Select random template and location. Avoid addresses already used by a
        # still-active incident in this event so two open alarms don't share an
        # address (the seeded location pool is small, so plain random.choice
        # collided often). Fall back to the full pool once it's exhausted.
        template = random.choice(templates)
        used_addresses = await self._active_addresses(event_id)
        free_locations = [
            loc for loc in self._cache_locations if loc.get_full_address() not in used_addresses
        ]
        location = random.choice(free_locations or self._cache_locations)

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
        notification = Notification(
            id=uuid4(),
            type="training_emergency",
            severity="critical" if category == "critical" else "warning",
            message=f"Neuer Übungs-Einsatz: {incident.title} ({full_address})",
            incident_id=incident.id,
            event_id=event_id,
            dismissed=False,
        )
        self.db.add(notification)
        await self.db.commit()

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

        notification = Notification(
            id=uuid4(),
            type="training_emergency",
            severity="critical" if template.category == "critical" else "warning",
            message=f"Neuer Übungs-Einsatz: {incident.title} ({incident.location_address})",
            incident_id=incident.id,
            event_id=event_id,
            dismissed=False,
        )
        self.db.add(notification)
        await self.db.commit()

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
            category = random.choices(["normal", "critical"], weights=[normal_weight, critical_weight], k=1)[0]

        templates = [t for t in self._cache_templates if t.category == category]
        if not templates:
            raise ValueError(f"No templates found for category: {category}")

        template = random.choice(templates)
        used_addresses = await self._active_addresses(event_id)
        free_locations = [
            loc for loc in self._cache_locations if loc.get_full_address() not in used_addresses
        ]
        location = random.choice(free_locations or self._cache_locations)

        # Negative divera_id keeps simulated alarms clear of real Divera IDs
        # (which are positive). Retry on the unlikely collision.
        divera_id = -random.randint(10_000_000, 2_000_000_000)
        for _ in range(5):
            existing = await self.db.execute(
                select(DiveraEmergency.id).where(DiveraEmergency.divera_id == divera_id)
            )
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
        await self.db.commit()
        await self.db.refresh(emergency)

        logger.info(
            "Simulated Divera alarm created: %s at %s (category: %s)",
            emergency.title,
            emergency.address,
            category,
        )
        return emergency

    async def _active_addresses(self, event_id: UUID) -> set[str]:
        """Addresses of still-active (not yet completed) incidents in the event."""
        result = await self.db.execute(
            select(Incident.location_address).where(
                Incident.event_id == event_id,
                Incident.completed_at.is_(None),
            )
        )
        return {addr for (addr,) in result.all() if addr}


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
