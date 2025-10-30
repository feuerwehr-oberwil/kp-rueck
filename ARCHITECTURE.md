# System Architecture

KP Rück Dashboard is a real-time incident management system for tactical firefighting operations. This document describes the technical architecture and design decisions.

## Architecture Overview

### System Design Philosophy

- **Monolithic simplicity**: Single codebase for ease of deployment and maintenance
- **Polling over WebSockets**: Simple synchronization model (≤5s intervals)
- **Docker-first deployment**: Consistent environments across dev/staging/production
- **Progressive enhancement**: Build features iteratively, ship early

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Client Layer                         │
│  ┌──────────────────┐        ┌──────────────────┐      │
│  │  Desktop Editor  │        │  Mobile Viewer   │      │
│  │  (Drag & Drop)   │        │  (Read-Only)     │      │
│  └──────────────────┘        └──────────────────┘      │
│           │                            │                │
│           └────────────┬───────────────┘                │
│                        │                                │
│                   HTTP/HTTPS                            │
│                        │                                │
└────────────────────────┼────────────────────────────────┘
                         │
┌────────────────────────┼────────────────────────────────┐
│                  Backend Layer                          │
│                        │                                │
│           ┌────────────▼────────────┐                   │
│           │     FastAPI Server      │                   │
│           │  ┌──────────────────┐   │                   │
│           │  │  REST API        │   │                   │
│           │  │  Authentication  │   │                   │
│           │  │  Business Logic  │   │                   │
│           │  └──────────────────┘   │                   │
│           └────────────┬────────────┘                   │
│                        │                                │
└────────────────────────┼────────────────────────────────┘
                         │
┌────────────────────────┼────────────────────────────────┐
│                   Data Layer                            │
│           ┌────────────▼────────────┐                   │
│           │   PostgreSQL Database   │                   │
│           │  ┌──────────────────┐   │                   │
│           │  │  Incidents       │   │                   │
│           │  │  Personnel       │   │                   │
│           │  │  Vehicles        │   │                   │
│           │  │  Materials       │   │                   │
│           │  │  Assignments     │   │                   │
│           │  │  Audit Log       │   │                   │
│           │  └──────────────────┘   │                   │
│           └─────────────────────────┘                   │
└─────────────────────────────────────────────────────────┘
```

## Technology Stack

### Frontend
- **Framework**: Next.js 15 (App Router)
- **UI Library**: React 19
- **Language**: TypeScript
- **Styling**: Tailwind CSS 4
- **Drag & Drop**: @dnd-kit
- **Maps**: Leaflet + OpenStreetMap
- **Components**: shadcn/ui

**Why these choices?**
- Next.js App Router provides excellent server/client component separation
- TypeScript ensures type safety across the entire frontend
- Tailwind enables rapid UI development
- @dnd-kit is lightweight and performant for Kanban boards

### Backend
- **Framework**: FastAPI (Python)
- **ORM**: SQLAlchemy 2.0 (async)
- **Database**: PostgreSQL 16
- **Validation**: Pydantic V2
- **Server**: uvicorn (ASGI)
- **Package Manager**: uv

**Why these choices?**
- FastAPI provides automatic OpenAPI docs and excellent async support
- SQLAlchemy 2.0 async engine enables high-performance database operations
- Pydantic V2 ensures request/response validation
- uv is fast and modern for Python dependency management

### Infrastructure
- **Deployment**: Docker Compose + Railway
- **Database**: PostgreSQL 16 (managed on Railway)
- **Photo Storage**: Docker volumes with filesystem storage
- **Backups**: Automated pg_dump (30-day retention)

## System Components

### Frontend Application

**Location**: `frontend/`

#### Key Directories
```
frontend/
├── app/                      # Next.js App Router
│   ├── page.tsx              # Main Kanban dashboard
│   ├── map/                  # Map view
│   ├── check-in/             # Personnel check-in
│   ├── reko/                 # Field reconnaissance forms
│   └── settings/             # System settings
├── components/               # Reusable UI components
│   ├── ui/                   # shadcn components
│   ├── kanban/               # Kanban board components
│   └── map-view.tsx          # Leaflet map integration
└── lib/
    ├── contexts/             # React contexts for state
    ├── api-client.ts         # Backend API client
    └── hooks/                # Custom React hooks
