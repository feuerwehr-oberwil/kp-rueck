"""Tests for the sync_service module.

Tests the bidirectional sync between Railway and Local databases including:
- Health checks
- Delta calculation
- Conflict resolution
- Sync operations (from/to Railway)
"""

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Event, Incident, Material, Personnel, Setting, SyncLog, User, Vehicle
from app.schemas import Delta, SyncDirection, SyncStatus
from app.services.sync_service import SyncService, create_sync_service


# ============================================
# Fixtures
# ============================================


@pytest_asyncio.fixture
async def sync_user(db_session: AsyncSession) -> User:
    """Create a test user for sync tests."""
    user = User(
        id=uuid4(),
        username="sync_test_user",
        password_hash="$2b$12$test",
        role="editor",
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest_asyncio.fixture
async def sync_event(db_session: AsyncSession, sync_user: User) -> Event:
    """Create a test event for sync tests."""
    event = Event(
        id=uuid4(),
        name="Sync Test Event",
        training_flag=False,
    )
    db_session.add(event)
    await db_session.commit()
    await db_session.refresh(event)
    return event


@pytest_asyncio.fixture
async def sync_personnel(db_session: AsyncSession) -> Personnel:
    """Create test personnel for sync tests."""
    personnel = Personnel(
        id=uuid4(),
        name="Sync Test Person",
        role="Einsatzleiter",
        availability="available",
    )
    db_session.add(personnel)
    await db_session.commit()
    await db_session.refresh(personnel)
    return personnel


@pytest_asyncio.fixture
async def sync_vehicle(db_session: AsyncSession) -> Vehicle:
    """Create test vehicle for sync tests."""
    vehicle = Vehicle(
        id=uuid4(),
        name="Sync Test Vehicle",
        type="TLF",
        status="available",
    )
    db_session.add(vehicle)
    await db_session.commit()
    await db_session.refresh(vehicle)
    return vehicle


@pytest_asyncio.fixture
async def sync_material(db_session: AsyncSession) -> Material:
    """Create test material for sync tests."""
    material = Material(
        id=uuid4(),
        name="Sync Test Material",
        type="Atemschutz",
        status="available",
    )
    db_session.add(material)
    await db_session.commit()
    await db_session.refresh(material)
    return material


@pytest_asyncio.fixture
async def sync_incident(db_session: AsyncSession, sync_event: Event, sync_user: User) -> Incident:
    """Create test incident for sync tests."""
    incident = Incident(
        id=uuid4(),
        title="Sync Test Incident",
        type="brandbekaempfung",
        priority="high",
        status="eingegangen",
        event_id=sync_event.id,
        created_by=sync_user.id,
    )
    db_session.add(incident)
    await db_session.commit()
    await db_session.refresh(incident)
    return incident


@pytest_asyncio.fixture
async def railway_url_setting(db_session: AsyncSession) -> Setting:
    """Create Railway database URL setting."""
    setting = Setting(
        key="railway_database_url",
        value="postgresql://user:pass@railway.host:5432/railway",
    )
    db_session.add(setting)
    await db_session.commit()
    return setting


@pytest_asyncio.fixture
async def conflict_buffer_setting(db_session: AsyncSession) -> Setting:
    """Create conflict buffer setting."""
    setting = Setting(
        key="sync_conflict_buffer_seconds",
        value="5",
    )
    db_session.add(setting)
    await db_session.commit()
    return setting


@pytest_asyncio.fixture
async def sync_service(db_session: AsyncSession) -> SyncService:
    """Create a SyncService instance."""
    return SyncService(db_session)


@pytest_asyncio.fixture
async def successful_sync_log(db_session: AsyncSession) -> SyncLog:
    """Create a successful sync log entry."""
    sync_log = SyncLog(
        sync_direction=SyncDirection.FROM_RAILWAY.value,
        status=SyncStatus.SUCCESS.value,
        records_synced={"events": 5, "incidents": 10},
        started_at=datetime.now(UTC) - timedelta(hours=1),
        completed_at=datetime.now(UTC) - timedelta(minutes=55),
    )
    db_session.add(sync_log)
    await db_session.commit()
    await db_session.refresh(sync_log)
    return sync_log


# ============================================
# Factory Function Tests
# ============================================


class TestCreateSyncService:
    """Tests for create_sync_service factory function."""

    @pytest.mark.asyncio
    async def test_create_sync_service_returns_instance(self, db_session: AsyncSession):
        """Test that factory returns SyncService instance."""
        service = await create_sync_service(db_session)
        assert isinstance(service, SyncService)
        assert service.db is db_session

    @pytest.mark.asyncio
    async def test_create_sync_service_initializes_fields(self, db_session: AsyncSession):
        """Test that factory initializes all fields correctly."""
        service = await create_sync_service(db_session)
        assert service._railway_database_url is None
        assert service._railway_engine is None
        assert service._conflict_buffer is None


# ============================================
# Configuration Tests
# ============================================


class TestSyncServiceConfiguration:
    """Tests for sync service configuration methods."""

    @pytest.mark.asyncio
    async def test_get_railway_database_url_from_settings(
        self, sync_service: SyncService, railway_url_setting: Setting
    ):
        """Test getting Railway URL from database settings."""
        url = await sync_service.get_railway_database_url()
        assert url == "postgresql://user:pass@railway.host:5432/railway"

    @pytest.mark.asyncio
    async def test_get_railway_database_url_caches_result(
        self, sync_service: SyncService, railway_url_setting: Setting
    ):
        """Test that Railway URL is cached after first fetch."""
        # First call
        url1 = await sync_service.get_railway_database_url()
        # Modify setting in cache directly
        sync_service._railway_database_url = "cached_url"
        # Second call should return cached value
        url2 = await sync_service.get_railway_database_url()
        assert url2 == "cached_url"

    @pytest.mark.asyncio
    async def test_get_railway_database_url_empty_when_not_configured(self, sync_service: SyncService):
        """Test empty URL when Railway not configured."""
        url = await sync_service.get_railway_database_url()
        assert url == ""

    @pytest.mark.asyncio
    async def test_get_conflict_buffer_from_settings(self, sync_service: SyncService, conflict_buffer_setting: Setting):
        """Test getting conflict buffer from database settings."""
        buffer = await sync_service.get_conflict_buffer()
        assert buffer == 5

    @pytest.mark.asyncio
    async def test_get_conflict_buffer_default_value(self, sync_service: SyncService):
        """Test default conflict buffer when not configured."""
        buffer = await sync_service.get_conflict_buffer()
        # Default is 5 seconds
        assert buffer == 5

    @pytest.mark.asyncio
    async def test_get_conflict_buffer_caches_result(self, sync_service: SyncService, conflict_buffer_setting: Setting):
        """Test that conflict buffer is cached."""
        buffer1 = await sync_service.get_conflict_buffer()
        sync_service._conflict_buffer = 99
        buffer2 = await sync_service.get_conflict_buffer()
        assert buffer2 == 99


# ============================================
# Railway Engine Tests
# ============================================


class TestRailwayEngine:
    """Tests for Railway database engine management."""

    @pytest.mark.asyncio
    async def test_get_railway_engine_returns_none_without_url(self, sync_service: SyncService):
        """Test engine is None when URL not configured."""
        engine = await sync_service.get_railway_engine()
        assert engine is None

    @pytest.mark.asyncio
    async def test_get_railway_engine_converts_postgresql_url(
        self, sync_service: SyncService, railway_url_setting: Setting
    ):
        """Test that postgresql:// is converted to postgresql+asyncpg://."""
        with patch("app.services.sync_service.create_async_engine") as mock_create:
            mock_create.return_value = MagicMock()
            await sync_service.get_railway_engine()

            # Check the URL was converted
            call_args = mock_create.call_args
            url_arg = call_args[0][0]
            assert "postgresql+asyncpg://" in url_arg

    @pytest.mark.asyncio
    async def test_get_railway_engine_caches_engine(self, sync_service: SyncService, railway_url_setting: Setting):
        """Test that engine is cached after creation."""
        with patch("app.services.sync_service.create_async_engine") as mock_create:
            mock_engine = MagicMock()
            mock_create.return_value = mock_engine

            engine1 = await sync_service.get_railway_engine()
            engine2 = await sync_service.get_railway_engine()

            # Should only create once
            assert mock_create.call_count == 1
            assert engine1 is engine2

    @pytest.mark.asyncio
    async def test_close_railway_connection(self, sync_service: SyncService, railway_url_setting: Setting):
        """Test closing Railway connection disposes engine."""
        with patch("app.services.sync_service.create_async_engine") as mock_create:
            mock_engine = AsyncMock()
            mock_create.return_value = mock_engine

            await sync_service.get_railway_engine()
            await sync_service.close_railway_connection()

            mock_engine.dispose.assert_called_once()
            assert sync_service._railway_engine is None

    @pytest.mark.asyncio
    async def test_close_railway_connection_does_nothing_when_no_engine(self, sync_service: SyncService):
        """Test close does nothing when no engine exists."""
        # Should not raise
        await sync_service.close_railway_connection()
        assert sync_service._railway_engine is None


# ============================================
# Health Check Tests
# ============================================


class TestCheckRailwayHealth:
    """Tests for Railway health check functionality."""

    @pytest.mark.asyncio
    async def test_check_health_returns_false_without_engine(self, sync_service: SyncService):
        """Test health check returns False when no engine."""
        result = await sync_service.check_railway_health()
        assert result is False

    @pytest.mark.asyncio
    async def test_check_health_returns_true_on_success(self, sync_service: SyncService, railway_url_setting: Setting):
        """Test health check returns True when connection succeeds."""
        with patch.object(sync_service, "get_railway_engine") as mock_get_engine:
            # Create proper async context manager mock
            mock_conn = AsyncMock()
            mock_conn.execute = AsyncMock()

            mock_conn_cm = AsyncMock()
            mock_conn_cm.__aenter__ = AsyncMock(return_value=mock_conn)
            mock_conn_cm.__aexit__ = AsyncMock(return_value=None)

            mock_engine = MagicMock()
            mock_engine.connect.return_value = mock_conn_cm
            mock_get_engine.return_value = mock_engine

            result = await sync_service.check_railway_health()
            assert result is True

    @pytest.mark.asyncio
    async def test_check_health_returns_false_on_connection_error(
        self, sync_service: SyncService, railway_url_setting: Setting
    ):
        """Test health check returns False when connection fails."""
        with patch.object(sync_service, "get_railway_engine") as mock_get_engine:
            mock_engine = AsyncMock()
            mock_engine.connect.side_effect = Exception("Connection refused")
            mock_get_engine.return_value = mock_engine

            result = await sync_service.check_railway_health()
            assert result is False


# ============================================
# Sync Log Tests
# ============================================


class TestGetLastSyncTime:
    """Tests for getting last sync time."""

    @pytest.mark.asyncio
    async def test_get_last_sync_time_returns_none_when_never_synced(self, sync_service: SyncService):
        """Test returns None when no sync has occurred."""
        result = await sync_service.get_last_sync_time(SyncDirection.FROM_RAILWAY)
        assert result is None

    @pytest.mark.asyncio
    async def test_get_last_sync_time_returns_completed_at(
        self, sync_service: SyncService, successful_sync_log: SyncLog
    ):
        """Test returns completed_at from last successful sync."""
        result = await sync_service.get_last_sync_time(SyncDirection.FROM_RAILWAY)
        assert result is not None
        assert result == successful_sync_log.completed_at

    @pytest.mark.asyncio
    async def test_get_last_sync_time_filters_by_direction(self, sync_service: SyncService, db_session: AsyncSession):
        """Test only returns sync logs for requested direction."""
        # Create FROM_RAILWAY log
        from_log = SyncLog(
            sync_direction=SyncDirection.FROM_RAILWAY.value,
            status=SyncStatus.SUCCESS.value,
            started_at=datetime.now(UTC) - timedelta(hours=2),
            completed_at=datetime.now(UTC) - timedelta(hours=1),
        )
        db_session.add(from_log)
        await db_session.commit()

        # Check TO_RAILWAY returns None (no logs in that direction)
        result = await sync_service.get_last_sync_time(SyncDirection.TO_RAILWAY)
        assert result is None

    @pytest.mark.asyncio
    async def test_get_last_sync_time_ignores_failed_syncs(self, sync_service: SyncService, db_session: AsyncSession):
        """Test ignores failed sync logs."""
        # Create failed sync log
        failed_log = SyncLog(
            sync_direction=SyncDirection.FROM_RAILWAY.value,
            status=SyncStatus.FAILED.value,
            started_at=datetime.now(UTC) - timedelta(hours=1),
            completed_at=datetime.now(UTC) - timedelta(minutes=55),
        )
        db_session.add(failed_log)
        await db_session.commit()

        result = await sync_service.get_last_sync_time(SyncDirection.FROM_RAILWAY)
        assert result is None  # Failed logs not returned


# ============================================
# Delta Tests
# ============================================


class TestGetSyncDeltaFromRailway:
    """Tests for getting sync delta from Railway."""

    @pytest.mark.asyncio
    async def test_get_delta_returns_empty_without_engine(self, sync_service: SyncService):
        """Test returns empty delta when no Railway engine."""
        delta = await sync_service.get_sync_delta_from_railway()
        assert delta.total_records == 0
        assert delta.events == []
        assert delta.incidents == []

    @pytest.mark.asyncio
    async def test_get_delta_fetches_all_records_on_first_sync(
        self, sync_service: SyncService, railway_url_setting: Setting
    ):
        """Test fetches all records when last_sync_time is None."""
        with patch.object(sync_service, "get_railway_engine") as mock_get_engine:
            # Mock Railway session with test data
            mock_engine = AsyncMock()
            mock_session = AsyncMock()

            # Mock count query
            mock_count_result = MagicMock()
            mock_count_result.scalar.return_value = 0

            # Mock select query
            mock_select_result = MagicMock()
            mock_select_result.scalars.return_value.all.return_value = []

            mock_session.execute.return_value = mock_count_result
            mock_engine.__aenter__ = AsyncMock(return_value=mock_session)
            mock_engine.__aexit__ = AsyncMock(return_value=None)

            # Patch AsyncSession context manager
            with patch("app.services.sync_service.AsyncSession") as mock_session_class:
                mock_session_class.return_value.__aenter__ = AsyncMock(return_value=mock_session)
                mock_session_class.return_value.__aexit__ = AsyncMock(return_value=None)
                mock_get_engine.return_value = mock_engine

                delta = await sync_service.get_sync_delta_from_railway(None)
                assert isinstance(delta, Delta)


# ============================================
# Apply Delta Tests
# ============================================


class TestApplyDelta:
    """Tests for applying sync delta to local database."""

    @pytest.mark.asyncio
    async def test_apply_delta_empty_delta(self, sync_service: SyncService):
        """Test applying empty delta returns zero counts."""
        delta = Delta()
        result = await sync_service.apply_delta(delta)

        assert result["events"] == 0
        assert result["incidents"] == 0
        assert result["personnel"] == 0
        assert result["vehicles"] == 0
        assert result["materials"] == 0
        assert result["settings"] == 0

    @pytest.mark.asyncio
    async def test_apply_delta_inserts_new_personnel(self, sync_service: SyncService, db_session: AsyncSession):
        """Test applying delta inserts new personnel records."""
        new_id = uuid4()
        delta = Delta(
            personnel=[
                {
                    "id": str(new_id),
                    "name": "New Person",
                    "role": "Atemschutz",
                    "availability": "available",
                    "updated_at": datetime.now(UTC).isoformat(),
                    "created_at": datetime.now(UTC).isoformat(),
                }
            ]
        )

        result = await sync_service.apply_delta(delta)
        assert result["personnel"] == 1

        # Verify in database
        db_result = await db_session.execute(select(Personnel).where(Personnel.id == new_id))
        person = db_result.scalar_one_or_none()
        assert person is not None
        assert person.name == "New Person"

    @pytest.mark.asyncio
    async def test_apply_delta_updates_existing_when_newer(
        self, sync_service: SyncService, sync_personnel: Personnel, conflict_buffer_setting: Setting
    ):
        """Test applying delta updates records when incoming is newer."""
        # Create delta with newer timestamp
        newer_time = datetime.now(UTC) + timedelta(minutes=10)
        delta = Delta(
            personnel=[
                {
                    "id": str(sync_personnel.id),
                    "name": "Updated Name",
                    "role": sync_personnel.role,
                    "availability": "unavailable",
                    "updated_at": newer_time.isoformat(),
                    "created_at": sync_personnel.created_at.isoformat(),
                }
            ]
        )

        result = await sync_service.apply_delta(delta)
        assert result["personnel"] == 1

    @pytest.mark.asyncio
    async def test_apply_delta_skips_when_within_conflict_buffer(
        self, sync_service: SyncService, sync_personnel: Personnel, conflict_buffer_setting: Setting
    ):
        """Test skips update when timestamps within conflict buffer (local wins)."""
        # Create delta with timestamp within buffer (5 seconds)
        same_time = sync_personnel.updated_at + timedelta(seconds=2)
        delta = Delta(
            personnel=[
                {
                    "id": str(sync_personnel.id),
                    "name": "Should Not Update",
                    "role": sync_personnel.role,
                    "availability": sync_personnel.availability,
                    "updated_at": same_time.isoformat(),
                    "created_at": sync_personnel.created_at.isoformat(),
                }
            ]
        )

        result = await sync_service.apply_delta(delta)
        # Should be skipped due to conflict buffer
        assert result["personnel"] == 0

    @pytest.mark.asyncio
    async def test_apply_delta_skips_record_without_id(self, sync_service: SyncService):
        """Test skips records without ID field."""
        delta = Delta(
            personnel=[
                {
                    "name": "No ID Person",
                    "role": "Test",
                    "availability": "available",
                }
            ]
        )

        result = await sync_service.apply_delta(delta)
        assert result["personnel"] == 0

    @pytest.mark.asyncio
    async def test_apply_delta_handles_integrity_errors(
        self, sync_service: SyncService, sync_event: Event, sync_user: User
    ):
        """Test handles integrity errors gracefully (e.g., foreign key violations)."""
        # Try to insert incident with non-existent event_id
        fake_event_id = uuid4()
        delta = Delta(
            incidents=[
                {
                    "id": str(uuid4()),
                    "title": "Bad Incident",
                    "type": "brandbekaempfung",
                    "priority": "high",
                    "status": "eingegangen",
                    "event_id": str(fake_event_id),  # Non-existent
                    "created_by": str(sync_user.id),
                    "updated_at": datetime.now(UTC).isoformat(),
                    "created_at": datetime.now(UTC).isoformat(),
                }
            ]
        )

        # Should not raise, should skip the record
        result = await sync_service.apply_delta(delta)
        # Count may be 0 due to integrity error
        assert "incidents" in result


# ============================================
# Sync From Railway Tests
# ============================================


class TestSyncFromRailway:
    """Tests for syncing from Railway to Local."""

    @pytest.mark.asyncio
    async def test_sync_from_railway_fails_when_unreachable(self, sync_service: SyncService, db_session: AsyncSession):
        """Test sync fails when Railway is unreachable."""
        with patch.object(sync_service, "check_railway_health", return_value=False):
            result = await sync_service.sync_from_railway()

            assert result.success is False
            assert result.direction == SyncDirection.FROM_RAILWAY
            assert "Railway is unreachable" in result.errors

    @pytest.mark.asyncio
    async def test_sync_from_railway_creates_sync_log(self, sync_service: SyncService, db_session: AsyncSession):
        """Test sync creates sync log entry."""
        with patch.object(sync_service, "check_railway_health", return_value=False):
            await sync_service.sync_from_railway()

            # Check sync log was created
            result = await db_session.execute(
                select(SyncLog).where(SyncLog.sync_direction == SyncDirection.FROM_RAILWAY.value)
            )
            logs = result.scalars().all()
            assert len(logs) > 0

    @pytest.mark.asyncio
    async def test_sync_from_railway_success_flow(self, sync_service: SyncService, db_session: AsyncSession):
        """Test successful sync from Railway."""
        with (
            patch.object(sync_service, "check_railway_health", return_value=True),
            patch.object(sync_service, "get_last_sync_time", return_value=None),
            patch.object(sync_service, "get_sync_delta_from_railway", return_value=Delta()),
            patch.object(
                sync_service,
                "apply_delta",
                return_value={
                    "events": 0,
                    "incidents": 0,
                    "personnel": 0,
                    "vehicles": 0,
                    "materials": 0,
                    "settings": 0,
                },
            ),
            patch.object(sync_service, "close_railway_connection", new_callable=AsyncMock),
        ):
            result = await sync_service.sync_from_railway()

            assert result.success is True
            assert result.direction == SyncDirection.FROM_RAILWAY

    @pytest.mark.asyncio
    async def test_sync_from_railway_closes_connection_on_success(self, sync_service: SyncService):
        """Test Railway connection is closed after successful sync."""
        close_mock = AsyncMock()
        with (
            patch.object(sync_service, "check_railway_health", return_value=True),
            patch.object(sync_service, "get_last_sync_time", return_value=None),
            patch.object(sync_service, "get_sync_delta_from_railway", return_value=Delta()),
            patch.object(sync_service, "apply_delta", return_value={}),
            patch.object(sync_service, "close_railway_connection", close_mock),
        ):
            await sync_service.sync_from_railway()
            close_mock.assert_called_once()

    @pytest.mark.asyncio
    async def test_sync_from_railway_closes_connection_on_error(self, sync_service: SyncService):
        """Test Railway connection is closed even when sync fails."""
        close_mock = AsyncMock()
        with (
            patch.object(sync_service, "check_railway_health", return_value=True),
            patch.object(sync_service, "get_last_sync_time", side_effect=Exception("Test error")),
            patch.object(sync_service, "close_railway_connection", close_mock),
        ):
            result = await sync_service.sync_from_railway()

            assert result.success is False
            close_mock.assert_called_once()


# ============================================
# Sync To Railway Tests
# ============================================


class TestSyncToRailway:
    """Tests for syncing from Local to Railway."""

    @pytest.mark.asyncio
    async def test_sync_to_railway_fails_when_unreachable(self, sync_service: SyncService):
        """Test sync fails when Railway is unreachable."""
        with patch.object(sync_service, "check_railway_health", return_value=False):
            result = await sync_service.sync_to_railway()

            assert result.success is False
            assert result.direction == SyncDirection.TO_RAILWAY
            assert "Railway is unreachable" in result.errors

    @pytest.mark.asyncio
    async def test_sync_to_railway_creates_sync_log(self, sync_service: SyncService, db_session: AsyncSession):
        """Test sync creates sync log entry."""
        with patch.object(sync_service, "check_railway_health", return_value=False):
            await sync_service.sync_to_railway()

            result = await db_session.execute(
                select(SyncLog).where(SyncLog.sync_direction == SyncDirection.TO_RAILWAY.value)
            )
            logs = result.scalars().all()
            assert len(logs) > 0

    @pytest.mark.asyncio
    async def test_sync_to_railway_fails_without_engine(self, sync_service: SyncService):
        """Test sync fails when engine not available."""
        with (
            patch.object(sync_service, "check_railway_health", return_value=True),
            patch.object(sync_service, "get_last_sync_time", return_value=None),
            patch.object(sync_service, "get_railway_engine", return_value=None),
        ):
            result = await sync_service.sync_to_railway()

            assert result.success is False
            assert "Railway database engine not available" in result.errors

    @pytest.mark.asyncio
    async def test_sync_to_railway_closes_connection_on_error(self, sync_service: SyncService):
        """Test Railway connection is closed even when sync fails."""
        close_mock = AsyncMock()
        with (
            patch.object(sync_service, "check_railway_health", return_value=True),
            patch.object(sync_service, "get_last_sync_time", side_effect=Exception("Test error")),
            patch.object(sync_service, "close_railway_connection", close_mock),
        ):
            result = await sync_service.sync_to_railway()

            assert result.success is False
            close_mock.assert_called_once()


# ============================================
# Bidirectional Sync Tests
# ============================================


class TestSyncBidirectional:
    """Tests for bidirectional sync."""

    @pytest.mark.asyncio
    async def test_bidirectional_sync_calls_both_directions(self, sync_service: SyncService):
        """Test bidirectional sync calls both from and to Railway."""
        from_result = MagicMock()
        from_result.success = True
        to_result = MagicMock()
        to_result.success = True

        with (
            patch.object(sync_service, "sync_from_railway", return_value=from_result) as from_mock,
            patch.object(sync_service, "sync_to_railway", return_value=to_result) as to_mock,
        ):
            results = await sync_service.sync_bidirectional()

            from_mock.assert_called_once()
            to_mock.assert_called_once()
            assert "from_railway" in results
            assert "to_railway" in results

    @pytest.mark.asyncio
    async def test_bidirectional_sync_returns_both_results(self, sync_service: SyncService):
        """Test bidirectional sync returns results for both directions."""
        from_result = MagicMock()
        from_result.success = True
        from_result.direction = SyncDirection.FROM_RAILWAY

        to_result = MagicMock()
        to_result.success = False
        to_result.direction = SyncDirection.TO_RAILWAY

        with (
            patch.object(sync_service, "sync_from_railway", return_value=from_result),
            patch.object(sync_service, "sync_to_railway", return_value=to_result),
        ):
            results = await sync_service.sync_bidirectional()

            assert results["from_railway"].success is True
            assert results["to_railway"].success is False

    @pytest.mark.asyncio
    async def test_bidirectional_sync_pulls_before_push(self, sync_service: SyncService):
        """Test pull from Railway happens before push to Railway."""
        call_order = []

        async def mock_from_railway():
            call_order.append("from")
            return MagicMock(success=True)

        async def mock_to_railway():
            call_order.append("to")
            return MagicMock(success=True)

        with (
            patch.object(sync_service, "sync_from_railway", mock_from_railway),
            patch.object(sync_service, "sync_to_railway", mock_to_railway),
        ):
            await sync_service.sync_bidirectional()

            assert call_order == ["from", "to"]


# ============================================
# Edge Cases and Error Handling Tests
# ============================================


class TestSyncEdgeCases:
    """Tests for edge cases and error handling."""

    @pytest.mark.asyncio
    async def test_syncable_models_constant(self, sync_service: SyncService):
        """Test SYNCABLE_MODELS contains expected tables."""
        expected_tables = {"events", "incidents", "personnel", "vehicles", "materials", "settings"}
        assert set(SyncService.SYNCABLE_MODELS.keys()) == expected_tables

    @pytest.mark.asyncio
    async def test_users_not_in_syncable_models(self, sync_service: SyncService):
        """Test users are NOT synced (per security design)."""
        assert "users" not in SyncService.SYNCABLE_MODELS

    @pytest.mark.asyncio
    async def test_apply_delta_handles_datetime_conversion(self, sync_service: SyncService, db_session: AsyncSession):
        """Test apply_delta converts ISO datetime strings back to datetime objects."""
        new_id = uuid4()
        now = datetime.now(UTC)
        delta = Delta(
            personnel=[
                {
                    "id": str(new_id),
                    "name": "DateTime Test",
                    "role": "Test",
                    "availability": "available",
                    "updated_at": now.isoformat(),
                    "created_at": now.isoformat(),
                }
            ]
        )

        await sync_service.apply_delta(delta)

        result = await db_session.execute(select(Personnel).where(Personnel.id == new_id))
        person = result.scalar_one_or_none()
        assert person is not None
        # Datetime should be stored properly
        assert isinstance(person.updated_at, datetime)

    @pytest.mark.asyncio
    async def test_sync_log_stores_error_details(self, sync_service: SyncService, db_session: AsyncSession):
        """Test sync log stores error details on failure."""
        with patch.object(sync_service, "check_railway_health", return_value=False):
            await sync_service.sync_from_railway()

            result = await db_session.execute(
                select(SyncLog)
                .where(SyncLog.sync_direction == SyncDirection.FROM_RAILWAY.value)
                .order_by(SyncLog.started_at.desc())
                .limit(1)
            )
            log = result.scalar_one()

            assert log.status == SyncStatus.FAILED.value
            assert log.errors is not None
            assert "error" in log.errors
