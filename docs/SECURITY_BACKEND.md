# Backend Security Audit

Last updated: 2025-01-15

## Summary

| Severity | Count |
|----------|-------|
| Critical | 1 |
| High | 1 |
| Medium | 2 |
| Low | 2 |

---

## Critical Issues

### 1. Hardcoded Credentials in .env File

**File**: `backend/.env`

**Issue**: The `.env` file contains actual production credentials that were committed to git history.

**Action Required**:
- Remove `.env` from git history using `git filter-repo --path backend/.env`
- Rotate all exposed credentials immediately on Railway
- Use Railway's secret management

---

## High Severity Issues

### 2. Form Token Security (Token Reuse)

**File**: `backend/app/services/tokens.py:69-99`

**Issue**: Form tokens for Reko forms don't have per-session uniqueness. Same token could be reused across multiple submissions.

**Risk**: Token fixation attacks possible if token isn't rotated after use.

**Recommendation**:
- Implement single-use tokens invalidated after first use
- Add token version/counter to prevent replay attacks

---

## Medium Severity Issues

### 3. Photo Upload - No Malware Scanning

**File**: `backend/app/services/photo_storage.py:97-105`

```python
# TODO: Integrate with virus scanning service in production
```

**Recommendation**: Integrate ClamAV or similar antivirus scanning.

---

### 4. Missing Database Size Checks

**File**: `backend/app/services/notification_service.py:343-347`

```python
# TODO: Implement database size check
# TODO: Implement photo storage size check
```

**Risk**: Disk space exhaustion DoS vulnerability.

**Recommendation**: Add quota limits and monitoring.

---

## Low Severity Issues

### 5. No Request Rate Limiting

**Files**: All API endpoints in `backend/app/api/`

**Recommendation**: Add FastAPI-Limiter with per-user and per-IP rate limits.

---

### 6. Insufficient Security Event Logging

**Recommendation**: Log all failed auth attempts with username, IP, timestamp in separate security log.

---

## Positive Findings

- Password hashing uses bcrypt with 12 rounds (strong)
- JWT tokens use HS256 with 256-bit secret key
- SQLAlchemy ORM usage prevents SQL injection
- Database models use CHECK constraints for enum validation
- Photo file validation uses PIL + magic bytes detection
- Proper async/await patterns throughout

---

## Completed Items (2025-01-15)

- ✅ WebSocket CORS misconfiguration → explicit whitelist
- ✅ Hardcoded default password in seed → ADMIN_SEED_PASSWORD required
- ✅ Debug print statements → replaced with logger
- ✅ Auth bypass not fully secured → fail-fast production check
- ✅ CORS wildcard regex → explicit domains only
- ✅ Sensitive data in audit logs → sanitization function added
- ✅ Weak password length → increased to 12 characters
- ✅ Error messages reveal system details → generic messages
- ✅ Missing input validation bounds → added ge=0, ge=1
- ✅ Missing security headers → SecurityHeadersMiddleware added
