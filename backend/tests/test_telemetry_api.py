"""The consent gate, the two channels, and the forwarder.

The tests worth reading here are the negative ones. Anyone can verify that telemetry works
when it is switched on; what a fire station needs verified is that a fresh install sends
nothing, that revoking consent stops payloads that were already queued, and that neither an
editor nor the generic settings endpoint can turn it on behind the admin's back.
"""

import logging

import pytest
from sqlalchemy import select

from app.config import settings
from app.models import Setting, TelemetryOutbox
from app.telemetry import consent as consent_mod

pytestmark = pytest.mark.asyncio

A_CRASH = {
    "kind": "render",
    "message": "TypeError: cannot read 'name' of Einsatz Hauptstrasse 12",
    "stack": "at KanbanBoard (/Users/beichenberger/kp-rueck/frontend/components/kanban/board.tsx:88)",
    "path": "/incidents/3f2504e0-4f89-11d3-9a0c-0305e82c3301",
    "build": "v0.1.0+a1b2c3d",
}


@pytest.fixture(autouse=True)
def _usable_dsn(monkeypatch):
    """A parseable DSN for the duration of each test.

    The DSN shipped in the repo is a placeholder that deliberately does not parse, so without
    this every test here would be testing the "telemetry is off" path by accident.
    """
    monkeypatch.setattr(settings, "telemetry_dsn", "https://pub1ickey@ingest.test/2")
    monkeypatch.setattr(settings, "telemetry_enabled", True)


async def _set_consent(db, value: str) -> None:
    await consent_mod.set_consent(db, value)
    await db.commit()


async def _queued(db) -> list[TelemetryOutbox]:
    return list((await db.execute(select(TelemetryOutbox))).scalars().all())


# --- The default is silence -----------------------------------------------------------


async def test_fresh_install_queues_nothing(client, db_session):
    r = await client.post("/api/diag/client-error", json=A_CRASH)
    assert r.status_code == 204
    assert await _queued(db_session) == []


async def test_fresh_install_mints_no_id(client, db_session):
    # An instance that never opts in should not even carry an identifier for a thing it
    # never did.
    await client.post("/api/diag/client-error", json=A_CRASH)
    assert await consent_mod.get_install_id(db_session) is None


async def test_local_logging_still_happens_without_consent(client, caplog):
    # Consent gates the SECOND hop only. The station's own log is not telemetry.
    with caplog.at_level(logging.WARNING, logger="kprueck.clienterror"):
        await client.post("/api/diag/client-error", json=A_CRASH)
    assert "client-error" in "\n".join(r.getMessage() for r in caplog.records)


# --- Opted in -------------------------------------------------------------------------


async def test_consent_queues_a_sanitised_payload(client, db_session):
    await _set_consent(db_session, consent_mod.CONSENT_ERRORS)
    assert (await client.post("/api/diag/client-error", json=A_CRASH)).status_code == 204

    rows = await _queued(db_session)
    assert len(rows) == 1
    assert rows[0].channel == "error" and rows[0].sent_at is None
    wire = str(rows[0].payload_json)
    assert "Hauptstrasse 12" not in wire
    assert "beichenberger" not in wire
    assert "3f2504e0" not in wire
    assert "board.tsx" in wire  # still a usable report


async def test_the_exact_payload_is_logged_before_it_is_queued(client, db_session, caplog):
    # The transparency requirement: a deployer running default log levels can read what
    # left, in their own log, without being told to enable anything.
    await _set_consent(db_session, consent_mod.CONSENT_ERRORS)
    with caplog.at_level(logging.INFO, logger="kp.telemetry"):
        await client.post("/api/diag/client-error", json=A_CRASH)
    logged = "\n".join(r.getMessage() for r in caplog.records)
    assert "exact content follows" in logged
    assert "board.tsx" in logged


# --- Revoking -------------------------------------------------------------------------


async def test_switching_off_discards_what_was_queued(admin_client, client, db_session):
    await _set_consent(db_session, consent_mod.CONSENT_ERRORS)
    await client.post("/api/diag/client-error", json=A_CRASH)
    assert len(await _queued(db_session)) == 1

    r = await admin_client.put("/api/diag/telemetry/consent", json={"consent": "off"})
    assert r.status_code == 200 and r.json()["discarded"] == 1
    # "Off" has to mean the queue stops, not that it drains.
    assert await _queued(db_session) == []


