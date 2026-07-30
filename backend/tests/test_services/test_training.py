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

import io
import random
import re
import uuid
from pathlib import Path
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
from app.seed_training import FALLBACK_TRAINING_LOCATIONS, LEGACY_FALLBACK_COORDINATES, TRAINING_AREA_BOUNDS
from app.services import training_photos
from app.services.photo_storage import photo_storage
from app.services.training import (
    TrainingGenerator,
    generate_training_emergency,
)
from app.services.training_photos import attach_training_photos, pick_pool_photos


def test_fallback_training_locations_are_unique_and_inside_oberwil_bounds():
    keys = {(street, house_number) for street, house_number, *_ in FALLBACK_TRAINING_LOCATIONS}

    assert len(FALLBACK_TRAINING_LOCATIONS) > 1
    assert len(keys) == len(FALLBACK_TRAINING_LOCATIONS)
    for _, _, _, latitude, longitude in FALLBACK_TRAINING_LOCATIONS:
        assert TRAINING_AREA_BOUNDS["min_lat"] <= latitude <= TRAINING_AREA_BOUNDS["max_lat"]
        assert TRAINING_AREA_BOUNDS["min_lon"] <= longitude <= TRAINING_AREA_BOUNDS["max_lon"]
        assert (latitude, longitude) != LEGACY_FALLBACK_COORDINATES


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
# Simulated Divera Pool Emergency Tests
# ============================================


class TestPoolEmergencyGeneration:
    """Tests for simulated Divera alarms injected into the pool."""

    @pytest.mark.asyncio
    async def test_generate_pool_emergency(
        self,
        db_session: AsyncSession,
        training_event,
        emergency_templates,
        training_locations,
    ):
        """A pool emergency is training-marked, unattached and has a negative ID."""
        generator = TrainingGenerator(db_session)
        emergency = await generator.generate_pool_emergency(training_event.id, category="normal")

        assert emergency.is_training is True
        assert emergency.divera_id < 0
        assert emergency.attached_to_event_id is None
        assert emergency.title
        assert emergency.address
        assert emergency.raw_payload_json["simulated"] is True
        assert emergency.raw_payload_json["training_event_id"] == str(training_event.id)

    @pytest.mark.asyncio
    async def test_generate_pool_emergency_creates_no_incident_or_notification(
        self,
        db_session: AsyncSession,
        training_event,
        emergency_templates,
        training_locations,
    ):
        """Pool injection must NOT put anything on the board or ring the bell —
        discovering the alarm via the pool is the exercise."""
        from sqlalchemy import func

        generator = TrainingGenerator(db_session)
        await generator.generate_pool_emergency(training_event.id, category="normal")

        incident_count = (
            await db_session.execute(
                select(func.count()).select_from(Incident).where(Incident.event_id == training_event.id)
            )
        ).scalar_one()
        notification_count = (await db_session.execute(select(func.count()).select_from(Notification))).scalar_one()
        assert incident_count == 0
        assert notification_count == 0

    @pytest.mark.asyncio
    async def test_generate_pool_emergency_critical_category(
        self,
        db_session: AsyncSession,
        training_event,
        emergency_templates,
        training_locations,
    ):
        """Forcing the critical category picks a critical template."""
        generator = TrainingGenerator(db_session)
        emergency = await generator.generate_pool_emergency(training_event.id, category="critical")
        assert emergency.raw_payload_json["category"] == "critical"


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
        assert incident.status == "incoming"

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

        assert incident.priority == "low"
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
        result = await db_session.execute(select(Notification).where(Notification.incident_id == incident.id))
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

        result = await db_session.execute(select(Notification).where(Notification.incident_id == incident.id))
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

        result = await db_session.execute(select(Notification).where(Notification.incident_id == incident.id))
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

        # Should always be low priority (normal)
        assert incident.priority == "low"


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
        incidents = await generate_training_emergency(db_session, training_event.id, category="critical", count=2)

        assert len(incidents) == 2
        for incident in incidents:
            assert incident.priority == "high"

    @pytest.mark.asyncio
    async def test_generate_training_emergency_intake_is_noncritical_with_caller(
        self,
        db_session: AsyncSession,
        training_event: Event,
        emergency_templates: list[EmergencyTemplate],
        training_locations: list[TrainingLocation],
        training_settings: list[Setting],
    ):
        """Telefon (intake) alarms are non-critical and carry a fake caller.

        Citizens phone in the non-critical stuff; a real fire goes to official
        dispatch. So intake forces normal scenarios and attaches a Melder
        (contact) plus a context line on the description for realism.
        """
        incidents = await generate_training_emergency(db_session, training_event.id, count=5, source="intake")

        assert len(incidents) == 5
        for incident in incidents:
            assert incident.source == "intake"
            # Non-critical only -> normal templates -> low priority
            assert incident.priority == "low"
            # Caller info present: "Name Surname, 07x xxx xx xx"
            assert incident.contact is not None
            assert "," in incident.contact
            assert any(ch.isdigit() for ch in incident.contact)
            # A context line was appended to the scenario description
            assert incident.description

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
        # Seeded on purpose. The generator draws from the configured 80/20 weights, so ten
        # draws land below five "normal" roughly once every 150 runs — and this assertion had
        # already gone red in CI while passing locally. A weighted draw is exactly the thing
        # you must pin in a test: the point here is that the WEIGHTS get loaded, not that the
        # RNG behaves, and a gate that fails 1-in-150 for no reason teaches people to re-run
        # rather than read.
        random.seed(20260726)

        # Settings have 80/20 normal/critical weight
        # Generate several incidents, most should be normal
        incidents = await generate_training_emergency(db_session, training_event.id, count=10)

        normal_count = sum(1 for i in incidents if i.priority == "low")
        # With 80/20 weights, expect roughly 8 normal incidents (allow variance)
        assert normal_count >= 5  # At least half should be normal


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


