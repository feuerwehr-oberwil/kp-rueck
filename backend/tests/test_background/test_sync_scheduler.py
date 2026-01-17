"""Tests for the background sync scheduler.

Tests cover:
- scheduled_sync function behavior
- start_sync_scheduler initialization
- stop_sync_scheduler graceful shutdown
- Interval change detection and rescheduling
- Error handling during sync
"""

from unittest.mock import AsyncMock, MagicMock, patch
import pytest

from app.background import sync_scheduler
from app.background.sync_scheduler import (
    scheduled_sync,
    start_sync_scheduler,
    stop_sync_scheduler,
)


# ============================================
# Fixtures
# ============================================


@pytest.fixture(autouse=True)
def reset_scheduler_state():
    """Reset global scheduler state before each test."""
    sync_scheduler.scheduler = None
    sync_scheduler.last_interval_minutes = None
    sync_scheduler._shutting_down = False
    sync_scheduler._current_sync_task = None
    yield
    # Cleanup after test
    sync_scheduler.scheduler = None
    sync_scheduler.last_interval_minutes = None
    sync_scheduler._shutting_down = False
    sync_scheduler._current_sync_task = None


# ============================================
# scheduled_sync Tests
# ============================================


class TestScheduledSync:
    """Tests for the scheduled_sync function."""

    @pytest.mark.asyncio
    async def test_skips_sync_when_shutting_down(self):
        """Test that sync is skipped when shutdown flag is set."""
        sync_scheduler._shutting_down = True

        with patch("app.background.sync_scheduler.get_db") as mock_get_db:
            await scheduled_sync()
            # get_db should not be called when shutting down
            mock_get_db.assert_not_called()

    @pytest.mark.asyncio
    async def test_skips_sync_when_no_railway_url(self):
        """Test that sync is skipped when Railway URL is not configured."""
        mock_db = AsyncMock()

        async def mock_get_db_gen():
            yield mock_db

        with (
            patch("app.background.sync_scheduler.get_db", return_value=mock_get_db_gen()),
            patch(
                "app.background.sync_scheduler.get_setting_value",
                new_callable=AsyncMock,
                return_value="",
            ) as mock_setting,
            patch("app.background.sync_scheduler.create_sync_service") as mock_create,
        ):
            await scheduled_sync()
            # Should check for railway_database_url
            mock_setting.assert_called_once()
            # Should not create sync service when no URL
            mock_create.assert_not_called()

    @pytest.mark.asyncio
    async def test_skips_sync_when_railway_unhealthy(self):
        """Test that sync is skipped when Railway is unreachable."""
        mock_db = AsyncMock()
        mock_sync_service = AsyncMock()
        mock_sync_service.check_railway_health = AsyncMock(return_value=False)

        async def mock_get_db_gen():
            yield mock_db

        with (
            patch("app.background.sync_scheduler.get_db", return_value=mock_get_db_gen()),
            patch(
                "app.background.sync_scheduler.get_setting_value",
                new_callable=AsyncMock,
                side_effect=["postgresql://railway", "2"],
            ),
            patch(
                "app.background.sync_scheduler.create_sync_service",
                new_callable=AsyncMock,
                return_value=mock_sync_service,
            ),
        ):
            await scheduled_sync()
            mock_sync_service.check_railway_health.assert_called_once()
            # sync_bidirectional should not be called when unhealthy
            mock_sync_service.sync_bidirectional.assert_not_called()

    @pytest.mark.asyncio
    async def test_performs_bidirectional_sync_on_success(self):
        """Test successful bidirectional sync execution."""
        mock_db = AsyncMock()
        mock_sync_service = AsyncMock()
        mock_sync_service.check_railway_health = AsyncMock(return_value=True)
        mock_sync_service.sync_bidirectional = AsyncMock(
            return_value={
                "from_railway": MagicMock(success=True, records_synced={"incidents": 5}),
                "to_railway": MagicMock(success=True, records_synced={"incidents": 3}),
            }
        )

        async def mock_get_db_gen():
            yield mock_db

        with (
            patch("app.background.sync_scheduler.get_db", return_value=mock_get_db_gen()),
            patch(
                "app.background.sync_scheduler.get_setting_value",
                new_callable=AsyncMock,
                side_effect=["postgresql://railway", "2"],
            ),
            patch(
                "app.background.sync_scheduler.create_sync_service",
                new_callable=AsyncMock,
                return_value=mock_sync_service,
            ),
        ):
            await scheduled_sync()
            mock_sync_service.sync_bidirectional.assert_called_once()

    @pytest.mark.asyncio
    async def test_handles_sync_errors_gracefully(self):
        """Test that sync errors are caught and logged."""
        mock_db = AsyncMock()
        mock_sync_service = AsyncMock()
        mock_sync_service.check_railway_health = AsyncMock(return_value=True)
        mock_sync_service.sync_bidirectional = AsyncMock(side_effect=Exception("Sync failed"))

        async def mock_get_db_gen():
            yield mock_db

        with (
            patch("app.background.sync_scheduler.get_db", return_value=mock_get_db_gen()),
            patch(
                "app.background.sync_scheduler.get_setting_value",
                new_callable=AsyncMock,
                side_effect=["postgresql://railway", "2"],
            ),
            patch(
                "app.background.sync_scheduler.create_sync_service",
                new_callable=AsyncMock,
                return_value=mock_sync_service,
            ),
            patch("app.background.sync_scheduler.logger") as mock_logger,
        ):
            # Should not raise exception
            await scheduled_sync()
            # Should log the error
            mock_logger.error.assert_called()

    @pytest.mark.asyncio
    async def test_logs_partial_sync_errors(self):
        """Test that partial sync failures are logged."""
        mock_db = AsyncMock()
        mock_sync_service = AsyncMock()
        mock_sync_service.check_railway_health = AsyncMock(return_value=True)
        mock_sync_service.sync_bidirectional = AsyncMock(
            return_value={
                "from_railway": MagicMock(success=True, records_synced={"incidents": 5}),
                "to_railway": MagicMock(success=False, errors=["Connection failed"]),
            }
        )

        async def mock_get_db_gen():
            yield mock_db

        with (
            patch("app.background.sync_scheduler.get_db", return_value=mock_get_db_gen()),
            patch(
                "app.background.sync_scheduler.get_setting_value",
                new_callable=AsyncMock,
                side_effect=["postgresql://railway", "2"],
            ),
            patch(
                "app.background.sync_scheduler.create_sync_service",
                new_callable=AsyncMock,
                return_value=mock_sync_service,
            ),
            patch("app.background.sync_scheduler.logger") as mock_logger,
        ):
            await scheduled_sync()
            # Should log the partial error
            mock_logger.error.assert_called()


