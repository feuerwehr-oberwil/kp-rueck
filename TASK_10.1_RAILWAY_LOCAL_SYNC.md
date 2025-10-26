# Task 10.1: Bidirectional Railway ↔ Local Sync

**Priority:** P2 (High - Important for deployment workflow)
**Complexity:** High
**Estimated Effort:** 8-12 hours
**Dependencies:** None
**Status:** Specification Complete - Not Implemented

---

## 1. Overview

Implement bidirectional synchronization between Railway production database and local development environment to facilitate safe testing of production data locally and selective deployment of tested data back to production.

### Business Value
- Test production scenarios locally without risk
- Debug production issues with real data
- Validate data migrations before production deployment
- Enable safe experimentation with production datasets

### User Stories
1. **As a developer**, I want to pull production data to my local environment so I can debug production issues
2. **As an admin**, I want to push tested local data to production so I can update resources safely
3. **As a developer**, I want to selectively sync specific data types so I can avoid overwriting critical production data
4. **As an admin**, I want sync audit logs so I can track all synchronization operations

---

## 2. Technical Specification

### 2.1 Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Sync Architecture                         │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  Railway Production DB  ←──────────→  Local Dev DB          │
│  (PostgreSQL)                          (PostgreSQL)          │
│                                                               │
│  ┌──────────────────┐                ┌──────────────────┐   │
│  │  Personnel       │  ←──Pull───    │  Personnel       │   │
│  │  Vehicles        │  ───Push──→    │  Vehicles        │   │
│  │  Materials       │                │  Materials       │   │
│  │  Events          │                │  Events          │   │
│  │  Incidents       │                │  Incidents       │   │
│  └──────────────────┘                └──────────────────┘   │
│                                                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │         Sync Manager (Python CLI)                    │   │
│  │  - Connection validation                             │   │
│  │  - Data export/import                                │   │
│  │  - Conflict detection                                │   │
│  │  - Audit logging                                     │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Data Sync Modes

#### Pull Mode (Railway → Local)
```python
# Pull all data
python sync.py pull --all

# Pull specific resources
python sync.py pull --resources personnel,vehicles

# Pull with filters
python sync.py pull --resources incidents --event-id <uuid>
python sync.py pull --resources incidents --training-only
python sync.py pull --resources personnel --checked-in-only
```

#### Push Mode (Local → Railway)
```python
# Push with confirmation
python sync.py push --resources personnel,vehicles --confirm

# Dry run (preview changes)
python sync.py push --all --dry-run

# Push with backup
python sync.py push --all --backup
```

### 2.3 Database Connections

**Environment Variables:**

```bash
# Local database (default from .env)
DATABASE_URL=postgresql+asyncpg://kprueck:kprueck@localhost:5433/kprueck

# Railway production database
RAILWAY_DATABASE_URL=postgresql+asyncpg://postgres:...@railway.app:5432/railway
```

**Connection Configuration:**

```python
# backend/app/services/sync/config.py

from pydantic_settings import BaseSettings

class SyncConfig(BaseSettings):
    """Sync configuration."""

    local_database_url: str
    railway_database_url: str

    # Safety settings
    require_confirmation: bool = True
    allow_destructive_pull: bool = False  # Prevents --replace on pull
    backup_before_push: bool = True

    # Performance settings
    batch_size: int = 1000
    max_workers: int = 4

    class Config:
        env_file = ".env.sync"
```

### 2.4 Sync Manager Implementation

**File: `backend/app/services/sync/manager.py`**

