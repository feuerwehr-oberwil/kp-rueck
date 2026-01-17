"""Tests for the training emergency generator service.

Tests cover:
- TrainingGenerator class initialization
- Template and location loading
- Time weight calculation for early multiplier
- Emergency generation with category selection
- Notification creation on emergency generation
- generate_training_emergency module function
- Error handling for missing templates/locations
"""

from datetime import datetime, timedelta
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    EmergencyTemplate,
    Event,
    Incident,
    Notification,
    Setting,
    TrainingLocation,
)
from app.services.training import (
    TrainingGenerator,
    generate_training_emergency,
)


# ============================================
# Fixtures
# ============================================


@pytest_asyncio.fixture
async def training_event(db_session: AsyncSession) -> Event:
    """Create a training event."""
    event = Event(
        id=uuid4(),
        name="Training Generator Test Event",
        training_flag=True,
    )
    db_session.add(event)
    await db_session.commit()
    await db_session.refresh(event)
    return event


@pytest_asyncio.fixture
async def normal_event(db_session: AsyncSession) -> Event:
    """Create a non-training event."""
    event = Event(
        id=uuid4(),
        name="Normal Event",
        training_flag=False,
    )
    db_session.add(event)
    await db_session.commit()
    await db_session.refresh(event)
    return event


@pytest_asyncio.fixture
async def emergency_templates(db_session: AsyncSession) -> list[EmergencyTemplate]:
    """Create test emergency templates."""
    templates = [
        EmergencyTemplate(
            id=uuid4(),
            title_pattern="Wohnungsbrand",
            incident_type="brandbekaempfung",
            category="normal",
            message_pattern="Brand in Mehrfamilienhaus gemeldet",
            is_active=True,
        ),
        EmergencyTemplate(
            id=uuid4(),
            title_pattern="Verkehrsunfall eingeklemmt",
            incident_type="strassenrettung",
            category="critical",
            message_pattern="Person eingeklemmt nach Kollision",
            is_active=True,
        ),
        EmergencyTemplate(
            id=uuid4(),
            title_pattern="Inactive Template",
            incident_type="oelwehr",
            category="normal",
            message_pattern="Should not be used",
            is_active=False,
        ),
    ]
    for t in templates:
        db_session.add(t)
    await db_session.commit()
    return templates


@pytest_asyncio.fixture
async def training_locations(db_session: AsyncSession) -> list[TrainingLocation]:
    """Create test training locations."""
    locations = [
        TrainingLocation(
            id=uuid4(),
            street="Hauptstrasse",
            house_number="10",
            postal_code="4104",
            city="Oberwil",
            building_type="Wohnhaus",
            latitude=47.5123,
            longitude=7.5456,
            is_active=True,
        ),
        TrainingLocation(
            id=uuid4(),
            street="Bahnhofstrasse",
            house_number="22",
            postal_code="4104",
            city="Oberwil",
            building_type="Geschäft",
            latitude=47.5200,
            longitude=7.5500,
            is_active=True,
        ),
        TrainingLocation(
            id=uuid4(),
            street="Inactive Street",
            house_number="99",
            postal_code="4104",
            city="Oberwil",
            is_active=False,
        ),
    ]
    for loc in locations:
        db_session.add(loc)
    await db_session.commit()
    return locations


@pytest_asyncio.fixture
async def training_settings(db_session: AsyncSession) -> list[Setting]:
    """Create training auto-gen settings."""
    settings = [
        Setting(
            key="training_normal_weight",
            value="80",
        ),
        Setting(
            key="training_critical_weight",
            value="20",
        ),
        Setting(
            key="training_autogen_enabled",
            value="true",
        ),
        Setting(
            key="training_autogen_min_interval_sec",
            value="60",
        ),
        Setting(
            key="training_autogen_max_interval_sec",
            value="120",
        ),
        Setting(
            key="training_early_multiplier",
            value="2.0",
        ),
    ]
    for s in settings:
        db_session.add(s)
    await db_session.commit()
    return settings


# ============================================
# TrainingGenerator Initialization Tests
# ============================================


class TestTrainingGeneratorInit:
    """Tests for TrainingGenerator initialization."""

    @pytest.mark.asyncio
    async def test_init_creates_empty_caches(self, db_session: AsyncSession):
        """Test that generator initializes with empty caches."""
        generator = TrainingGenerator(db_session)

        assert generator.db is db_session
        assert generator._cache_templates == []
        assert generator._cache_locations == []
        assert generator._event_start_time == {}


# ============================================
# Template and Location Loading Tests
# ============================================


