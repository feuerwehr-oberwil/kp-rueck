# KP Rück – Key Architectural Decisions

Version: 1.0
Date: 2025-10-23

This document captures all critical architectural decisions made during the planning phase to guide implementation and avoid future refactoring.

---

## Authentication & Security

### Decision: JWT Authentication
- **Chosen**: JWT with short-lived access tokens (15 min) + refresh tokens
- **Rejected**: Basic auth, session cookies only
- **Rationale**: Better mobile support, stateless, industry standard
- **Implementation**: PyJWT library, httpOnly cookies, comprehensive testing

### Decision: Token-based Reko Forms
- **Chosen**: Reusable tokens per responder type (no login required)
- **Rejected**: One-time tokens, login-protected forms
- **Rationale**: Simplicity for field users, low security risk for non-sensitive data
- **Implementation**: Token validation middleware, stored in `reko_reports.token`

---

## Real-time Updates

### Decision: Polling (No WebSockets in MVP)
- **Chosen**: Simple HTTP polling with user-configurable interval (default 5s)
- **Rejected**: WebSockets, Server-Sent Events, long polling
- **Rationale**:
  - Simpler implementation and debugging
  - Adequate for 3 editors + 50 viewers
  - Avoids connection lifecycle complexity
  - No load balancing complications
- **Future**: May add WebSockets only if performance issues arise

### Decision: Optimistic UI Updates
- **Chosen**: Optimistic updates with last-write-wins + conflict notifications
- **Rejected**: Pessimistic locking, complex CRDT
- **Rationale**: Maintains UI responsiveness, conflicts rare with 3 editors
- **Implementation**: Version tracking, rollback on failure, audit log for resolution

---

## Data Architecture

### Decision: Many-to-Many with Warnings (Not Hard Locks)
- **Chosen**: Junction table with conflict warnings in UI, allow override
- **Rejected**: Hard locks preventing double-assignment, one-to-many only
- **Rationale**: Flexibility for edge cases (e.g., vehicle doing two small jobs)
- **Implementation**: `incident_assignments` table, UI warning badges

### Decision: Training Flag on Incidents (Same Database)
- **Chosen**: Single `training_flag` boolean on incidents table
- **Rejected**: Separate training database, global mode toggle
- **Rationale**: Simpler data model, easier filtering, support mixed scenarios
- **Implementation**: Filter UI, visual indicators, default to live

### Decision: Comprehensive Audit Log
- **Chosen**: Separate `audit_log` table for ALL actions + `status_transitions` for workflow
- **Rejected**: Status transitions only
- **Rationale**: Full traceability, debugging, compliance, incident review
- **Implementation**: Middleware logging, JSONB for before/after state

### Decision: Materials Master List with Location
- **Chosen**: Separate `materials` table with location field (vehicle or storage)
- **Rejected**: Materials as incident metadata only
- **Rationale**: Reusability, availability tracking, assignment conflicts
- **Implementation**: Similar to vehicles/personnel, free-text location

---

## Integration Strategy

### Decision: Alarm Server Webhook (Primary)
- **Chosen**: Webhook from existing alarm server as primary integration
- **Rejected**: Direct DIVERA API polling as primary
- **Rationale**: Leverage existing SMS → DIVERA conversion, simpler initial setup
- **Timeline**: MVP (November 2025)
- **Implementation**: POST endpoint with shared secret auth

### Decision: DIVERA API (Secondary, Later)
- **Chosen**: Add DIVERA polling in production-ready phase
- **Timeline**: March 2026
- **Rationale**: Focus MVP on core workflow, add bidirectional sync later
- **Implementation**: Poll for emergencies, send detailed assignments

---

## File Storage

### Decision: Filesystem Storage for Photos
- **Chosen**: Docker volume-mounted filesystem with UUID filenames
- **Rejected**: Database storage (base64/bytea), object storage (S3)
- **Rationale**:
  - Simpler deployment (no external services)
  - Better performance
  - Easier backup with database
- **Implementation**: Automatic compression (JPEG), static file serving

---

## Deployment & Failover

### Decision: One-Way DB Sync (No Dual Editing)
- **Chosen**: Railway → Local automated sync every 5 minutes, manual failover
- **Rejected**: Two-way sync, automatic failover, concurrent editing
- **Rationale**:
  - Avoids conflict resolution complexity
  - Railway is primary, local is emergency backup only
  - Simpler to reason about and debug
- **Implementation**: Cron job with pg_dump + pg_restore, health check UI warning