```python
"""
Bidirectional sync manager for Railway ↔ Local database synchronization.
"""

from typing import List, Optional, Literal
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy import select, delete, func
import asyncio
from datetime import datetime
import json

from ...models import Personnel, Vehicle, Material, Event, Incident
from ...database import Base
from .config import SyncConfig
from .audit import log_sync_operation

class SyncManager:
    """Manages bidirectional database synchronization."""

    def __init__(self, config: SyncConfig):
        self.config = config
        self.local_engine = create_async_engine(config.local_database_url)
        self.railway_engine = create_async_engine(config.railway_database_url)

    async def pull(
        self,
        resources: List[str],
        event_id: Optional[str] = None,
        training_only: bool = False,
        replace: bool = False,
    ) -> dict:
        """
        Pull data from Railway to Local.

        Args:
            resources: List of resource types to sync
            event_id: Filter incidents by event
            training_only: Only pull training incidents
            replace: Delete local data before import (dangerous!)

        Returns:
            Dictionary with sync statistics
        """
        stats = {
            "pulled_at": datetime.utcnow().isoformat(),
            "source": "railway",
            "destination": "local",
            "resources": {},
        }

        # Validate connections
        await self._validate_connections()

        # Warn if replace mode
        if replace and not self.config.allow_destructive_pull:
            raise ValueError("Destructive pull not allowed. Set allow_destructive_pull=True")

        async with (
            AsyncSession(self.railway_engine) as source_session,
            AsyncSession(self.local_engine) as dest_session,
        ):
            # Pull personnel
            if "personnel" in resources:
                count = await self._pull_personnel(source_session, dest_session, replace)
                stats["resources"]["personnel"] = count

            # Pull vehicles
            if "vehicles" in resources:
                count = await self._pull_vehicles(source_session, dest_session, replace)
                stats["resources"]["vehicles"] = count

            # Pull materials
            if "materials" in resources:
                count = await self._pull_materials(source_session, dest_session, replace)
                stats["resources"]["materials"] = count

            # Pull events
            if "events" in resources:
                count = await self._pull_events(source_session, dest_session, replace)
                stats["resources"]["events"] = count

            # Pull incidents (with filters)
            if "incidents" in resources:
                count = await self._pull_incidents(
                    source_session,
                    dest_session,
                    event_id=event_id,
                    training_only=training_only,
                    replace=replace,
                )
                stats["resources"]["incidents"] = count

            await dest_session.commit()

        # Log sync operation
        await log_sync_operation("pull", stats)

        return stats

    async def push(
        self,
        resources: List[str],
        dry_run: bool = False,
        backup: bool = True,
        confirm: bool = True,
    ) -> dict:
        """
        Push data from Local to Railway.

        Args:
            resources: List of resource types to sync
            dry_run: Preview changes without applying
            backup: Create backup before pushing
            confirm: Require user confirmation

        Returns:
            Dictionary with sync statistics
        """
        stats = {
            "pushed_at": datetime.utcnow().isoformat(),
            "source": "local",
            "destination": "railway",
            "resources": {},
            "dry_run": dry_run,
        }

        # Validate connections
        await self._validate_connections()

        # User confirmation
        if confirm and self.config.require_confirmation:
            if not await self._confirm_push(resources):
                raise ValueError("Push cancelled by user")

        # Backup production data
        if backup and not dry_run:
            await self._backup_railway(resources)

        async with (
            AsyncSession(self.local_engine) as source_session,
            AsyncSession(self.railway_engine) as dest_session,
        ):
            # Push personnel
            if "personnel" in resources:
                count = await self._push_personnel(
                    source_session, dest_session, dry_run
                )
                stats["resources"]["personnel"] = count

            # Push vehicles
            if "vehicles" in resources:
                count = await self._push_vehicles(
                    source_session, dest_session, dry_run
                )
                stats["resources"]["vehicles"] = count

            # Push materials
            if "materials" in resources:
                count = await self._push_materials(
                    source_session, dest_session, dry_run
                )
                stats["resources"]["materials"] = count

            if not dry_run:
                await dest_session.commit()

        # Log sync operation
        await log_sync_operation("push", stats)

        return stats

    async def _validate_connections(self):
        """Validate both database connections are accessible."""
        try:
            async with AsyncSession(self.local_engine) as session:
                await session.execute(select(1))
            async with AsyncSession(self.railway_engine) as session:
                await session.execute(select(1))
        except Exception as e:
            raise ConnectionError(f"Database connection failed: {e}")

    async def _pull_personnel(
        self,
        source: AsyncSession,
        dest: AsyncSession,
        replace: bool,
    ) -> int:
        """Pull personnel from source to destination."""
        if replace:
            await dest.execute(delete(Personnel))

        result = await source.execute(select(Personnel))
        personnel = result.scalars().all()

        for person in personnel:
            # Check if exists
            existing = await dest.execute(
                select(Personnel).where(Personnel.id == person.id)
            )
            if existing.scalar_one_or_none():
                continue  # Skip existing (upsert not implemented in this spec)

            # Create new
            new_person = Personnel(
                id=person.id,
                name=person.name,
                role=person.role,
                divera_alarm_id=person.divera_alarm_id,
                phone_number=person.phone_number,
                availability_status=person.availability_status,
            )
            dest.add(new_person)

        return len(personnel)

    async def _push_personnel(
        self,
        source: AsyncSession,
        dest: AsyncSession,
        dry_run: bool,
    ) -> int:
        """Push personnel from source to destination."""
        result = await source.execute(select(Personnel))
        personnel = result.scalars().all()

        if dry_run:
            return len(personnel)

        # Upsert logic (simplified - full implementation would use ON CONFLICT)
        for person in personnel:
            # Delete existing
            await dest.execute(
                delete(Personnel).where(Personnel.id == person.id)
            )

            # Insert new
            new_person = Personnel(
                id=person.id,
                name=person.name,
                role=person.role,
                divera_alarm_id=person.divera_alarm_id,
                phone_number=person.phone_number,
                availability_status=person.availability_status,
            )
            dest.add(new_person)

        return len(personnel)

    async def _backup_railway(self, resources: List[str]):
        """Create backup of Railway data before pushing."""
        timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
        backup_file = f"railway_backup_{timestamp}.json"

        async with AsyncSession(self.railway_engine) as session:
            backup_data = {}

            if "personnel" in resources:
                result = await session.execute(select(Personnel))
                personnel = result.scalars().all()
                backup_data["personnel"] = [
                    {
                        "id": str(p.id),
                        "name": p.name,
                        "role": p.role,
                        # ... other fields
                    }
                    for p in personnel
                ]

            # ... similar for other resources

            with open(backup_file, "w") as f:
                json.dump(backup_data, f, indent=2)

        print(f"Backup created: {backup_file}")
```

