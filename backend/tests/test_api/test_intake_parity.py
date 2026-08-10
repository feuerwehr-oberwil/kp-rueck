"""KP parity for the intake surface (plan 26 §6, §8.3).

`/alarm` fails the rule narrowly: it writes exactly one thing the board could
not, `Incident.source = "intake"`, and that one thing is the "Telefon" chip on
the card. An operator taking the call on the landline and typing the incident
himself produced a card that claims to be operator-originated, which is the one
thing it is not.

So `source` joins `IncidentCreate` and `IncidentUpdate`, restricted to the two
values an editor may claim. The restriction is the interesting half: "divera"
and the generic-webhook slugs write `source` on their own path, and a board
request naming one would make a card look like it arrived from a system that has
never heard of it. That boundary is asserted here against the *whole* reserved
set, not a sample, so a slug added to `RESERVED_ALARM_SOURCES` later is covered
the day it lands.

The public form's row is the reference: an editor-created intake incident has to
match it column for column, because the point is that the two are the same fact
arriving through different doors. Everything the board sets and the lean public
form cannot (`internal_notes`, the flags, the Auftrag) is left at its default in
the comparison, and `created_by` is the audit trail — the one column that must
differ, since a KP-typed card does have an author.
"""

from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Event, Incident, User
from app.schemas.alarms import RESERVED_ALARM_SOURCES
from app.services.tokens import generate_alarm_token

# The same alarm, worded once. The public form takes the lean payload; the board
# adds `event_id` (the token carries it) and says so with `source`.
ALARM = {
    "title": "Baum auf Fahrbahn",
    "type": "elementarereignis",
    "priority": "medium",
    "location_address": "Hauptstrasse 12, Oberwil",
    "location_lat": "47.5100",
    "location_lng": "7.5500",
    "description": "Baum liegt quer über beide Spuren",
    "contact": "Hans Muster",
    "contact_phone": "079 123 45 67",
}

# Columns that carry the alarm itself. `created_by` is deliberately absent: it is
# the audit trail, and it is the only column the two doors are allowed to differ
# in (§8.3).
ALARM_COLUMNS = [
    "event_id",
    "title",
    "type",
    "priority",
    "location_address",
    "location_lat",
    "location_lng",
    "description",
    "contact",
    "contact_phone",
    "status",
    "source",
    "source_ref",
]

# Everything an editor may NOT claim. "operator"/"intake" are the two doors this
# phase opens; the rest name a delivering system.
FOREIGN_SOURCES = sorted(RESERVED_ALARM_SOURCES - {"operator", "intake"})


async def _row(db: AsyncSession, incident_id: str) -> Incident:
    """The row straight from the table.

    Takes the *id*, never the ORM object: `expire_all` is what makes the API's
    writes visible through this shared session, and an expired object would then
    try to lazy-load its own primary key from a sync context. For the same
    reason, anything read off an earlier row must be read before the next call.
    """
    db.expire_all()
    return (await db.execute(select(Incident).where(Incident.id == incident_id))).scalar_one()


async def _row_pair(db: AsyncSession, first_id: str, second_id: str) -> tuple[Incident, Incident]:
    """Two rows off one expiry, so neither is stale while the other is read."""
    db.expire_all()
    rows = (await db.execute(select(Incident).where(Incident.id.in_([first_id, second_id])))).scalars().all()
    by_id = {str(row.id): row for row in rows}
    return by_id[first_id], by_id[second_id]


class TestIntakeParity:
    """The board produces the row the public form produces."""

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_public_form_still_writes_intake(
        self, client: AsyncClient, db_session: AsyncSession, test_event: Event
    ):
        """The field door first — the schema change must not move the phone's row."""
        token = generate_alarm_token(test_event.id)
        response = await client.post(f"/api/intake/alarm?token={token}", json=ALARM)

        assert response.status_code == 201
        row = await _row(db_session, response.json()["id"])
        assert row.source == "intake"
        assert row.created_by is None

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_editor_intake_row_equals_public_form_row(
        self,
        client: AsyncClient,
        editor_client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_editor: User,
    ):
        """Same alarm through both doors: identical except the audit trail."""
        # Read before the first `_row`: its `expire_all` is what makes the API's
        # writes visible here, and an expired `User` would then lazy-load its own
        # id from a sync context.
        editor_id = test_editor.id
        token = generate_alarm_token(test_event.id)
        field = await client.post(f"/api/intake/alarm?token={token}", json=ALARM)
        assert field.status_code == 201

        board = await editor_client.post(
            "/api/incidents/",
            json={**ALARM, "event_id": str(test_event.id), "source": "intake"},
        )
        assert board.status_code == 201

        # Both rows in ONE query: `_row`'s `expire_all` is what makes the API's
        # writes visible through this shared session, so a second call would
        # expire the first row and send it lazy-loading from a sync context.
        field_row, board_row = await _row_pair(db_session, field.json()["id"], board.json()["id"])

        for column in ALARM_COLUMNS:
            assert getattr(board_row, column) == getattr(field_row, column), column

        # The audit trail is where they part, and it has to: a KP-typed card has
        # an author, a self-service one does not.
        assert field_row.created_by is None
        assert board_row.created_by == editor_id

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_default_is_operator(self, editor_client: AsyncClient, db_session: AsyncSession, test_event: Event):
        """Off by default — typing a card on the board IS the operator case."""
        response = await editor_client.post(
            "/api/incidents/",
            json={**ALARM, "event_id": str(test_event.id)},
        )
        assert response.status_code == 201
        assert response.json()["source"] == "operator"
        assert (await _row(db_session, response.json()["id"])).source == "operator"

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_intake_reaches_the_response(self, editor_client: AsyncClient, test_event: Event):
        """The card's "Telefon" chip reads `source` off this response."""
        response = await editor_client.post(
            "/api/incidents/",
            json={**ALARM, "event_id": str(test_event.id), "source": "intake"},
        )
        assert response.status_code == 201
        assert response.json()["source"] == "intake"


