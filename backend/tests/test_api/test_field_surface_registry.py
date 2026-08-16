"""The registry that outlives the audit (plan 26 §8.4).

Plan 26 §1 states the rule every login-less surface has to satisfy:

    An editor must be able to produce the identical database state from the
    board, with provenance saying which channel it came through.

§2 checked that by hand once. This file is what stops the next feature from
re-opening the hole without another audit: it names every write route on every
login-less router together with the doors that route opens, walks the real
FastAPI route table, and fails when the two disagree.

**A registry entry is an auth matrix, not a pair of paths** (decision 11). The
board's twin is normally a *second door on the same route* — either the link's
token or an editor session — because a `…-by-editor` twin is two handlers that
have to be kept in step forever, which is the drift this plan exists to prevent.

The four doors an entry may declare:

``both``
    The rule satisfied on one route. Asserted for real below: the route is
    called with an editor cookie and must not answer 401/403.
``token``
    Field-only. Must name its board twin in ``EXTERNAL_TWINS`` (a *different*
    endpoint that produces the same state) or be written down in ``KNOWN_GAPS``
    with the reason it has none. Both lists are checked against the live route
    table, so a twin that gets renamed fails this suite rather than rotting.
``session``
    Board-only — the direction the rule does **not** police. A field surface
    with no board twin is the hole; a board route with no field twin is fine
    (nobody bulk-checks-out thirty-four people from a phone). It still has to be
    typed out, so the escape hatch is always visible in review.

Out of scope on purpose: `/api/alarms` and `/api/divera/webhook` are
machine-to-machine intakes authenticated by a shared secret, not surfaces a
human opens without logging in; `/api/print/jobs` is agent-authenticated;
`/api/photos` reads only, behind a session or an event-scoped viewer token
(`serve_photo`), and this registry polices writes.
"""

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.main import app
from app.models import Event, Incident, Personnel, RekoReport
from app.services.tokens import generate_form_token

DOORS = ("token", "session", "both")

# The URL prefix each login-less router is mounted under. Every non-GET route
# below one of these has to appear in FIELD_SURFACES.
SURFACE_PREFIXES: dict[str, str] = {
    "personnel_checkin": "/api/personnel/check-in",
    "reko": "/api/reko",
    "feld": "/api/feld",
    "intake": "/api/intake",
    "viewer": "/api/viewer",
}

# door: "token" | "session" | "both" — "both" is the rule satisfied on one route.
FIELD_SURFACES: dict[str, dict[str, str]] = {
    "personnel_checkin": {
        "POST /generate-link": "session",
        "POST /{personnel_id}/in": "both",
        "POST /{personnel_id}/out": "both",
        "POST /event/{event_id}/out-all": "session",
        # The roll-call cycle's third click, built after §4.2 was answered on
        # 2026-08-10 — and it landed as "session", exactly as predicted there. A
        # phone can say it arrived and that it left; "I was never here" corrects
        # the record, which belongs to whoever keeps it.
        "DELETE /{personnel_id}": "session",
    },
    "reko": {
        "POST /": "both",
        # The four that moved here when `/reko-dashboard` was removed (decision
        # 24). They were never that page's: every one is editor-authed, and the
        # comment below its old entry said so. Deleting the router would have
        # taken the board's Reko assignment UI with it.
        "POST /incidents/{incident_id}/assign-reko": "session",
        "DELETE /incidents/{incident_id}/unassign-reko/{personnel_id}": "session",
        "POST /transfer-rekos": "session",
        "PATCH /{report_id}": "both",
        "POST /generate-link": "both",
        "POST /{incident_id}/arrived": "token",
        "POST /{incident_id}/photos": "token",
        "DELETE /{incident_id}/photos/{filename}": "token",
    },
    "feld": {
        "POST /generate-link": "session",
        # The door itself (plan 26, decisions 13 and 18). Token-gated because
        # they are what a phone calls *before* it has any other credential —
        # see KNOWN_GAPS for why neither has a board twin.
        "POST /unlock": "token",
        "POST /claim": "token",
        # The board's two knobs on that door. Editor-only: the code is a
        # credential, and logging every crew out mid-storm is not a field action.
        "POST /access/regenerate": "session",
        "POST /access/revoke-devices": "session",
        "POST /attendance/{personnel_id}": "token",
        "POST /incidents": "token",
        "POST /incidents/{incident_id}/reko-link": "token",
        "POST /incidents/{incident_id}/arrived": "token",
        "POST /incidents/{incident_id}/complete": "token",
        "POST /incidents/{incident_id}/pickup": "token",
        "PUT /incidents/{incident_id}/rapport": "token",
        "POST /incidents/{incident_id}/photos": "token",
        "DELETE /incidents/{incident_id}/photos/{filename}": "token",
        "POST /incidents/{incident_id}/message": "token",
    },
    "intake": {
        "POST /generate-link": "session",
        "POST /alarm": "token",  # twin lives elsewhere ↓
    },
    "viewer": {
        # Output only — the token surface reads and never writes. Minting the link
        # is the board's own action.
        "POST /generate-link": "session",
    },
}

