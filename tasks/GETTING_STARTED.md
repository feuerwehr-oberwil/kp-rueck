# Getting Started with KP Rück Development Tasks

## Quick Start Guide

### Your First Task

1. **Start with Task 1.1** - Database Schema Migration
   ```bash
   # Create worktree
   git worktree add ../kp-rueck-task-1.1 -b task/1.1-database-schema

   # Navigate
   cd ../kp-rueck-task-1.1

   # Open in Claude Code and say:
   "Implement the feature described in tasks/phase-1-core/1.1-database-schema-migration.md"
   ```

2. **Complete the task** following the documentation

3. **Test your work**
   ```bash
   # Backend tests
   cd backend && uv run pytest

   # Database migrations
   uv run alembic upgrade head
   uv run alembic downgrade -1  # Test rollback

   # Start the system
   make dev
   ```

4. **Commit and merge**
   ```bash
   git add .
   git commit -m "feat: implement complete database schema with UUID PKs and migrations"
   git push origin task/1.1-database-schema

   # Switch back to main
   cd ../kp-rueck-testing
   git merge task/1.1-database-schema
   git push origin main

   # Clean up
   git worktree remove ../kp-rueck-task-1.1
   ```

---

## Understanding the Task Structure

### Task Documentation Format

Each task file includes:

```markdown
# Task X.Y: Feature Name

**Phase**: Which phase this belongs to
**Complexity**: Low | Medium | High
**Priority**: P0 (critical) | P1 | P2
**Estimated Time**: Hours needed

## Overview
What this task accomplishes

## Prerequisites
What must be completed first

## Implementation Steps
1. Detailed step-by-step guide
2. Production-ready code examples
3. Best practices and design patterns

## Testing Requirements
Unit tests, integration tests, E2E tests

## Acceptance Criteria
Definition of "done"

## Security Considerations
Potential vulnerabilities to avoid

## Performance Notes
Optimization tips

## References
Links to design docs
```

---

## Development Workflow

### Recommended Order

**Week 1-2: Core Infrastructure**
```bash
Task 1.1: Database Schema       ⭐ START HERE (12h)
Task 1.2: Authentication        (14h)
Task 1.3: Audit Logging         (8h)
Task 1.4: Settings Management   (6h)
```

**Week 3-4: Incident Management**
```bash
Task 2.1: Incident CRUD         (14h)
Task 2.2: Assignment System     (10h)
Task 2.3: Kanban Board UI       (16h) - Can parallelize with 2.4
Task 2.4: Master Lists UI       (10h) - Can parallelize with 2.3
```

**Week 5: Map Integration**
```bash
Task 3.1: Geocoding Service     (8h)  - Can parallelize with Phase 4
Task 3.2: Map View UI           (10h)
```

**Week 6: Reko Forms**
```bash
Task 4.1: Reko Backend          (10h)
Task 4.2: Reko Frontend         (12h)
Task 4.3: Photo Upload          (8h)
```

**Week 7: Integrations**
```bash
Task 5.1: Alarm Webhook         (8h)
```

**Week 8-9: Production**
```bash
Task 6.1: Railway Deployment    (10h)
Task 6.2: Database Backup       (8h)
Task 6.3: UI Polish             (16h)
Task 6.4: Performance           (10h)
```

**Throughout + Week 10: Testing**
```bash
Task 7.1: Backend Testing       (16h)
Task 7.2: Frontend Testing      (12h)
Task 7.3: E2E Testing           (16h)
```

---

## Best Practices

### Before Starting Any Task

✅ **Read the entire task file** - Don't skip ahead
✅ **Verify prerequisites** - Check all required tasks are done
✅ **Check current code** - Understand existing patterns
✅ **Create git worktree** - Isolate your work
✅ **Review design docs** - Understand business context

### During Development

✅ **Follow code examples** - They're production-ready patterns
✅ **Write tests first** - TDD where possible
✅ **Run tests frequently** - Catch issues early
✅ **Commit often** - Small, logical commits
✅ **Keep main in sync** - Pull rebase often

### Code Quality Standards

```python
# Backend - Python
- Type hints on all functions
- Async/await consistently
- Comprehensive docstrings
- Unit tests with pytest
- 80%+ code coverage

# Frontend - TypeScript
- Strict mode enabled
- Server components by default
- Client components marked
- Component tests with Vitest
- 70%+ component coverage
```

