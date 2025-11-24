"""Bidirectional sync service for Railway ↔ Local synchronization."""
import asyncio
from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, create_async_engine

from app.config import settings
from app.logging_config import get_logger
from app.models import Event, Incident, Material, Personnel, Setting, SyncLog, Vehicle
from app.schemas import Delta, SyncDirection, SyncResult, SyncStatus

logger = get_logger(__name__)


class SyncService:
    """Service for bidirectional synchronization between Railway and Local."""

    # Syncable tables and their models
    # NOTE: Users are NOT synced - they are authentication records managed per environment
    # Incidents reference users via created_by, so users must exist on both systems independently
    SYNCABLE_MODELS = {
        "events": Event,
        "incidents": Incident,
        "personnel": Personnel,
        "vehicles": Vehicle,
        "materials": Material,
        "settings": Setting,
    }

    def __init__(self, db: AsyncSession):
        """Initialize sync service with database session."""
        self.db = db
        self._railway_database_url: Optional[str] = None
        self._railway_engine: Optional[AsyncEngine] = None
        self._conflict_buffer: Optional[int] = None

    async def get_railway_database_url(self) -> str:
        """Get Railway database URL from settings."""
        if self._railway_database_url is None:
            from app.services.settings import get_setting_value
            self._railway_database_url = await get_setting_value(self.db, "railway_database_url", "")
        return self._railway_database_url

    async def get_conflict_buffer(self) -> int:
        """Get conflict buffer from database settings."""
        if self._conflict_buffer is None:
            from app.services.settings import get_setting_value
            buffer_str = await get_setting_value(self.db, "sync_conflict_buffer_seconds", "5")
            self._conflict_buffer = int(buffer_str)
        return self._conflict_buffer

    async def get_railway_engine(self) -> Optional[AsyncEngine]:
        """Get or create Railway database engine."""
        railway_url = await self.get_railway_database_url()
        if not railway_url:
            return None

        if self._railway_engine is None:
            # Ensure the URL uses asyncpg driver for async operations
            if railway_url.startswith('postgresql://'):
                railway_url = railway_url.replace('postgresql://', 'postgresql+asyncpg://', 1)
            elif not railway_url.startswith('postgresql+asyncpg://'):
                # If it's already postgresql+something, we should still ensure it's asyncpg
                railway_url = railway_url.replace('postgresql+', 'postgresql+asyncpg+', 1)

            self._railway_engine = create_async_engine(railway_url, echo=False)
        return self._railway_engine

    async def close_railway_connection(self):
        """Close Railway database connection."""
        if self._railway_engine:
            await self._railway_engine.dispose()
            self._railway_engine = None

    async def check_railway_health(self) -> bool:
        """
        Check if Railway database is reachable and healthy.

        Returns:
            bool: True if Railway database is accessible, False otherwise.
        """
        engine = await self.get_railway_engine()
        if not engine:
            return False

        try:
            # Try to connect and execute a simple query
            async with engine.connect() as conn:
                await conn.execute(select(1))
            return True
        except Exception as e:
            logger.warning(f"Railway health check failed: {e}")
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

    async def get_sync_delta_from_railway(
        self,
        last_sync_time: Optional[datetime] = None
    ) -> Delta:
        """
        Get records changed since last sync from Railway database using batched loading.

        Args:
            last_sync_time: Timestamp of last sync (None = get all records).

        Returns:
            Delta object containing changed records.
        """
        delta = Delta()
        engine = await self.get_railway_engine()
        if not engine:
            return delta

        BATCH_SIZE = 100  # Process records in batches to avoid memory issues

        async with AsyncSession(engine) as railway_session:
            for table_name, model_class in self.SYNCABLE_MODELS.items():
                try:
                    # Build query
                    query = select(model_class)
                    if last_sync_time:
                        query = query.where(model_class.updated_at > last_sync_time)

                    # Count total records first
                    count_query = select(func.count()).select_from(model_class)
                    if last_sync_time:
                        count_query = count_query.where(model_class.updated_at > last_sync_time)
                    count_result = await railway_session.execute(count_query)
                    total_count = count_result.scalar() or 0

                    records_data = []
                    # Process in batches
                    for offset in range(0, total_count, BATCH_SIZE):
                        batch_query = query.offset(offset).limit(BATCH_SIZE)
                        result = await railway_session.execute(batch_query)
                        batch_records = result.scalars().all()

                        # Convert batch to dict
                        batch_data = [
                            {
                                column.name: (
                                    getattr(record, column.name).isoformat()
                                    if isinstance(getattr(record, column.name), datetime)
                                    else str(getattr(record, column.name))
                                    if isinstance(getattr(record, column.name), UUID)
                                    else getattr(record, column.name)
                                )
                                for column in model_class.__table__.columns
                            }
                            for record in batch_records
                        ]
                        records_data.extend(batch_data)

                    setattr(delta, table_name, records_data)
                    delta.total_records += len(records_data)

                except Exception as e:
                    logger.error(f"Error fetching delta for {table_name}: {e}")

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
        from sqlalchemy.exc import IntegrityError

        applied_counts = {}

        for table_name, records in [
            ("events", delta.events),
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
                # Use nested transaction (savepoint) for each record
                async with self.db.begin_nested():
                    try:
                        record_id = record_data.get("id")
                        if not record_id:
                            continue

                        # Convert ISO format strings back to datetime objects
                        processed_data = {}
                        for key, value in record_data.items():
                            if isinstance(value, str):
                                # Try to parse as datetime
                                try:
                                    processed_data[key] = datetime.fromisoformat(value)
                                except (ValueError, AttributeError):
                                    processed_data[key] = value
                            else:
                                processed_data[key] = value

                        # Check if record exists locally
                        result = await self.db.execute(
                            select(model_class).where(model_class.id == UUID(record_id))
                        )
                        existing = result.scalar_one_or_none()

                        if existing:
                            # Conflict resolution: last-write-wins with buffer for Local
                            incoming_updated_at = processed_data.get("updated_at")
                            if isinstance(incoming_updated_at, str):
                                incoming_updated_at = datetime.fromisoformat(incoming_updated_at)
                            local_updated_at = existing.updated_at

                            # Add buffer: if timestamps within configured seconds, Local wins
                            conflict_buffer = await self.get_conflict_buffer()
                            time_diff = abs((incoming_updated_at - local_updated_at).total_seconds())
                            if time_diff <= conflict_buffer:
                                # Local wins, skip update
                                continue

                            # Update if incoming is newer
                            if incoming_updated_at > local_updated_at:
                                for key, value in processed_data.items():
                                    if hasattr(existing, key):
                                        setattr(existing, key, value)
                                count += 1
                        else:
                            # Insert new record
                            new_record = model_class(**processed_data)
                            self.db.add(new_record)
                            count += 1

                        # Flush to detect integrity errors within this savepoint
                        await self.db.flush()

                    except IntegrityError as ie:
                        # Savepoint automatically rolls back, other records unaffected
                        logger.debug(f"Skipping record {record_id} in {table_name} due to integrity constraint: {str(ie)[:200]}")
                        continue
                    except Exception as e:
                        logger.error(f"Error applying record {record_id} to {table_name}: {e}")
                        continue

            applied_counts[table_name] = count

        # Final commit for all successfully applied records
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

            # Get delta from Railway database
            delta = await self.get_sync_delta_from_railway(last_sync)

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

            # Collect local changes since last sync using batched loading
            delta = Delta()
            BATCH_SIZE = 100  # Process records in batches to avoid memory issues

            for table_name, model_class in self.SYNCABLE_MODELS.items():
                query = select(model_class)
                if last_sync:
                    query = query.where(model_class.updated_at > last_sync)

                # Count total records first
                count_query = select(func.count()).select_from(model_class)
                if last_sync:
                    count_query = count_query.where(model_class.updated_at > last_sync)
                count_result = await self.db.execute(count_query)
                total_count = count_result.scalar() or 0

                records_data = []
                # Process in batches
                for offset in range(0, total_count, BATCH_SIZE):
                    batch_query = query.offset(offset).limit(BATCH_SIZE)
                    result = await self.db.execute(batch_query)
                    batch_records = result.scalars().all()

                    # Convert batch to dict
                    batch_data = [
                        {
                            column.name: getattr(record, column.name)
                            for column in model_class.__table__.columns
                        }
                        for record in batch_records
                    ]
                    records_data.extend(batch_data)

                setattr(delta, table_name, records_data)
                delta.total_records += len(records_data)

            # Push delta to Railway database
            engine = await self.get_railway_engine()
            if not engine:
                errors.append("Railway database engine not available")
                sync_log.status = SyncStatus.FAILED.value
                sync_log.errors = {"errors": errors}
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

            pushed_counts = {}
            async with AsyncSession(engine) as railway_session:
                # Apply delta to Railway database using the apply_delta logic
                for table_name, records in [
                    ("events", delta.events),
                    ("incidents", delta.incidents),
                    ("personnel", delta.personnel),
                    ("vehicles", delta.vehicles),
                    ("materials", delta.materials),
                    ("settings", delta.settings),
                ]:
                    if not records:
                        pushed_counts[table_name] = 0
                        continue

                    model_class = self.SYNCABLE_MODELS[table_name]
                    count = 0

                    for record_data in records:
                        try:
                            record_id = record_data.get("id")
                            if not record_id:
                                continue

                            # Check if record exists on Railway
                            result = await railway_session.execute(
                                select(model_class).where(model_class.id == UUID(str(record_id)))
                            )
                            existing = result.scalar_one_or_none()

                            if existing:
                                # Update existing record
                                for key, value in record_data.items():
                                    if hasattr(existing, key):
                                        setattr(existing, key, value)
                                count += 1
                            else:
                                # Insert new record
                                new_record = model_class(**record_data)
                                railway_session.add(new_record)
                                count += 1

                        except Exception as e:
                            logger.error(f"Error pushing record {record_id} to {table_name}: {e}")
                            errors.append(f"Error pushing record {record_id} to {table_name}: {str(e)}")

                    pushed_counts[table_name] = count

                # Commit all changes to Railway database
                try:
                    await railway_session.commit()
                except Exception as e:
                    errors.append(f"Error committing to Railway database: {str(e)}")

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


    async def sync_bidirectional(self) -> dict[str, SyncResult]:
        """
        Perform bidirectional sync: Railway ↔ Local.

        First pulls changes from Railway to Local, then pushes Local changes to Railway.
        This ensures both databases stay in sync.

        Returns:
            Dictionary with results for both directions:
            - "from_railway": Result of Railway → Local sync
            - "to_railway": Result of Local → Railway sync
        """
        results = {}

        # First, pull changes from Railway to Local
        results["from_railway"] = await self.sync_from_railway()

        # Then, push Local changes to Railway
        results["to_railway"] = await self.sync_to_railway()

        return results


async def create_sync_service(db: AsyncSession) -> SyncService:
    """Factory function to create SyncService instance."""
    return SyncService(db)