class TestTemplateLoading:
    """Tests for template and location loading."""

    @pytest.mark.asyncio
    async def test_load_templates_only_active(
        self, db_session: AsyncSession, emergency_templates: list[EmergencyTemplate]
    ):
        """Test that only active templates are loaded."""
        generator = TrainingGenerator(db_session)
        await generator._load_templates()

        # Should have 2 active templates (not the inactive one)
        assert len(generator._cache_templates) == 2
        titles = {t.title_pattern for t in generator._cache_templates}
        assert "Wohnungsbrand" in titles
        assert "Verkehrsunfall eingeklemmt" in titles
        assert "Inactive Template" not in titles

    @pytest.mark.asyncio
    async def test_load_locations_only_active(
        self, db_session: AsyncSession, training_locations: list[TrainingLocation]
    ):
        """Test that only active locations are loaded."""
        generator = TrainingGenerator(db_session)
        await generator._load_locations()

        # Should have 2 active locations
        assert len(generator._cache_locations) == 2
        streets = {loc.street for loc in generator._cache_locations}
        assert "Hauptstrasse" in streets
        assert "Bahnhofstrasse" in streets
        assert "Inactive Street" not in streets


# ============================================
# Time Weight Calculation Tests
# ============================================


class TestTimeWeightCalculation:
    """Tests for time-based weight calculation."""

    @pytest.mark.asyncio
    async def test_calculate_time_weight_no_start_time(self, db_session: AsyncSession):
        """Test weight calculation when no start time is recorded."""
        generator = TrainingGenerator(db_session)
        event_id = uuid4()

        weight = generator._calculate_time_weight(event_id, 2.0)
        assert weight == pytest.approx(2.0)  # Returns multiplier when no start time

    @pytest.mark.asyncio
    async def test_calculate_time_weight_at_start(self, db_session: AsyncSession):
        """Test weight calculation at event start (0 minutes)."""
        generator = TrainingGenerator(db_session)
        event_id = uuid4()
        generator._event_start_time[event_id] = datetime.utcnow()

        weight = generator._calculate_time_weight(event_id, 2.0)
        assert weight == pytest.approx(2.0)  # Full multiplier at start

    @pytest.mark.asyncio
    async def test_calculate_time_weight_halfway(self, db_session: AsyncSession):
        """Test weight calculation at 15 minutes (halfway through decay period)."""
        generator = TrainingGenerator(db_session)
        event_id = uuid4()
        # Set start time 15 minutes ago
        generator._event_start_time[event_id] = datetime.utcnow() - timedelta(minutes=15)

        weight = generator._calculate_time_weight(event_id, 2.0)
        # At 15 minutes: weight = 2.0 - ((2.0 - 1.0) * (15 / 30)) = 2.0 - 0.5 = 1.5
        assert 1.4 <= weight <= 1.6  # Allow small timing variance

    @pytest.mark.asyncio
    async def test_calculate_time_weight_after_30_minutes(self, db_session: AsyncSession):
        """Test weight calculation after 30+ minutes returns 1.0."""
        generator = TrainingGenerator(db_session)
        event_id = uuid4()
        # Set start time 45 minutes ago
        generator._event_start_time[event_id] = datetime.utcnow() - timedelta(minutes=45)

        weight = generator._calculate_time_weight(event_id, 2.0)
        assert weight == pytest.approx(1.0)


# ============================================
# Emergency Generation Tests
# ============================================