### Common Commands

```bash
# Development
make dev              # Start with hot reload
make logs             # View all logs
make logs-backend     # Backend only
make logs-frontend    # Frontend only

# Database
make shell-db         # PostgreSQL shell
make init-db          # Create tables
make seed-db          # Seed test data

# Testing
cd backend && uv run pytest           # Backend tests
cd frontend && pnpm test              # Frontend tests
cd frontend && pnpm test:ui           # Playwright UI mode

# Code Quality
cd backend && uv run ruff check .     # Lint
cd backend && uv run ruff format .    # Format
cd frontend && pnpm lint              # Frontend lint
```

---

## Task Dependencies Explained

### Why Order Matters

**Phase 1 MUST be sequential**:
- 1.1 creates database schema
- 1.2 needs `users` table from 1.1
- 1.3 needs `audit_log` table and auth from 1.2
- 1.4 needs `settings` table and audit logging

**Phase 2 can parallelize after 2.1+2.2**:
- 2.1 creates incident API (required for all)
- 2.2 creates assignment API (required for all)
- 2.3 (Kanban UI) can run parallel with 2.4 (Master Lists UI)

**Phases 3, 4, 5 can parallelize**:
- All need 2.1 (incidents API) but independent of each other
- Map (Phase 3) works standalone
- Reko (Phase 4) works standalone
- Webhook (Phase 5) works standalone

**Phase 6 needs UI complete**:
- Railway deployment needs working frontend
- But individual tasks (6.1-6.4) can parallelize

**Phase 7 runs throughout**:
- Write tests as you build features
- Final E2E tests need core features done

---

## Troubleshooting

### "Prerequisites not met"

Check that required tasks are fully complete:
```bash
# Verify database schema
make shell-db
\dt  # List tables - should see all 10 tables

# Verify migrations
cd backend && uv run alembic current
```

### "Tests failing"

Run tests in isolation:
```bash
# Single test file
cd backend && uv run pytest tests/test_models.py -v

# Single test
uv run pytest tests/test_models.py::test_incident_creation -v
```

### "Database migration issues"

Reset and retry:
```bash
# Rollback
cd backend && uv run alembic downgrade -1

# Re-apply
uv run alembic upgrade head

# If stuck, recreate database
make clean
make init-db
```

### "Frontend build errors"

Clear caches:
```bash
cd frontend
rm -rf .next node_modules
pnpm install
pnpm dev
```

---

## Getting Help

### Resources

1. **Task Documentation**: Your primary guide
2. **IMPLEMENTATION_PLAN.md**: Architectural decisions
3. **DESIGN_DOC.md**: Business requirements
4. **CLAUDE.md**: Project-specific instructions
5. **Makefile**: Quick command reference

### Asking Claude Code

**Good prompts**:
- "Implement the feature described in tasks/phase-1-core/1.1-database-schema-migration.md"
- "I'm stuck on the optimistic locking section of task 2.1. Can you explain the approach?"
- "The tests in task 1.2 are failing with JWT errors. Help me debug?"

**Bad prompts**:
- "Build the entire system" (too broad)
- "Fix this error" (without context)
- "Make it faster" (not specific)

---

## Success Criteria

### Task is "Done" When:

- [ ] All acceptance criteria met
- [ ] All tests passing (100% of new code)
- [ ] Code follows patterns from examples
- [ ] No security vulnerabilities introduced
- [ ] Performance meets targets
- [ ] Documentation updated
- [ ] Committed with clear message
- [ ] Merged to main successfully

### Commit Message Format

```bash
# Good
git commit -m "feat: implement JWT authentication with httpOnly cookies

- Add User model with bcrypt password hashing
- Implement access/refresh token flow
- Create login/logout/refresh endpoints
- Add role-based middleware (Editor/Viewer)
- Include comprehensive security tests

Closes task 1.2"

# Bad
git commit -m "auth stuff"
git commit -m "WIP"
```

---

## Next Steps

1. Read [README.md](README.md) for full task index
2. Review dependency graph
3. Start with [Task 1.1](phase-1-core/1.1-database-schema-migration.md) ⭐
4. Follow the implementation plan
5. Test thoroughly
6. Ship to production!

**Good luck! 🚀**
