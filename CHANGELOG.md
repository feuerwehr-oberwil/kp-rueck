# Changelog

All notable changes to KP Rück are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims to follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) once it cuts its first tagged release.

KP Rück has not yet published a versioned release; everything to date lands on `main` (see the
git log). This file starts the release-notes trail — the first tag will turn the Unreleased
section below into `[0.1.0]`.

## [Unreleased]

### Added
- Provider-neutral alarm intake: a generic `POST /api/alarms` webhook accepts alarms from **any**
  dispatch or alarm system — shared-secret auth, `(source, source_id)` idempotency, auto-attach
  to the active event, and fail-closed when no secret is configured. The native Divera adapter
  (`POST /api/divera/webhook`) and the token-gated phone/walk-in intake form feed the same pool.
  See [`docs/ALARM-INTEGRATIONS.md`](docs/ALARM-INTEGRATIONS.md).
- Integration capability registry: `GET /api/integrations` reports which provider is configured
  per area (alarm in, Ausalarmierung, personnel sync, vehicle GPS). The frontend renders provider
  names from this response instead of hard-coding them, and the generic webhook and intake form
  are always available.
- Provider-neutral outbound alerting (Ausalarmierung): a pluggable `send_alarm(...)` seam
  (`backend/app/services/alerting/`) with a `personnel_external_identities` table keying each
  person's identity per provider — a new provider is a module plus a registry entry.
- German i18n layer: `next-intl` infrastructure (cookie locale, `frontend/messages/de.json`
  catalog, outside-React helper) with UI, toast, and API-error strings extracted from hardcoded
  German — the groundwork for additional locales.
- GPS-driven status automation: silent-arrival (Rule A) and confirm-release (Rule B) rules move
  incidents by vehicle position (`backend/app/services/gps_automation.py`), running in training
  events too. Dwell is decoupled from fix freshness so parked trackers can still trigger.
- After-action PDF report and unified export: Einsatztagebuch, Reaktionszeiten, and Lageblatt
  chapters via `services/pdf_report_service.py`, exposed on the events page and user menu.
- Undo incident deletion: `POST /api/incidents/{id}/restore` with a "Rückgängig" toast.
- Persisted Kanban card order: `Incident.position` + `/incidents/reorder`, eliminating the
  drag snap-back flicker and making within-column reordering real.
- Ausfallsicherheit (paper fallback): a printable Lageblatt PDF, automatic thermal board
  snapshots, an outage SOP ([`docs/AUSFALL_SOP.md`](docs/AUSFALL_SOP.md)), and a startup
  checklist task.
- Reliability hardening for the public demo: audit-log retention sweep
  (`background/audit_cleanup.py`), a global exception handler with request IDs
  (`middleware/request_id.py`), endpoint hardening (admin-gated demo reset, `PRINT_AGENT_TOKEN`,
  WebSocket room auth), and per-session demo sandbox events (`POST /api/demo/sandbox`).
- Training mode depth: auto-generated incidents wired live, Divera intake drills, escalation
  injects, adjustable sim tempo, one-tap Rückfahrt, and simulated GPS drives from the
  Übungssteuerung — all isolated by the `training_flag`.
- QR walk-in print jobs and a generic `qr_code` job type for the thermal print agent.

### Changed
- The board sync path was reworked for robustness: serialized reorders, drag-aware reloads, WS
  recovery, single-commit status operations, and stale-reload discarding — debounced edits are no
  longer lost on tab close, and newer local changes are never clobbered by a late reload.
- Alembic is the single source of schema truth: `create_all` was dropped from boot, so the schema
  only ever changes through a migration.
- Onboarding resolved without a welcome card: shortcut discoverability is the ⌘K command palette
  (also `?`); the 409 conflict copy was softened to "Von anderer Person geändert".
- Blocking photo and Excel work moved off the event loop; driver reassignment and vehicle moves
  are now atomic.

### Fixed
- The Divera webhook auto-attach never fails the ACK, and the member sync now counts created
  personnel correctly.
- `/incidents/sync-version` is no longer shadowed by the `/{incident_id}` route.
- A submitted Reko report can no longer silently revert to draft; users are informed whenever an
  action fails instead of a silent revert.
- Lost print jobs are requeued instead of being dropped forever.
- The shared editor account is no longer seeded in production.

_For the full running history before the first release, see the git log._