### 2.5 CLI Interface

**File: `backend/sync.py`**

```python
#!/usr/bin/env python3
"""
Railway ↔ Local Sync CLI

Usage:
    # Pull from Railway
    python sync.py pull --all
    python sync.py pull --resources personnel,vehicles
    python sync.py pull --resources incidents --event-id <uuid>

    # Push to Railway
    python sync.py push --resources personnel --confirm
    python sync.py push --all --dry-run

    # Backup
    python sync.py backup --output backup.json
"""

import asyncio
import click
from app.services.sync.manager import SyncManager
from app.services.sync.config import SyncConfig

@click.group()
def cli():
    """Railway ↔ Local Database Sync Tool"""
    pass

@cli.command()
@click.option('--all', is_flag=True, help='Pull all resources')
@click.option('--resources', help='Comma-separated list of resources')
@click.option('--event-id', help='Filter incidents by event ID')
@click.option('--training-only', is_flag=True, help='Only pull training incidents')
@click.option('--replace', is_flag=True, help='Replace local data (dangerous!)')
def pull(all, resources, event_id, training_only, replace):
    """Pull data from Railway to Local."""
    config = SyncConfig()
    manager = SyncManager(config)

    if all:
        resource_list = ["personnel", "vehicles", "materials", "events", "incidents"]
    else:
        resource_list = resources.split(",") if resources else []

    if not resource_list:
        click.echo("Error: Specify --all or --resources")
        return

    if replace:
        if not click.confirm("⚠️  This will DELETE all local data. Continue?"):
            click.echo("Cancelled.")
            return

    click.echo(f"Pulling {', '.join(resource_list)} from Railway...")

    stats = asyncio.run(manager.pull(
        resources=resource_list,
        event_id=event_id,
        training_only=training_only,
        replace=replace,
    ))

    click.echo("\n✅ Pull complete!")
    click.echo(f"Resources synced: {stats['resources']}")

@cli.command()
@click.option('--all', is_flag=True, help='Push all resources')
@click.option('--resources', help='Comma-separated list of resources')
@click.option('--dry-run', is_flag=True, help='Preview changes without applying')
@click.option('--no-backup', is_flag=True, help='Skip backup creation')
@click.option('--confirm/--no-confirm', default=True, help='Require confirmation')
def push(all, resources, dry_run, no_backup, confirm):
    """Push data from Local to Railway."""
    config = SyncConfig()
    manager = SyncManager(config)

    if all:
        resource_list = ["personnel", "vehicles", "materials"]
    else:
        resource_list = resources.split(",") if resources else []

    if not resource_list:
        click.echo("Error: Specify --all or --resources")
        return

    if not dry_run and confirm:
        click.echo(f"⚠️  About to push {', '.join(resource_list)} to Railway PRODUCTION")
        if not click.confirm("Continue?"):
            click.echo("Cancelled.")
            return

    click.echo(f"{'[DRY RUN] ' if dry_run else ''}Pushing {', '.join(resource_list)} to Railway...")

    stats = asyncio.run(manager.push(
        resources=resource_list,
        dry_run=dry_run,
        backup=not no_backup,
        confirm=False,  # Already confirmed above
    ))

    if dry_run:
        click.echo("\n📋 Dry run complete (no changes applied)")
    else:
        click.echo("\n✅ Push complete!")
    click.echo(f"Resources synced: {stats['resources']}")

@cli.command()
@click.option('--output', default='railway_backup.json', help='Output file')
def backup(output):
    """Create backup of Railway data."""
    click.echo(f"Creating backup: {output}")
    # Implementation would export all Railway data to JSON
    click.echo("✅ Backup complete!")

if __name__ == '__main__':
    cli()
```

