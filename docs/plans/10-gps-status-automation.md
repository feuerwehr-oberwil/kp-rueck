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

## Proposed ruleset (for review — not yet built)

Vehicle↔incident link: a vehicle is associated with an incident via its active
`IncidentAssignment` (`resource_type='vehicle'`). Its driver's device is the GPS source.

### Rule A — Arrival: `disponiert → einsatz`
- **Trigger:** an assigned vehicle's device stays within `geofence_radius_meters` of the
  incident location for **≥ N seconds** (debounce, suggest N=60) **and** speed < ~5 km/h.
- **Action:** transition the incident `disponiert → einsatz`, write a `StatusTransition`
  with a synthetic system user and note `"Automatisch: Fahrzeug am Einsatzort (GPS)"`.
- **Guards:** only if status is exactly `disponiert`; never downgrade; never in training
  (`event.training_flag`) or demo mode; require ≥1 confirmed in-radius reading after the
  debounce window (not a single noisy fix).

### Rule B — Return to station: release vehicle / `→ abschluss`
- **Station geofence:** a configurable home-base coordinate + radius (new setting, e.g.
  `gps.station_lat`, `gps.station_lng`, `gps.station_radius_meters`).
- **Trigger:** an assigned vehicle's device enters the station geofence for ≥ N seconds.
- **Action (conservative):** mark that vehicle's assignment as returned and **notify**
  the operator with a one-click "Fahrzeug zurück – freigeben?" action, rather than
  auto-releasing. Auto-release only if a future `gps.auto_release` setting is enabled.
- **Do NOT** auto-move the incident to `abschluss` from this rule — closing an incident
  is an operator decision (see plan for "Einsatz abschliessen"). A returning vehicle ≠
  finished incident (could be a relief/rotation).

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

## Open questions for review
1. Confirm the station home-base coordinate(s) and radius (single station Oberwil?).
2. For Rule A, is auto-advance to `einsatz` desired at all, or only an *upgraded* alert
   ("Fahrzeug am Einsatzort – jetzt auf Einsatz setzen?") the operator confirms?
3. For Rule B, is one-click-confirm release acceptable, or fully automatic once enabled?