# ============================================
# Interval Change Detection Tests
# ============================================


class TestIntervalChangeDetection:
    """Tests for dynamic interval change detection."""

    @pytest.mark.asyncio
    async def test_detects_interval_change(self):
        """Test that interval changes are detected."""
        sync_scheduler.last_interval_minutes = 2
        mock_db = AsyncMock()

        async def mock_get_db_gen():
            yield mock_db

        with (
            patch("app.background.sync_scheduler.get_db", return_value=mock_get_db_gen()),
            patch(
                "app.background.sync_scheduler.get_setting_value",
                new_callable=AsyncMock,
                side_effect=["postgresql://railway", "5"],  # New interval: 5 minutes
            ),
            patch(
                "app.background.sync_scheduler.create_sync_service",
                new_callable=AsyncMock,
            ) as mock_create,
            patch("app.background.sync_scheduler.logger") as mock_logger,
        ):
            mock_sync_service = AsyncMock()
            mock_sync_service.check_railway_health = AsyncMock(return_value=False)
            mock_create.return_value = mock_sync_service

            await scheduled_sync()

            # Should log interval change
            assert any("interval changed" in str(call).lower() for call in mock_logger.info.call_args_list)
            # Should update last_interval_minutes
            assert sync_scheduler.last_interval_minutes == 5

    @pytest.mark.asyncio
    async def test_reschedules_job_on_interval_change(self):
        """Test that job is rescheduled when interval changes."""
        sync_scheduler.last_interval_minutes = 2
        mock_scheduler = MagicMock()
        mock_scheduler.running = True
        sync_scheduler.scheduler = mock_scheduler
        mock_db = AsyncMock()

        async def mock_get_db_gen():
            yield mock_db

        with (
            patch("app.background.sync_scheduler.get_db", return_value=mock_get_db_gen()),
            patch(
                "app.background.sync_scheduler.get_setting_value",
                new_callable=AsyncMock,
                side_effect=["postgresql://railway", "10"],  # New interval: 10 minutes
            ),
            patch(
                "app.background.sync_scheduler.create_sync_service",
                new_callable=AsyncMock,
            ) as mock_create,
        ):
            mock_sync_service = AsyncMock()
            mock_sync_service.check_railway_health = AsyncMock(return_value=False)
            mock_create.return_value = mock_sync_service

            await scheduled_sync()

            # Should reschedule the job
            mock_scheduler.reschedule_job.assert_called_once()
            call_args = mock_scheduler.reschedule_job.call_args
            assert call_args[0][0] == "railway_sync"


# ============================================
# start_sync_scheduler Tests
# ============================================