# ============================================
# Title + message variations (multi-variant spawn pool)
# ============================================


@pytest_asyncio.fixture
async def template_with_variations(db_session: AsyncSession) -> EmergencyTemplate:
    """A template that has alternate titles + messages."""
    tpl = EmergencyTemplate(
        id=uuid4(),
        title_pattern="Wohnungsbrand",
        incident_type="brandbekaempfung",
        category="normal",
        message_pattern="Brand in MFH gemeldet, Wohnung 2. OG.",
        title_variations=["Brand in Wohnung", "Rauch aus Wohnung"],
        message_variations=[
            "Starke Rauchentwicklung, Personen evtl. noch drin.",
            "Bewohnerin meldet Brand, ist bereits draussen.",
        ],
        is_active=True,
    )
    db_session.add(tpl)
    await db_session.commit()
    await db_session.refresh(tpl)
    return tpl


class TestTitleAndMessageVariations:
    def test_pick_title_includes_pattern_and_variations(self, template_with_variations: EmergencyTemplate):
        # Run 200 picks and assert every value lands in the union pool, and
        # both pattern + variations are represented (statistically certain).
        seen = {TrainingGenerator._pick_title(template_with_variations) for _ in range(200)}
        expected_pool = {"Wohnungsbrand", "Brand in Wohnung", "Rauch aus Wohnung"}
        assert seen == expected_pool

    def test_pick_message_includes_pattern_and_variations(self, template_with_variations: EmergencyTemplate):
        seen = {TrainingGenerator._pick_message(template_with_variations) for _ in range(200)}
        expected_pool = {
            "Brand in MFH gemeldet, Wohnung 2. OG.",
            "Starke Rauchentwicklung, Personen evtl. noch drin.",
            "Bewohnerin meldet Brand, ist bereits draussen.",
        }
        assert seen == expected_pool

    def test_pick_title_no_variations_returns_pattern(self):
        # Backwards compat: template without variations always returns pattern.
        tpl = EmergencyTemplate(
            id=uuid4(),
            title_pattern="Solo",
            incident_type="oelwehr",
            category="normal",
            message_pattern="x",
            title_variations=None,
            message_variations=None,
            is_active=True,
        )
        assert {TrainingGenerator._pick_title(tpl) for _ in range(20)} == {"Solo"}
        assert {TrainingGenerator._pick_message(tpl) for _ in range(20)} == {"x"}


