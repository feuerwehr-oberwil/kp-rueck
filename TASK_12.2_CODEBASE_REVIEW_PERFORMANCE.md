# Task 12.2: Codebase Review & Performance Optimization

**Priority:** P2 (Important - Technical debt and performance)
**Complexity:** Medium-High
**Estimated Effort:** 6-10 hours
**Dependencies:** None
**Status:** Specification Complete - Not Implemented

---

## 1. Overview

Conduct comprehensive review of existing codebase for code quality, security vulnerabilities, performance bottlenecks, and technical debt. Implement optimizations to improve response times, reduce resource usage, and enhance maintainability.

### Business Value
- Faster page load times and better user experience
- Reduced server costs through optimization
- Improved code maintainability
- Enhanced security posture
- Better scalability for growth

### Review Scope
1. **Backend Performance** - Database queries, API response times, caching
2. **Frontend Performance** - Bundle size, render performance, network requests
3. **Code Quality** - Type safety, error handling, code duplication
4. **Security** - Input validation, authentication, authorization
5. **Infrastructure** - Database indexes, connection pooling, caching

---

## 2. Review Checklist

### 2.1 Backend Performance

#### Database Optimization

**Current Issues to Investigate:**

```python
# ❌ N+1 Query Problem
async def get_incidents_with_assignments(db: AsyncSession):
    incidents = await db.execute(select(Incident))
    for incident in incidents.scalars():
        # This executes a query for EACH incident!
        assignments = await db.execute(
            select(Assignment).where(Assignment.incident_id == incident.id)
        )

# ✅ Solution: Eager Loading
async def get_incidents_with_assignments(db: AsyncSession):
    incidents = await db.execute(
        select(Incident)
        .options(selectinload(Incident.assignments))
    )
    # All assignments loaded in 2 queries total
```

**Database Index Review:**

```sql
-- Check missing indexes on frequently queried columns
EXPLAIN ANALYZE SELECT * FROM incidents WHERE event_id = '...';
EXPLAIN ANALYZE SELECT * FROM assignments WHERE incident_id = '...';

-- Add indexes if needed
CREATE INDEX idx_incidents_event_id ON incidents(event_id);
CREATE INDEX idx_incidents_status ON incidents(status);
CREATE INDEX idx_assignments_incident_id ON assignments(incident_id);
CREATE INDEX idx_assignments_resource ON assignments(resource_type, resource_id);
CREATE INDEX idx_status_transitions_incident ON status_transitions(incident_id, timestamp);
```

**Connection Pool Tuning:**

```python
# backend/app/database.py

from sqlalchemy.ext.asyncio import create_async_engine

engine = create_async_engine(
    DATABASE_URL,
    # Current settings - may need tuning
    pool_size=5,              # Increase for production?
    max_overflow=10,          # Max additional connections
    pool_timeout=30,          # Timeout waiting for connection
    pool_recycle=3600,        # Recycle connections after 1 hour
    pool_pre_ping=True,       # Test connections before use
)
```

#### API Response Caching

```python
# backend/app/middleware/cache.py

from functools import lru_cache
from datetime import datetime, timedelta
import hashlib

class ResponseCache:
    """Simple in-memory response cache."""

    def __init__(self):
        self.cache = {}
        self.ttl = timedelta(seconds=5)

    def get(self, key: str):
        if key in self.cache:
            value, expires_at = self.cache[key]
            if datetime.utcnow() < expires_at:
                return value
            else:
                del self.cache[key]
        return None

    def set(self, key: str, value):
        expires_at = datetime.utcnow() + self.ttl
        self.cache[key] = (value, expires_at)

# Usage in endpoints
@router.get("/incidents/")
@cache_response(ttl=5)  # Cache for 5 seconds
async def get_incidents(...):
    ...
```

#### Async Optimization

```python
# ❌ Sequential API calls (slow)
async def process_incident(db: AsyncSession, incident_id: str):
    incident = await get_incident(db, incident_id)
    assignments = await get_assignments(db, incident_id)
    history = await get_status_history(db, incident_id)
    # Total time = time1 + time2 + time3

# ✅ Parallel API calls (fast)
async def process_incident(db: AsyncSession, incident_id: str):
    incident, assignments, history = await asyncio.gather(
        get_incident(db, incident_id),
        get_assignments(db, incident_id),
        get_status_history(db, incident_id),
    )
    # Total time = max(time1, time2, time3)
```

### 2.2 Frontend Performance

#### Bundle Size Analysis

```bash
# Analyze Next.js bundle size
cd frontend && pnpm build

# Expected output:
# Route (app)              Size     First Load JS
# ├ ○ /                    150 kB   250 kB
# ├ ○ /incidents           120 kB   220 kB
# └ ○ /map                 200 kB   300 kB  ⚠️ Large!
```

**Optimization Strategies:**