# Routes whose twin is a different endpoint rather than a second door on the same
# one. The value must START with the twin's own "METHOD /path" so this file cannot
# quietly outlive the route it points at; anything after that is prose.
EXTERNAL_TWINS: dict[str, str] = {
    "POST /api/intake/alarm": "POST /api/incidents/ with source='intake'",
    "POST /api/feld/attendance/{personnel_id}": (
        "POST /api/personnel/check-in/{personnel_id}/in — the same attendance row, "
        "written through the same CRUD. The board twin is the door tablet's own route, "
        "which is `both` (token or editor session); this one is the individual saying "
        "it from the vehicle instead of queueing at the tablet."
    ),
    "POST /api/feld/incidents": (
        "POST /api/incidents/ — the board's own create. Same table, same columns; only "
        "the provenance differs, and `source='feld'` is deliberately NOT in "
        "EditorIncidentSource so an operator cannot claim a card was reported from the "
        "field. The takeover half has a board twin too: adding a stop to an Auftrag."
    ),
    "POST /api/reko/{incident_id}/arrived": (
        "POST /api/incidents/{incident_id}/reko-arrived — the KP writer for "
        "'Reko meldet: vor Ort' over the radio (§5.2). Not a second door on the "
        "form-token route, because it also takes an explicit timestamp and clears."
    ),
    "POST /api/feld/incidents/{incident_id}/arrived": (
        "POST /api/incidents/{incident_id}/field-report — sets arrived_at, same crud/feld.py"
    ),
    "POST /api/feld/incidents/{incident_id}/complete": (
        "POST /api/incidents/{incident_id}/field-report — sets field_complete_reported_at"
    ),
    "POST /api/feld/incidents/{incident_id}/pickup": (
        "POST /api/incidents/{incident_id}/field-report — sets pickup_needed/pickup_note"
    ),
    "PUT /api/feld/incidents/{incident_id}/rapport": "PUT /api/incidents/{incident_id}/rapport",
    "POST /api/feld/incidents/{incident_id}/photos": "POST /api/incidents/{incident_id}/rapport/photos",
    "DELETE /api/feld/incidents/{incident_id}/photos/{filename}": (
        "DELETE /api/incidents/{incident_id}/rapport/photos/{filename}"
    ),
}

# Token-gated writes with NO board twin, each with the reason it stays that way.
# This is the escape hatch of last resort and it is deliberately uncomfortable:
# a new token-gated write still fails this suite until somebody writes the line,
# which is the point — the decision gets made once, in review, in writing.
KNOWN_GAPS: dict[str, str] = {
    "POST /api/feld/unlock": (
        "NOT A STATE WRITE — this is authentication, and the rule §1 states does not "
        "reach it. The endpoint exchanges a link token plus the Feld-Code for an "
        "unlocked token and writes nothing at all; there is no database state for an "
        "editor to reproduce from the board. It is a POST because it carries a secret "
        "in a body rather than a query string. The board's authority over this door is "
        "the code itself: POST /api/feld/access/regenerate, which is session-only."
    ),
    "POST /api/feld/claim": (
        "Authentication again (decision 18): the device names its person and receives a "
        "token bound to them. It does write one row — the feld_device_claims record that "
        "makes revocation possible — but that row is a credential, not board state, and "
        "an editor minting one on somebody's behalf is precisely the capability the "
        "binding exists to remove. The board's twin is the other direction: "
        "POST /api/feld/access/revoke-devices takes claims away, and nothing hands them out."
    ),
    "POST /api/feld/incidents/{incident_id}/reko-link": (
        "Mints a short-lived form token so the Reko form can mount inside /feld; it "
        "writes no state at all. The board's equivalent is the route it borrows from — "
        "POST /api/reko/{incident_id}/generate-link, which is editor-authed and hands "
        "out the identical token. Two doors, one credential, no second handler to keep "
        "in step."
    ),
    "POST /api/reko/{incident_id}/photos": (
        "The board offers no photo upload on a Reko report and this stays token-only "
        "on purpose (phase 2's call, re-affirmed in phase 4). A Reko report the KP "
        "files is a radio message transcribed, and a radio call carries no photo — "
        "there is nothing in the operator's hand to attach. Adding the session door "
        "without a control would be a capability that exists in the backend and is "
        "unreachable from the UI, which is the exact complaint §2.2 makes about PATCH. "
        "A photo that reaches the KP by another route belongs on the Schadenplatz-"
        "Rapport, which does have an editor upload."
    ),
    "DELETE /api/reko/{incident_id}/photos/{filename}": (
        "The other half of the same decision: the board cannot attach a Reko photo, "
        "so it has none of its own to remove. Deleting a crew's photo from the KP is "
        "a moderation action nobody has asked for."
    ),
    "POST /api/feld/incidents/{incident_id}/message": (
        "NO BOARD TWIN — surfaced by this registry, not by the audit. A crew's "
        "Freitext-Meldung becomes a notification plus an append-only Journal entry, "
        "and `crud/feld.record_field_message` already handles a user actor and writes "
        "source='kp' (the incident timeline renders it). Only the HTTP route is "
        "missing, so a message dictated over the radio has nowhere to land. Plan 26 "
        "scopes /feld to plan 25 and does not close this; it is a follow-up step, not "
        "an accepted design."
    ),
}


