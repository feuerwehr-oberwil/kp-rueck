# Security Audit

Last updated: 2025-01-15

## Summary

| Area | High | Medium | Low |
|------|------|--------|-----|
| Backend | 1 | 2 | 2 |
| Frontend | 1 | 1 | 3 |
| Authentication | 1 | 2 | 0 |
| Docker/Deployment | 0 | 2 | 1 |

---

## High Severity Issues

### 1. Form Token Security (Token Reuse)

**File**: `backend/app/services/tokens.py:69-99`

Form tokens for Reko forms don't have per-session uniqueness. Same token could be reused across multiple submissions.

**Risk**: Token fixation attacks possible if token isn't rotated after use.

**Recommendation**: Implement single-use tokens invalidated after first use.

---

### 2. Token Exposure in URL Parameters

**File**: `frontend/components/reko/reko-form.tsx:253`

```typescript
router.push(`/reko/success?id=${incidentId}&token=${token}`)
```

**Risk**: Tokens visible in browser history, URL bar, server logs, referrer headers.

**Note**: Design decision for field use (Reko forms accessed via shared links). Consider if acceptable for the use case.

---

### 3. No Token Revocation

**Risk**: Compromised tokens valid for up to 8 hours.

**Mitigation**: JWT ID (`jti` claim) is included and can be used for token blacklist.

**Recommendation**: Implement Redis-backed token blacklist for immediate revocation.

---

## Medium Severity Issues

### 4. Photo Upload - No Malware Scanning

**File**: `backend/app/services/photo_storage.py:97-105`

```python
# TODO: Integrate with virus scanning service in production
```

**Recommendation**: Integrate ClamAV or similar antivirus scanning.

---

### 5. Missing Database Size Checks

**File**: `backend/app/services/notification_service.py:343-347`

**Risk**: Disk space exhaustion DoS vulnerability.

**Recommendation**: Add quota limits and monitoring.

---

### 6. Missing CSRF Protection

All requests rely on httpOnly cookies for CSRF protection. No explicit CSRF token validation.

**Current Protection**:
- Login uses FormData (provides some CSRF protection)
- API requests use `credentials: 'include'`
- SameSite cookies configured on backend

**Recommendation**: Implement CSRF tokens for state-changing operations.

---

### 7. Long Token Expiration

**File**: `backend/app/auth/config.py:17`

```python
ACCESS_TOKEN_EXPIRE_MINUTES = 480  # 8 hours for emergency operations
```

**Justification**: Trade-off for operational continuity (firefighting).

**Recommendation**: Consider shorter expiration (2-4 hours) if operationally feasible.

---

### 8. X-Forwarded-For Trust

**File**: `backend/app/services/audit.py:56-61`

**Risk**: Header spoofing if not behind trusted proxy.

**Recommendation**: Use FastAPI's TrustedHostMiddleware or validate proxy configuration.

---

### 9. Default Database Credentials in Source

**Files**: `docker-compose.yml`, `docker-compose.dev.yml`

```yaml
POSTGRES_PASSWORD: kprueck
```

**Note**: Acceptable for local development only.

**Fix for production**: Use environment variable substitution.

---

### 10. Missing Environment Validation

Database URL with special characters may not work with asyncpg.

**Fix**: Add URL encoding validation in config.

---

## Low Severity Issues

### 11. No Request Rate Limiting

**Recommendation**: Add FastAPI-Limiter with per-user and per-IP rate limits.

---

### 12. Insufficient Security Event Logging

**Recommendation**: Log all failed auth attempts with username, IP, timestamp in separate security log.

---

### 13. Photo URL Exposure

**File**: `frontend/components/reko/photo-upload.tsx:76-79`

**Risk**: Photo URLs could be enumerable if filename pattern is predictable.

**Mitigation**: Backend implements proper access control.

---

### 14. Missing Error Boundary Components

**File**: `frontend/app/layout.tsx`

**Recommendation**: Add error boundary at root level to catch rendering errors.

---

### 15. Long Token Refresh Interval

**File**: `frontend/lib/contexts/auth-context.tsx:60`

**Current**: Refreshes at 7.5 hours before 8-hour token expiry.

**Best Practice**: Refresh at 50% of token lifetime or shorter.

---

### 16. Exposed API Documentation

**File**: `backend/app/main.py`

Swagger UI and ReDoc enabled by default at `/docs` and `/redoc`.

**Fix for Production**:
```python
docs_url=None if settings.is_production else "/docs",
redoc_url=None if settings.is_production else "/redoc",
```

---

## Security Strengths

### Authentication
- Strong password hashing (bcrypt, 12 rounds)
- HTTPOnly cookies (XSS protection)
- SameSite protection (CSRF mitigation)
- Type-safe token validation (access vs refresh)
- Environment-aware security settings
- Fail-fast auth bypass check in production

### Backend
- JWT tokens use HS256 with 256-bit secret key
- SQLAlchemy ORM usage prevents SQL injection
- Database models use CHECK constraints for enum validation
- Photo file validation uses PIL + magic bytes detection
- Proper async/await patterns throughout

### Frontend
- No `eval()` or `dangerouslySetInnerHTML` found
- URL encoding with `encodeURIComponent()` prevents injection
- Retry logic with exponential backoff
- Role-based access control properly implemented

### Docker/Deployment
- Non-root users in Dockerfiles
- Resource limits in docker-compose
- Health checks configured
- Restart policies added

---

## Future Improvements

### Network Isolation

```yaml
networks:
  backend:
    internal: true
  frontend-backend:
    internal: false
```

### Image Pinning

Use digest pinning instead of tags:
```dockerfile
FROM ghcr.io/astral-sh/uv@sha256:abc123...
```

### Supply Chain Security

1. Use specific image patch versions
2. Scan dependencies: `npm audit`, `trivy scan`
3. Enable Dependabot/Renovate for updates

---

## Completed Items (2025-01-15)

### Backend
- WebSocket CORS misconfiguration - explicit whitelist
- Hardcoded default password in seed - ADMIN_SEED_PASSWORD required
- Debug print statements - replaced with logger
- Auth bypass not fully secured - fail-fast production check
- CORS wildcard regex - explicit domains only
- Sensitive data in audit logs - sanitization function added
- Weak password length - increased to 12 characters
- Error messages reveal system details - generic messages
- Missing input validation bounds - added ge=0, ge=1
- Missing security headers - SecurityHeadersMiddleware added

### Frontend
- Missing credentials in photo upload - added `credentials: 'include'`
- Console logging of sensitive information - removed console.log statements
- Missing timeout on file uploads - added 60s timeout with AbortController

### Authentication
- Auth bypass safeguards - fail-fast production check with model_validator
- CORS wildcards - explicit domain whitelist (no regex)
- Password policy - increased minimum length to 12 characters

### Docker/Deployment
- WebSocket CORS wildcard - explicit whitelist
- Backend Dockerfile - non-root user
- Frontend Dockerfile.dev - non-root user
- CORS regex - explicit domains
- Resource limits added to docker-compose
- Backend health check added
- Restart policies added
- Verbose WebSocket logging - disabled in production
- Railway health check timeout - reduced to 60s