class TestReservedSourcesRejected:
    """The editor router is not a way to forge a delivering system."""

    @pytest.mark.asyncio
    @pytest.mark.api
    @pytest.mark.parametrize("source", FOREIGN_SOURCES)
    async def test_create_with_reserved_source_is_422(self, editor_client: AsyncClient, test_event: Event, source: str):
        response = await editor_client.post(
            "/api/incidents/",
            json={**ALARM, "event_id": str(test_event.id), "source": source},
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    @pytest.mark.api
    @pytest.mark.parametrize("source", FOREIGN_SOURCES)
    async def test_patch_with_reserved_source_is_422(
        self, editor_client: AsyncClient, test_incident: Incident, source: str
    ):
        response = await editor_client.patch(f"/api/incidents/{test_incident.id}", json={"source": source})
        assert response.status_code == 422

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_unknown_source_is_422(self, editor_client: AsyncClient, test_event: Event):
        """Not only the reserved names: the field is a closed set of two."""
        response = await editor_client.post(
            "/api/incidents/",
            json={**ALARM, "event_id": str(test_event.id), "source": "leitstelle-bl"},
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_webhook_source_survives_a_board_edit(
        self, editor_client: AsyncClient, db_session: AsyncSession, test_incident: Incident
    ):
        """A card that really did come from Divera keeps saying so.

        The pool path writes `source` outside the editor schema, and a PATCH that
        does not mention `source` must leave it standing — otherwise every title
        fix would quietly relabel the alarm as operator-typed.
        """
        test_incident.source = "divera"
        test_incident.source_ref = "E-4711"
        await db_session.commit()

        response = await editor_client.patch(f"/api/incidents/{test_incident.id}", json={"title": "Korrigiert"})
        assert response.status_code == 200
        assert response.json()["source"] == "divera"

        row = await _row(db_session, str(test_incident.id))
        assert row.source == "divera"
        assert row.source_ref == "E-4711"


class TestSourceCorrection:
    """Decision 8: settable at create *and* correctable afterwards, both ways."""

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_operator_to_intake(
        self, editor_client: AsyncClient, db_session: AsyncSession, test_incident: Incident
    ):
        """ "Type it in, then realise it was a phone call" — the common case."""
        assert test_incident.source == "operator"

        response = await editor_client.patch(f"/api/incidents/{test_incident.id}", json={"source": "intake"})
        assert response.status_code == 200
        assert response.json()["source"] == "intake"
        assert (await _row(db_session, str(test_incident.id))).source == "intake"

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_intake_to_operator(self, editor_client: AsyncClient, db_session: AsyncSession, test_event: Event):
        """And back — a mis-ticked toggle is corrected, not lived with."""
        created = await editor_client.post(
            "/api/incidents/",
            json={**ALARM, "event_id": str(test_event.id), "source": "intake"},
        )
        assert created.status_code == 201
        incident_id = created.json()["id"]

        response = await editor_client.patch(f"/api/incidents/{incident_id}", json={"source": "operator"})
        assert response.status_code == 200
        assert response.json()["source"] == "operator"
        assert (await _row(db_session, incident_id)).source == "operator"

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_no_source_ref_is_invented(
        self, editor_client: AsyncClient, db_session: AsyncSession, test_incident: Incident
    ):
        """§6: a phone call has no id in a delivering system, so it gets none."""
        response = await editor_client.patch(f"/api/incidents/{test_incident.id}", json={"source": "intake"})
        assert response.status_code == 200
        assert response.json()["source_ref"] is None
        assert (await _row(db_session, str(test_incident.id))).source_ref is None

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_viewer_cannot_correct(self, viewer_client: AsyncClient, test_incident: Incident):
        response = await viewer_client.patch(f"/api/incidents/{test_incident.id}", json={"source": "intake"})
        assert response.status_code == 403

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_anonymous_cannot_claim_intake(self, client: AsyncClient, test_event: Event):
        """The board door needs a session; the token door is `/api/intake/alarm`."""
        response = await client.post(
            "/api/incidents/",
            json={**ALARM, "event_id": str(test_event.id), "source": "intake"},
        )
        assert response.status_code == 401

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_correction_is_audited(
        self, editor_client: AsyncClient, db_session: AsyncSession, test_incident: Incident
    ):
        """A claim (§11) that nobody can trace back to a person is not one."""
        from app.models import AuditLog

        await editor_client.patch(f"/api/incidents/{test_incident.id}", json={"source": "intake"})

        entries = (
            (
                await db_session.execute(
                    select(AuditLog).where(
                        AuditLog.resource_type == "incident",
                        AuditLog.resource_id == test_incident.id,
                        AuditLog.action_type == "update",
                    )
                )
            )
            .scalars()
            .all()
        )
        assert any("source" in (entry.changes_json or {}) for entry in entries)

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_unknown_incident_is_404(self, editor_client: AsyncClient):
        response = await editor_client.patch(f"/api/incidents/{uuid4()}", json={"source": "intake"})
        assert response.status_code == 404