```typescript
// ❌ Import entire library
import { Map, Marker, Popup } from 'react-leaflet';
import * as _ from 'lodash';  // Imports ALL of lodash!

// ✅ Tree-shaking friendly imports
import dynamic from 'next/dynamic';
import debounce from 'lodash/debounce';  // Only import what you need

// Lazy load heavy components
const MapView = dynamic(() => import('@/components/map-view'), {
  ssr: false,  // Don't render on server
  loading: () => <div>Loading map...</div>,
});
```

#### React Performance

```typescript
// ❌ Re-renders on every prop change
function IncidentCard({ incident }) {
  return <div>{incident.title}</div>;
}

// ✅ Memoized component
const IncidentCard = React.memo(({ incident }) => {
  return <div>{incident.title}</div>;
}, (prevProps, nextProps) => {
  // Only re-render if incident changed
  return prevProps.incident.id === nextProps.incident.id &&
         prevProps.incident.updated_at === nextProps.incident.updated_at;
});

// ✅ Memoize expensive calculations
const expensiveValue = useMemo(() => {
  return calculateComplexStats(incidents);
}, [incidents]);  // Only recalculate when incidents change
```

#### Image Optimization

```typescript
// ❌ Large images loaded eagerly
<img src="/photos/reko1.jpg" alt="Reko photo" />

// ✅ Next.js Image with optimization
import Image from 'next/image';

<Image
  src="/photos/reko1.jpg"
  alt="Reko photo"
  width={800}
  height={600}
  loading="lazy"
  quality={75}  // Reduce quality for smaller file size
  placeholder="blur"
  blurDataURL="..."  // Low-quality placeholder
/>
```

### 2.3 Code Quality

#### Type Safety Improvements

```typescript
// ❌ Loose typing
const incidents: any[] = await apiClient.getIncidents();

// ✅ Strict typing
const incidents: ApiIncident[] = await apiClient.getIncidents();

// ❌ Unsafe access
const status = incident.status;  // Could be undefined!

// ✅ Safe access with optional chaining
const status = incident?.status ?? 'unknown';
```

#### Error Handling

```python
# ❌ Swallow errors
try:
    result = await some_operation()
except Exception:
    pass  # Errors are silently ignored!

# ✅ Proper error handling
try:
    result = await some_operation()
except SpecificError as e:
    logger.error(f"Operation failed: {e}")
    raise HTTPException(status_code=500, detail=str(e))
except Exception as e:
    logger.exception("Unexpected error")
    raise
```

#### Code Duplication

```python
# ❌ Duplicated CRUD logic
async def get_personnel(db: AsyncSession, id: UUID):
    result = await db.execute(select(Personnel).where(Personnel.id == id))
    return result.scalar_one_or_none()

async def get_vehicle(db: AsyncSession, id: UUID):
    result = await db.execute(select(Vehicle).where(Vehicle.id == id))
    return result.scalar_one_or_none()

# ✅ Generic CRUD base class
from typing import TypeVar, Generic, Type
from sqlalchemy.ext.asyncio import AsyncSession

ModelType = TypeVar("ModelType")

class CRUDBase(Generic[ModelType]):
    def __init__(self, model: Type[ModelType]):
        self.model = model

    async def get(self, db: AsyncSession, id: UUID) -> ModelType | None:
        result = await db.execute(select(self.model).where(self.model.id == id))
        return result.scalar_one_or_none()

    async def get_multi(self, db: AsyncSession, skip: int = 0, limit: int = 100):
        result = await db.execute(select(self.model).offset(skip).limit(limit))
        return result.scalars().all()

# Usage
personnel_crud = CRUDBase(Personnel)
vehicle_crud = CRUDBase(Vehicle)
```

### 2.4 Security Review

#### Input Validation

```python
# ❌ No validation
@router.post("/incidents/")
async def create_incident(data: dict):
    # Directly insert untrusted data!
    incident = Incident(**data)

# ✅ Pydantic validation
@router.post("/incidents/")
async def create_incident(data: schemas.IncidentCreate):
    # Pydantic validates all fields
    incident = Incident(**data.dict())
```

#### SQL Injection Prevention

```python
# ❌ String formatting (vulnerable!)
query = f"SELECT * FROM incidents WHERE title = '{user_input}'"

# ✅ SQLAlchemy ORM (safe)
query = select(Incident).where(Incident.title == user_input)
```

#### Authentication Bypass Check

```python
# ❌ Missing auth check
@router.delete("/incidents/{id}")
async def delete_incident(id: UUID):
    # Anyone can delete!

# ✅ Proper auth check
@router.delete("/incidents/{id}")
async def delete_incident(
    id: UUID,
    current_user: CurrentEditor,  # Requires editor role
):
    ...
```

---

## 3. Performance Monitoring

### 3.1 Backend Metrics

