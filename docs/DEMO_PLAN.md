# Online Demo Release Plan

**Status**: Future Feature (Not Implemented)
**Last updated**: 2025-01-12

## Overview

Create a hosted online demo at `demo.kp-rueck.app` that:
- Allows users to explore the full application without signup
- Resets to clean state every 2 hours
- Uses anonymized sample data
- Mocks external integrations (Traccar GPS)

---

## Demo Features

### User Experience

| Feature | Demo Behavior |
|---------|---------------|
| Login | Pre-filled demo credentials, one-click login |
| All CRUD operations | Fully functional |
| Drag-and-drop kanban | Fully functional |
| Map view | Works with OpenStreetMap tiles |
| GPS tracking | Mocked vehicle positions (simulated movement) |
| Photo upload | Functional but cleared on reset |

### Demo Accounts

| Username | Password | Role |
|----------|----------|------|
| `demo-editor` | `demo123` | Editor (full access) |
| `demo-viewer` | `demo123` | Viewer (read-only) |

### Reset Behavior

- **Frequency**: Every 2 hours
- **What resets**: Database returns to seed state, uploaded photos deleted
- **User notification**: Banner shows "Demo resets in X minutes"

---

## Architecture

```
                    ┌─────────────────────────────────────────┐
                    │           demo.kp-rueck.app             │
                    └────────────────┬────────────────────────┘
                                     │
              ┌──────────────────────┴───────────────────────┐
              │                                              │
    ┌─────────▼─────────┐                      ┌─────────────▼─────────────┐
    │    Frontend       │                      │      Backend              │
    │   (Vercel/Railway)│◄────────────────────►│     (Railway)             │
    │   - Demo banner   │                      │   - DEMO_MODE=true        │
    │   - Reset timer   │                      │   - Mock Traccar          │
    │   - Pre-fill login│                      │   - Rate limiting         │
    └───────────────────┘                      │   - Reset scheduler       │
                                               └─────────────┬─────────────┘
                                                             │
                                               ┌─────────────▼─────────────┐
                                               │     PostgreSQL            │
                                               │   - Resets every 2 hours  │
                                               └───────────────────────────┘
```

---

## Implementation Phases

### Phase 1: Backend Demo Mode

1. Add demo configuration settings (`DEMO_MODE`, `DEMO_RESET_HOURS`, `DEMO_RATE_LIMIT`)
2. Create mock Traccar client for simulated GPS positions
3. Implement database reset scheduler (truncate + re-seed)
4. Add `/api/demo/status` endpoint for reset countdown
5. Add rate limiting middleware for demo environment

### Phase 2: Frontend Demo Mode

1. Create `DemoBanner` component showing reset countdown
2. Add demo status check to login page
3. Pre-fill credentials when in demo mode
4. Auto-refresh page after reset

### Phase 3: Anonymize Seed Data

1. Create demo-specific seed script with fake names
2. Use generic location data (not real addresses)
3. Generate sample incidents across all statuses

### Phase 4: Deployment

1. Create separate Railway project for demo
2. Configure environment variables
3. Set up custom domain `demo.kp-rueck.app`
4. Enable Cloudflare proxy for DDoS protection

### Phase 5: Documentation

1. Add demo landing page explaining features
2. Update README with demo section
3. Add "Try Demo" link to GitHub repo

---

## Cost Estimate (Railway)

| Resource | Cost/Month |
|----------|------------|
| Backend (Hobby) | $5 |
| PostgreSQL (Hobby) | $5 |
| Frontend (Vercel Free) | $0 |
| **Total** | **~$10/month** |

---

## Security Considerations

1. **Rate Limiting**: 60 requests/minute per IP
2. **No Sensitive Data**: All data is fake/anonymized
3. **No Real Integrations**: Traccar mocked, no external sync
4. **Reset Clears Everything**: Including uploaded files
5. **Separate Environment**: Completely isolated from production

### Abuse Prevention

- Max 50 incidents per reset period
- Max 20 photo uploads per reset period
- 1MB file size limit in demo

---

## Future Enhancements

1. Guided tour / interactive walkthrough
2. Pre-built incident scenarios
3. Feature flags for experimental features
4. Feedback collection widget
5. Usage analytics