def _route_table() -> list[tuple[str, str]]:
    """Every ("METHOD", "/path") in the running app, HEAD/OPTIONS excluded."""
    table: list[tuple[str, str]] = []
    for route in app.routes:
        methods = getattr(route, "methods", None)
        path = getattr(route, "path", None)
        if not methods or not path:
            continue
        for method in sorted(set(methods) - {"HEAD", "OPTIONS"}):
            table.append((method, path))
    return table


def _surface_of(path: str) -> str | None:
    """Which login-less router owns this path, if any.

    Prefix matching is anchored on a path separator so that `/api/reko-dashboard`
    is never read as a route of `/api/reko`.
    """
    for surface, prefix in SURFACE_PREFIXES.items():
        if path == prefix or path.startswith(prefix + "/"):
            return surface
    return None


def _registered_writes() -> dict[str, dict[str, str]]:
    """The real route table, folded into the registry's own shape."""
    found: dict[str, dict[str, str]] = {surface: {} for surface in SURFACE_PREFIXES}
    for method, path in _route_table():
        if method == "GET":
            continue
        surface = _surface_of(path)
        if surface is None:
            continue
        relative = path[len(SURFACE_PREFIXES[surface]) :] or "/"
        found[surface][f"{method} {relative}"] = path
    return found


def _full_key(surface: str, entry: str) -> str:
    method, relative = entry.split(" ", 1)
    suffix = "" if relative == "/" else relative
    return f"{method} {SURFACE_PREFIXES[surface]}{suffix or '/'}"


def _token_entries() -> list[str]:
    return [
        _full_key(surface, entry)
        for surface, entries in FIELD_SURFACES.items()
        for entry, door in entries.items()
        if door == "token"
    ]


class TestRegistryMatchesTheRouteTable:
    """A new token-gated write fails the suite until somebody names its twin."""

    def test_every_write_route_is_registered(self):
        found = _registered_writes()
        missing = {surface: sorted(set(entries) - set(FIELD_SURFACES[surface])) for surface, entries in found.items()}
        missing = {surface: entries for surface, entries in missing.items() if entries}
        assert not missing, (
            "Write routes on a login-less router that no registry entry names:\n"
            f"{missing}\n\n"
            "Add each one to FIELD_SURFACES with the door it opens. If it is token-only, "
            "name its board twin in EXTERNAL_TWINS or write down in KNOWN_GAPS why it has none."
        )

    def test_no_registry_entry_outlives_its_route(self):
        """A deleted or renamed route must not leave a claim behind."""
        found = _registered_writes()
        stale = {surface: sorted(set(entries) - set(found[surface])) for surface, entries in FIELD_SURFACES.items()}
        stale = {surface: entries for surface, entries in stale.items() if entries}
        assert not stale, f"Registry names routes the app does not serve: {stale}"

    def test_every_door_is_one_of_the_three(self):
        bad = {
            f"{surface}: {entry}": door
            for surface, entries in FIELD_SURFACES.items()
            for entry, door in entries.items()
            if door not in DOORS
        }
        assert not bad, f"Unknown door values: {bad}"