### Decision: Manual Failover Switch
- **Chosen**: Health check detects Railway outage, UI prompts manual switch
- **Rejected**: Automatic failover, DNS-based switching
- **Rationale**: Explicit decision during emergency, avoids accidental dual editing
- **Implementation**: Frontend environment toggle, local deployment ready with latest data

---

## Incident Workflow

### Decision: No Automatic Status Transitions
- **Chosen**: All transitions manual via drag-and-drop, only notifications/reminders
- **Rejected**: Auto-archiving after timeout, automatic workflows
- **Rationale**:
  - Maintains operator control
  - Mirrors physical board behavior
  - Avoids premature closure
- **Implementation**: Timer badges, configurable notifications

### Decision: Editable Reko Forms
- **Chosen**: Fully editable after submission, draft saving, resume capability
- **Rejected**: Immutable submissions, version history only
- **Rationale**: Field conditions change, corrections needed, progressive refinement
- **Implementation**: `updated_at` tracking, auto-save on change

---

## Data Model Specifics

### Decision: Predefined Incident Types & Priorities
- **Chosen**: Enums for type (fire/medical/technical/hazmat/other) and priority (low/medium/high/critical)
- **Rejected**: Free text, DIVERA-only categories
- **Rationale**: Consistency, filtering, UI design, alarm mapping
- **Implementation**: Database CHECK constraints, dropdown UI

### Decision: All Incidents Must Have Location
- **Chosen**: Location required, show warning for missing/invalid addresses
- **Rejected**: Optional location, hide from map
- **Rationale**: Critical for dispatching, map is core feature
- **Implementation**: Geocoding validation, special UI marker for missing location

---

## Testing Strategy

### Decision: Comprehensive Coverage with Defined Targets
- **Chosen**: 80% backend, 70% frontend, 100% E2E critical flows
- **Rejected**: 100% everywhere, minimal testing
- **Rationale**: Balance quality and velocity, focus on critical paths
- **Implementation**: pytest + Vitest + Playwright, CI/CD gates

---

## Version Tracking

### Decision: Git Tags + CHANGELOG + VERSION File
- **Chosen**: Semantic versioning with git tags, human-readable changelog, single VERSION file
- **Rejected**: Complex versioning system, no version tracking
- **Rationale**: Simple, standard, sufficient for deployment rollback
- **Implementation**: GitHub releases, CI/CD reads VERSION file

---

## Anti-Decisions (Explicitly NOT Doing)

These decisions prevent scope creep and future confusion:

1. **NO WebSockets in MVP** - Only add if polling proves insufficient
2. **NO two-way database sync** - Only Railway → Local, never concurrent
3. **NO automatic status transitions** - All manual, only reminders
4. **NO auto-purging of training data** - Manual deletion only
5. **NO hard locks on assignments** - Warnings only, allow override
6. **NO complex authentication** - Database seeding only, no self-registration
7. **NO object storage (S3)** - Filesystem with Docker volumes
8. **NO automatic failover** - Manual switch only during emergencies
9. **NO ETags for polling optimization** - Simple polling sufficient for scale

---

## Future Refactoring Risks Identified & Mitigated

### Risk: Polling → WebSocket Migration
- **Impact**: Moderate - would require frontend state management refactoring
- **Mitigation**: Abstract polling logic into hooks, prepare for swap-out
- **Likelihood**: Low - polling should handle expected load

### Risk: JWT → More Complex Auth
- **Impact**: Low - JWT is already token-based and extensible
- **Mitigation**: Use standard JWT claims structure, avoid custom logic
- **Likelihood**: Very Low - JWT sufficient for foreseeable needs

### Risk: Filesystem → Object Storage
- **Impact**: Low - abstraction layer for file operations
- **Mitigation**: Use FastAPI static files, easy to swap backend
- **Likelihood**: Low - unless multi-datacenter deployment needed

---

## Open Questions (To Resolve During Implementation)

1. **Geocoding API rate limits**: Monitor Nominatim usage, implement caching
2. **Photo retention policy**: Confirm 1-year retention acceptable
3. **Notification delivery mechanism**: Email? Push? In-app only?
4. **Performance under 50 viewers**: Load test to validate assumptions
5. **Alarm webhook retry logic**: Should failed webhooks retry? How many times?

---

## Document Maintenance

- **Review after Phase 1** (Week 2): Validate infrastructure decisions
- **Review after Phase 4** (Week 6): Validate data model and integrations
- **Review before Production** (Week 9): Final decision validation
- **Update on any architectural change**: Keep this document as single source of truth

---

**Status**: Finalized for MVP Development
**Next Review**: End of Week 2 (after core infrastructure complete)
**Maintained By**: Development Team