class TestDispatchSpecific:
    @pytest.mark.asyncio
    async def test_dispatch_specific_uses_given_template_and_location(
        self,
        db_session: AsyncSession,
        training_event: Event,
        template_with_variations: EmergencyTemplate,
        training_locations: list[TrainingLocation],
    ):
        chosen_location = training_locations[0]
        generator = TrainingGenerator(db_session)

        incident = await generator.dispatch_specific(
            training_event.id, template_with_variations, location=chosen_location
        )

        assert incident.type == template_with_variations.incident_type
        assert incident.location_address == chosen_location.get_full_address()
        assert float(incident.location_lat) == pytest.approx(float(chosen_location.latitude), abs=1e-4)
        # priority derived from category
        assert incident.priority == ("high" if template_with_variations.category == "critical" else "low")
        # title + message must come from the variations pool
        assert incident.title in {"Wohnungsbrand", "Brand in Wohnung", "Rauch aus Wohnung"}

    @pytest.mark.asyncio
    async def test_dispatch_specific_with_map_pin_override(
        self,
        db_session: AsyncSession,
        training_event: Event,
        template_with_variations: EmergencyTemplate,
    ):
        """Trainer-dropped pin: free-form coords + address bypass TrainingLocation."""
        generator = TrainingGenerator(db_session)

        incident = await generator.dispatch_specific(
            training_event.id,
            template_with_variations,
            location_override=("Bielstrasse 7, 4104 Oberwil", 47.5188, 7.5499),
        )

        assert incident.location_address == "Bielstrasse 7, 4104 Oberwil"
        assert float(incident.location_lat) == pytest.approx(47.5188, abs=1e-4)
        assert float(incident.location_lng) == pytest.approx(7.5499, abs=1e-4)
        assert incident.type == template_with_variations.incident_type

    @pytest.mark.asyncio
    async def test_dispatch_specific_requires_one_location_source(
        self,
        db_session: AsyncSession,
        training_event: Event,
        template_with_variations: EmergencyTemplate,
    ):
        generator = TrainingGenerator(db_session)
        with pytest.raises(ValueError, match="location"):
            await generator.dispatch_specific(training_event.id, template_with_variations)

    @pytest.mark.asyncio
    async def test_dispatch_specific_emits_notification(
        self,
        db_session: AsyncSession,
        training_event: Event,
        template_with_variations: EmergencyTemplate,
        training_locations: list[TrainingLocation],
    ):
        generator = TrainingGenerator(db_session)
        await generator.dispatch_specific(training_event.id, template_with_variations, location=training_locations[0])

        result = await db_session.execute(select(Notification).where(Notification.event_id == training_event.id))
        notes = list(result.scalars().all())
        assert len(notes) == 1
        assert notes[0].type == "training_emergency"
        assert training_locations[0].street in notes[0].message


# ============================================
# Training Photo Pool (simulated Reko photos)
# ============================================
#
# Uses a stubbed pool directory (tmp_path) — these tests must not depend on
# the committed images in app/assets/training_photos, because brigades may
# strip those assets entirely.

# Same filename contract the real upload endpoint produces and the serving
# endpoint (get_photo_path) enforces.
UUID_JPG = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$")


def _make_jpeg(path: Path, size: tuple[int, int] = (64, 48)) -> None:
    """Write a small valid JPEG to `path`."""
    from PIL import Image

    path.parent.mkdir(parents=True, exist_ok=True)
    img = Image.new("RGB", size, (200, 30, 30))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    path.write_bytes(buf.getvalue())


@pytest.fixture
def pool_dir(tmp_path: Path) -> Path:
    """A stubbed photo pool with images for two incident types."""
    pool = tmp_path / "pool"
    for i in range(1, 4):
        _make_jpeg(pool / "brandbekaempfung" / f"{i:02d}.jpg")
        _make_jpeg(pool / "chemiewehr" / f"{i:02d}.jpg")
    return pool


@pytest.fixture
def photos_dir(tmp_path: Path, monkeypatch) -> Path:
    """Redirect the PhotoStorageService singleton to a temp photos dir."""
    target = tmp_path / "photos"
    monkeypatch.setattr(photo_storage, "photos_dir", target)
    return target


@pytest.fixture
def always_two_photos(monkeypatch):
    """Force the weighted photo count to always pick 2."""
    monkeypatch.setattr(training_photos, "_PHOTO_COUNT_WEIGHTS", (0, 0, 1))


