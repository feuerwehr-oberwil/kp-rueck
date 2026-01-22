# Codebase Audit Report

**Generated**: 2026-01-22
**Status**: Active tracking document

This document tracks all TODOs, unfinished work, and known bugs in the KP Rück codebase.

---

## 1. Implementation Plan Status

**Source**: `IMPLEMENTATION_PLAN.md`

| # | Issue | Category | Status |
|---|-------|----------|--------|
| 2 | Transaction isolation for assignments | Reliability | ✅ Done |
| 3 | Retry + state refresh for 409 Conflict | Reliability | ✅ Done |
| 4 | Create bulk reko endpoint | Performance | ✅ Done |
| 5 | Fix opacity-60 contrast issue | UI/UX | ✅ Done |
| 6 | Add rate limiting middleware | Security | ✅ Done |
| 7 | Replace detail=str(e) with generic errors | Security | ✅ Done |
| 8 | Add jitter + exponential backoff to polling | Performance | ✅ Done |
| 9 | Increase mobile filter buttons to 44px | UI/UX | ✅ Done |
| 10 | Add missing database indexes | Performance | ✅ Done |
| **12** | **Split context providers** | **Performance** | **⏳ Pending** |
| 14 | Optimize notification service queries | Performance | ✅ Done |
| 15 | Add form validation feedback | UI/UX | ✅ Done |

### Pending: Item #12 - Split Context Providers

**Problem**: Single large context (`operations-context.tsx`) causes all components to re-render when any state changes.

**Solution**: Split into domain-specific contexts:
- `PersonnelContext` - personnel list and operations
- `MaterialsContext` - materials list and operations
- `OperationsContext` - incidents only

**Files to modify**:
- `frontend/lib/contexts/operations-context.tsx`
- `frontend/lib/contexts/personnel-context.tsx` (new)
- `frontend/lib/contexts/materials-context.tsx` (new)
- `frontend/app/layout.tsx`

---

## 2. Known Bugs (Documented in Tests)

### 2.1 Vehicle CRUD - radio_call_sign Not Saved

**Location**: `backend/tests/test_api/test_vehicles.py:212-249`
**Severity**: Medium
**Status**: ✅ Fixed (2026-01-22)

**Description**: The CRUD layer (`crud.create_vehicle`) wasn't saving `radio_call_sign` or `display_order` from input.

**Fix**: `backend/app/crud/vehicles.py:34-40` now explicitly sets all fields from the input schema.

---

### 2.2 Material CRUD - type Field Not Saved

**Location**: `backend/tests/test_api/test_materials.py:214-216`
**Severity**: Low
**Status**: ✅ Fixed (2026-01-22)

**Description**: The CRUD layer (`crud.create_material`) wasn't saving the `type` field from input.

**Fix**: `backend/app/crud/materials.py:36-43` now explicitly sets all fields including `type`.

---

### 2.3 Assignment API - Invalid resource_type Returns 500

**Location**: `backend/tests/test_api/test_assignments.py:261-270`
**Severity**: Medium
**Status**: ✅ Fixed (2026-01-22)

**Description**: The API wasn't validating `resource_type` before inserting into DB, causing 500 errors on invalid values.

**Fix**: Added `@field_validator("resource_type")` in `backend/app/schemas.py:610-616` to validate against allowed values ('personnel', 'vehicle', 'material').

---

### 2.4 Assignment API - No Resource Existence Check

**Location**: `backend/tests/test_api/test_assignments.py:286-288`
**Severity**: Low
**Status**: 🟡 Design Decision

**Description**: The API doesn't verify resource existence before creating an assignment. This allows creating assignment records pointing to non-existent resources.

**Consideration**: May be intentional (trusting the caller), but could cause data integrity issues.

---

## 3. Testing Issues (UI/UX)

**Source**: `TESTING_ISSUES_FINDINGS.md`

### Open Issues

| # | Issue | Severity | Component |
|---|-------|----------|-----------|
| 7 | Tab navigation in NewEmergencyModal | Medium | NewEmergencyModal |
| 10 | Arrow keys display in Cmd+K menu | Low | CommandPalette |
| 11 | Toast vs notification integration | Medium | Multiple |
| 21 | Collapsible resource sections | Medium | Resource sidebar |
| 24 | Resource settings real-time updates | Medium | PersonnelSettings |

### Issue #7: Tab Navigation

**Status**: ⚠️ Needs manual verification

Tab should navigate through all form fields in the new emergency modal in logical order.

### Issue #10: Arrow Keys in Cmd+K

**Status**: Open

Remove up and down arrows from Cmd+K menu navigation section, or clarify their purpose.

