"""Tests for the training_autogen_task service module.

Tests background task management for training emergency auto-generation including:
- Task lifecycle (start/stop)
- Settings checking and parsing
- Auto-generation logic and intervals
- Boost period calculations
- Max emergency limits
"""

import asyncio
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Event, Incident, Setting, User
from app.services.training_autogen_task import TrainingAutoGenTask


# ============================================
# Fixtures
# ============================================


@pytest_asyncio.fixture
async def autogen_user(db_session: AsyncSession) -> User:
    """Create a test user for autogen tests."""
    user = User(
        id=uuid4(),
        username="autogen_test_user",
        password_hash="$2b$12$test",
        role="editor",
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest_asyncio.fixture
async def training_event(db_session: AsyncSession) -> Event:
    """Create a training event for autogen tests."""
    event = Event(
        id=uuid4(),
        name="Auto-gen Test Event",
        training_flag=True,
        # archived_at=None means not archived
    )
    db_session.add(event)
    await db_session.commit()
    await db_session.refresh(event)
    return event


@pytest_asyncio.fixture
async def non_training_event(db_session: AsyncSession) -> Event:
    """Create a non-training event for autogen tests."""
    event = Event(
        id=uuid4(),
        name="Live Event",
        training_flag=False,
    )
    db_session.add(event)
    await db_session.commit()
    await db_session.refresh(event)
    return event


@pytest_asyncio.fixture
async def archived_training_event(db_session: AsyncSession) -> Event:
    """Create an archived training event."""
    event = Event(
        id=uuid4(),
        name="Archived Training",
        training_flag=True,
        archived_at=datetime.now(UTC),  # Not None means archived
    )
    db_session.add(event)
    await db_session.commit()
    await db_session.refresh(event)
    return event


@pytest_asyncio.fixture
async def autogen_settings_enabled(db_session: AsyncSession) -> list[Setting]:
    """Create enabled auto-gen settings."""
    settings = [
        Setting(key="training_autogen_enabled", value="true"),
        Setting(key="training_autogen_interval_min", value="5"),
        Setting(key="training_boost_multiplicator", value="2.0"),
        Setting(key="training_boost_duration_min", value="30"),
        Setting(key="training_autogen_max_emergencies", value="50"),
    ]
    for s in settings:
        db_session.add(s)
    await db_session.commit()
    return settings


@pytest_asyncio.fixture
async def autogen_settings_disabled(db_session: AsyncSession) -> list[Setting]:
    """Create disabled auto-gen settings."""
    settings = [
        Setting(key="training_autogen_enabled", value="false"),
    ]
    for s in settings:
        db_session.add(s)
    await db_session.commit()
    return settings


# ============================================
# TrainingAutoGenTask Init Tests
# ============================================


class TestTrainingAutoGenTaskInit:
    """Tests for TrainingAutoGenTask initialization."""

    def test_initial_state(self):
        """Test task starts in correct initial state."""
        task = TrainingAutoGenTask()
        assert task.running is False
        assert task.task is None
        assert task.current_event_id is None

    def test_multiple_instances(self):
        """Test multiple instances are independent."""
        task1 = TrainingAutoGenTask()
        task2 = TrainingAutoGenTask()
        task1.running = True
        assert task2.running is False


# ============================================
# Start/Stop Tests
# ============================================


class TestStartStop:
    """Tests for start and stop methods."""

    @pytest.mark.asyncio
    async def test_start_sets_running_true(self):
        """Test start sets running flag to True."""
        task = TrainingAutoGenTask()
        with patch.object(task, "_monitor_loop", new_callable=AsyncMock):
            await task.start()
            try:
                assert task.running is True
            finally:
                await task.stop()

    @pytest.mark.asyncio
    async def test_start_creates_task(self):
        """Test start creates an asyncio task."""
        task = TrainingAutoGenTask()
        with patch.object(task, "_monitor_loop", new_callable=AsyncMock):
            await task.start()
            try:
                assert task.task is not None
            finally:
                await task.stop()

    @pytest.mark.asyncio
    async def test_start_is_idempotent(self):
        """Test calling start twice doesn't create duplicate tasks."""
        task = TrainingAutoGenTask()
        with patch.object(task, "_monitor_loop", new_callable=AsyncMock) as mock_loop:
            await task.start()
            original_task = task.task
            await task.start()  # Second call
            try:
                assert task.task is original_task
                # Only one task should be created
            finally:
                await task.stop()

    @pytest.mark.asyncio
    async def test_stop_sets_running_false(self):
        """Test stop sets running flag to False."""
        task = TrainingAutoGenTask()
        with patch.object(task, "_monitor_loop", new_callable=AsyncMock):
            await task.start()
            await task.stop()
            assert task.running is False

    @pytest.mark.asyncio
    async def test_stop_cancels_task(self):
        """Test stop cancels the running task."""
        task = TrainingAutoGenTask()

        async def fake_loop():
            while task.running:
                await asyncio.sleep(0.1)

        with patch.object(task, "_monitor_loop", side_effect=fake_loop):
            await task.start()
            await task.stop()
            # Task should be cancelled

    @pytest.mark.asyncio
    async def test_stop_handles_no_task(self):
        """Test stop handles case when no task is running."""
        task = TrainingAutoGenTask()
        # Should not raise
        await task.stop()
        assert task.running is False


# ============================================
# _check_and_run Logic Tests
# ============================================


class TestCheckAndRunLogic:
    """Tests for _check_and_run method logic."""

    @pytest.mark.asyncio
    async def test_disabled_autogen_clears_event_id(
        self, db_session: AsyncSession, autogen_settings_disabled: list[Setting]
    ):
        """Test disabled auto-gen clears current_event_id."""
        task = TrainingAutoGenTask()
        task.current_event_id = uuid4()  # Set a current event

        await task._check_and_run(db_session)

        assert task.current_event_id is None

    @pytest.mark.asyncio
    async def test_no_settings_treated_as_disabled(self, db_session: AsyncSession):
        """Test no settings means auto-gen is disabled."""
        task = TrainingAutoGenTask()
        task.current_event_id = uuid4()

        await task._check_and_run(db_session)

        assert task.current_event_id is None

    @pytest.mark.asyncio
    async def test_uses_default_settings(
        self, db_session: AsyncSession, training_event: Event
    ):
        """Test uses default values when settings not specified."""
        # Only enable auto-gen, other settings use defaults
        setting = Setting(key="training_autogen_enabled", value="true")
        db_session.add(setting)
        await db_session.commit()

        task = TrainingAutoGenTask()

        # Mock the generator to prevent actual generation
        with patch("app.services.training_autogen_task.TrainingGenerator") as MockGen:
            mock_instance = MagicMock()
            mock_instance.generate_emergency = AsyncMock(return_value=MagicMock(title="Test"))
            MockGen.return_value = mock_instance

            await task._check_and_run(db_session)

            # Should have called generator (no incidents yet)
            MockGen.assert_called_once()

    @pytest.mark.asyncio
    async def test_respects_max_emergencies_limit(
        self, db_session: AsyncSession, training_event: Event, autogen_user: User, autogen_settings_enabled: list[Setting]
    ):
        """Test stops generation when max emergencies reached."""
        # Update max to 2
        max_setting = await db_session.get(Setting, "training_autogen_max_emergencies")
        max_setting.value = "2"
        await db_session.commit()

        # Create 2 incidents (at max)
        for i in range(2):
            incident = Incident(
                id=uuid4(),
                title=f"Incident {i}",
                type="brandbekaempfung",
                priority="medium",
                status="eingegangen",
                event_id=training_event.id,
                created_by=autogen_user.id,
            )
            db_session.add(incident)
        await db_session.commit()

        task = TrainingAutoGenTask()
        task.current_event_id = training_event.id

        with patch("app.services.training_autogen_task.TrainingGenerator") as MockGen:
            await task._check_and_run(db_session)
            # Should not generate - max reached
            MockGen.assert_not_called()

        # current_event_id should be cleared
        assert task.current_event_id is None

    @pytest.mark.asyncio
    async def test_generates_first_incident(
        self, db_session: AsyncSession, training_event: Event, autogen_settings_enabled: list[Setting]
    ):
        """Test generates first incident when none exist."""
        task = TrainingAutoGenTask()

        with patch("app.services.training_autogen_task.TrainingGenerator") as MockGen:
            mock_instance = MagicMock()
            mock_incident = MagicMock(title="Generated Incident")
            mock_instance.generate_emergency = AsyncMock(return_value=mock_incident)
            MockGen.return_value = mock_instance

            await task._check_and_run(db_session)

            MockGen.assert_called_once()
            mock_instance.generate_emergency.assert_called_once()

    @pytest.mark.asyncio
    async def test_respects_interval(
        self, db_session: AsyncSession, training_event: Event, autogen_user: User, autogen_settings_enabled: list[Setting]
    ):
        """Test respects interval between generations."""
        # Create recent incident (within interval)
        recent_incident = Incident(
            id=uuid4(),
            title="Recent Incident",
            type="brandbekaempfung",
            priority="medium",
            status="eingegangen",
            event_id=training_event.id,
            created_by=autogen_user.id,
            created_at=datetime.now(UTC) - timedelta(minutes=2),  # 2 min ago, interval is 5
        )
        db_session.add(recent_incident)
        await db_session.commit()

        task = TrainingAutoGenTask()

        with patch("app.services.training_autogen_task.TrainingGenerator") as MockGen:
            await task._check_and_run(db_session)
            # Should not generate - too soon
            MockGen.assert_not_called()

    @pytest.mark.asyncio
    async def test_generates_after_interval(
        self, db_session: AsyncSession, training_event: Event, autogen_user: User, autogen_settings_enabled: list[Setting]
    ):
        """Test generates after interval has passed."""
        # Create old incident (past interval)
        old_incident = Incident(
            id=uuid4(),
            title="Old Incident",
            type="brandbekaempfung",
            priority="medium",
            status="eingegangen",
            event_id=training_event.id,
            created_by=autogen_user.id,
            created_at=datetime.now(UTC) - timedelta(minutes=10),  # 10 min ago, interval is 5
        )
        db_session.add(old_incident)
        await db_session.commit()

        task = TrainingAutoGenTask()

        with patch("app.services.training_autogen_task.TrainingGenerator") as MockGen:
            mock_instance = MagicMock()
            mock_incident = MagicMock(title="New Incident")
            mock_instance.generate_emergency = AsyncMock(return_value=mock_incident)
            MockGen.return_value = mock_instance

            await task._check_and_run(db_session)

            MockGen.assert_called_once()


# ============================================
# Boost Period Tests
# ============================================


class TestBoostPeriod:
    """Tests for boost period interval calculations."""

    @pytest.mark.asyncio
    async def test_boost_reduces_interval_for_new_event(
        self, db_session: AsyncSession, autogen_user: User, autogen_settings_enabled: list[Setting]
    ):
        """Test boost period reduces interval for newly created events."""
        # Create very recent event (within boost period)
        new_event = Event(
            id=uuid4(),
            name="New Training Event",
            training_flag=True,
            created_at=datetime.now(UTC) - timedelta(minutes=5),  # 5 min old, boost is 30 min
        )
        db_session.add(new_event)

        # Create incident just after normal interval but within boosted interval
        # Normal interval: 5 min
        # Boosted interval: 5/2.0 = 2.5 min
        incident = Incident(
            id=uuid4(),
            title="Recent Incident",
            type="brandbekaempfung",
            priority="medium",
            status="eingegangen",
            event_id=new_event.id,
            created_by=autogen_user.id,
            created_at=datetime.now(UTC) - timedelta(minutes=3),  # 3 min ago
        )
        db_session.add(incident)
        await db_session.commit()

        task = TrainingAutoGenTask()

        with patch("app.services.training_autogen_task.TrainingGenerator") as MockGen:
            mock_instance = MagicMock()
            mock_incident = MagicMock(title="Boosted Incident")
            mock_instance.generate_emergency = AsyncMock(return_value=mock_incident)
            MockGen.return_value = mock_instance

            await task._check_and_run(db_session)

            # With boost: 3 min > 2.5 min boosted interval, should generate
            MockGen.assert_called_once()

    @pytest.mark.asyncio
    async def test_no_boost_for_old_event(
        self, db_session: AsyncSession, autogen_user: User, autogen_settings_enabled: list[Setting]
    ):
        """Test no boost for events older than boost duration."""
        # Create old event (past boost period)
        old_event = Event(
            id=uuid4(),
            name="Old Training Event",
            training_flag=True,
            created_at=datetime.now(UTC) - timedelta(hours=1),  # 1 hour old, boost is 30 min
        )
        db_session.add(old_event)

        # Create incident at 3 min ago - should not generate without boost
        incident = Incident(
            id=uuid4(),
            title="Recent Incident",
            type="brandbekaempfung",
            priority="medium",
            status="eingegangen",
            event_id=old_event.id,
            created_by=autogen_user.id,
            created_at=datetime.now(UTC) - timedelta(minutes=3),  # 3 min ago
        )
        db_session.add(incident)
        await db_session.commit()

        task = TrainingAutoGenTask()

        with patch("app.services.training_autogen_task.TrainingGenerator") as MockGen:
            await task._check_and_run(db_session)

            # Without boost: 3 min < 5 min normal interval, should NOT generate
            MockGen.assert_not_called()


# ============================================
# Error Handling Tests
# ============================================


class TestErrorHandling:
    """Tests for error handling in auto-generation."""

    @pytest.mark.asyncio
    async def test_handles_generator_error(
        self, db_session: AsyncSession, training_event: Event, autogen_settings_enabled: list[Setting]
    ):
        """Test handles errors from generator gracefully."""
        task = TrainingAutoGenTask()

        with patch("app.services.training_autogen_task.TrainingGenerator") as MockGen:
            mock_instance = MagicMock()
            mock_instance.generate_emergency = AsyncMock(side_effect=Exception("Generation failed"))
            MockGen.return_value = mock_instance

            # Should not raise
            await task._check_and_run(db_session)


# ============================================
# Edge Cases
# ============================================


class TestEdgeCases:
    """Tests for edge cases in auto-generation."""

    @pytest.mark.asyncio
    async def test_handles_missing_event(
        self, db_session: AsyncSession, autogen_settings_enabled: list[Setting]
    ):
        """Test handles case when no training event exists."""
        task = TrainingAutoGenTask()
        task.current_event_id = uuid4()

        await task._check_and_run(db_session)

        # Should clear event ID when no event found
        assert task.current_event_id is None

    @pytest.mark.asyncio
    async def test_ignores_non_training_events(
        self, db_session: AsyncSession, non_training_event: Event, autogen_settings_enabled: list[Setting]
    ):
        """Test ignores non-training events."""
        task = TrainingAutoGenTask()

        with patch("app.services.training_autogen_task.TrainingGenerator") as MockGen:
            await task._check_and_run(db_session)
            # Should not generate for non-training event
            MockGen.assert_not_called()

    @pytest.mark.asyncio
    async def test_settings_passed_to_generator(
        self, db_session: AsyncSession, training_event: Event, autogen_settings_enabled: list[Setting]
    ):
        """Test settings are passed to the generator."""
        task = TrainingAutoGenTask()

        with patch("app.services.training_autogen_task.TrainingGenerator") as MockGen:
            mock_instance = MagicMock()
            mock_incident = MagicMock(title="Test")
            mock_instance.generate_emergency = AsyncMock(return_value=mock_incident)
            MockGen.return_value = mock_instance

            await task._check_and_run(db_session)

            # Check settings were passed
            call_args = mock_instance.generate_emergency.call_args
            assert "settings" in call_args.kwargs
            settings_dict = call_args.kwargs["settings"]
            assert "training_autogen_enabled" in settings_dict
