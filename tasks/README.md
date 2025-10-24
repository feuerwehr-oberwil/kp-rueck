# KP Rück - Task Documentation

This directory contains comprehensive task documentation for implementing the KP Rück Digital Einsatz-Board system. Each task is designed to be completed independently in a git worktree.

## How to Use These Tasks

### Quick Start

```bash
# 1. Create a new worktree for a task
git worktree add ../kp-rueck-task-1.1 -b task/1.1-database-schema

# 2. Navigate to the worktree
cd ../kp-rueck-task-1.1

# 3. Open Claude Code and say:
"Implement the feature described in tasks/phase-1-core/1.1-database-schema-migration.md"

# 4. When complete, commit and push
git add .
git commit -m "feat: implement complete database schema with migrations"
git push origin task/1.1-database-schema

# 5. Merge back to main
cd ../kp-rueck-testing
git merge task/1.1-database-schema
git push origin main

# 6. Clean up worktree
git worktree remove ../kp-rueck-task-1.1
```

## Task Organization

### Phase 1: Core Infrastructure (Weeks 1-2)
**Priority**: Must complete in order
**Goal**: Production-ready backend foundation

- **1.1**: [Database Schema Migration](phase-1-core/1.1-database-schema-migration.md) ⭐ START HERE
  - Complete production schema with UUID primary keys
  - Alembic migrations setup
  - Best practices: indexes, constraints, JSONB
  - Time: 8-12 hours

- **1.2**: [JWT Authentication System](phase-1-core/1.2-authentication-system.md)
  - httpOnly cookie-based JWT auth
  - Role-based access control (Editor/Viewer)
  - Password hashing with bcrypt
  - Time: 10-14 hours

- **1.3**: [Audit Logging System](phase-1-core/1.3-audit-logging-system.md)
  - Comprehensive action tracking
  - Before/after state capture
  - IP and user agent logging
  - Time: 6-8 hours

- **1.4**: [Settings Management](phase-1-core/1.4-settings-management.md)
  - Database-backed configuration
  - Runtime updates without restart
  - Time: 4-6 hours

### Phase 2: Incident Management & Kanban (Weeks 3-4)
**Priority**: Core business logic
**Goal**: Functional operations board

- **2.1**: [Incident CRUD & Status Management](phase-2-kanban/2.1-incident-management.md)
  - Complete incident lifecycle
  - Status transitions tracking
  - Training mode filtering
  - Optimistic locking
  - Time: 10-14 hours

- **2.2**: [Resource Assignment System](phase-2-kanban/2.2-assignment-system.md)
  - Many-to-many assignments
  - Conflict detection
  - Auto-release on completion
  - Time: 8-10 hours

- **2.3**: [Kanban Board UI](phase-2-kanban/2.3-kanban-board-ui.md)
  - Drag-and-drop status updates
  - Real-time polling sync
  - Incident cards with badges
  - Time: 12-16 hours

- **2.4**: [Master Lists UI](phase-2-kanban/2.4-master-lists-ui.md)
  - Personnel management
  - Vehicle management
  - Materials management
  - Time: 8-10 hours

### Phase 3: Map Integration (Week 5)
**Priority**: High value-add feature
**Goal**: Situational awareness

- **3.1**: [Geocoding Service](phase-3-map/3.1-geocoding-service.md)
  - Nominatim integration
  - Address validation
  - Coordinates storage
  - Time: 6-8 hours

- **3.2**: [Map View UI](phase-3-map/3.2-map-view-ui.md)
  - Leaflet.js integration
  - Incident markers
  - Status-based coloring
  - Time: 8-10 hours

### Phase 4: Field Operations & Data Collection (Week 6)
**Priority**: Unique firefighting features
**Goal**: Field personnel check-in and reconnaissance data collection

- **4.1**: [Reko Forms Backend](phase-4-reko/4.1-reko-forms-backend.md)
  - Token-based access
  - Structured JSONB data
  - Draft save functionality
  - Time: 8-10 hours

- **4.2**: [Personnel Check-In System](phase-4-reko/4.2-personnel-check-in.md)
  - Token-based mobile check-in
  - QR code access
  - On-site presence tracking
  - Time: 6-8 hours

- **4.3**: [Reko Forms Frontend](phase-4-reko/4.3-reko-forms-frontend.md)
  - Mobile-optimized form UI
  - Auto-save drafts
  - Resume capability
  - Time: 10-12 hours

