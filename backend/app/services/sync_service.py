"""Bidirectional sync service for Railway ↔ Local synchronization."""
import asyncio
from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import Incident, Material, Personnel, Setting, SyncLog, Vehicle
from app.schemas import Delta, SyncDirection, SyncResult, SyncStatus


class SyncService:
    """Service for bidirectional synchronization between Railway and Local."""

    # Syncable tables and their models
    SYNCABLE_MODELS = {
        "incidents": Incident,
        "personnel": Personnel,
        "vehicles": Vehicle,
        "materials": Material,
        "settings": Setting,
    }

    def __init__(self, db: AsyncSession):
        """Initialize sync service with database session."""
        self.db = db

    async def check_railway_health(self) -> bool:
        """
        Check if Railway is reachable and healthy.

        Returns:
            bool: True if Railway is healthy, False otherwise.
        """
        if not settings.railway_url:
            return False

        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(
                    f"{settings.railway_url}/api/health",
                    timeout=5.0
                )
                return response.status_code == 200
        except (httpx.RequestError, httpx.TimeoutException):
            return False

    async def get_last_sync_time(self, direction: SyncDirection) -> Optional[datetime]:
        """
        Get timestamp of last successful sync in given direction.

        Args:
            direction: Sync direction to check.

        Returns:
            Datetime of last sync or None if never synced.
        """
        result = await self.db.execute(
            select(SyncLog)
            .where(
                SyncLog.sync_direction == direction.value,
                SyncLog.status == SyncStatus.SUCCESS.value
            )
            .order_by(SyncLog.completed_at.desc())
            .limit(1)
        )
        last_sync = result.scalar_one_or_none()
        return last_sync.completed_at if last_sync else None

    async def get_sync_delta(
        self,
        source_url: str,
        last_sync_time: Optional[datetime] = None
    ) -> Delta:
        """
        Get records changed since last sync from source.

        Args:
            source_url: Base URL of the source (Railway or Local).
            last_sync_time: Timestamp of last sync (None = get all records).

        Returns:
            Delta object containing changed records.
        """
        delta = Delta()

        async with httpx.AsyncClient(timeout=settings.sync_timeout_seconds) as client:
            for table_name in self.SYNCABLE_MODELS.keys():
                try:
                    params = {}
                    if last_sync_time:
                        params["updated_since"] = last_sync_time.isoformat()

                    response = await client.get(
                        f"{source_url}/api/sync/delta/{table_name}",
                        params=params
                    )
                    response.raise_for_status()

                    records = response.json()
                    setattr(delta, table_name, records)
                    delta.total_records += len(records)

                except (httpx.RequestError, httpx.HTTPStatusError) as e:
                    # Log error but continue with other tables
                    print(f"Error fetching delta for {table_name}: {e}")

        return delta

    async def apply_delta(
        self,
        delta: Delta,
        conflict_strategy: str = "last_write_wins"
    ) -> dict[str, int]:
        """
        Apply delta to local database with conflict resolution.

        Args:
            delta: Delta containing records to apply.
            conflict_strategy: Strategy for conflict resolution.

        Returns:
            Dictionary of record counts applied per table.
        """
        applied_counts = {}

        for table_name, records in [
            ("incidents", delta.incidents),
            ("personnel", delta.personnel),
            ("vehicles", delta.vehicles),
            ("materials", delta.materials),
            ("settings", delta.settings),
        ]:
            if not records:
                applied_counts[table_name] = 0
                continue

            model_class = self.SYNCABLE_MODELS[table_name]
            count = 0

            for record_data in records:
                try:
                    record_id = record_data.get("id")
                    if not record_id:
                        continue

                    # Check if record exists locally
                    result = await self.db.execute(
                        select(model_class).where(model_class.id == UUID(record_id))
                    )
                    existing = result.scalar_one_or_none()

                    if existing:
                        # Conflict resolution: last-write-wins with 5s buffer for Local
                        incoming_updated_at = datetime.fromisoformat(
                            record_data.get("updated_at")
                        )
                        local_updated_at = existing.updated_at

                        # Add buffer: if timestamps within 5 seconds, Local wins
                        time_diff = abs((incoming_updated_at - local_updated_at).total_seconds())
                        if time_diff <= settings.sync_conflict_buffer_seconds:
                            # Local wins, skip update
                            continue

                        # Update if incoming is newer
                        if incoming_updated_at > local_updated_at:
                            for key, value in record_data.items():
                                if hasattr(existing, key):
                                    setattr(existing, key, value)
                            count += 1
                    else:
                        # Insert new record
                        new_record = model_class(**record_data)
                        self.db.add(new_record)
                        count += 1

                except Exception as e:
                    print(f"Error applying record {record_id} to {table_name}: {e}")

            applied_counts[table_name] = count

        await self.db.commit()
        return applied_counts

    async def sync_from_railway(self) -> SyncResult:
        """
        Pull changes from Railway to Local.

        Returns:
            SyncResult with sync operation details.
        """
        started_at = datetime.now(timezone.utc)
        errors = []

        # Create sync log entry
        sync_log = SyncLog(
            sync_direction=SyncDirection.FROM_RAILWAY.value,
            status=SyncStatus.IN_PROGRESS.value,
            started_at=started_at
        )
        self.db.add(sync_log)
        await self.db.commit()

        try:
            # Check Railway health
            if not await self.check_railway_health():
                errors.append("Railway is unreachable")
                sync_log.status = SyncStatus.FAILED.value
                sync_log.errors = {"error": errors}
                sync_log.completed_at = datetime.now(timezone.utc)
                await self.db.commit()

                return SyncResult(
                    success=False,
                    direction=SyncDirection.FROM_RAILWAY,
                    records_synced={},
                    errors=errors,
                    started_at=started_at,
                    completed_at=datetime.now(timezone.utc)
                )

            # Get last sync time
            last_sync = await self.get_last_sync_time(SyncDirection.FROM_RAILWAY)

            # Get delta from Railway
            delta = await self.get_sync_delta(settings.railway_url, last_sync)

            # Apply delta to local database
            applied_counts = await self.apply_delta(delta)

            # Update sync log
            completed_at = datetime.now(timezone.utc)
            sync_log.status = SyncStatus.SUCCESS.value
            sync_log.records_synced = applied_counts
            sync_log.completed_at = completed_at
            await self.db.commit()

            return SyncResult(
                success=True,
                direction=SyncDirection.FROM_RAILWAY,
                records_synced=applied_counts,
                errors=None,
                started_at=started_at,
                completed_at=completed_at
            )

        except Exception as e:
            errors.append(str(e))
            sync_log.status = SyncStatus.FAILED.value
            sync_log.errors = {"error": errors}
            sync_log.completed_at = datetime.now(timezone.utc)
            await self.db.commit()

            return SyncResult(
                success=False,
                direction=SyncDirection.FROM_RAILWAY,
                records_synced={},
                errors=errors,
                started_at=started_at,
                completed_at=datetime.now(timezone.utc)
            )

    async def sync_to_railway(self) -> SyncResult:
        """
        Push Local changes to Railway (recovery mode).

        Returns:
            SyncResult with sync operation details.
        """
        started_at = datetime.now(timezone.utc)
        errors = []

        # Create sync log entry
        sync_log = SyncLog(
            sync_direction=SyncDirection.TO_RAILWAY.value,
            status=SyncStatus.IN_PROGRESS.value,
            started_at=started_at
        )
        self.db.add(sync_log)
        await self.db.commit()

        try:
            # Check Railway health
            if not await self.check_railway_health():
                errors.append("Railway is unreachable")
                sync_log.status = SyncStatus.FAILED.value
                sync_log.errors = {"error": errors}
                sync_log.completed_at = datetime.now(timezone.utc)
                await self.db.commit()

                return SyncResult(
                    success=False,
                    direction=SyncDirection.TO_RAILWAY,
                    records_synced={},
                    errors=errors,
                    started_at=started_at,
                    completed_at=datetime.now(timezone.utc)
                )

            # Get last sync time
            last_sync = await self.get_last_sync_time(SyncDirection.TO_RAILWAY)

            # Collect local changes since last sync
            delta = Delta()
            for table_name, model_class in self.SYNCABLE_MODELS.items():
                query = select(model_class)
                if last_sync:
                    query = query.where(model_class.updated_at > last_sync)

                result = await self.db.execute(query)
                records = result.scalars().all()

                # Convert to dict
                records_data = [
                    {
                        column.name: getattr(record, column.name)
                        for column in model_class.__table__.columns
                    }
                    for record in records
                ]
                setattr(delta, table_name, records_data)
                delta.total_records += len(records_data)

            # Push delta to Railway
            pushed_counts = {}
            async with httpx.AsyncClient(timeout=settings.sync_timeout_seconds) as client:
                for table_name in self.SYNCABLE_MODELS.keys():
                    records = getattr(delta, table_name)
                    if not records:
                        pushed_counts[table_name] = 0
                        continue

                    try:
                        response = await client.post(
                            f"{settings.railway_url}/api/sync/apply/{table_name}",
                            json=records
                        )
                        response.raise_for_status()
                        result = response.json()
                        pushed_counts[table_name] = result.get("count", 0)
                    except (httpx.RequestError, httpx.HTTPStatusError) as e:
                        errors.append(f"Error pushing {table_name}: {str(e)}")
                        pushed_counts[table_name] = 0

            # Update sync log
            completed_at = datetime.now(timezone.utc)
            status = SyncStatus.SUCCESS if not errors else SyncStatus.PARTIAL
            sync_log.status = status.value
            sync_log.records_synced = pushed_counts
            if errors:
                sync_log.errors = {"errors": errors}
            sync_log.completed_at = completed_at
            await self.db.commit()

            return SyncResult(
                success=not errors,
                direction=SyncDirection.TO_RAILWAY,
                records_synced=pushed_counts,
                errors=errors if errors else None,
                started_at=started_at,
                completed_at=completed_at
            )

        except Exception as e:
            errors.append(str(e))
            sync_log.status = SyncStatus.FAILED.value
            sync_log.errors = {"error": errors}
            sync_log.completed_at = datetime.now(timezone.utc)
            await self.db.commit()

            return SyncResult(
                success=False,
                direction=SyncDirection.TO_RAILWAY,
                records_synced={},
                errors=errors,
                started_at=started_at,
                completed_at=datetime.now(timezone.utc)
            )


async def create_sync_service(db: AsyncSession) -> SyncService:
    """Factory function to create SyncService instance."""
    return SyncService(db)
