# Backend Security Audit

Last updated: 2025-01-12

## Summary

| Severity | Count |
|----------|-------|
| Critical | 4 |
| High | 3 |
| Medium | 6 |
| Low | 9 |

---

## Critical Issues

### 1. Hardcoded Credentials in .env File

**File**: `backend/.env`

**Issue**: The `.env` file contains actual production credentials:
- `SECRET_KEY`: JWT signing key exposed
- `TRACCAR_PASSWORD`: GPS system password exposed
- `TRACCAR_EMAIL`: Service account email exposed

**Risk**: If repository becomes public, all secrets are exposed. Git history retains them permanently.

**Recommendation**:
- Remove `.env` from git history using `git filter-repo --path backend/.env`
- Rotate all exposed credentials immediately
- Use `.env.example` with placeholder values only
- Implement pre-commit hooks to prevent future commits of `.env` files

---

### 2. WebSocket CORS Misconfiguration

**File**: `backend/app/websocket_manager.py:14-20`

```python
sio = socketio.AsyncServer(
    async_mode='asgi',
    cors_allowed_origins="*",      # Allows ANY origin
    cors_credentials=True,          # WITH credentials
    logger=True,
    engineio_logger=True
)
```

**Risk**: Allows Cross-Site WebSocket Hijacking (CSWSH). Any website can establish authenticated WebSocket sessions with user cookies.

**Recommendation**:
```python
cors_allowed_origins=[
    "https://kp.fwo.li",
    "https://kp-api.fwo.li",
    "http://localhost:3000",  # Dev only
]
```

---

### 3. Hardcoded Default Password in Seed Script

**File**: `backend/app/seed.py:45`

```python
password = "changeme123"  # CHANGE IN PRODUCTION
```

**Risk**: If seed script runs in production without changing password, admin account is compromised.

**Recommendation**:
- Generate random password if not provided via environment variable
- Require explicit `ADMIN_PASSWORD` env var for seed operations
- Add startup check that rejects default password in production

---

### 4. Traccar Credentials Exposed

**File**: `backend/.env:11-12`

**Issue**: Plain-text Traccar email and password stored in repository.

**Risk**: Anyone with repository access can access the GPS tracking system.

**Recommendation**: Use Railway/deployment secret management, never commit credentials.

---

## High Severity Issues

### 5. Debug Print Statements in Production Code

**Files**:
- `backend/app/auth/dependencies.py:55-62` - Auth debug output with token preview
- `backend/app/api/incidents.py:36, 44, 50, 52, 57` - Various debug prints

**Issue**: `print()` statements leak sensitive information to logs:
```python
print(f"[Auth Debug] Decoding token: {access_token[:50]}...")
```

**Risk**: Token fragments and user data exposed in production logs.

**Recommendation**:
- Replace all `print()` with `logger.debug()` statements
- Use proper logging configuration with LOG_LEVEL env var
- Never log token contents, even partial

---

### 6. Auth Bypass Not Fully Secured

**File**: `backend/app/auth/config.py:118-137`

**Issue**: The `AUTH_BYPASS_AUTH_DEV` flag could potentially be enabled in production if environment detection fails.

**Recommendation**:
- Add explicit environment variable validation at startup
- Fail fast if bypass is detected with `RAILWAY_ENVIRONMENT` set
- Add prominent warning logs

---

### 7. Form Token Security (Token Reuse)

**File**: `backend/app/services/tokens.py:69-99`

**Issue**: Form tokens for Reko forms don't have per-session uniqueness. Same token could be reused across multiple submissions.

**Risk**: Token fixation attacks possible if token isn't rotated after use.

**Recommendation**:
- Implement single-use tokens invalidated after first use
- Add token version/counter to prevent replay attacks

---

## Medium Severity Issues

### 8. CORS Allow-All Wildcard Regex

**File**: `backend/app/main.py:119-132`

```python
railway_patterns = [
    "https://*.railway.app",
    "https://*.up.railway.app",
]
allow_origin_regex=r"https://.*\.(railway\.app|up\.railway\.app)$"
```

**Issue**: Allows ANY subdomain of railway.app, including potentially malicious Railway deployments.

**Recommendation**: Whitelist only specific Railway URLs instead of wildcard patterns.

---

### 9. Sensitive Data in Audit Logs

**File**: `backend/app/middleware/audit.py:45-56`

**Issue**: Audit logs capture all API request data without filtering sensitive fields.

**Recommendation**: Filter sensitive fields (password, token, email) before logging.

---

### 10. Weak Password Length

**File**: `backend/app/auth/config.py:20-22`

**Issue**: `MIN_PASSWORD_LENGTH=8` is weak for security-critical application.

**Recommendation**: Increase to 12+ characters, add complexity requirements.

---

### 11. Photo Upload - No Malware Scanning

**File**: `backend/app/services/photo_storage.py:97-105`

```python
# TODO: Integrate with virus scanning service in production
```

**Recommendation**: Integrate ClamAV or similar antivirus scanning.

---

### 12. Missing Database Size Checks

**File**: `backend/app/services/notification_service.py:343-347`

```python
# TODO: Implement database size check
# TODO: Implement photo storage size check
```

**Risk**: Disk space exhaustion DoS vulnerability.

**Recommendation**: Add quota limits and monitoring.

---

### 13. Error Messages Reveal System Details

**File**: `backend/app/api/traccar.py:69-73`

```python
detail=f"Failed to fetch positions from Traccar: {str(e)}"
```

**Recommendation**: Return generic error messages to clients, log full details server-side.

---

## Low Severity Issues

### 14. No Request Rate Limiting

**Files**: All API endpoints in `backend/app/api/`

**Recommendation**: Add FastAPI-Limiter with per-user and per-IP rate limits.

---

### 15. Missing HTTPS Enforcement

**File**: `backend/app/auth/config.py:25-26`

**Recommendation**: Add HSTS headers and startup check for HTTPS in production.

---

### 16. Missing Input Validation Bounds

**File**: `backend/app/api/incidents.py:60-85`

```python
skip: int = Query(default=0)  # Missing ge=0
limit: int = Query(default=100, le=500)  # Missing ge=1
```

**Recommendation**: Add `ge=0` to skip, `ge=1` to limit.

---

### 17. Insufficient Security Event Logging

**Recommendation**: Log all failed auth attempts with username, IP, timestamp in separate security log.

---

### 18. Missing Security Headers

**Recommendation**: Add middleware with:
```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
Strict-Transport-Security: max-age=31536000; includeSubDomains
Content-Security-Policy: default-src 'self'
```

---

## Positive Findings

- Password hashing uses bcrypt with 12 rounds (strong)
- JWT tokens use HS256 with 256-bit secret key
- SQLAlchemy ORM usage prevents SQL injection
- Database models use CHECK constraints for enum validation
- Photo file validation uses PIL + magic bytes detection
- Proper async/await patterns throughout
