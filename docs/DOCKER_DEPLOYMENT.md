# Docker & Deployment Security Audit

Last updated: 2025-01-12

## Summary

| Severity | Count |
|----------|-------|
| Critical | 2 |
| High | 4 |
| Medium | 5 |
| Low | 3 |

---

## Critical Issues

### 1. Exposed Secrets in Version Control

**File**: `backend/.env`

The `.env` file contains actual production credentials:
```
TRACCAR_PASSWORD=REDACTED_TRACCAR_PASSWORD
SECRET_KEY=REDACTED_SECRET_KEY
TRACCAR_EMAIL=REDACTED_EMAIL
```

**Action Required**:
1. Remove from git history: `git filter-repo --path backend/.env`
2. Rotate all credentials immediately
3. Add to `.gitignore`
4. Use Railway's secret management

---

### 2. WebSocket CORS Wildcard

**File**: `backend/app/websocket_manager.py:16`

```python
cors_allowed_origins="*",
cors_credentials=True,
```

**Risk**: Any website can establish authenticated WebSocket connections.

**Fix**:
```python
cors_allowed_origins=[
    "https://kp.fwo.li",
    "http://localhost:3000",
]
```

---

## High Severity Issues

### 3. Backend Dockerfile Runs as Root

**File**: `backend/Dockerfile`

```dockerfile
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim
WORKDIR /app
# ... no USER directive ...
CMD ["./start.sh"]  # Runs as root
```

**Comparison**: Frontend Dockerfile correctly uses non-root:
```dockerfile
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs
USER nextjs
```

**Fix**:
```dockerfile
# Add after package installation
RUN groupadd -r appuser && useradd -r -g appuser appuser
RUN chown -R appuser:appuser /app
USER appuser
```

---

### 4. Frontend Dev Dockerfile Runs as Root

**File**: `frontend/Dockerfile.dev`

```dockerfile
FROM node:20-alpine
# ... no USER directive ...
CMD ["pnpm", "dev"]
```

**Fix**: Same as backend - add non-root user.

---

### 5. Overly Permissive CORS Regex

**File**: `backend/app/main.py:132`

```python
allow_origin_regex=r"https://.*\.(railway\.app|up\.railway\.app)$"
```

**Risk**: Any Railway app can make authenticated requests.

**Fix**: Use explicit domain list instead of regex.

---

### 6. TileServer Root Execution

**File**: `tileserver/Dockerfile`

```dockerfile
USER root
RUN apt-get update && apt-get install -y sqlite3
# ...
USER node  # Switches back but RUN was as root
```

**Recommendation**: Minimize root usage, run apt as non-root if possible.

---

## Medium Severity Issues

### 7. No Resource Limits

**Files**: `docker-compose.yml`, `docker-compose.dev.yml`

No CPU or memory limits defined.

**Risk**: Single container can consume all host resources.

**Fix**:
```yaml
services:
  backend:
    deploy:
      resources:
        limits:
          cpus: '1'
          memory: 512M
        reservations:
          cpus: '0.5'
          memory: 256M
```

---

### 8. Missing Backend Health Check

**Files**: `docker-compose.yml`, `docker-compose.dev.yml`

PostgreSQL has health check, but backend doesn't:
```yaml
postgres:
  healthcheck:
    test: ["CMD-SHELL", "pg_isready -U kprueck"]
```

**Fix**:
```yaml
backend:
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
    interval: 10s
    timeout: 5s
    retries: 5
    start_period: 30s
```

---

### 9. Default Database Credentials in Source

**Files**: `docker-compose.yml`, `docker-compose.dev.yml`

```yaml
postgres:
  environment:
    POSTGRES_USER: kprueck
    POSTGRES_PASSWORD: kprueck
```

**Fix**: Use environment variable substitution:
```yaml
POSTGRES_PASSWORD: ${DB_PASSWORD?Database password required}
```

---

### 10. Verbose WebSocket Logging

**File**: `backend/app/websocket_manager.py:18-19`

```python
logger=True,
engineio_logger=True
```

**Risk**: Logs all connections and events in production.

**Fix**:
```python
import os
is_prod = os.getenv("RAILWAY_ENVIRONMENT") is not None
logger=not is_prod,
engineio_logger=not is_prod,
```

---

### 11. Missing Environment Validation

**File**: `backend/app/config.py`

Database URL with special characters may not work with asyncpg.

**Fix**: Add URL encoding validation in config.

---

## Low Severity Issues

### 12. Exposed API Documentation

**File**: `backend/app/main.py`

Swagger UI and ReDoc enabled by default at `/docs` and `/redoc`.

**Fix for Production**:
```python
docs_url=None if settings.is_production else "/docs",
redoc_url=None if settings.is_production else "/redoc",
```

---

### 13. Long Railway Health Check Timeout

**File**: `backend/railway.json:11`

```json
"healthcheckTimeout": 300  // 5 minutes
```

**Fix**: Reduce to 10-30 seconds.

---

### 14. No Restart Policies

**Files**: `docker-compose.yml`, `docker-compose.dev.yml`

Only tileserver has restart policy:
```yaml
tileserver:
  restart: unless-stopped
```

**Fix**: Add to all services:
```yaml
restart: on-failure
```

---

## Best Practices Not Implemented

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

### Secrets Management

**Current**: Secrets in `.env` file.

**Better**:
```bash
# Railway CLI
railway secret set TRACCAR_PASSWORD "secret"
railway secret set SECRET_KEY "$(openssl rand -hex 32)"
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

## Immediate Actions

### Week 1 (Critical)
1. Remove `.env` from git history
2. Rotate all exposed credentials
3. Fix CORS wildcards
4. Add non-root user to backend Dockerfile

### Week 2 (High)
5. Add backend health check
6. Add resource limits
7. Fix WebSocket CORS

### Week 3 (Medium)
8. Implement network isolation
9. Disable API docs in production
10. Add restart policies

---

## Files Summary

| File | Issues | Priority |
|------|--------|----------|
| `backend/.env` | Exposed secrets | Critical |
| `websocket_manager.py` | CORS wildcard | Critical |
| `backend/Dockerfile` | Runs as root | High |
| `frontend/Dockerfile.dev` | Runs as root | High |
| `main.py` | CORS regex | High |
| `docker-compose.yml` | No limits, health checks | Medium |
| `railway.json` | Long timeout | Low |
