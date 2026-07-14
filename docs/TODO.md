# TODO

## Features

- [x] **Einsatztagebuch** — shipped as a chapter in the after-action PDF
  (chronological timeline from `audit_log` + `status_transitions` + assignments +
  reko reports). Deferred to a possible v2: manual Nachtrag entries, dedicated UI view.
- [ ] **Reaktionszeiten in the UI** — the after-action PDF now has the
  Reaktionszeiten table (Eingang → Reko/Disponiert/Vor Ort/Abschluss per incident);
  showing the same numbers live in the app (e.g. event stats page) is wanted later.
- [ ] **Divera real training alarms (Übungs-Whitelist)** — implemented and reviewed
  on branch `claude/ubungssteuerung-divera-review-0n64m1` (commit `da7ec5a`),
  deliberately NOT merged: training stays Divera-free (simulations only) for now.
  If ever wanted: fix the send-dialog banner race (one settings fetch must drive
  banner + send gate) and check the ÜBUNG marker against the truncated title first.
- [ ] **More reko training photos** — current pool is Wikimedia-Commons-only,
  scene-before-response criterion (59 images, `scripts/download-training-photos.py`
  + ATTRIBUTION.md). Gaps: `chemiewehr` and `gerettete_menschen` have zero compliant
  Commons material — best filled with own photos staged during a drill (before crews
  enter frame; drop into `backend/app/assets/training_photos/<type>/`, own dir beats
  the alias automatically). Other sources worth probing: Openverse (aggregates
  Flickr CC — check each license), cantonal/GVB press archives (ask permission),
  Unsplash/Pexels are NOT ok (licenses forbid redistribution "as part of a dataset").

## Operational Reliability

_Process/ops tasks, not code. The backend already exposes `/api/health` and
`/api/health/detailed` (DB + WebSocket component status) — build the external
monitoring on top of those._

- [x] Define KP Rueck's outage role — in `docs/AUSFALL_SOP.md`: "Papier führt" under outage, last Lageblatt becomes the board.
- [x] Write a one-page outage SOP — `docs/AUSFALL_SOP.md` (incl. failure matrix + re-entry procedure).
- [ ] Keep a physical paper board ready at the command post (magnet board or blank Führungsformulare + Klemmbrett).
- [x] Snapshot routine — automatic: thermal auto-print (Settings → Drucker → Papier-Fallback) and Lageblatt auto-download (Export menu), both every 15 min, change-detected. Manual Lageblatt (A4, Führungsformular BL/BS layout) in the export menu.
- [x] ~~Assign a role for snapshots~~ — superseded by the automatic snapshot routine above.
- [ ] Run the failover drill (script at the end of `docs/AUSFALL_SOP.md`) — target: on paper within 2 minutes.
- [ ] Test restoring Railway Postgres and exporting/snapshotting Railway volume photos.
- [ ] Add external monitoring (uptime checks) for frontend, backend `/health`, login, WebSocket connection, and authenticated board load.
- [ ] Set `PRINT_AGENT_TOKEN` on Railway — prod logs warn the print-agent endpoints are unauthenticated without it (the Pi agent must then send the same token).

---

_Divera Outbound Alarm Integration — **done** and removed from this list. Shipped as
`backend/app/services/divera_alarm.py` + `POST /api/incidents/{id}/alarm`
(targets assigned personnel via `notification_type=4`, guarded against training +
demo, audit-logged, with a test-alarm endpoint). WhatsApp copy flow unchanged._
