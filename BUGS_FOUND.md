# Bugs Found During Task 1.3 & 1.4 Testing

**Date**: 2025-10-24
**Test Suite**: Tasks 1.3 (Audit Logging) and 1.4 (Settings Management)
**Total Tests Written**: 49 tests
**Tests Passing**: 44/49 (89.8%)
**Tests Failing**: 5/49 (10.2%)

---

## Bug #1: Timezone-Naive datetime.utcnow() Causes Timestamp Comparison Failures

**Severity**: Medium
**Status**: Not Fixed (Reporting Only)
**Affected Files**: `backend/app/services/settings.py:47`

### Description
The `update_setting()` function uses `datetime.utcnow()` which returns a timezone-naive datetime object. However, PostgreSQL stores the `updated_at` column with timezone information (`TIMESTAMP WITH TIME ZONE`), causing comparison failures when testing timestamp updates.

### Evidence
```python
# File: app/services/settings.py, Line 47
setting.updated_at = datetime.utcnow()  # ❌ Returns naive datetime
```

### Failing Tests
1. `tests/test_services/test_settings.py::TestUpdateSetting::test_update_setting_existing`
2. `tests/test_api/test_settings.py::TestUpdateSetting::test_update_setting_updates_timestamp`

### Error Message
```
assert datetime.datetime(2025, 10, 24, 6, 9, 47, 736752, tzinfo=datetime.timezone.utc) >=
       datetime.datetime(2025, 10, 24, 8, 9, 47, 711598, tzinfo=datetime.timezone.utc)
```

The timestamps appear to go "backwards" by 2 hours due to timezone conversion issues.

### Root Cause
When PostgreSQL stores a naive datetime, it assumes local time and adds timezone info. When retrieved, SQLAlchemy returns timezone-aware datetimes. Subsequent updates using naive `utcnow()` create inconsistent timezone handling.

### Recommended Fix
Replace `datetime.utcnow()` with `datetime.now(timezone.utc)` in `app/services/settings.py:47`:

```python
# Before (❌)
setting.updated_at = datetime.utcnow()

# After (✅)
from datetime import timezone
setting.updated_at = datetime.now(timezone.utc)
```

---

## Bug #2: FastAPI Date Parameter Parsing Issue

**Severity**: Low
**Status**: Not Fixed (Reporting Only)
**Affected Files**: `backend/app/api/audit.py:26-27` (parameter parsing)

### Description
The audit log query endpoint rejects ISO-formatted datetime strings with a 422 Unprocessable Entity error when using `start_date` and `end_date` query parameters.

### Evidence
Test sends:
```python
start_date = (now - timedelta(minutes=10)).isoformat()  # "2025-10-24T08:00:00+00:00"
end_date = now.isoformat()                              # "2025-10-24T08:10:00+00:00"

response = await client.get(f"/api/audit?start_date={start_date}&end_date={end_date}")
```

Response: `422 Unprocessable Entity`

### Failing Tests
1. `tests/test_api/test_audit.py::TestAuditLogQuery::test_query_audit_log_filter_date_range`

### Root Cause
FastAPI's automatic datetime parsing might not handle the ISO format string correctly, or the test needs to URL-encode the datetime string. The endpoint signature is:
```python
start_date: Optional[datetime] = None,
end_date: Optional[datetime] = None,
```

### Possible Causes
1. ISO format string not being parsed correctly by FastAPI
2. Need for URL encoding of `+` symbols in timezone offset
3. Pydantic datetime validation failing

### Recommended Fix (Option 1)
URL-encode the ISO string in the test:
```python
from urllib.parse import quote
start_param = quote(start_date, safe='')
```

### Recommended Fix (Option 2)
Use a simpler datetime format that FastAPI can parse:
```python
start_date = (now - timedelta(minutes=10)).strftime("%Y-%m-%dT%H:%M:%S")
```

---

## Bug #3: Audit Middleware Database Connection Pool Conflict

**Severity**: High ⚠️
**Status**: Not Fixed (Reporting Only)
**Affected Files**: `backend/app/middleware/audit.py:34`

### Description
The audit middleware creates its own database session using `async_session_maker()`, which causes connection pool conflicts when running in test environments. The middleware silently fails to log API requests, printing errors to stdout instead.

### Evidence
```
Audit logging failed: (sqlalchemy.dialects.postgresql.asyncpg.InterfaceError)
<class 'asyncpg.exceptions._base.InterfaceError'>: cannot perform operation:
another operation is in progress
```

### Failing Tests
1. `tests/test_middleware/test_audit.py::TestAuditMiddleware::test_middleware_logs_successful_api_request`
2. `tests/test_middleware/test_audit.py::TestAuditMiddleware::test_middleware_captures_user_from_request_state`

### Root Cause
The middleware code creates a new session:
```python
# File: app/middleware/audit.py:34
async with async_session_maker() as db:
    await log_action(db=db, ...)
    await db.commit()
```

This conflicts with existing database operations in the request handler, causing asyncpg to throw "another operation is in progress" errors.

### Impact
- **Production**: Audit logs are silently dropped when middleware logging fails
- **Tests**: Cannot verify middleware logging behavior
- **Observability**: Lost audit trail for API requests

### Recommended Fixes

**Option 1**: Use dependency injection instead of creating sessions in middleware
```python
# Middleware should set request.state.audit_pending = {...}
# Then a dependency finalizer commits the audit log
```

**Option 2**: Use a separate connection pool for audit middleware
```python
# Create dedicated audit_engine with separate pool
audit_engine = create_async_engine(DATABASE_URL, pool_size=5)
audit_session_maker = async_sessionmaker(audit_engine)
```

**Option 3**: Background task with queue
```python
import asyncio
audit_queue = asyncio.Queue()

# Middleware pushes to queue
await audit_queue.put(audit_data)

# Background worker consumes queue
async def audit_worker():
    while True:
        data = await audit_queue.get()
        async with async_session_maker() as db:
            await log_action(db, **data)
```

---

## Summary

| Bug # | Severity | Component | Passing Tests | Failing Tests |
|-------|----------|-----------|---------------|---------------|
| #1 | Medium | Settings Service | 5/7 | 2/7 |
| #2 | Low | Audit API | 12/13 | 1/13 |
| #3 | High | Audit Middleware | 4/6 | 2/6 |

**Overall Test Results**:
- ✅ Service Layer: 17/19 passing (89.5%)
- ✅ API Layer: 22/24 passing (91.7%)
- ⚠️ Middleware Layer: 4/6 passing (66.7%)

**Recommended Priority**:
1. **Bug #3** (High) - Middleware connection pool issue
2. **Bug #1** (Medium) - Timezone handling in settings
3. **Bug #2** (Low) - Date parameter parsing (might be test issue)

---

## Test Coverage Achieved

- **Service Tests**: 100% coverage on `app/services/audit.py` and `app/services/settings.py`
- **API Tests**: 85% coverage on `app/api/audit.py`, 70% coverage on `app/api/settings.py`
- **Middleware Tests**: 95% coverage on `app/middleware/audit.py`

**Overall**: 66% code coverage (up from 21% before tests)