**File**: `frontend/components/ui/command-palette.tsx:302-322`

### Issue #11: Toast vs Notification Integration

**Status**: Open

Quick popups (e.g., "Funktion zugewiesen") should appear in Benachrichtigungen sidebar if open, instead of as toast.

**Files**:
- `frontend/components/kanban/operation-detail-modal.tsx`
- `frontend/components/notifications/notification-sidebar.tsx`

### Issue #21: Collapsible Resource Sections

**Status**: Open

Instead of "Beide / Personen / Material" toggle, make sections independently collapsible. Pressing P or M should auto-expand the relevant section.

### Issue #24: Resource Settings Real-time Updates

**Status**: Open

Changes in settings (e.g., deleting personnel) should propagate to Kanban view immediately, not just after polling interval.

**Files**:
- `frontend/components/settings/personnel-settings.tsx`
- `frontend/lib/contexts/operations-context.tsx`

---

## 4. TODO Comments in Code

### 4.1 CI/CD Pipeline

**File**: `.github/workflows/ci.yml`

| Line | TODO | Current State |
|------|------|---------------|
| 48 | Fix formatting issues then make blocking | `continue-on-error: true` |
| 52 | Fix 87 lint errors then make blocking | `continue-on-error: true` |
| 77 | Make blocking once type errors are fixed | `continue-on-error: true` |
| 102 | Make blocking once security issues are reviewed | `continue-on-error: true` |
| 190 | Fix 158 lint errors then make blocking | `continue-on-error: true` |

### 4.2 Backend Services

| File | Line | TODO |
|------|------|------|
| `app/services/photo_storage.py` | 105 | Integrate with virus scanning service in production |
| `app/services/notification_service.py` | 387 | Implement database size check |
| `app/services/notification_service.py` | 391 | Implement photo storage size check |

### 4.3 Documentation TODOs

| File | TODO |
|------|------|
| `docs/SECURITY_BACKEND.md:38` | Integrate with virus scanning service |
| `docs/SECURITY_BACKEND.md:50` | Implement database size check |
| `docs/SECURITY_BACKEND.md:51` | Implement photo storage size check |
| `docs/RELIABILITY.md:54` | Implement photo storage size check |

---

## 5. Test Coverage

**Source**: `TESTING_IMPROVEMENTS.md`

| Metric | Current | Target | Gap |
|--------|---------|--------|-----|
| Backend Tests | 1366 | Maintain | ✅ |
| Backend Coverage | **62%** | 70% | ~464 lines |
| Frontend E2E | ~60 | Maintain | ✅ |

### Low Coverage Files (Priority)

| File | Coverage | Lines Missing | Priority |
|------|----------|---------------|----------|
| `services/photo_storage.py` | 27% | 77 | Medium |
| `websocket_manager.py` | 42% | 94 | Low |
| `services/tokens.py` | 56% | 18 | Low |
| `traccar.py` | 57% | 37 | Low |

---

## 6. Priority Matrix

### 🔴 High Priority (Bugs affecting functionality)

~~1. **CRUD `radio_call_sign` bug** - ✅ Fixed~~
~~2. **CRUD `type` field bug** - ✅ Fixed~~
~~3. **Assignment validation bug** - ✅ Fixed~~

*No high priority bugs remaining*

### 🟡 Medium Priority (UX/Performance)

1. **Split context providers** (#12) - Performance optimization
2. **Resource settings real-time updates** (#24) - UX improvement
3. **Toast vs notification integration** (#11) - UX consistency
4. **CI/CD blocking checks** - Code quality enforcement

### 🟢 Low Priority (Nice-to-have)

1. Virus scanning integration
2. Database/photo storage size checks
3. Arrow keys in Cmd+K (#10)
4. Coverage push to 70%
5. Collapsible resource sections (#21)

---

## 7. Quick Reference

### Running Tests

```bash
# Backend
cd backend && uv run pytest
cd backend && uv run pytest --cov=app  # With coverage

# Frontend E2E
cd frontend && pnpm test
cd frontend && pnpm test:ui  # Interactive
```

### Finding TODOs

```bash
# Search for TODOs in code
grep -r "TODO\|FIXME\|XXX\|HACK" --include="*.py" --include="*.ts" --include="*.tsx" .
```

### Skipped Tests

```bash
# Find skipped tests
grep -r "@pytest.mark.skip" backend/tests/
```

---

## Change Log

| Date | Change |
|------|--------|
| 2026-01-22 | Fixed all 3 high priority bugs: Vehicle CRUD, Material CRUD, Assignment validation |
| 2026-01-22 | Initial audit created |

---

*This document should be updated when issues are resolved or new issues are discovered.*