class TestEmergencyGeneration:
    """Tests for emergency generation."""

    @pytest.mark.asyncio
    async def test_generate_emergency_creates_incident(
        self,
        db_session: AsyncSession,
        training_event: Event,
        emergency_templates: list[EmergencyTemplate],
        training_locations: list[TrainingLocation],
    ):
        """Test that generate_emergency creates an incident."""
        generator = TrainingGenerator(db_session)
        incident = await generator.generate_emergency(training_event.id)

        assert incident is not None
        assert incident.id is not None
        assert incident.event_id == training_event.id
        assert incident.status == "eingegangen"

    @pytest.mark.asyncio
    async def test_generate_emergency_with_normal_category(
        self,
        db_session: AsyncSession,
        training_event: Event,
        emergency_templates: list[EmergencyTemplate],
        training_locations: list[TrainingLocation],
    ):
        """Test generating a normal category emergency."""
        generator = TrainingGenerator(db_session)
        incident = await generator.generate_emergency(training_event.id, category="normal")

        assert incident.priority == "medium"
        assert incident.type == "brandbekaempfung"  # Only normal template type

    @pytest.mark.asyncio
    async def test_generate_emergency_with_critical_category(
        self,
        db_session: AsyncSession,
        training_event: Event,
        emergency_templates: list[EmergencyTemplate],
        training_locations: list[TrainingLocation],
    ):
        """Test generating a critical category emergency."""
        generator = TrainingGenerator(db_session)
        incident = await generator.generate_emergency(training_event.id, category="critical")

        assert incident.priority == "high"
        assert incident.type == "strassenrettung"  # Only critical template type

    @pytest.mark.asyncio
    async def test_generate_emergency_uses_location(
        self,
        db_session: AsyncSession,
        training_event: Event,
        emergency_templates: list[EmergencyTemplate],
        training_locations: list[TrainingLocation],
    ):
        """Test that generated incident has location info."""
        generator = TrainingGenerator(db_session)
        incident = await generator.generate_emergency(training_event.id)

        assert incident.location_address is not None
        assert "4104" in incident.location_address or "Oberwil" in incident.location_address
        assert incident.location_lat is not None
        assert incident.location_lng is not None

    @pytest.mark.asyncio
    async def test_generate_emergency_creates_notification(
        self,
        db_session: AsyncSession,
        training_event: Event,
        emergency_templates: list[EmergencyTemplate],
        training_locations: list[TrainingLocation],
    ):
        """Test that generate_emergency creates a notification."""
        generator = TrainingGenerator(db_session)
        incident = await generator.generate_emergency(training_event.id)

        # Check notification was created
        result = await db_session.execute(
            select(Notification).where(Notification.incident_id == incident.id)
        )
        notification = result.scalar_one_or_none()

        assert notification is not None
        assert notification.type == "training_emergency"
        assert notification.event_id == training_event.id
        assert notification.dismissed is False

    @pytest.mark.asyncio
    async def test_generate_emergency_critical_notification_severity(
        self,
        db_session: AsyncSession,
        training_event: Event,
        emergency_templates: list[EmergencyTemplate],
        training_locations: list[TrainingLocation],
    ):
        """Test that critical incidents create critical notifications."""
        generator = TrainingGenerator(db_session)
        incident = await generator.generate_emergency(training_event.id, category="critical")

        result = await db_session.execute(
            select(Notification).where(Notification.incident_id == incident.id)
        )
        notification = result.scalar_one_or_none()
        assert notification.severity == "critical"

    @pytest.mark.asyncio
    async def test_generate_emergency_normal_notification_severity(
        self,
        db_session: AsyncSession,
        training_event: Event,
        emergency_templates: list[EmergencyTemplate],
        training_locations: list[TrainingLocation],
    ):
        """Test that normal incidents create warning notifications."""
        generator = TrainingGenerator(db_session)
        incident = await generator.generate_emergency(training_event.id, category="normal")

        result = await db_session.execute(
            select(Notification).where(Notification.incident_id == incident.id)
        )
        notification = result.scalar_one_or_none()
        assert notification.severity == "warning"

    @pytest.mark.asyncio
    async def test_generate_emergency_uses_settings(
        self,
        db_session: AsyncSession,
        training_event: Event,
        emergency_templates: list[EmergencyTemplate],
        training_locations: list[TrainingLocation],
    ):
        """Test that generate_emergency respects settings dict."""
        generator = TrainingGenerator(db_session)

        # Force 100% normal weight
        settings = {"training_normal_weight": "100", "training_critical_weight": "0"}
        incident = await generator.generate_emergency(training_event.id, settings=settings)

        # Should always be medium priority (normal)
        assert incident.priority == "medium"


# ============================================
# Error Handling Tests
# ============================================


class TestErrorHandling:
    """Tests for error handling in training generator."""

    @pytest.mark.asyncio
    async def test_generate_emergency_no_templates_error(
        self,
        db_session: AsyncSession,
        training_event: Event,
        training_locations: list[TrainingLocation],
    ):
        """Test error when no templates available."""
        generator = TrainingGenerator(db_session)

        with pytest.raises(ValueError, match="No emergency templates available"):
            await generator.generate_emergency(training_event.id)

    @pytest.mark.asyncio
    async def test_generate_emergency_no_locations_error(
        self,
        db_session: AsyncSession,
        training_event: Event,
        emergency_templates: list[EmergencyTemplate],
    ):
        """Test error when no locations available."""
        generator = TrainingGenerator(db_session)

        with pytest.raises(ValueError, match="No training locations available"):
            await generator.generate_emergency(training_event.id)

    @pytest.mark.asyncio
    async def test_generate_emergency_no_templates_for_category(
        self,
        db_session: AsyncSession,
        training_event: Event,
        training_locations: list[TrainingLocation],
    ):
        """Test error when no templates for requested category."""
        # Create only normal templates
        template = EmergencyTemplate(
            id=uuid4(),
            title_pattern="Normal Only",
            incident_type="brandbekaempfung",
            category="normal",
            message_pattern="Test",
            is_active=True,
        )
        db_session.add(template)
        await db_session.commit()

        generator = TrainingGenerator(db_session)

        with pytest.raises(ValueError, match="No templates found for category: critical"):
            await generator.generate_emergency(training_event.id, category="critical")


# ============================================
# Module Function Tests
# ============================================


