# Database Schema & Architecture Analysis

Last updated: 2025-01-12

## Overview

The application uses PostgreSQL 16 with SQLAlchemy 2.0 async ORM. This document covers schema design issues, migration safety, and connection management.

---

## Missing Indexes

### Critical Performance Issues

**File**: `backend/app/models.py`

| Table | Field | Issue | Impact |
|-------|-------|-------|--------|
| Vehicle (65-85) | `status` | No index | Slow availability checks |
| Vehicle | `display_order` | No index | Slow UI ordering |
| Material (124-145) | `status` | No index | Slow resource filtering |
| Material | `location_sort_order` | No index | Slow sorting |
| Personnel (88-121) | `availability` | No index | Slow assignment conflict checks |
| Personnel | `role_sort_order` | No index | Slow UI ordering |

### IncidentAssignment Index Gap

**File**: `backend/app/models.py:393-396`

Current index:
```python
Index("idx_incident_assignments_unassigned", "unassigned_at")
```

**Missing**: Composite index for common query pattern:
```python
Index("idx_active_assignments", "incident_id", "resource_type", "resource_id",
      postgresql_where=text("unassigned_at IS NULL"))
```

---

## N+1 Query Risks

### Current Protection (Good)

**File**: `backend/app/crud/incidents.py:41-43`

```python
.options(
    selectinload(Incident.status_transitions),
    selectinload(Incident.assignments).selectinload(IncidentAssignment.vehicle),
    selectinload(Incident.reko_reports)
)
```

### Potential Issue

**File**: `backend/app/crud/incidents.py:176`

Function calls `_get_assigned_vehicles()` for single incident retrieval, creating extra query even though vehicles are already loaded via eager loading.

**Recommendation**: Remove redundant helper call.

---

## Relationship Configuration Issues

### Problematic Vehicle Relationship

**File**: `backend/app/models.py:378-383`

```python
vehicle: Mapped[Optional["Vehicle"]] = relationship(
    "Vehicle",
    primaryjoin="and_(IncidentAssignment.resource_id == Vehicle.id, "
                "IncidentAssignment.resource_type == 'vehicle')",
    foreign_keys=[resource_id],
    viewonly=True
)
```

**Issues**:
- Conditional `primaryjoin` only works when `resource_type == 'vehicle'`
- `viewonly=True` prevents SQLAlchemy relationship management
- Complex join cannot be properly indexed
- Redundant: CRUD operations already use explicit joins correctly

**Recommendation**: Remove this relationship, rely on explicit joins in CRUD.

---

## Cascade Delete Configuration

### Data Loss Risk

**File**: `backend/app/models.py:283`

```python
event_id: Mapped[UUID] = mapped_column(
    ForeignKey("events.id", ondelete="CASCADE"), nullable=False
)
```

Combined with Event model (176-177):
```python
incidents: Mapped[list["Incident"]] = relationship(
    "Incident", back_populates="event", cascade="all, delete-orphan"
)
```

**Issue**: Deleting an Event cascade-deletes ALL associated Incidents.

**Risk**: Accidental event deletion destroys all incident history.

**Note**: Code uses soft-delete (archive) for events (`crud/events.py:103-122`), so CASCADE is unnecessary.

**Recommendation**: Change to `ondelete="SET NULL"` or rely solely on soft-delete.

---

## Migration Safety Analysis

### Data Loss Risks

**Migration**: `be398c3e264a` (add_events_table.py)

- Uses hardcoded UUID for default event
- No error handling if migration runs twice
- Risk: Partial migration failure leaves orphaned data

**Migration**: `e0f2105b967e` (add_contact_and_internal_notes)

- Downgrade loses data from `contact` and `internal_notes` fields
- No data archival before destructive downgrade

### Safe Migrations

**Migration**: `0d5cc7325349` (remove_critical_priority)

```python
op.execute("UPDATE incidents SET priority = 'high' WHERE priority = 'critical'")
```

Correctly migrates data before constraint change.

**Migration**: `dd20084b9da4` (add_timezone_support)

PostgreSQL handles TIMESTAMP to TIMESTAMPTZ conversion automatically.

---

## Connection Pool Configuration