---

## 3. Implementation Checklist

### Phase 1: Foundation (2-3 hours)
- [ ] Create `backend/app/services/sync/` directory
- [ ] Implement `config.py` with SyncConfig
- [ ] Implement `manager.py` with SyncManager class
- [ ] Add connection validation logic
- [ ] Create `.env.sync` template

### Phase 2: Pull Implementation (3-4 hours)
- [ ] Implement `_pull_personnel()`
- [ ] Implement `_pull_vehicles()`
- [ ] Implement `_pull_materials()`
- [ ] Implement `_pull_events()`
- [ ] Implement `_pull_incidents()` with filtering
- [ ] Add batch processing for large datasets

### Phase 3: Push Implementation (2-3 hours)
- [ ] Implement `_push_personnel()`
- [ ] Implement `_push_vehicles()`
- [ ] Implement `_push_materials()`
- [ ] Add conflict detection
- [ ] Implement backup creation

### Phase 4: CLI & Safety (1-2 hours)
- [ ] Create `sync.py` CLI script
- [ ] Add user confirmation prompts
- [ ] Implement dry-run mode
- [ ] Add progress indicators
- [ ] Create sync audit logging

---

## 4. Safety Considerations

### 4.1 Safeguards

```python
# Prevent accidental production overwrites
SAFETY_CHECKS = {
    "require_confirmation": True,  # Always ask before push
    "backup_before_push": True,    # Auto-backup production
    "allow_destructive_pull": False,  # Prevent --replace on pull
    "max_batch_size": 1000,        # Prevent memory issues
}
```

### 4.2 Audit Logging

**File: `backend/app/services/sync/audit.py`**

```python
async def log_sync_operation(
    operation: Literal["pull", "push", "backup"],
    stats: dict,
):
    """Log sync operation to audit trail."""
    log_entry = {
        "timestamp": datetime.utcnow().isoformat(),
        "operation": operation,
        "stats": stats,
        "user": os.getenv("USER"),
        "hostname": socket.gethostname(),
    }

    # Write to sync audit log file
    with open("sync_audit.jsonl", "a") as f:
        f.write(json.dumps(log_entry) + "\n")

    # Also log to database audit_log table
    # ... (implementation)
```