class TestModuleFunctions:
    """Tests for module-level functions."""

    @pytest.mark.asyncio
    async def test_generate_training_emergency_single(
        self,
        db_session: AsyncSession,
        training_event: Event,
        emergency_templates: list[EmergencyTemplate],
        training_locations: list[TrainingLocation],
        training_settings: list[Setting],
    ):
        """Test generating a single training emergency."""
        incidents = await generate_training_emergency(db_session, training_event.id, count=1)

        assert len(incidents) == 1
        assert incidents[0].event_id == training_event.id

    @pytest.mark.asyncio
    async def test_generate_training_emergency_multiple(
        self,
        db_session: AsyncSession,
        training_event: Event,
        emergency_templates: list[EmergencyTemplate],
        training_locations: list[TrainingLocation],
        training_settings: list[Setting],
    ):
        """Test generating multiple training emergencies."""
        incidents = await generate_training_emergency(db_session, training_event.id, count=3)

        assert len(incidents) == 3
        for incident in incidents:
            assert incident.event_id == training_event.id

    @pytest.mark.asyncio
    async def test_generate_training_emergency_with_category(
        self,
        db_session: AsyncSession,
        training_event: Event,
        emergency_templates: list[EmergencyTemplate],
        training_locations: list[TrainingLocation],
        training_settings: list[Setting],
    ):
        """Test generating with specific category."""
        incidents = await generate_training_emergency(
            db_session, training_event.id, category="critical", count=2
        )

        assert len(incidents) == 2
        for incident in incidents:
            assert incident.priority == "high"

    @pytest.mark.asyncio
    async def test_generate_training_emergency_loads_settings(
        self,
        db_session: AsyncSession,
        training_event: Event,
        emergency_templates: list[EmergencyTemplate],
        training_locations: list[TrainingLocation],
        training_settings: list[Setting],
    ):
        """Test that module function loads settings from database."""
        # Settings have 80/20 normal/critical weight
        # Generate several incidents, most should be normal
        incidents = await generate_training_emergency(db_session, training_event.id, count=10)

        normal_count = sum(1 for i in incidents if i.priority == "medium")
        # With 80/20 weights, expect roughly 8 normal incidents (allow variance)
        assert normal_count >= 5  # At least half should be normal


# ============================================
# Get Setting Helper Tests
# ============================================


class TestGetSettingHelper:
    """Tests for _get_setting helper method."""

    @pytest.mark.asyncio
    async def test_get_setting_returns_value(
        self, db_session: AsyncSession, training_settings: list[Setting]
    ):
        """Test getting an existing setting."""
        generator = TrainingGenerator(db_session)
        value = await generator._get_setting("training_autogen_enabled")
        assert value == "true"

    @pytest.mark.asyncio
    async def test_get_setting_returns_none_for_missing(self, db_session: AsyncSession):
        """Test getting a non-existent setting returns None."""
        generator = TrainingGenerator(db_session)
        value = await generator._get_setting("nonexistent_setting")
        assert value is None


# ============================================
# Cache Behavior Tests
# ============================================


class TestCacheBehavior:
    """Tests for template/location caching."""

    @pytest.mark.asyncio
    async def test_templates_cached_on_first_generate(
        self,
        db_session: AsyncSession,
        training_event: Event,
        emergency_templates: list[EmergencyTemplate],
        training_locations: list[TrainingLocation],
    ):
        """Test that templates are cached after first generation."""
        generator = TrainingGenerator(db_session)

        # Initially empty
        assert generator._cache_templates == []

        # Generate first incident
        await generator.generate_emergency(training_event.id)

        # Cache should be populated
        assert len(generator._cache_templates) == 2

    @pytest.mark.asyncio
    async def test_locations_cached_on_first_generate(
        self,
        db_session: AsyncSession,
        training_event: Event,
        emergency_templates: list[EmergencyTemplate],
        training_locations: list[TrainingLocation],
    ):
        """Test that locations are cached after first generation."""
        generator = TrainingGenerator(db_session)

        # Initially empty
        assert generator._cache_locations == []

        # Generate first incident
        await generator.generate_emergency(training_event.id)

        # Cache should be populated
        assert len(generator._cache_locations) == 2

    @pytest.mark.asyncio
    async def test_second_generate_uses_cache(
        self,
        db_session: AsyncSession,
        training_event: Event,
        emergency_templates: list[EmergencyTemplate],
        training_locations: list[TrainingLocation],
    ):
        """Test that second generation uses cached data."""
        generator = TrainingGenerator(db_session)

        # Generate first incident (populates cache)
        await generator.generate_emergency(training_event.id)

        # Pre-fill cache with known values
        original_templates = generator._cache_templates.copy()

        # Generate second incident
        await generator.generate_emergency(training_event.id)

        # Cache should be same object (not reloaded)
        assert generator._cache_templates == original_templates