class TestStartSyncScheduler:
    """Tests for start_sync_scheduler function."""

    def test_creates_scheduler_instance(self):
        """Test that scheduler instance is created."""
        with patch("app.background.sync_scheduler.AsyncIOScheduler") as MockScheduler:
            mock_instance = MagicMock()
            MockScheduler.return_value = mock_instance

            start_sync_scheduler()

            MockScheduler.assert_called_once()
            assert sync_scheduler.scheduler == mock_instance

    def test_adds_sync_job(self):
        """Test that sync job is added to scheduler."""
        with patch("app.background.sync_scheduler.AsyncIOScheduler") as MockScheduler:
            mock_instance = MagicMock()
            MockScheduler.return_value = mock_instance

            start_sync_scheduler()

            mock_instance.add_job.assert_called_once()
            call_kwargs = mock_instance.add_job.call_args[1]
            assert call_kwargs["id"] == "railway_sync"
            assert call_kwargs["replace_existing"] is True

    def test_starts_scheduler(self):
        """Test that scheduler is started."""
        with patch("app.background.sync_scheduler.AsyncIOScheduler") as MockScheduler:
            mock_instance = MagicMock()
            MockScheduler.return_value = mock_instance

            start_sync_scheduler()

            mock_instance.start.assert_called_once()

    def test_initializes_last_interval(self):
        """Test that last_interval_minutes is initialized from settings."""
        with (
            patch("app.background.sync_scheduler.AsyncIOScheduler") as MockScheduler,
            patch("app.background.sync_scheduler.settings") as mock_settings,
        ):
            mock_settings.sync_interval_minutes = 5
            mock_instance = MagicMock()
            MockScheduler.return_value = mock_instance

            start_sync_scheduler()

            assert sync_scheduler.last_interval_minutes == 5


# ============================================
# stop_sync_scheduler Tests
# ============================================


class TestStopSyncScheduler:
    """Tests for stop_sync_scheduler function."""

    def test_sets_shutting_down_flag(self):
        """Test that shutdown flag is set."""
        mock_scheduler = MagicMock()
        mock_scheduler.running = True
        sync_scheduler.scheduler = mock_scheduler

        stop_sync_scheduler()

        assert sync_scheduler._shutting_down is True

    def test_stops_running_scheduler(self):
        """Test that running scheduler is stopped."""
        mock_scheduler = MagicMock()
        mock_scheduler.running = True
        sync_scheduler.scheduler = mock_scheduler

        stop_sync_scheduler()

        mock_scheduler.shutdown.assert_called_once_with(wait=True)

    def test_handles_shutdown_when_not_running(self):
        """Test handling when scheduler is not running."""
        sync_scheduler.scheduler = None

        # Should not raise exception
        stop_sync_scheduler()

        assert sync_scheduler._shutting_down is True

    def test_force_stops_on_graceful_failure(self):
        """Test that force shutdown is attempted on graceful failure."""
        mock_scheduler = MagicMock()
        mock_scheduler.running = True
        mock_scheduler.shutdown.side_effect = [Exception("Graceful failed"), None]
        sync_scheduler.scheduler = mock_scheduler

        stop_sync_scheduler()

        # Should be called twice: graceful then force
        assert mock_scheduler.shutdown.call_count == 2
        # Second call should be with wait=False
        mock_scheduler.shutdown.assert_called_with(wait=False)

    def test_handles_force_shutdown_failure(self):
        """Test handling when both graceful and force shutdown fail."""
        mock_scheduler = MagicMock()
        mock_scheduler.running = True
        mock_scheduler.shutdown.side_effect = [
            Exception("Graceful failed"),
            Exception("Force failed"),
        ]
        sync_scheduler.scheduler = mock_scheduler

        with patch("app.background.sync_scheduler.logger") as mock_logger:
            # Should not raise exception
            stop_sync_scheduler()

            # Should log the force shutdown error
            mock_logger.error.assert_called()


# ============================================
# Global State Tests
# ============================================


class TestGlobalState:
    """Tests for global state management."""

    def test_initial_state(self):
        """Test initial global state values."""
        # After reset from fixture
        assert sync_scheduler.scheduler is None
        assert sync_scheduler.last_interval_minutes is None
        assert sync_scheduler._shutting_down is False
        assert sync_scheduler._current_sync_task is None

    def test_scheduler_lifecycle(self):
        """Test full scheduler lifecycle: start -> stop."""
        with patch("app.background.sync_scheduler.AsyncIOScheduler") as MockScheduler:
            mock_instance = MagicMock()
            mock_instance.running = True
            MockScheduler.return_value = mock_instance

            # Start
            start_sync_scheduler()
            assert sync_scheduler.scheduler is not None

            # Stop
            stop_sync_scheduler()
            assert sync_scheduler._shutting_down is True
            mock_instance.shutdown.assert_called()