### Main Engine

**File**: `backend/app/database.py:10-19`

```python
engine = create_async_engine(
    settings.database_url,
    pool_size=20,           # Persistent connections
    max_overflow=10,        # Extra during spikes (total: 30)
    pool_timeout=30,        # Wait timeout
    pool_recycle=1800,      # Recycle after 30 minutes
    pool_pre_ping=True,     # Verify connections
)
```

### Audit Engine

**File**: `backend/app/database.py:32-41`

```python
audit_engine = create_async_engine(
    pool_size=5,            # Smaller for audit
    max_overflow=10,        # Extra during bursts (total: 15)
)
```

### Concern: Total Connections

- Main engine: 30 connections max
- Audit engine: 15 connections max
- **Total: 45 connections possible**
- Railway typically limits to 25-50 per database

**Recommendation**: Reduce `audit_engine.max_overflow` to 5.

---

## Transaction Handling

### Session Dependency

**File**: `backend/app/database.py:58-68`

```python
async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with async_session_maker() as session:
        try:
            yield session
            await session.commit()  # Auto-commit on success
        except Exception:
            await session.rollback()
            raise
```

### Dual-Commit Pattern Issue

CRUD operations have explicit commits:
```python
# incidents.py:223
await db.commit()
```

Then `get_db()` commits again (no-op but unnecessary).

**Impact**: Extra `COMMIT` statements sent to database.

**Recommendation**: Either remove commits from CRUD (let `get_db()` handle) or remove from `get_db()` (require explicit commits).

### Audit Logging in Transaction

**File**: `backend/app/crud/incidents.py:210-217`

```python
await log_action(db=db, ...)
```

**Issue**: If `log_action()` fails, entire incident creation rolls back.

**Recommendation**: Use separate audit_engine for async non-blocking logging.

---

## Soft Delete Implementation

### Inconsistent Strategies

| Entity | Approach | Field |
|--------|----------|-------|
| Incidents | `deleted_at` timestamp | `deleted_at` |
| Events | `archived_at` timestamp | `archived_at` |
| Vehicles | Status change | `status = "maintenance"` |
| Personnel | Status change | `availability = "unavailable"` |
| Materials | Status change | `status = "maintenance"` |

**Issue**: Vehicles/Personnel/Materials use status change, not proper soft-delete:
- Can't track when deletion occurred
- Can't restore original status if deleted by mistake

**Recommendation**: Standardize to `deleted_at` timestamp across all entities.

---

## Unique Constraint Issues

### IncidentAssignment

**File**: `backend/app/models.py:389-391`

```python
UniqueConstraint(
    "incident_id", "resource_type", "resource_id", "unassigned_at",
    name="unique_assignment"
)
```

**Issue**: `unassigned_at` is NULL for active assignments. PostgreSQL treats NULL as equal for uniqueness (PostgreSQL 15+), but this is version-dependent.

**Better Approach**: Partial unique index:
```sql
CREATE UNIQUE INDEX unique_active_assignment
ON incident_assignments(incident_id, resource_type, resource_id)
WHERE unassigned_at IS NULL;
```

---

## Session Configuration

**File**: `backend/app/database.py:22-28`

```python
async_session_maker = async_sessionmaker(
    engine,
    expire_on_commit=False,    # Prevents detached instance errors
    autocommit=False,          # Explicit transaction control
    autoflush=False,           # Explicit flush points
)
```

All settings are correct for async usage.

**Note**: No explicit `isolation_level` set - uses PostgreSQL default (READ COMMITTED), which is sufficient for this application.

---

## Recommendations Summary

| Priority | Issue | Action |
|----------|-------|--------|
| High | Missing indexes | Add indexes on status, availability, sort fields |
| High | Event CASCADE delete | Change to SET NULL or soft-delete only |
| High | Connection pool size | Reduce audit max_overflow to 5 |
| Medium | Dual-commit pattern | Standardize transaction handling |
| Medium | Audit in main transaction | Use separate audit_engine |
| Medium | Soft-delete inconsistency | Standardize to deleted_at |
| Low | Redundant vehicle relationship | Remove viewonly relationship |
| Low | Partial unique index | Add for active assignments |