---

## 5. Testing Strategy

### 5.1 Unit Tests

```python
# tests/services/sync/test_manager.py

async def test_pull_personnel():
    """Test pulling personnel from Railway to Local."""
    # Setup mock databases
    # Execute pull
    # Verify data copied correctly

async def test_push_with_dry_run():
    """Test dry run doesn't modify production."""
    # Execute push with dry_run=True
    # Verify no changes to destination

async def test_backup_creation():
    """Test backup file created before push."""
    # Execute push with backup=True
    # Verify backup file exists
```

### 5.2 Integration Tests

```bash
# Test pull workflow
python sync.py pull --resources personnel --dry-run
python sync.py pull --resources personnel

# Test push workflow
python sync.py push --resources vehicles --dry-run
python sync.py push --resources vehicles --confirm
```

---

## 6. Usage Examples

### Example 1: Debug Production Issue Locally

```bash
# Pull production incident data
python sync.py pull --resources incidents --event-id <prod-event-id>

# Pull related resources
python sync.py pull --resources personnel,vehicles

# Debug locally...

# Push fix back to production
python sync.py push --resources incidents --confirm
```

### Example 2: Bulk Resource Update

```bash
# Export production data
python sync.py pull --resources personnel

# Edit locally using Excel import/export feature

# Preview changes
python sync.py push --resources personnel --dry-run

# Apply changes
python sync.py push --resources personnel --confirm
```

### Example 3: Training Data Setup

```bash
# Pull only training incidents
python sync.py pull --resources incidents --training-only

# Modify for new training session

# Push back
python sync.py push --resources incidents --confirm
```

---

## 7. Future Enhancements

### 7.1 Selective Field Sync
- Sync only specific fields (e.g., update availability status only)
- Exclude sensitive data (PII) from pull

### 7.2 Conflict Resolution
- Detect conflicts (same resource modified in both locations)
- Merge strategies (last-write-wins, manual resolution)

### 7.3 Scheduled Sync
- Cron job for automatic nightly backups
- Webhook-triggered sync on Railway deployments

### 7.4 Web UI
- Admin panel for triggering sync operations
- Visual diff of changes before push
- Real-time sync progress monitoring

---

## 8. Documentation Requirements

### 8.1 Developer Documentation
- [ ] Sync architecture diagram
- [ ] CLI command reference
- [ ] Configuration options
- [ ] Troubleshooting guide

### 8.2 Operations Guide
- [ ] Production sync workflow
- [ ] Disaster recovery procedures
- [ ] Backup restoration steps
- [ ] Audit log analysis

---

## 9. Dependencies

```toml
# pyproject.toml additions

[project]
dependencies = [
    "click>=8.1.7",  # CLI framework
    "rich>=13.7.0",  # Pretty CLI output
]

[project.scripts]
sync = "app.services.sync.cli:main"
```

---

## 10. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Accidental production data loss | High | Mandatory backups, confirmation prompts |
| Large dataset memory issues | Medium | Batch processing, streaming |
| Network interruption during sync | Medium | Transaction rollback, resume capability |
| Conflicting concurrent edits | Medium | Optimistic locking, conflict detection |
| Exposing Railway credentials | High | Environment variables, .env.sync not in git |

---

## Acceptance Criteria

✅ **Must Have:**
- [ ] Pull personnel, vehicles, materials from Railway to Local
- [ ] Push personnel, vehicles, materials from Local to Railway
- [ ] User confirmation required before push
- [ ] Automatic backup before push
- [ ] Dry-run mode for previewing changes
- [ ] CLI with --help documentation
- [ ] Sync audit logging

🎯 **Should Have:**
- [ ] Filter incidents by event or training flag
- [ ] Batch processing for large datasets
- [ ] Progress indicators during sync
- [ ] Detailed error messages

💡 **Nice to Have:**
- [ ] Web UI for sync operations
- [ ] Conflict detection and resolution
- [ ] Scheduled automatic backups
- [ ] Selective field sync
