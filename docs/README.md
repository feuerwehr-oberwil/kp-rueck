# Documentation

This folder holds KP Rück's longer-form documentation — the slower-moving "why" and "how"
behind the app. The product intent and quick start live in the [root README](../README.md); the
feature history lives in [`../CHANGELOG.md`](../CHANGELOG.md).

**Status legend:** 🟢 reflects shipped behaviour · 🟡 partially implemented / may drift ·
🔵 proposed / not yet built · 🗄 historical, not maintained.

## Foundations

| Doc | Status | What it is |
| --- | --- | --- |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | 🟢 | System overview: how the Next.js frontend, FastAPI service, PostgreSQL, and external integrations fit together, plus the sync/audit model. |
| [`ALARM-INTEGRATIONS.md`](ALARM-INTEGRATIONS.md) | 🟢 | Provider-neutral alarm intake: the generic `POST /api/alarms` webhook (auth, idempotency, auto-attach, fail-closed), the Divera adapter and phone/walk-in form, and the `GET /api/integrations` capability registry. |
| [`RAILWAY.md`](RAILWAY.md) | 🟢 | Deployment guide: Railway service layout, environment variables, secrets, and the `start.sh` boot/migration flow. Works on any Docker host. |
| [`OFFLINE_MAPS.md`](OFFLINE_MAPS.md) | 🟢 | Offline map tiles for Basel-Landschaft: TileServer GL setup, MBTiles, and the auto / online / offline fallback modes. |
| [`PRINT_AGENT.md`](PRINT_AGENT.md) | 🟢 | The print agent and the transport-neutral job queue: dispatch slips, board snapshots, QR walk-in slips, the four agent endpoints, and how to write a custom agent for any printer. |
| [`PHOTO_STORAGE.md`](PHOTO_STORAGE.md) | 🟢 | How Reko photos are stored on the persistent volume, served, and pooled for training scenarios. |
| [`AUSFALL_SOP.md`](AUSFALL_SOP.md) | 🟢 | Outage / paper-fallback standard operating procedure: Lageblatt PDF, automatic thermal snapshots, and what to do when the network or backend is down. |
| [`DATABASE_SCHEMA.md`](DATABASE_SCHEMA.md) | 🟡 | Reference table map. Alembic migrations are the source of truth — regenerate if this drifts. |

## Planning ([`plans/`](plans/))

| Doc | Status | What it is |
| --- | --- | --- |
| [`plans/README.md`](plans/README.md) | 🔵 | Post-launch feature and hardening plans, priority-ordered. The pre-publication reliability work is shipped (see the CHANGELOG); remaining plans include emergency plans, Reko material requests, material thresholds, Auftrag routing, and i18n. |

## Test protocols (repo root)

Manual verification scripts run against a live instance before release.

| Doc | Status | What it is |
| --- | --- | --- |
| [`../ALARM-WEBHOOK-TEST-PROTOCOL.md`](../ALARM-WEBHOOK-TEST-PROTOCOL.md) | 🟡 | Step-by-step checks for the provider-neutral alarm webhook (auth, idempotency, auto-attach, rate limit). |
| [`../GPS-TEST-PROTOCOL.md`](../GPS-TEST-PROTOCOL.md) | 🟡 | Step-by-step checks for GPS-driven status automation and vehicle tracking. |

## Historical

Kept for reference; not maintained. Snapshots of design reviews, audits, and superseded plans.

- 🗄 [`AUDIT-2026-07-02.md`](AUDIT-2026-07-02.md), [`AUDIT_2026_05_27.md`](AUDIT_2026_05_27.md),
  [`AUDIT-2026-03-12.md`](AUDIT-2026-03-12.md) — point-in-time code/security audits.
- 🗄 [`CRITIQUE-2026-03-12.md`](CRITIQUE-2026-03-12.md),
  [`UI_UX_FIXES.md`](UI_UX_FIXES.md) — design critiques and their fix lists.
- 🗄 [`DEMO_PLAN.md`](DEMO_PLAN.md), [`FEEDBACK_2026_03_31.md`](FEEDBACK_2026_03_31.md),
  [`verify-polling.md`](verify-polling.md) — superseded plans and verification notes.
- 🗄 [`118-magazin-statement.md`](118-magazin-statement.md) — positioning statement for the "118"
  magazine feature.
