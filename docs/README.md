# Documentation

This folder holds KP Rück's longer-form documentation – the slower-moving "why" and "how"
behind the app. The product intent and quick start live in the [root README](../README.md); the
feature history lives in [`../CHANGELOG.md`](../CHANGELOG.md).

**Status legend:** 🟢 reflects shipped behaviour · 🟡 partially implemented / may drift ·
🔵 proposed / not yet built.

## Foundations

| Doc | Status | What it is |
| --- | --- | --- |
| [`SETUP.md`](SETUP.md) | 🟢 | **Start here for a new station.** The ordered path from an empty Docker host to a board you can run an event on: boot, take over the seeded accounts, bulk-load resources, offline tiles, integrations, backups – plus the gotchas that catch people and a pre-field checklist. Links to the reference docs below rather than repeating them. |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | 🟢 | System overview: how the Next.js frontend, FastAPI service, PostgreSQL, and external integrations fit together, plus the sync/audit model. |
| [`ALARM-INTEGRATIONS.md`](ALARM-INTEGRATIONS.md) | 🟢 | Provider-neutral alarm intake: the generic `POST /api/alarms` webhook (auth, idempotency, auto-attach, fail-closed), the Divera adapter and phone/walk-in form, and the `GET /api/integrations` capability registry. |
| [`DEPLOYMENT.md`](DEPLOYMENT.md) | 🟢 | Self-hosting guide: the docker-compose stack built from published GHCR images, the single-origin Caddy layout, `KP_RUECK_TAG` version pinning, updating/rollback, and backups. |
| [`RUNNING-BOTH.md`](RUNNING-BOTH.md) | 🟢 | For stations running KP Front *and* KP Rück on one host: the three places two independent stacks collide – host ports (only one can own 443), `PUBLIC_URL` meaning something different in each, and per-deployment alarm secrets with non-interchangeable payloads. |
| [`RAILWAY.md`](RAILWAY.md) | 🟡 | Railway service layout, environment variables, secrets, and the `start.sh` boot/migration flow. **Legacy:** the runtime no longer assumes Railway and [`DEPLOYMENT.md`](DEPLOYMENT.md) is the reference path. Kept for deployments already on Railway. |
| [`OFFLINE_MAPS.md`](OFFLINE_MAPS.md) | 🟢 | Offline map tiles for Basel-Landschaft: TileServer GL setup, MBTiles, and the auto / online / offline fallback modes. |
| [`PRINT_AGENT.md`](PRINT_AGENT.md) | 🟢 | The print agent and the transport-neutral job queue: dispatch slips, board snapshots, QR walk-in slips, the four agent endpoints, and how to write a custom agent for any printer. |
| [`PHOTO_STORAGE.md`](PHOTO_STORAGE.md) | 🟢 | How Reko photos are stored on the persistent volume, served, and pooled for training scenarios. |
| [`AUSFALL_SOP.md`](AUSFALL_SOP.md) | 🟢 | Outage / paper-fallback standard operating procedure: Lageblatt PDF, automatic thermal snapshots, and what to do when the network or backend is down. |
| [`openapi.json`](openapi.json) | 🟢 | The committed OpenAPI contract — every route, request and response shape, readable without booting the stack. Regenerate with `just openapi`; a pytest fails when it drifts from the code. |

## Open checklist

| Doc | Status | What it is |
| --- | --- | --- |

## Planning ([`plans/`](plans/))

| Doc | Status | What it is |
| --- | --- | --- |
| [`plans/README.md`](plans/README.md) | 🔵 | Post-launch feature and hardening plans, priority-ordered. The pre-publication reliability work is shipped (see the CHANGELOG); remaining plans include emergency plans, Reko material requests, material thresholds, Auftrag routing, and i18n. |

## Not in this repository

Internal working documents – point-in-time audits, design critiques, feature planning, QA
protocols run against a live instance – stay local and are not published. They are snapshots of
a moment, they go stale fast, and a half-finished register of "things we were worried about in
March" is a worse answer to "is this software any good?" than the
[CHANGELOG](../CHANGELOG.md), the [known limitations](../README.md#known-limitations), and the
[open issues](https://github.com/feuerwehr-oberwil/kp-rueck/issues) – all of which are current.

Per-station deployment data (rosters, branding, credentials) is never in this repository either.