- **4.4**: [Photo Upload & Storage](phase-4-reko/4.4-photo-upload-storage.md)
  - Filesystem storage
  - Automatic compression
  - Secure serving
  - Time: 6-8 hours

### Phase 5: Integrations (Week 7)
**Priority**: External system integration
**Goal**: Automated incident creation

- **5.1**: [Alarm Webhook API](phase-5-integrations/5.1-alarm-webhook.md)
  - Webhook endpoint
  - Auto-create incidents
  - Payload validation
  - Time: 6-8 hours

- **5.2**: [DIVERA API Integration](phase-5-integrations/5.2-divera-integration.md)
  - DIVERA 24/7 API polling
  - Bi-directional sync
  - Personnel notifications
  - Time: 10-14 hours
  - **Note**: Production Ready phase (March 2026), not MVP

### Phase 6: Production Readiness (Weeks 8-9)
**Priority**: Deployment and polish
**Goal**: Production-ready system

- **6.1**: [Railway Deployment](phase-6-production/6.1-railway-deployment.md)
  - Multi-service setup
  - Environment configuration
  - CI/CD pipeline
  - Time: 8-10 hours

- **6.2**: [Database Backup & Sync](phase-6-production/6.2-database-backup-sync.md)
  - Automated backups
  - Local failover sync
  - Health check monitoring
  - Time: 6-8 hours

- **6.3**: [UI Polish & Features](phase-6-production/6.3-ui-polish-features.md)
  - Filters and search
  - Incident timers
  - Training mode UI
  - Archive functionality
  - Time: 12-16 hours

- **6.4**: [Performance Optimization](phase-6-production/6.4-performance-optimization.md)
  - Database indexing review
  - API response caching
  - Frontend code splitting
  - Time: 8-10 hours

### Phase 7: Testing (Throughout + Week 10)
**Priority**: Quality assurance
**Goal**: Production confidence

- **7.1**: [Backend Testing](phase-7-testing/7.1-backend-testing.md)
  - Unit tests (pytest)
  - Integration tests
  - 80%+ coverage target
  - Time: 12-16 hours

- **7.2**: [Frontend Testing](phase-7-testing/7.2-frontend-testing.md)
  - Component tests (Vitest)
  - React Testing Library
  - 70%+ coverage target
  - Time: 10-12 hours

- **7.3**: [E2E Testing](phase-7-testing/7.3-e2e-testing.md)
  - Playwright tests
  - Critical user flows
  - Cross-browser testing
  - Time: 12-16 hours

### Phase 8: Post-MVP Enhancements (Summer 2026+)
**Priority**: Future work / Nice-to-haves
**Goal**: Enhancements based on real-world usage feedback

**See**: [Phase 8 README](phase-8-post-mvp/README.md) for full details

This phase includes potential enhancements from DESIGN_DOC.md Section 16:
- Real-time WebSocket updates (if polling insufficient)
- Offline-first PWA mode (if needed for field operations)
- Advanced role-based permissions (beyond Editor/Viewer)
- DIVERA → WhatsApp notification bridge
- Map clustering for high incident volume
- Dashboard KPIs and analytics
- Mobile native app (React Native)
- AI-assisted incident classification
- Video/audio attachments for Reko reports
- Integration with other emergency services

**⚠️ Important**: Phase 8 features should **only be implemented** if:
- Real-world usage demonstrates clear need
- Users explicitly request the feature
- Analytics/audit logs show measurable pain points
- Core MVP and Production Ready features are stable

## Task Dependency Graph

```
1.1 Database Schema ⭐ START HERE
 ├─→ 1.2 Authentication
 │    ├─→ 1.3 Audit Logging
 │    │    ├─→ 1.4 Settings
 │    │    ├─→ 2.1 Incident CRUD
 │    │    │    ├─→ 2.2 Assignments
 │    │    │    │    ├─→ 2.3 Kanban UI
 │    │    │    │    └─→ 2.4 Master Lists UI
 │    │    │    ├─→ 3.1 Geocoding
 │    │    │    │    └─→ 3.2 Map UI
 │    │    │    ├─→ 4.1 Reko Backend
 │    │    │    │    ├─→ 4.3 Reko Frontend
 │    │    │    │    └─→ 4.4 Photo Upload
 │    │    │    ├─→ 4.2 Personnel Check-In
 │    │    │    ├─→ 5.1 Alarm Webhook
 │    │    │    └─→ 5.2 DIVERA Integration (March 2026)
 │    │    └─→ 6.1 Railway Deployment
 │    │         ├─→ 6.2 Backup & Sync
 │    │         ├─→ 6.3 UI Polish
 │    │         └─→ 6.4 Performance
 └─→ 7.1 Backend Testing (parallel to all)
     ├─→ 7.2 Frontend Testing (parallel to all)
     └─→ 7.3 E2E Testing (after core features)
```

