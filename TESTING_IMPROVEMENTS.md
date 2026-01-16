# Testing Improvements Plan

> **Status**: In Progress
> **Started**: 2026-01-16
> **Goal**: Ensure adding new features doesn't break existing ones

## Current State (Baseline)

| Metric | Value | Target |
|--------|-------|--------|
| Backend Tests | 744 | Maintain/Grow |
| Backend Coverage | 36.18% | 50% (then 70%) |
| Frontend E2E Tests | ~60 | Maintain/Grow |
| CI Blocking | No | Yes |

### Critical Coverage Gaps

| Service | Current | Target | Status |
|---------|---------|--------|--------|
| `export_service.py` | **94%** | 70% | Done |
| `event_export.py` | 0% | 70% | Pending |
| `training_autogen_task.py` | 0% | 70% | Pending |
| `sync_service.py` | 9% | 70% | Pending |
| `notification_service.py` | 11% | 70% | Pending |
| `excel_import_export.py` | 12% | 70% | Pending |

---

## Implementation Progress

### Phase 1: CI/CD Hardening

- [x] 1.1 Make backend tests blocking in CI (with 35% coverage threshold)
- [x] 1.2 Make frontend typecheck and build blocking in CI
- [ ] 1.3 Fix backend lint errors (87 remaining) to make blocking
- [ ] 1.4 Fix frontend lint errors (158 remaining) to make blocking
- [ ] 1.5 Add pre-commit hooks configuration

### Phase 2: Backend Test Coverage

- [x] 2.1 Add export_service.py tests (32 tests, 94% coverage)
- [ ] 2.2 Add sync_service.py tests
- [ ] 2.3 Add notification_service.py tests
- [ ] 2.4 Add event_export.py tests
- [ ] 2.5 Add excel_import_export.py tests
- [ ] 2.6 Add training_autogen_task.py tests

### Phase 3: Security Tests

- [ ] 3.1 SQL injection prevention tests
- [ ] 3.2 XSS prevention tests
- [ ] 3.3 Authorization boundary tests
- [ ] 3.4 Input validation tests

### Phase 4: Integration Tests

- [ ] 4.1 API contract validation
- [ ] 4.2 End-to-end workflow tests
- [ ] 4.3 Error recovery tests

---

## Commits Log

| Date | Commit | Description |
|------|--------|-------------|
| 2026-01-16 | 2434c75 | Phase 1: CI hardening - make tests/build blocking |
| 2026-01-16 | 2e1b8f1 | Phase 2.1: Add export_service.py tests (32 tests, 94% coverage) |

---

## Test Guidelines (Reference)

Based on Myers' "The Art of Software Testing":

### Test Case Design Principles

1. **Define expected output before testing** - Every test needs input + expected output
2. **Test invalid inputs** - Empty, null, boundary values, wrong types
3. **Check for side effects** - State changes, resource leaks, unintended calls
4. **Save all tests** - No throwaway tests, everything in version control

### What to Test for Each Function

```
- Normal inputs (happy path)
- Boundary values (min, max, just below, just above)
- Invalid inputs (wrong types, null, empty)
- Error conditions and exception handling
- Security inputs (injection attempts, XSS payloads)
```

### Coverage Goals

| Test Type | Coverage Goal |
|-----------|---------------|
| Unit Tests | 80%+ line coverage |
| Integration Tests | All critical paths |
| E2E Tests | All user-facing features |
| Security Tests | All input boundaries |

---

## Running Tests

```bash
# Backend
cd backend && uv run pytest                    # All tests
cd backend && uv run pytest --cov=app          # With coverage
cd backend && uv run pytest -k "test_export"   # Specific tests

# Frontend E2E
cd frontend && pnpm test                       # All E2E tests
cd frontend && pnpm test:ui                    # Interactive mode
cd frontend && pnpm test tests/e2e/01-auth/    # Specific suite

# Full CI simulation
make test                                      # E2E tests
cd backend && uv run ruff check . && uv run ruff format --check .
cd frontend && pnpm lint && pnpm exec tsc --noEmit
```