class TestPickPoolPhotos:
    """Pool selection: type matching, aliases, graceful absence."""

    @pytest.mark.unit
    def test_returns_empty_for_missing_pool(self, tmp_path: Path):
        assert pick_pool_photos("brandbekaempfung", pool_dir=tmp_path / "does-not-exist") == []

    @pytest.mark.unit
    def test_returns_empty_for_missing_type_dir(self, pool_dir: Path):
        assert pick_pool_photos("oelwehr", pool_dir=pool_dir) == []

    @pytest.mark.unit
    def test_returns_empty_for_empty_type_dir(self, pool_dir: Path):
        (pool_dir / "oelwehr").mkdir()
        assert pick_pool_photos("oelwehr", pool_dir=pool_dir) == []

    @pytest.mark.unit
    def test_returns_empty_for_none_type(self, pool_dir: Path):
        assert pick_pool_photos(None, pool_dir=pool_dir) == []

    @pytest.mark.unit
    def test_selects_from_matching_type_dir(self, pool_dir: Path, always_two_photos):
        photos = pick_pool_photos("brandbekaempfung", pool_dir=pool_dir)
        assert len(photos) == 2
        assert all(p.parent.name == "brandbekaempfung" for p in photos)
        assert len(set(photos)) == 2  # no duplicate picks within one report

    @pytest.mark.unit
    def test_uses_alias_for_types_without_own_pool(self, pool_dir: Path, always_two_photos):
        """strahlenwehr has no own pool and borrows chemiewehr's."""
        photos = pick_pool_photos("strahlenwehr", pool_dir=pool_dir)
        assert len(photos) == 2
        assert all(p.parent.name == "chemiewehr" for p in photos)

    @pytest.mark.unit
    def test_own_pool_wins_over_alias(self, pool_dir: Path, always_two_photos):
        """An aliased type with its own images uses those, not the sibling's."""
        for i in range(1, 4):
            _make_jpeg(pool_dir / "strahlenwehr" / f"{i:02d}.jpg")
        photos = pick_pool_photos("strahlenwehr", pool_dir=pool_dir)
        assert len(photos) == 2
        assert all(p.parent.name == "strahlenwehr" for p in photos)

    @pytest.mark.unit
    def test_can_return_zero_photos(self, pool_dir: Path, monkeypatch):
        monkeypatch.setattr(training_photos, "_PHOTO_COUNT_WEIGHTS", (1, 0, 0))
        assert pick_pool_photos("brandbekaempfung", pool_dir=pool_dir) == []


class TestAttachTrainingPhotos:
    """Copying pool photos through the real PhotoStorageService path."""

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_stores_photos_in_incident_dir(self, pool_dir: Path, photos_dir: Path, always_two_photos):
        incident_id = uuid.uuid4()
        filenames = await attach_training_photos(incident_id, "brandbekaempfung", pool_dir=pool_dir)

        assert len(filenames) == 2
        for filename in filenames:
            # Same photos_json entry shape as the real upload endpoint: a
            # plain UUID.jpg filename string.
            assert UUID_JPG.match(filename)
            # File lands in the per-incident directory, exactly like uploads.
            file_path = photos_dir / str(incident_id) / filename
            assert file_path.exists()
            # And is served through the same path-validating accessor.
            assert photo_storage.get_photo_path(incident_id, filename) == file_path

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_photos_are_valid_jpegs(self, pool_dir: Path, photos_dir: Path, always_two_photos):
        from PIL import Image

        incident_id = uuid.uuid4()
        filenames = await attach_training_photos(incident_id, "brandbekaempfung", pool_dir=pool_dir)
        for filename in filenames:
            with Image.open(photos_dir / str(incident_id) / filename) as img:
                assert img.format == "JPEG"

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_degrades_gracefully_without_pool(self, tmp_path: Path, photos_dir: Path, always_two_photos):
        """A stripped/missing pool must yield no photos, not an error."""
        incident_id = uuid.uuid4()
        filenames = await attach_training_photos(incident_id, "brandbekaempfung", pool_dir=tmp_path / "gone")
        assert filenames == []
        assert not (photos_dir / str(incident_id)).exists()

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_skips_corrupt_pool_images(self, tmp_path: Path, photos_dir: Path, always_two_photos):
        """Unreadable pool files are skipped without breaking the simulation."""
        pool = tmp_path / "pool"
        (pool / "brandbekaempfung").mkdir(parents=True)
        (pool / "brandbekaempfung" / "01.jpg").write_bytes(b"not a jpeg at all")
        (pool / "brandbekaempfung" / "02.jpg").write_bytes(b"still not a jpeg")

        filenames = await attach_training_photos(uuid.uuid4(), "brandbekaempfung", pool_dir=pool)
        assert filenames == []

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_respects_existing_photo_count_limit(
        self, pool_dir: Path, photos_dir: Path, always_two_photos, monkeypatch
    ):
        """The max-photos-per-report guard of the real upload path applies."""
        monkeypatch.setattr(photo_storage, "max_photos", 1)
        filenames = await attach_training_photos(
            uuid.uuid4(), "brandbekaempfung", current_photos=["existing.jpg"], pool_dir=pool_dir
        )
        assert filenames == []  # limit reached -> save_photo refuses, we degrade
