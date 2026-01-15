# Docker & Deployment Security Audit

Last updated: 2025-01-15

## Summary

| Severity | Count |
|----------|-------|
| Critical | 1 |
| Medium | 2 |
| Low | 1 |

---

## Critical Issues

### 1. Exposed Secrets in Version Control

**File**: `backend/.env`

The `.env` file contains actual production credentials that were committed to git history.

**Action Required**:
1. Remove from git history: `git filter-repo --path backend/.env`
2. Rotate all credentials immediately on Railway
3. Use Railway's secret management

---

## Medium Severity Issues

### 2. Default Database Credentials in Source

**Files**: `docker-compose.yml`, `docker-compose.dev.yml`

```yaml
postgres:
  environment:
    POSTGRES_USER: kprueck
    POSTGRES_PASSWORD: kprueck
```

**Note**: Acceptable for local development only.

**Fix for production**: Use environment variable substitution:
```yaml
POSTGRES_PASSWORD: ${DB_PASSWORD?Database password required}
```

---

### 3. Missing Environment Validation

**File**: `backend/app/config.py`

Database URL with special characters may not work with asyncpg.

**Fix**: Add URL encoding validation in config.

---

## Low Severity Issues

### 4. Exposed API Documentation

**File**: `backend/app/main.py`

Swagger UI and ReDoc enabled by default at `/docs` and `/redoc`.

**Fix for Production**:
```python
docs_url=None if settings.is_production else "/docs",
redoc_url=None if settings.is_production else "/redoc",
```

---

## Best Practices (Future Improvements)

### Network Isolation

**Current**: All containers on single bridge network.

**Better**:
```yaml
networks:
  backend:
    internal: true  # No external access
  frontend-backend:
    internal: false

services:
  postgres:
    networks: [backend]
  backend:
    networks: [backend, frontend-backend]
  frontend:
    networks: [frontend-backend]
```

---

### Image Pinning

**Current**: Tag-based versions.

**Better**: Use digest pinning:
```dockerfile
FROM ghcr.io/astral-sh/uv@sha256:abc123...
```

---

### Supply Chain Security

**Recommendations**:
1. Use specific image patch versions (not just major.minor)
2. Scan dependencies: `npm audit`, `trivy scan`
3. Enable Dependabot/Renovate for updates

---

## Completed Items (2025-01-15)

- ✅ WebSocket CORS wildcard → explicit whitelist
- ✅ Backend Dockerfile → non-root user
- ✅ Frontend Dockerfile.dev → non-root user
- ✅ CORS regex → explicit domains
- ✅ Resource limits added to docker-compose
- ✅ Backend health check added
- ✅ Restart policies added
- ✅ Verbose WebSocket logging → disabled in production
- ✅ Railway health check timeout → reduced to 60s