async def test_env_kill_switch_outranks_stored_consent(client, db_session, monkeypatch):
    await _set_consent(db_session, consent_mod.CONSENT_ERRORS)
    monkeypatch.setattr(settings, "telemetry_enabled", False)
    assert await consent_mod.get_consent(db_session) == consent_mod.CONSENT_OFF
    await client.post("/api/diag/client-error", json=A_CRASH)
    assert await _queued(db_session) == []


async def test_unknown_stored_consent_reads_as_off(db_session):
    # Defence against a hand-edited settings row: anything unrecognised is off, never
    # "probably fine".
    db_session.add(Setting(key=consent_mod.CONSENT_KEY, value="usage-and-more"))
    await db_session.commit()
    assert await consent_mod.get_consent(db_session) == consent_mod.CONSENT_OFF


# --- Who may decide -------------------------------------------------------------------


async def test_consent_is_admin_only(client, editor_client):
    # 401/403 either way — what matters is that a kiosk-level login cannot flip it. Consent
    # is a deployment decision, and the Feuerwehr is the controller, not the logged-in user.
    assert (await client.get("/api/diag/telemetry")).status_code in (401, 403)
    assert (await editor_client.put("/api/diag/telemetry/consent", json={"consent": "errors"})).status_code in (
        401,
        403,
    )


async def test_the_generic_settings_endpoint_cannot_reach_the_consent_key(editor_client):
    # app/api/settings.py only accepts keys in DEFAULT_SETTINGS. telemetry.consent is
    # deliberately absent from that list, which is what stops an editor from routing around
    # the admin gate above. If someone ever adds it there, this fails.
    r = await editor_client.patch(f"/api/settings/{consent_mod.CONSENT_KEY}", json={"value": "errors"})
    assert r.status_code == 404


# --- The manual channel ---------------------------------------------------------------


async def test_report_requires_a_logged_in_user(client):
    assert (await client.post("/api/diag/report", json={"message": "kaputt"})).status_code in (
        401,
        403,
    )


async def test_report_is_queued_without_any_admin_opt_in(editor_client, db_session):
    # Pressing send IS the consent — the background switch is irrelevant here, and this is
    # the difference the whole design rests on.
    assert await consent_mod.get_consent(db_session) == consent_mod.CONSENT_OFF
    r = await editor_client.post("/api/diag/report", json={"message": "Nach dem Verschieben war die Karte weg"})
    assert r.status_code == 202
    rows = await _queued(db_session)
    assert len(rows) == 1 and rows[0].channel == "report"


async def test_report_echoes_back_exactly_what_was_queued(editor_client, db_session):
    # The dialog shows a client-built preview; this response is the server confirming the
    # preview was honest. If they could differ, the preview would be theatre.
    r = await editor_client.post(
        "/api/diag/report",
        json={"message": "Absturz beim Einsatz Bahnhofstrasse 4, Rückruf 079 123 45 67"},
    )
    assert r.status_code == 202
    echoed = r.json()["sent"]
    assert echoed == (await _queued(db_session))[0].payload_json
    wire = str(echoed)
    assert "Bahnhofstrasse 4" not in wire and "079 123 45 67" not in wire


async def test_report_is_refused_when_the_deployer_disabled_outbound(editor_client, monkeypatch):
    # 503 rather than a silent success: the dialog has to know to fall back to mail.
    monkeypatch.setattr(settings, "telemetry_enabled", False)
    r = await editor_client.post("/api/diag/report", json={"message": "kaputt"})
    assert r.status_code == 503
    assert r.json()["detail"] == "outbound-disabled"


# --- Admin surface --------------------------------------------------------------------


async def test_status_shows_the_queue_verbatim(admin_client, client, db_session):
    await _set_consent(db_session, consent_mod.CONSENT_ERRORS)
    await client.post("/api/diag/client-error", json=A_CRASH)

    body = (await admin_client.get("/api/diag/telemetry")).json()
    assert body["consent"] == "errors"
    assert body["decided"] is True
    assert body["pending"] == 1
    assert body["recent"][0]["payload"]["tags"]["channel"] == "error"