```

#### State Management
- **React Context**: Global state for incidents, personnel, vehicles
- **Polling mechanism**: Client polls backend every 5 seconds for updates
- **Optimistic updates**: UI updates immediately, reconciles with backend
- **Last-write-wins**: Simple conflict resolution strategy

#### Authentication
- **JWT tokens**: Stored in httpOnly cookies
- **Roles**: Editor (full CRUD) vs Viewer (read-only)
- **Session management**: 15-minute access tokens, refresh tokens for renewal

### Backend API

**Location**: `backend/`

#### Key Directories
```
backend/
├── app/
│   ├── main.py              # FastAPI application
│   ├── config.py            # Pydantic settings
│   ├── database.py          # SQLAlchemy async engine
│   ├── models.py            # Database models
│   ├── schemas.py           # Pydantic request/response schemas
│   ├── api/                 # API endpoints
│   │   ├── incidents.py
│   │   ├── personnel.py
│   │   ├── vehicles.py
│   │   ├── materials.py
│   │   ├── auth.py
│   │   └── reko.py
│   ├── crud/                # Database operations
│   ├── auth/                # Authentication logic
│   ├── services/            # Business logic services
│   └── middleware/          # Custom middleware
└── alembic/                 # Database migrations
```

#### API Design Patterns

**Dependency Injection**
```python
# Database session
async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with async_session_maker() as session:
        yield session

# Current user
async def get_current_user(token: str = Depends(oauth2_scheme)):
    return verify_jwt_token(token)
```

**Async everywhere**
- All database operations use `async/await`
- Async context managers for session handling
- AsyncSession for SQLAlchemy operations

**Error handling**
- HTTP exceptions with proper status codes
- Validation errors from Pydantic
- Database constraint errors caught and handled

### Database Schema

#### Core Tables

**incidents**
- Primary entity for tracking operations
- Fields: id, title, type, priority, status, location, training_flag
- Status workflow: eingegangen → reko → disponiert → einsatz → abschluss

**personnel**
- Firefighter roster with availability tracking
- Fields: id, name, role, status (available/assigned/unavailable)

**vehicles**
- Fire apparatus inventory
- Fields: id, name, type (TLF/DLK/MTW), status, current_location

**materials**
- Equipment and resources
- Fields: id, name, type, status, location

**incident_assignments**
- Many-to-many relationships between incidents and resources
- Tracks which personnel/vehicles/materials are assigned to which incident

**reko_reports**
- Field reconnaissance reports
- Linked to incidents via incident_id
- Supports photo uploads and structured form data

**audit_log**
- Comprehensive action logging
- Tracks: user_id, action_type, resource_type, changes, timestamp

**users**
- Authentication and authorization
- Fields: id, username, password_hash, role (editor/viewer)

**settings**
- System configuration key-value store
- Example: polling_interval, max_photos_per_report

#### Database Patterns

**UUIDs for primary keys**
- All tables use UUID primary keys for distributed system compatibility

**Soft deletes**
- Incidents marked as archived rather than hard deleted
- Enables data retention and audit trail

**JSON/JSONB fields**
- Flexible structured data (e.g., reko report dangers, audit log changes)
- Indexed JSONB for query performance

**Timestamps**
- created_at, updated_at on all major tables
- Automatic timestamp updates via SQLAlchemy

## Key Architectural Patterns

### Polling-Based Synchronization

**Why polling instead of WebSockets?**
- Simpler to implement and debug
- No connection state to manage
- Works reliably behind firewalls/proxies
- Sufficient for ≤5s update requirements

**How it works:**
1. Frontend polls `/api/sync/state` endpoint every 5 seconds
2. Backend returns only changed data since last poll (via `updated_at` timestamps)
3. Frontend merges changes into local state
4. Optimistic updates: UI changes immediately, reconciled on next poll

### Training Mode

**Implementation:**
- Single `training_flag` boolean on incidents table
- No separate tables or databases for training data
- All users see training incidents (with visual indicators)
- Clear UI distinctions: banner, badges, color coding
- Filter option to show/hide training incidents

**Benefits:**
- Simplified data model
- Same workflows for training and live operations
- Easy transition from training to live (flip flag)

### Resource Assignment Conflicts

**Conflict detection:**
- Check if resource is already assigned before assignment
- Show warning in UI but allow override
- Log all assignments in audit trail

**Resolution:**
- UI warns: "Vehicle TLF-123 is already assigned to Incident X"
- User can choose to reassign (removes from previous incident)
- Audit log tracks the reassignment

### Photo Storage

**Filesystem-based storage:**
- Photos stored in Docker volumes (`/mnt/data/photos`)
- Automatic JPEG compression (40-70% reduction)
- Resize to max 1920px width
- Filename: `{report_id}_{timestamp}_{index}.jpg`

**Why not cloud storage (S3)?**
- Simpler deployment (no AWS credentials)
- Lower cost for small-scale deployments
- Easier local backup/restore
- Docker volume persistence sufficient for single-instance deployment

## Deployment Architecture

### Development Environment
```
docker-compose.dev.yml
├── postgres (port 5433)
├── backend (port 8000) - hot reload
└── frontend (port 3000) - hot reload
```

### Production Environment (Railway)
```
Railway Project
├── PostgreSQL Service (managed database)
├── Backend Service
│   ├── Docker container from /backend
│   ├── Volume: /mnt/data (photos)
│   └── Environment: DATABASE_URL, CORS_ORIGINS
└── Frontend Service
    ├── Docker container from /frontend
    └── Environment: NEXT_PUBLIC_API_URL