## Estimated Timeline

| Phase | Duration | Parallel Work Possible | Blockers |
|-------|----------|----------------------|----------|
| Phase 1 | 2 weeks | No (sequential) | None |
| Phase 2 | 2 weeks | 2.3 & 2.4 can parallelize after 2.1+2.2 | Phase 1 complete |
| Phase 3 | 1 week | Can parallelize with Phase 4 | Phase 2.1 complete |
| Phase 4 | 1 week | 4.2 can parallelize with Phase 3, 4.1/4.3/4.4 sequential | Phase 2.1 complete |
| Phase 5 | 1 week (5.1 only for MVP) | 5.2 is March 2026 enhancement | Phase 2.1 complete |
| Phase 6 | 2 weeks | 6.1-6.4 can run in parallel | Phase 2.3 complete (need UI) |
| Phase 7 | Throughout + 1 week final | All tasks have tests | None (parallel) |
| Phase 8 | Post-MVP (Summer 2026+) | User-driven implementation | All core features stable |

**Total (MVP)**: 10 weeks with parallel work, ~16 weeks if fully sequential
**Total (Production Ready with DIVERA)**: +2 weeks for Task 5.2 (March 2026)

## Task File Format

Each task file includes:

1. **Overview**: What the task accomplishes
2. **Prerequisites**: Required completed tasks
3. **Current State Analysis**: What exists vs. what's needed
4. **Implementation Steps**: Detailed step-by-step guide
5. **Code Examples**: Production-ready code snippets
6. **Testing Requirements**: Unit/integration tests
7. **Acceptance Criteria**: Definition of "done"
8. **Security Considerations**: Potential vulnerabilities
9. **Performance Notes**: Optimization tips
10. **References**: Links to design docs and specs

## Best Practices

### Before Starting a Task

1. ✅ Read the entire task file thoroughly
2. ✅ Verify all prerequisites are met
3. ✅ Check current codebase state
4. ✅ Create a new git worktree
5. ✅ Review referenced design docs

### During Implementation

1. ✅ Follow the code examples (but adapt as needed)
2. ✅ Write tests as you code (TDD where possible)
3. ✅ Run existing tests frequently (`make test`)
4. ✅ Commit often with descriptive messages
5. ✅ Update documentation as you go

### After Completion

1. ✅ Verify all acceptance criteria met
2. ✅ Run full test suite (`make test`)
3. ✅ Check code quality (`make lint`)
4. ✅ Test locally with Docker (`make dev`)
5. ✅ Review changes before committing
6. ✅ Write clear commit message
7. ✅ Push and create PR if using PRs
8. ✅ Merge back to main
9. ✅ Clean up worktree

## Getting Help

If a task is unclear or you encounter issues:

1. Check the **References** section for design doc context
2. Review **IMPLEMENTATION_PLAN.md** for architectural decisions
3. Check **DESIGN_DOC.md** for business requirements
4. Look at existing code for patterns to follow
5. Ask Claude Code for clarification on specific sections

## Task Status Tracking

Create a `task-status.md` file to track progress:

```markdown
# Task Progress

## Completed ✅
- [x] 1.1 Database Schema Migration
- [x] 1.2 JWT Authentication

## In Progress 🚧
- [ ] 1.3 Audit Logging

## Blocked 🚫
- [ ] 2.3 Kanban UI (waiting for 2.1)

## Not Started ⏸️
- [ ] 3.1 Geocoding Service
```

## Contributing

When adding new tasks:

1. Follow the same format as existing tasks
2. Include comprehensive code examples
3. Specify dependencies clearly
4. Add to this README's task list
5. Update dependency graph

---

**Start Here**: [Task 1.1 - Database Schema Migration](phase-1-core/1.1-database-schema-migration.md) ⭐