async def test_undecided_is_not_the_same_as_off(admin_client):
    body = (await admin_client.get("/api/diag/telemetry")).json()
    assert body["consent"] == "off"
    # ...but nobody has answered, so the UI asks rather than treating silence as a decision.
    assert body["decided"] is False


async def test_regenerating_the_install_id_cuts_the_link(admin_client, client, db_session):
    await _set_consent(db_session, consent_mod.CONSENT_ERRORS)
    await client.post("/api/diag/client-error", json=A_CRASH)
    before = await consent_mod.get_install_id(db_session)

    after = (await admin_client.post("/api/diag/telemetry/install-id")).json()["installId"]
    assert after != before and before is not None


# --- The forwarder --------------------------------------------------------------------


class _FakeResponse:
    def __init__(self, status_code: int):
        self.status_code = status_code

    @property
    def is_success(self) -> bool:
        return 200 <= self.status_code < 300


class _FakeClient:
    """Stands in for httpx.AsyncClient, recording what would have gone over the wire."""

    posted: list = []
    responses: list = []
    raises: Exception | None = None

    def __init__(self, *_, **__):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        return False

    async def post(self, url, content=None, headers=None):
        if _FakeClient.raises:
            raise _FakeClient.raises
        _FakeClient.posted.append((url, content))
        return _FakeClient.responses.pop(0) if _FakeClient.responses else _FakeResponse(200)


@pytest.fixture
def fake_http(monkeypatch):
    from app.telemetry import forwarder

    _FakeClient.posted = []
    _FakeClient.responses = []
    _FakeClient.raises = None
    monkeypatch.setattr(forwarder.httpx, "AsyncClient", _FakeClient)
    return _FakeClient


async def test_flush_delivers_and_marks_sent(client, db_session, fake_http):
    from app.telemetry.forwarder import flush

    await _set_consent(db_session, consent_mod.CONSENT_ERRORS)
    await client.post("/api/diag/client-error", json=A_CRASH)

    assert await flush(db_session) == 1
    await db_session.commit()
    assert (await _queued(db_session))[0].sent_at is not None
    url, body = fake_http.posted[0]
    assert url == "https://ingest.test/api/2/envelope/"
    assert b"board.tsx" in body


async def test_unparseable_dsn_sends_nothing(client, db_session, fake_http, monkeypatch):
    # The DSN is live now, so this can no longer lean on the shipped placeholder. The
    # invariant it actually guards is the one that keeps a misconfiguration quiet instead of
    # dangerous: if the configured DSN cannot be parsed, nothing goes out at all — the rows
    # stay queued and the instance carries on.
    from app.telemetry.forwarder import flush

    await _set_consent(db_session, consent_mod.CONSENT_ERRORS)
    await client.post("/api/diag/client-error", json=A_CRASH)
    monkeypatch.setattr(settings, "telemetry_dsn", "not-a-dsn://broken")

    assert await flush(db_session) == 0
    assert fake_http.posted == []


async def test_offline_keeps_the_row_queued(client, db_session, fake_http):
    from app.telemetry.forwarder import flush

    await _set_consent(db_session, consent_mod.CONSENT_ERRORS)
    await client.post("/api/diag/client-error", json=A_CRASH)
    fake_http.raises = OSError("network unreachable")

    assert await flush(db_session) == 0
    await db_session.commit()
    row = (await _queued(db_session))[0]
    assert row.sent_at is None and row.attempts == 1 and row.last_error == "OSError"


async def test_consent_revoked_between_queue_and_flush_sends_nothing(client, editor_client, db_session, fake_http):
    # The race the design has to survive: an admin switches off while a payload is queued.
    from app.telemetry.forwarder import flush

    await _set_consent(db_session, consent_mod.CONSENT_ERRORS)
    await client.post("/api/diag/client-error", json=A_CRASH)
    await editor_client.post("/api/diag/report", json={"message": "von Hand gemeldet"})
    await _set_consent(db_session, consent_mod.CONSENT_OFF)

    # The manual report still goes (its consent was the send button); the background one is
    # dropped, not merely delayed.
    assert await flush(db_session) == 1
    await db_session.commit()
    assert [r.channel for r in await _queued(db_session)] == ["report"]
