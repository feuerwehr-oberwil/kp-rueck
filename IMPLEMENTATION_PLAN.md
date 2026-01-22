# Implementation Plan: Critical Fixes for KP Rück

**Created**: 2026-01-22
**Status**: In Progress

This document tracks the implementation of 12 critical improvements identified during the full codebase sweep.

---

## Overview

| # | Issue | Category | Status | Commit |
|---|-------|----------|--------|--------|
| 2 | Transaction isolation for assignments | Reliability | ✅ Done | 956847e |
| 3 | Retry + state refresh for 409 Conflict | Reliability | ✅ Done | eca60e3 |
| 4 | Create bulk reko endpoint | Performance | ✅ Done | 661e476 |
| 5 | Fix opacity-60 contrast issue | UI/UX | ✅ Done | d675f9a |
| 6 | Add rate limiting middleware | Security | ✅ Done | e4bf90f |
| 7 | Replace detail=str(e) with generic errors | Security | Pending | - |
| 8 | Add jitter + exponential backoff to polling | Performance | Pending | - |
| 9 | Increase mobile filter buttons to 44px | UI/UX | Pending | - |
| 10 | Add missing database indexes | Performance | Pending | - |
| 12 | Split context providers | Performance | Pending | - |
| 14 | Optimize notification service queries | Performance | Pending | - |
| 15 | Add form validation feedback | UI/UX | Pending | - |

---

## Detailed Implementation Plans

### 2. Transaction Isolation for Assignments (Row Locking)

**Problem**: Race condition in `crud/assignments.py` - check-and-create is not atomic. Two concurrent requests can both pass the conflict check and create duplicate assignments.

**Solution**: Use PostgreSQL `SELECT ... FOR UPDATE` to lock rows during the check-and-assign operation.

**Files to modify**:
- `backend/app/crud/assignments.py`

**Tests to update**:
- `backend/tests/test_crud/test_assignments.py` (if exists)
- Create new concurrency tests

---

### 3. Retry + State Refresh for 409 Conflict Responses

**Problem**: Frontend performs optimistic updates but doesn't properly recover from 409 conflicts - local state remains changed without server refresh.

**Solution**:
1. Add retry logic with exponential backoff for 409 responses
2. On conflict, refetch server state and merge
3. Show user-friendly conflict message

**Files to modify**:
- `frontend/lib/api-client.ts`
- `frontend/lib/contexts/operations-context.tsx`

---

### 4. Create Bulk Reko Endpoint

**Problem**: N+1 query pattern - fetches each incident's reko report individually (50 incidents = 50 API calls).

**Solution**: Create `GET /api/reko/summaries/{event_id}` endpoint that returns all reko summaries for an event in one query.

**Files to modify**:
- `backend/app/api/reko.py`
- `backend/app/crud/reko.py` (if exists)
- `frontend/lib/api-client.ts`
- `frontend/lib/contexts/operations-context.tsx`

---

### 5. Fix Opacity-60 Contrast Issue

**Problem**: `opacity-60` on assigned personnel makes text barely visible, fails WCAG AA contrast.

**Solution**: Replace opacity-based styling with explicit color classes that maintain contrast.

**Files to modify**:
- `frontend/components/kanban/draggable-person.tsx`

---

### 6. Add Rate Limiting Middleware

**Problem**: No rate limiting allows brute force attacks on login and DoS on resource-heavy endpoints.

**Solution**: Add slowapi middleware with configurable limits per endpoint.

**Files to modify**:
- `backend/app/main.py`
- `backend/app/middleware/rate_limit.py` (new file)
- `backend/pyproject.toml` (add slowapi dependency)

---

### 7. Replace detail=str(e) with Generic Errors

**Problem**: Raw exception strings in HTTP responses leak database structure and internal details.

**Solution**: Log detailed errors server-side, return generic user-friendly messages.

**Files to modify**:
- `backend/app/api/incidents.py`
- `backend/app/api/divera.py`
- `backend/app/api/admin.py`
- `backend/app/api/reko.py`
- Other API files with `detail=str(e)` pattern

---

### 8. Add Jitter + Exponential Backoff to Polling

**Problem**: Hard-coded 5-second interval with no backoff causes thundering herd and no recovery from errors.

**Solution**:
1. Add random jitter to polling interval
2. Implement exponential backoff on errors
3. Reset backoff on successful response

**Files to modify**:
- `frontend/lib/contexts/operations-context.tsx`

---

### 9. Increase Mobile Filter Buttons to 44px

**Problem**: Status filter buttons are 32px (h-8), below the 44px minimum for touch targets under stress.

**Solution**: Increase button height to 44px (h-11) or min-h-[44px].

**Files to modify**:
- `frontend/components/mobile/mobile-incident-list-view.tsx`

---

### 10. Add Missing Database Indexes

**Problem**: Missing compound indexes for common query patterns causing full table scans.

**Solution**: Add indexes for:
- `event_attendance(event_id, checked_in)`
- `incident_assignments(incident_id, resource_type, unassigned_at)`

**Files to modify**:
- `backend/app/models.py`
- Create Alembic migration

---

### 12. Split Context Providers

**Problem**: Single large context causes all components to re-render when any state changes.

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

### 14. Optimize Notification Service Queries

**Problem**: `evaluate_notifications()` runs 9+ separate queries on each poll.

**Solution**:
1. Combine related checks into single queries with subqueries
2. Add short-term caching for unchanged events
3. Only re-evaluate on actual data changes

**Files to modify**:
- `backend/app/services/notification_service.py`

---

### 15. Add Form Validation Feedback

**Problem**: No inline form validation - users don't know why form won't submit.

**Solution**: Add real-time validation feedback with:
1. Required field indicators
2. Inline error messages
3. Visual feedback (red borders, tooltips)

**Files to modify**:
- `frontend/components/kanban/new-emergency-modal.tsx`
- `frontend/components/kanban/operation-detail-modal.tsx`

---

## Change Log

| Date | Item | Description | Commit |
|------|------|-------------|--------|
| 2026-01-22 | #2 | Added SELECT FOR UPDATE to prevent race conditions in assignments | 956847e |
| 2026-01-22 | #3 | Added ApiError class and 409 conflict handling with auto-refresh | eca60e3 |
| 2026-01-22 | #4 | Created bulk reko endpoint, reducing 50 requests to 1 | 661e476 |
| 2026-01-22 | #5 | Replaced opacity-60 with explicit color classes for WCAG compliance | d675f9a |
| 2026-01-22 | #6 | Added slowapi rate limiting to login (5/min), exports (10/min), photos (30/min) | e4bf90f |