```python
# backend/app/middleware/metrics.py

from time import time
from fastapi import Request, Response
import logging

logger = logging.getLogger(__name__)

@app.middleware("http")
async def metrics_middleware(request: Request, call_next):
    """Log request duration and performance metrics."""
    start_time = time()

    response = await call_next(request)

    duration = time() - start_time
    logger.info(
        f"{request.method} {request.url.path} - {response.status_code} - {duration:.3f}s"
    )

    # Warn on slow requests
    if duration > 1.0:
        logger.warning(f"Slow request detected: {request.url.path} took {duration:.3f}s")

    response.headers["X-Response-Time"] = str(duration)
    return response
```

### 3.2 Database Query Logging

```python
# backend/app/config.py

class Settings(BaseSettings):
    # Enable SQL query logging in development
    sql_echo: bool = False  # Set to True to see all SQL queries

# In database.py
engine = create_async_engine(
    settings.database_url,
    echo=settings.sql_echo,  # Logs all SQL statements
)
```

### 3.3 Frontend Performance Monitoring

```typescript
// frontend/lib/performance.ts

export function measurePageLoad() {
  if (typeof window !== 'undefined' && window.performance) {
    const perfData = window.performance.timing;
    const pageLoadTime = perfData.loadEventEnd - perfData.navigationStart;
    const connectTime = perfData.responseEnd - perfData.requestStart;

    console.log('Page Load Time:', pageLoadTime + 'ms');
    console.log('Server Connect Time:', connectTime + 'ms');

    // Send to analytics
    if (pageLoadTime > 3000) {
      console.warn('Page load exceeded 3 seconds!');
    }
  }
}

// Use in app layout
useEffect(() => {
  measurePageLoad();
}, []);
```

---

## 4. Implementation Plan

### Phase 1: Analysis (2-3 hours)
- [ ] Run bundle analyzer on frontend
- [ ] Profile database queries with EXPLAIN ANALYZE
- [ ] Identify N+1 query patterns
- [ ] Check for missing database indexes
- [ ] Review authentication on all protected endpoints
- [ ] Analyze API response times
- [ ] Check for code duplication

### Phase 2: Backend Optimization (2-3 hours)
- [ ] Add missing database indexes
- [ ] Implement eager loading for relationships
- [ ] Add response caching for frequently accessed data
- [ ] Optimize slow database queries
- [ ] Add performance monitoring middleware
- [ ] Tune connection pool settings

### Phase 3: Frontend Optimization (2-3 hours)
- [ ] Implement code splitting for heavy components
- [ ] Add React.memo to frequently re-rendering components
- [ ] Optimize images with Next.js Image
- [ ] Lazy load map component
- [ ] Reduce bundle size with tree-shaking
- [ ] Add performance monitoring

### Phase 4: Code Quality (1-2 hours)
- [ ] Add missing TypeScript types
- [ ] Improve error handling
- [ ] Refactor duplicated code
- [ ] Add input validation where missing
- [ ] Document complex functions

---

## 5. Performance Targets

### Backend
- [ ] API response time < 200ms (95th percentile)
- [ ] Database queries < 100ms (95th percentile)
- [ ] No N+1 queries in hot paths
- [ ] All endpoints properly authenticated

### Frontend
- [ ] First Contentful Paint < 1.5s
- [ ] Time to Interactive < 3s
- [ ] Bundle size < 300kB (gzipped)
- [ ] No unnecessary re-renders

### Database
- [ ] All frequently queried columns indexed
- [ ] Query plans optimized
- [ ] Connection pool properly sized

---

## 6. Testing

### 6.1 Load Testing

```bash
# Install Apache Bench
brew install httpd

# Test API endpoint
ab -n 1000 -c 10 http://localhost:8000/api/incidents/

# Expected results:
# Requests per second: > 100
# Mean time per request: < 100ms
# 95th percentile: < 200ms
```

### 6.2 Frontend Performance Testing

```bash
# Lighthouse CI
npm install -g @lhci/cli

# Run performance audit
lhci autorun --collect.url=http://localhost:3000

# Target scores:
# Performance: > 90
# Accessibility: > 95
# Best Practices: > 90
# SEO: > 90
```

---

## 7. Documentation Updates

After optimization, update:

- [ ] Architecture diagram with caching layers
- [ ] Performance benchmarks in README
- [ ] Deployment optimization guide
- [ ] Database tuning recommendations

---

## Acceptance Criteria

✅ **Must Have:**
- [ ] All database queries have proper indexes
- [ ] No N+1 query patterns in production code
- [ ] API response times meet targets
- [ ] Frontend bundle size optimized
- [ ] All endpoints properly authenticated
- [ ] Error handling implemented throughout

🎯 **Should Have:**
- [ ] Response caching for frequently accessed data
- [ ] React component memoization
- [ ] Performance monitoring in place
- [ ] Code duplication reduced by 50%

💡 **Nice to Have:**
- [ ] Real-time performance dashboard
- [ ] Automated performance regression tests
- [ ] APM integration (Sentry, DataDog)
- [ ] Database query analyzer
