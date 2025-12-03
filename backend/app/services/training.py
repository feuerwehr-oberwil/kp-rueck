"""Training emergency auto-generation service."""
import random
import asyncio
from datetime import datetime, timedelta
from typing import Literal
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from uuid import UUID, uuid4

from app.models import (
    EmergencyTemplate,
    TrainingLocation,
    Incident,
    Event,
    Setting,
    Notification
)


class TrainingGenerator:
    """Generates realistic training emergencies."""

    def __init__(self, db: AsyncSession):
        self.db = db
        self._cache_templates: list[EmergencyTemplate] = []
        self._cache_locations: list[TrainingLocation] = []
        self._event_start_time: dict[UUID, datetime] = {}

    async def _load_templates(self):
        """Load all active emergency templates."""
        result = await self.db.execute(
            select(EmergencyTemplate).where(EmergencyTemplate.is_active == True)
        )
        self._cache_templates = list(result.scalars().all())

    async def _load_locations(self):
        """Load all active training locations."""
        result = await self.db.execute(
            select(TrainingLocation).where(TrainingLocation.is_active == True)
        )
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

    async def generate_emergency(
        self,
        event_id: UUID,
        category: Literal["normal", "critical"] | None = None,
        settings: dict[str, str] | None = None
    ) -> Incident:
        """
        Generate a random training emergency.

        Args:
            event_id: Training event to add incident to
            category: Force specific category, or None for weighted random
            settings: Auto-gen settings (weights, etc.)

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

        # Determine category (weighted random if not specified)
        if category is None:
            normal_weight = int(settings.get('training_normal_weight', 90)) if settings else 90
            critical_weight = int(settings.get('training_critical_weight', 10)) if settings else 10
            category = random.choices(
                ['normal', 'critical'],
                weights=[normal_weight, critical_weight],
                k=1
            )[0]

        # Filter templates by category
        templates = [t for t in self._cache_templates if t.category == category]
        if not templates:
            raise ValueError(f"No templates found for category: {category}")

        # Select random template and location
        template = random.choice(templates)
        location = random.choice(self._cache_locations)

        # Build full address
        full_address = location.get_full_address()

        # Determine priority based on template category
        # critical templates -> high priority, normal templates -> medium priority
        priority = "high" if category == "critical" else "medium"

        # Create incident
        incident = Incident(
            event_id=event_id,
            title=template.title_pattern,
            type=template.incident_type,
            priority=priority,
            status="eingegangen",
            location_address=full_address,
            location_lat=location.latitude,
            location_lng=location.longitude,
            description=template.message_pattern,
        )

        self.db.add(incident)
        await self.db.commit()
        await self.db.refresh(incident)

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
        print(f"✓ Training emergency created: {incident.title} at {full_address} (category: {category})")

        return incident

    async def start_auto_generation(
        self,
        event_id: UUID,
        settings: dict[str, str]
    ):
        """
        Start auto-generating emergencies for a training event.
        Runs in background until stopped.

        This is meant to be called as a background task.
        """
        # Store event start time
        self._event_start_time[event_id] = datetime.utcnow()

        min_interval = int(settings.get('training_autogen_min_interval_sec', 120))
        max_interval = int(settings.get('training_autogen_max_interval_sec', 420))
        early_multiplier = float(settings.get('training_early_multiplier', 2.0))

        while True:
            # Check if still enabled
            enabled_setting = await self._get_setting('training_autogen_enabled')
            if enabled_setting != 'true':
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
                print(f"Error generating emergency: {e}")
                continue

    async def _get_setting(self, key: str) -> str | None:
        """Helper to get setting value."""
        result = await self.db.execute(
            select(Setting).where(Setting.key == key)
        )
        setting = result.scalar_one_or_none()
        return setting.value if setting else None


async def generate_training_emergency(
    db: AsyncSession,
    event_id: UUID,
    category: Literal["normal", "critical"] | None = None,
    count: int = 1
) -> list[Incident]:
    """
    Generate one or more training emergencies.

    Args:
        db: Database session
        event_id: Training event ID
        category: Optional category filter
        count: Number of emergencies to generate (for burst)

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
        incident = await generator.generate_emergency(event_id, category, settings)
        incidents.append(incident)

    return incidents
