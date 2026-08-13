"""Tests for storage_usage — the measurement behind the disk-space alarm.

Covers what can be measured for real (a temporary photo tree, the live test database) and
the caching that keeps the ~10 s notification poll from re-walking either.
"""

from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.storage_usage import (
    BYTES_PER_GB,
    StorageUsage,
    _measure_database_bytes,
    _measure_tree_bytes,
    format_gb,
    get_storage_usage,
    reset_storage_usage_cache,
)


@pytest.fixture(autouse=True)
def _clear_cache():
    """The cache is process-wide; no test may inherit another's measurement."""
    reset_storage_usage_cache()
    yield
    reset_storage_usage_cache()


class TestMeasureTreeBytes:
    """Tests for the photo directory walk."""

    def test_sums_nested_files(self, tmp_path: Path):
        """Photos live one directory per incident, so the walk must recurse."""
        (tmp_path / "incident-a").mkdir()
        (tmp_path / "incident-a" / "one.jpg").write_bytes(b"x" * 1000)
        (tmp_path / "incident-b").mkdir()
        (tmp_path / "incident-b" / "two.jpg").write_bytes(b"x" * 2500)

        assert _measure_tree_bytes(tmp_path) == 3500

    def test_missing_directory_is_zero_not_failure(self, tmp_path: Path):
        """A station that has never had a Reko photo has zero bytes, not an error."""
        assert _measure_tree_bytes(tmp_path / "never-created") == 0

    def test_does_not_follow_directory_symlinks(self, tmp_path: Path):
        """A symlink out of the photo volume must not be counted into it."""
        outside = tmp_path / "outside"
        outside.mkdir()
        (outside / "big.bin").write_bytes(b"x" * 5000)

        photos = tmp_path / "photos"
        photos.mkdir()
        (photos / "real.jpg").write_bytes(b"x" * 100)
        (photos / "link").symlink_to(outside, target_is_directory=True)

        assert _measure_tree_bytes(photos) == 100


class TestMeasureDatabaseBytes:
    """Tests for pg_database_size against the real test database."""

    @pytest.mark.asyncio
    async def test_returns_positive_size(self, db_session: AsyncSession):
        size = await _measure_database_bytes(db_session)

        assert size is not None
        assert size > 0

    @pytest.mark.asyncio
    async def test_non_postgres_bind_is_not_queried(self):
        """Guarded, not attempted: a failing statement would abort the caller's transaction."""
        fake_session = SimpleNamespace(
            bind=SimpleNamespace(dialect=SimpleNamespace(name="sqlite")),
            execute=AsyncMock(),
        )

        assert await _measure_database_bytes(fake_session) is None  # type: ignore[arg-type]
        fake_session.execute.assert_not_awaited()


class TestGetStorageUsageCache:
    """Measuring on every poll from every board is the cost this cache exists to avoid."""

    @pytest.mark.asyncio
    async def test_second_call_reuses_measurement(self, db_session: AsyncSession):
        measure_db = AsyncMock(return_value=42)
        measure_photos = AsyncMock(return_value=7)

        with (
            patch("app.services.storage_usage._measure_database_bytes", measure_db),
            patch("app.services.storage_usage._measure_photo_bytes", measure_photos),
        ):
            first = await get_storage_usage(db_session)
            second = await get_storage_usage(db_session)

        assert first == second == StorageUsage(database_bytes=42, photo_bytes=7)
        assert measure_db.await_count == 1
        assert measure_photos.await_count == 1

    @pytest.mark.asyncio
    async def test_stale_cache_is_re_measured(self, db_session: AsyncSession):
        measure_db = AsyncMock(side_effect=[1, 2])
        measure_photos = AsyncMock(side_effect=[10, 20])

        with (
            patch("app.services.storage_usage._measure_database_bytes", measure_db),
            patch("app.services.storage_usage._measure_photo_bytes", measure_photos),
        ):
            await get_storage_usage(db_session)
            fresh = await get_storage_usage(db_session, max_age_seconds=0)

        assert fresh == StorageUsage(database_bytes=2, photo_bytes=20)


def test_format_gb_uses_german_decimal_comma():
    assert format_gb(int(6.5 * BYTES_PER_GB)) == "6,5"
    assert format_gb(0) == "0,0"