class TestTokenOnlyRoutesNameTheirTwin:
    """`token` is a claim that the board reaches the same state somewhere else."""

    def test_each_token_route_has_a_twin_or_a_written_gap(self):
        undeclared = [key for key in _token_entries() if key not in EXTERNAL_TWINS and key not in KNOWN_GAPS]
        assert not undeclared, (
            "Token-only writes with no board twin and no written reason:\n"
            f"{undeclared}\n\n"
            "Either the board can produce this state (EXTERNAL_TWINS) or it cannot "
            "and somebody has to say so out loud (KNOWN_GAPS)."
        )

    def test_a_route_is_never_both_twinned_and_a_gap(self):
        overlap = sorted(set(EXTERNAL_TWINS) & set(KNOWN_GAPS))
        assert not overlap, f"Claimed to have a twin AND to have none: {overlap}"

    def test_only_token_routes_carry_twins_or_gaps(self):
        """`both` needs no twin (it *is* one) and `session` is not policed at all."""
        token_keys = set(_token_entries())
        noise = sorted((set(EXTERNAL_TWINS) | set(KNOWN_GAPS)) - token_keys)
        assert not noise, (
            f"Twin/gap lines for routes that are not token-only: {noise}. "
            "Delete them — they describe a rule that does not apply."
        )

    def test_every_named_twin_still_exists(self):
        """The twin is a route, not a memory: renaming it has to fail here."""
        table = {f"{method} {path}" for method, path in _route_table()}
        broken = {}
        for key, twin in EXTERNAL_TWINS.items():
            head = " ".join(twin.split()[:2])
            if head not in table:
                broken[key] = twin
        assert not broken, f"EXTERNAL_TWINS points at routes the app does not serve: {broken}"

    def test_every_written_gap_says_something(self):
        thin = {key: reason for key, reason in KNOWN_GAPS.items() if len(reason.strip()) < 60}
        assert not thin, f"A gap needs a reason, not a shrug: {thin}"


class TestSessionOnlyRoutesAreTypedOut:
    """The escape hatch stays visible: it is written down, never defaulted."""

    def test_session_routes_are_named_explicitly(self):
        """Every board-only write appears in the registry with the word `session`.

        This is the same assertion as `test_every_write_route_is_registered` seen
        from the other side, and it is here on purpose: the registry's value is
        that `out-all` having no field twin was a decision somebody typed, not a
        default the test framework handed out.
        """
        session_routes = [
            _full_key(surface, entry)
            for surface, entries in FIELD_SURFACES.items()
            for entry, door in entries.items()
            if door == "session"
        ]
        assert session_routes, "No board-only route left? Then decision 11 changed shape."
        assert "POST /api/personnel/check-in/event/{event_id}/out-all" in session_routes


class TestBothDoorsReallyOpen:
    """`both` is asserted against the app, not taken on trust."""

    @pytest.mark.asyncio
    async def test_every_both_route_accepts_a_session(
        self,
        editor_client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_personnel: Personnel,
        test_incident: Incident,
    ):
        report = RekoReport(
            id=uuid.uuid4(),
            incident_id=test_incident.id,
            token=generate_form_token(str(test_incident.id), "reko"),
            is_draft=True,
        )
        db_session.add(report)
        await db_session.commit()

        event_query = {"event_id": str(test_event.id)}
        probes: dict[str, tuple[str, str, dict]] = {
            "POST /api/personnel/check-in/{personnel_id}/in": (
                "POST",
                f"/api/personnel/check-in/{test_personnel.id}/in",
                {"params": event_query},
            ),
            "POST /api/personnel/check-in/{personnel_id}/out": (
                "POST",
                f"/api/personnel/check-in/{test_personnel.id}/out",
                {"params": event_query},
            ),
            "POST /api/reko/": ("POST", "/api/reko/", {"json": {"incident_id": str(test_incident.id)}}),
            "PATCH /api/reko/{report_id}": (
                "PATCH",
                f"/api/reko/{report.id}",
                {"json": {"summary_text": "Über Funk diktiert"}},
            ),
            "POST /api/reko/generate-link": (
                "POST",
                "/api/reko/generate-link",
                {"params": {"incident_id": str(test_incident.id)}},
            ),
        }

        both_routes = [
            _full_key(surface, entry)
            for surface, entries in FIELD_SURFACES.items()
            for entry, door in entries.items()
            if door == "both"
        ]
        assert sorted(probes) == sorted(both_routes), (
            "Every 'both' entry needs a probe here — the claim that a route accepts a "
            "session is worth exactly as much as the request that proves it."
        )

        for key, (method, url, kwargs) in probes.items():
            response = await editor_client.request(method, url, **kwargs)
            assert response.status_code not in (401, 403), (
                f"{key} is registered as 'both' but turned an editor session away "
                f"with {response.status_code}: {response.text}"
            )
