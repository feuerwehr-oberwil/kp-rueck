# Codebase Audit Report

**Last Updated**: 2026-01-22
**Status**: Active tracking document

This document tracks open TODOs, pending work, and known issues in the KP Rück codebase.

---

## 1. Completed Implementation Items

### Item #12 - Split Context Providers ✅

**Status**: Completed (2026-01-22)
**Category**: Performance

**Problem**: Single large context (`operations-context.tsx`) caused all components to re-render when any state changes.

**Solution**: Split into domain-specific contexts:
- `PersonnelContext` (`personnel-context.tsx`) - personnel state and refresh
- `MaterialsContext` (`materials-context.tsx`) - materials state and refresh
- `OperationsContext` - operations state, consumes Personnel/Materials contexts

**Files modified**:
- `frontend/lib/contexts/operations-context.tsx` - refactored to use new contexts
- `frontend/lib/contexts/personnel-context.tsx` (new)
- `frontend/lib/contexts/materials-context.tsx` (new)
- `frontend/app/layout.tsx` - added new providers

---

## 2. Open UI/UX Issues

**Source**: `TESTING_ISSUES_FINDINGS.md`

| # | Issue | Severity | Status |
|---|-------|----------|--------|
| 7 | Tab navigation in NewEmergencyModal | Medium | Needs verification |
| 11 | Toast vs notification integration | Medium | Open |
| 15 | Reko submission notification | Medium | Open |
| 21 | Collapsible resource sections | Medium | Open |
| 24 | Resource settings real-time updates | Medium | Open |

### Issue #7: Tab Navigation
Tab should navigate through all form fields in the new emergency modal in logical order. Manual testing needed.

### Issue #11: Toast vs Notification Integration
Quick popups (e.g., "Funktion zugewiesen") should appear in Benachrichtigungen sidebar if open, instead of as toast.

### Issue #15: Reko Submission Notification
When a Reko report is submitted, create a notification visible on the main dashboard.

### Issue #21: Collapsible Resource Sections
Instead of "Beide / Personen / Material" toggle, make sections independently collapsible. Pressing P or M should auto-expand the relevant section.

### Issue #24: Resource Settings Real-time Updates
Changes in settings (e.g., deleting personnel) should propagate to Kanban view immediately, not just after polling interval.

---

## 3. TODO Comments in Code

### 3.1 CI/CD Pipeline

**File**: `.github/workflows/ci.yml`

| Line | TODO | Current State |
|------|------|---------------|
| 48 | Fix formatting issues then make blocking | `continue-on-error: true` |
| 52 | Fix lint errors then make blocking | `continue-on-error: true` |
| 77 | Make blocking once type errors are fixed | `continue-on-error: true` |
| 102 | Make blocking once security issues are reviewed | `continue-on-error: true` |
| 190 | Fix frontend lint errors then make blocking | `continue-on-error: true` |

### 3.2 Backend Services

| File | Line | TODO |
|------|------|------|
| `app/services/photo_storage.py` | 105 | Integrate with virus scanning service in production |
| `app/services/notification_service.py` | 387 | Implement database size check |
| `app/services/notification_service.py` | 391 | Implement photo storage size check |

---

## 4. Test Coverage

| Metric | Current | Target |
|--------|---------|--------|
| Backend Coverage | ~39% | 70% |

### Low Coverage Files (Priority)

| File | Coverage | Priority |
|------|----------|----------|
| `services/photo_storage.py` | ~29% | Medium |
| `websocket_manager.py` | ~42% | Low |

---

## 5. Priority Matrix

### Medium Priority (UX/Performance)

1. ~~**Split context providers** (#12) - ✅ Completed~~
2. **Resource settings real-time updates** (#24) - UX improvement
3. **Toast vs notification integration** (#11) - UX consistency
4. **Reko submission notification** (#15) - Feature completeness
5. **CI/CD blocking checks** - Code quality enforcement

### Low Priority (Nice-to-have)

1. Virus scanning integration
2. Database/photo storage size checks
3. Collapsible resource sections (#21)
4. Tab navigation verification (#7)
5. Coverage push to 70%

---

## 6. Quick Reference

### Running Tests

```bash
# Backend
cd backend && uv run pytest
cd backend && uv run pytest --cov=app

# Frontend E2E
cd frontend && pnpm test
cd frontend && pnpm test:ui
```

### Finding TODOs

```bash
grep -r "TODO\|FIXME" --include="*.py" --include="*.ts" --include="*.tsx" .
```

---

## Change Log

| Date | Change |
|------|--------|
| 2026-01-22 | Implemented #12 - Split context providers into PersonnelContext, MaterialsContext, OperationsContext |
| 2026-01-22 | Cleaned up audit - removed all fixed bugs, updated issue list from TESTING_ISSUES_FINDINGS.md |
| 2026-01-22 | Fixed all 3 high priority bugs: Vehicle CRUD, Material CRUD, Assignment validation |
| 2026-01-22 | Initial audit created |

---

*This document should be updated when issues are resolved or new issues are discovered.*
