"""Training emergency auto-generation service."""

import asyncio
import logging
import random
from datetime import datetime
from typing import Literal
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import EmergencyTemplate, Event, Incident, Notification, Setting, TrainingLocation
from app.services.training_simulation_data import generate_intake_caller, vary_dispatch_numbers

logger = logging.getLogger(__name__)


class TrainingGenerator:
    """Generates realistic training emergencies."""

    def __init__(self, db: AsyncSession):
        self.db = db
        self._cache_templates: list[EmergencyTemplate] = []
        self._cache_locations: list[TrainingLocation] = []
        self._event_start_time: dict[UUID, datetime] = {}

    async def _load_templates(self):
        """Load all active emergency templates."""
        result = await self.db.execute(select(EmergencyTemplate).where(EmergencyTemplate.is_active))
        self._cache_templates = list(result.scalars().all())

    async def _load_locations(self):
        """Load all active training locations."""
        result = await self.db.execute(select(TrainingLocation).where(TrainingLocation.is_active))
        self._cache_locations = list(result.scalars().all())

    def _calculate_time_weight(self, event_id: UUID, early_multiplier: float) -> float:
        """
        Calculate weight based on elapsed time since event creation.
        More incidents at beginning of exercise.
        """
        if event_id not in self._event_start_time:
            return early_multiplier

        elapsed = datetime.utcnow() - self._event_start_time[event_id]
        elapsed_minutes = elapsed.total_seconds() / 60

        # Linear decay from multiplier to 1.0 over first 30 minutes
        if elapsed_minutes < 30:
            weight = early_multiplier - ((early_multiplier - 1.0) * (elapsed_minutes / 30))
            return max(1.0, weight)

        return 1.0

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

    async def start_auto_generation(self, event_id: UUID, settings: dict[str, str]):
        """
        Start auto-generating emergencies for a training event.
        Runs in background until stopped.

        This is meant to be called as a background task.
        """
        # Store event start time
        self._event_start_time[event_id] = datetime.utcnow()

        min_interval = int(settings.get("training_autogen_min_interval_sec", 120))
        max_interval = int(settings.get("training_autogen_max_interval_sec", 420))
        early_multiplier = float(settings.get("training_early_multiplier", 2.0))

        while True:
            # Check if still enabled
            enabled_setting = await self._get_setting("training_autogen_enabled")
            if enabled_setting != "true":
                break

            # Check if event still exists and is training
            event = await self.db.get(Event, event_id)
            if not event or not event.training_flag:
                break

            # Calculate weighted interval (shorter at beginning)
            time_weight = self._calculate_time_weight(event_id, early_multiplier)
            adjusted_min = int(min_interval / time_weight)
            adjusted_max = int(max_interval / time_weight)

            wait_seconds = random.randint(adjusted_min, adjusted_max)
            await asyncio.sleep(wait_seconds)

            # Generate emergency
            try:
                await self.generate_emergency(event_id, settings=settings)
            except Exception as e:
                logger.error("Error generating emergency: %s", e)
                continue

    async def _active_addresses(self, event_id: UUID) -> set[str]:
        """Addresses of still-active (not yet completed) incidents in the event."""
        result = await self.db.execute(
            select(Incident.location_address).where(
                Incident.event_id == event_id,
                Incident.completed_at.is_(None),
            )
        )
        return {addr for (addr,) in result.all() if addr}

    async def _get_setting(self, key: str) -> str | None:
        """Helper to get setting value."""
        result = await self.db.execute(select(Setting).where(Setting.key == key))
        setting = result.scalar_one_or_none()
        return setting.value if setting else None


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