```

### Backup Strategy

**Automated backups:**
- Daily pg_dump to cloud storage
- 30-day retention policy
- Photo directory included in backups

**Disaster recovery:**
- Restore from latest backup
- Photo files restored from backup
- Database migrations applied automatically

## Security Considerations

### Authentication
- Password hashing with bcrypt
- JWT tokens with 15-minute expiry
- HttpOnly cookies to prevent XSS
- CSRF protection via SameSite cookies

### Authorization
- Role-based access control (Editor/Viewer)
- API endpoints protected by role decorators
- Frontend components check user role

### Data Protection
- HTTPS/TLS in production
- Environment variables for secrets
- No sensitive data in logs
- Audit trail for compliance

### Photo Upload Security
- File type validation (JPEG/PNG only)
- Size limits (10MB per photo)
- Automatic sanitization via re-encoding
- Stored outside web root

## Performance Optimization

### Database
- Indexes on foreign keys and frequently queried columns
- Connection pooling via SQLAlchemy
- Async operations throughout
- Query optimization with eager loading

### API
- Response caching for static data (vehicles, personnel lists)
- Efficient sync endpoint (only changed data)
- Pagination for large result sets

### Frontend
- Code splitting via Next.js
- Lazy loading of map components
- Optimistic UI updates
- Debounced search inputs

### Photo Storage
- Automatic compression on upload
- Lazy loading of photo thumbnails
- Progressive JPEG encoding

## Testing Strategy

### Backend Testing
- Unit tests with pytest
- Integration tests for API endpoints
- Database transaction rollback in tests
- Mock external services

### Frontend Testing
- Component tests with Vitest
- Integration tests for user flows
- E2E tests with Playwright
- Visual regression testing

## Monitoring & Observability

### Logging
- Structured JSON logs
- Log levels: DEBUG, INFO, WARNING, ERROR
- Request/response logging in middleware
- Audit log for all data changes

### Health Checks
- `/health` endpoint for backend status
- Database connectivity check
- Photo storage directory check

### Metrics (future)
- Response time monitoring
- Database query performance
- User activity metrics
- Error rate tracking

## Scalability Considerations

### Current Scale
- Designed for: 3 editors, 50 viewers
- Expected load: 10-20 concurrent users
- Data volume: ~1000 incidents/year

### Future Scaling Options
- Vertical scaling on Railway (more CPU/RAM)
- Read replicas for PostgreSQL
- CDN for static assets
- Redis caching layer
- WebSocket upgrade for real-time updates

## Trade-offs & Future Improvements

### Current Limitations
- **Polling overhead**: 5-second intervals create some network traffic
- **Single database**: No horizontal scaling without reengineering
- **Filesystem photos**: Not suited for multi-instance deployment
- **Simple conflict resolution**: Last-write-wins can lose edits

### Potential Improvements
- Upgrade to WebSockets for real-time updates
- Move photos to S3-compatible storage
- Add Redis for caching and rate limiting
- Implement operational transform for collaborative editing
- Progressive Web App (PWA) for offline support
- Advanced analytics and reporting dashboard

## References

- [FastAPI Documentation](https://fastapi.tiangolo.com/)
- [Next.js App Router](https://nextjs.org/docs/app)
- [SQLAlchemy 2.0 Async](https://docs.sqlalchemy.org/en/20/orm/extensions/asyncio.html)
- [Leaflet Maps](https://leafletjs.com/)
- [Railway Deployment](https://docs.railway.app/)

---

**Note**: This is a living document. Update as the architecture evolves.
