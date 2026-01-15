# Authentication & Authorization Security Assessment

Last updated: 2025-01-12

## Overview

The application uses JWT-based authentication with HTTPOnly cookies. This document details the security implementation and identified concerns.

---

## Authentication Implementation

### JWT Configuration

**File**: `backend/app/auth/config.py`

| Setting | Value | Notes |
|---------|-------|-------|
| Algorithm | HS256 | Symmetric, suitable for single-server |
| Access Token Expiry | 8 hours | Optimized for emergency operations |
| Refresh Token Expiry | 7 days | Extended session support |
| Secret Key Min Length | 32 characters | 256-bit equivalent |

### Token Generation

**File**: `backend/app/auth/security.py:59-119`

**Payload includes**:
- `sub` (user ID)
- `username`
- `role` (editor/viewer)
- `exp` (expiration)
- `iat` (issued at)
- `jti` (JWT ID for potential revocation tracking)
- `type` (access/refresh to prevent token confusion)

### Token Storage

- HTTPOnly cookies prevent JavaScript access (XSS protection)
- Secure flag enforced in production (HTTPS only)
- SameSite configuration:
  - Production: `SameSite=None` + `Secure=True` (cross-domain)
  - Development: `SameSite=Lax` (same-site protection)

---

## Password Security

### Hashing

**File**: `backend/app/auth/security.py:12-40`

- **Algorithm**: Bcrypt
- **Cost Factor**: 12 rounds (computationally expensive)
- **Max Length**: 72 bytes (Bcrypt hard limit)
- **Verification**: Uses `bcrypt.checkpw()` for constant-time comparison (timing attack protection)

### Policy

**File**: `backend/app/auth/config.py:21-22`

- Minimum length: 8 characters (could be stronger)
- No complexity requirements enforced

**Recommendation**: Increase to 12+ characters with complexity requirements.

---

## Role-Based Access Control (RBAC)

### Roles

| Role | Permissions |
|------|-------------|
| Editor | Full CRUD on all resources |
| Viewer | Read-only access |

### Backend Implementation

**File**: `backend/app/auth/dependencies.py`

```python
# CurrentUser - requires authentication
async def get_current_user(request: Request) -> User:
    # Validates JWT, returns 401 if invalid

# CurrentEditor - requires editor role
async def get_current_editor(current_user: CurrentUser) -> User:
    if current_user.role != "editor":
        raise HTTPException(403, "Editor role required")
```

**Database Constraint** (`models.py:57`):
```python
CheckConstraint("role IN ('editor', 'viewer')", name="valid_role")
```

### Frontend Implementation

**File**: `frontend/components/protected-route.tsx`

- `ProtectedRoute`: Requires authentication, redirects to `/login`
- `EditorRoute`: Requires editor role, redirects to home
- `ProtectedButton`: Shows lock icon and tooltip for viewers

---

## Session Management

### Token Refresh Flow

**Endpoint**: `POST /api/auth/refresh`

**File**: `backend/app/api/auth.py:116-189`

1. Validates refresh token type
2. Creates new access token
3. Updates cookie
4. Returns user info

### Frontend Auto-Refresh

**File**: `frontend/lib/contexts/auth-context.tsx:34-77`

- Interval: 7.5 hours (8-hour expiration minus 30-minute buffer)
- On failure: Logs out user gracefully

### Logout

**File**: `backend/app/api/auth.py:192-232`

- Clears HTTPOnly cookies
- Works even without authentication
- **Note**: No server-side token revocation (relies on expiration)

**Risk**: Compromised tokens remain valid until expiration (up to 8 hours).

---

## Security Concerns

### 1. No Token Revocation (High)

**File**: `backend/app/api/auth.py:202-204`

```python
# JWT tokens are stateless, so we can't revoke them
```

**Risk**: Compromised tokens valid for up to 8 hours.

**Mitigation**: JWT ID (`jti` claim) is included and can be used for token blacklist.

**Recommendation**: Implement Redis-backed token blacklist for immediate revocation.

---

### 2. Long Token Expiration (Medium)

**File**: `backend/app/auth/config.py:17`

```python
ACCESS_TOKEN_EXPIRE_MINUTES = 480  # 8 hours for emergency operations
```

**Justification**: Trade-off for operational continuity (firefighting).

**Recommendation**: Consider shorter expiration (2-4 hours) if operationally feasible.

---

### 3. Auth Bypass Mechanism (Medium)

**File**: `backend/app/auth/config.py:12,118-137`

```python
BYPASS_AUTH_DEV = False  # Default disabled
```

**Safeguards**:
- Automatically disabled in production
- Checks `RAILWAY_ENVIRONMENT` env var
- Mock user has identifiable UUID: `00000000-0000-0000-0000-000000000000`

**Risk**: If detection fails, authentication is completely bypassed.

---

### 4. X-Forwarded-For Trust (Medium)

**File**: `backend/app/services/audit.py:56-61`

```python
# Takes first IP from X-Forwarded-For header
```

**Risk**: Header spoofing if not behind trusted proxy.

**Recommendation**: Use FastAPI's TrustedHostMiddleware or validate proxy configuration.

---

### 5. CORS Wildcard Railway Domains (Medium)

**File**: `backend/app/main.py:132`

```python
allow_origin_regex=r"https://.*\.(railway\.app|up\.railway\.app)$"
```

**Risk**: Allows any Railway app subdomain, not just kp-rueck.

**Recommendation**: Use specific domain instead of wildcard.

---

## Cookie Configuration

### Settings

**File**: `backend/app/auth/config.py`

| Setting | Production | Development |
|---------|------------|-------------|
| HTTPOnly | True | True |
| Secure | True | False |
| SameSite | None | Lax |
| Domain | .fwo.li | None (localhost) |
| Path | / | / |

### Domain Scoping

Production cookies use `.fwo.li` domain to share across:
- `kp.fwo.li` (frontend)
- `kp-api.fwo.li` (backend)

---

## Audit Logging

### Login/Logout Tracking

**File**: `backend/app/services/audit.py:91-130`

Captures:
- User ID
- Action type (login_success, login_failure, logout)
- IP address (handles X-Forwarded-For)
- User agent
- Timestamp

### Request Logging

**File**: `backend/app/middleware/audit.py:60-115`

Logs all successful API requests (<300 status):
- Path, method, duration
- User from `request.state.user`
- Skips `/api/health`

---

## Test Coverage

**File**: `backend/tests/test_api/test_auth.py` (715 lines)

- Login success/failure
- Protected routes
- Role-based access
- Token refresh
- Logout
- Password hashing verification
- Expired tokens
- Token type validation
- Malformed tokens
- Cookie attributes
- Last login tracking

---

## Recommendations Summary

| Priority | Issue | Action |
|----------|-------|--------|
| High | No token revocation | Implement Redis-backed blacklist |
| High | 8-hour token expiration | Consider shorter expiration |
| Medium | Auth bypass safeguards | Add explicit production check |
| Medium | CORS wildcards | Use specific domains |
| Medium | X-Forwarded-For trust | Validate proxy configuration |
| Low | Password policy | Add complexity requirements |
| Low | HS256 algorithm | Consider RS256 for distributed systems |

---

## Security Strengths

- Strong password hashing (bcrypt, 12 rounds)
- HTTPOnly cookies (XSS protection)
- SameSite protection (CSRF mitigation)
- Type-safe token validation (access vs refresh)
- Comprehensive audit logging
- Environment-aware security settings
- Role-based access properly enforced
