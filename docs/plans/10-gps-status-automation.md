# Plan 10 — GPS-driven status automation (ruleset only, no implementation yet)

**Status: DOCUMENTATION ONLY.** This plan records what GPS automation exists today
and specifies a proposed ruleset for future automation. **Do not implement** the
automation rules until the ruleset below is reviewed and explicitly approved — GPS
data is noisy and false transitions during a live operation are worse than none.

## Current state (as of 2026-06-25)

GPS tracking infrastructure already exists via a **Traccar** integration, but it only
produces **notifications/alerts** — it does **not** change any incident status or
release any resource automatically.

- **Traccar client** — `backend/app/traccar.py` (`TraccarClient`): fetches live device
  positions (lat, lng, speed, course, last_update, address) and position history.
- **Poller** — `backend/app/services/traccar_poller.py`: polls positions every ~10s and
  trails every ~30s, broadcasting `vehicle_positions_update` / `vehicle_trails_update`
  over WebSocket to the board (no side effects on incidents).
- **Geofence alert** — `backend/app/services/notification_service.py`
  (`_check_geofence_alerts`, `_haversine_distance_meters`): if a tracked vehicle comes
  within `geofence_radius_meters` (default **200 m**, `backend/app/schemas/notifications.py`)
  of an incident location, it creates a **`vehicle_arrived` notification only**. No
  status transition.
- **Incident coordinates** — `Incident.location_lat` / `location_lng`
  (`backend/app/models.py:308-309`); both-null-or-both-set constraint.
- **Status values** — `eingegangen, reko, reko_done, disponiert, einsatz,
  einsatz_beendet, abschluss` (`backend/app/models.py:361`). All transitions today are
  **manual** via `POST /incidents/{id}/status` (`backend/app/api/incidents.py`), each
  writing a `StatusTransition` row with the acting `user_id`.

**Conclusion:** No GPS-based status automation exists. The two behaviours the operator
asked about — auto-advancing `disponiert → einsatz` on arrival, and auto-releasing a
vehicle when it returns to the station — are **not** implemented. Only arrival *alerts*
exist.

## Agreed ruleset (decided 2026-06-25 — implementation still gated on master switch)

Decisions: **Rule A = silent auto-advance** (operator's call, over the recommended
confirm-prompt); **Rule B = confirm-release**. Both gated behind the opt-in master
switch (default off) and the safeguards below. The auto-advance choice puts extra weight
on the anti-jitter guards, because GPS is intermittent here (the live Traccar feed returns
frequent `404`/no-fix responses) and a single bad fix must never mis-advance an incident.

Vehicle↔incident link: a vehicle is associated with an incident via its active
`IncidentAssignment` (`resource_type='vehicle'`). Its driver's device is the GPS source.

### Rule A — Arrival: `disponiert → einsatz` (SILENT auto-advance)
- **Trigger:** an assigned vehicle's device is within `geofence_radius_meters` of the
  incident location, **stationary-ish** (speed < ~5 km/h), confirmed across **≥ N
  consecutive valid fixes over ≥ 60 s** (suggest N=3) — not a single reading.
- **Action:** transition the incident `disponiert → einsatz`, write a `StatusTransition`
  attributed to a system actor with note `"Automatisch: Fahrzeug am Einsatzort (GPS)"`.
- **Hard safeguards (because this is silent):**
  - Only fires when status is **exactly `disponiert`**; never downgrades, never re-fires.
  - **Stale/missing fixes don't count** — ignore positions whose `last_update` is older
    than a freshness window (suggest 60 s) and any `404`/no-position device; the debounce
    counter resets on any gap, so spotty coverage can't accumulate a false positive.
  - Per-incident **one-shot**: once auto-advanced, it won't auto-act on that incident again.
  - Trivially reversible — the operator can drag it back exactly like a manual move.

### Rule B — Return to station: confirm-release (never auto-close)
- **Station geofence:** a configurable home-base coordinate + radius (new settings
  `gps.station_lat`, `gps.station_lng`, `gps.station_radius_meters`).
- **Trigger:** an assigned vehicle's device enters the station geofence for ≥ N seconds
  (same freshness/consecutive-fix guards as Rule A).
- **Action:** **prompt** the operator with a one-click "Fahrzeug zurück — freigeben?" to
  release that vehicle's assignment. No silent release. (A future `gps.auto_release`
  setting could make it automatic, default off.)
- **Never** auto-moves the incident to `abschluss` — closing is an operator action; a
  returning vehicle can be a rotation/relief, not a finished job.

### Cross-cutting requirements
- **Opt-in master switch:** `gps.automation_enabled` setting (default **false**). With it
  off, behaviour is exactly today's (alerts only).
- **Hysteresis / debounce:** every rule needs an enter-duration and, where relevant, a
  speed gate, to survive GPS jitter and brief stops at lights.
- **Auditability:** every automated transition writes a `StatusTransition` and an
  `audit_log` row attributed to a clearly-named system actor so the Excel audit export
  shows "automatic (GPS)" vs operator actions.
- **Never in Übung/Demo:** all rules gated on `not event.training_flag` and not demo.
- **Reversibility:** automated transitions must be as easy to undo as a manual drag; the
  operator always overrides.

## Where it would hook in (when approved)
- Extend `notification_service._check_geofence_alerts` (or a sibling
  `_check_geofence_automation`) invoked from `traccar_poller`, calling
  `crud.update_incident_status(...)` under the guards above.
- Add the new settings to `DEFAULT_SETTINGS` (`backend/app/services/settings.py`).
- Add a station-geofence config UI in the existing Traccar/GPS settings area.

## Remaining input needed before build
1. **Station coordinate + radius** (only blocker for Rule B): the home-base lat/lng and a
   radius. Suggest a tight radius (~80–120 m) so vehicles merely driving past the station
   don't trigger a release. Single station in Oberwil assumed unless told otherwise.
2. Confirm the tuning constants are acceptable: geofence radius for arrival (reuse existing
   `geofence_radius_meters`, default 200 m), debounce N=3 consecutive fixes / ≥60 s,
   freshness window 60 s, speed gate ~5 km/h.

Decided: Rule A = silent auto-advance (with the hard safeguards above); Rule B =
confirm-release. Implementation is still gated on `gps.automation_enabled` (default off)
and remains unbuilt until you give the go-ahead.
