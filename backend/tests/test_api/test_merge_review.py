"""Review round on «merge any open card» (#197).

* a Reko link minted for a card that was merged writes to the LIVE card — form,
  submit (with its status/bell side effects), PATCH, «vor Ort», photos;
* a Rapport kept on a merged card is printed even after a chain of merges;
* reaction times and work windows count from the first report of the place and
  ignore the transition a merge writes;
* a photo that cannot be copied aborts the merge (nothing half-moved);
* Einsatzleiter: an automatic card re-picks, a manual card without one takes the
  merged card's leader when that person was already on it;
* «Trennen» is refused while the surviving card is closed, or merged on itself.
"""

import io
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from unittest.mock import AsyncMock, patch
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from PIL import Image
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Event,
    Incident,
    IncidentAssignment,
    Notification,
    Personnel,
    RekoReport,
    SchadenplatzReport,
    StatusTransition,
)
from app.services.audit_export_service import collect_event_report_data
from app.services.photo_storage import PhotoCopyError, photo_storage
from app.services.reaction_times import fold_merged, load_event_figures, stage_times
from app.services.tokens import generate_form_token

LAT, LNG = Decimal("47.51500000"), Decimal("7.55600000")


@pytest.fixture(autouse=True)
def _quiet_broadcasts():
    with (
        patch("app.api.incidents.broadcast_incident_update", new_callable=AsyncMock),
        patch("app.api.incidents.trigger_sync_background", new_callable=AsyncMock),
        patch("app.api.incidents.broadcast_reko_update", new_callable=AsyncMock),
        patch("app.api.incidents.broadcast_assignment_update", new_callable=AsyncMock),
        patch("app.api.incidents.broadcast_kp_message_update", new_callable=AsyncMock),
        patch("app.api.reko.broadcast_incident_update", new_callable=AsyncMock),
        patch("app.api.reko.broadcast_reko_update", new_callable=AsyncMock),
    ):
        yield


@pytest.fixture
def photos_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(photo_storage, "photos_dir", tmp_path)
    return tmp_path


async def _card(db: AsyncSession, event: Event, title: str, **fields: object) -> Incident:
    incident = Incident(
        id=uuid4(),
        title=title,
        type="elementarereignis",
        priority="low",
        location_address=title,
        location_lat=LAT,
        location_lng=LNG,
        event_id=event.id,
        **{"status": "incoming", **fields},
    )
    db.add(incident)
    await db.commit()
    await db.refresh(incident)
    return incident


async def _merge(client: AsyncClient, dup_id: UUID, target_id: UUID, expect: int = 200) -> dict:
    response = await client.post(f"/api/incidents/{dup_id}/merge", json={"target_id": str(target_id)})
    assert response.status_code == expect, response.text
    return response.json()


def _jpeg() -> bytes:
    image = io.BytesIO()
    Image.new("RGB", (8, 8), "red").save(image, format="JPEG")
    return image.getvalue()


class TestRekoLinkFollowsTheMerge:
    async def test_every_reko_link_endpoint_lands_on_the_live_card(
        self, editor_client: AsyncClient, client: AsyncClient, db_session: AsyncSession, test_event: Event, photos_dir
    ) -> None:
        target = await _card(db_session, test_event, "Hauptstrasse 6", status="reko")
        dup = await _card(db_session, test_event, "Hauptstr. 6", status="reko")
        target_id, dup_id = target.id, dup.id
        token = generate_form_token(str(dup_id), "reko")
        # The crew opened the link before the merge: a draft exists on the duplicate.
        form = await client.get("/api/reko/form", params={"incident_id": str(dup_id), "token": token})
        assert form.status_code == 200, form.text
        report_id = form.json()["id"]

        await _merge(editor_client, dup_id, target_id)

        # Reopened after the merge: the SAME report, now on the live card.
        form = await client.get("/api/reko/form", params={"incident_id": str(dup_id), "token": token})
        assert form.status_code == 200, form.text
        assert form.json()["id"] == report_id
        assert form.json()["incident_id"] == str(target_id)

        arrived = await client.post(f"/api/reko/{dup_id}/arrived", params={"token": token})
        assert arrived.status_code == 200, arrived.text
        bells = (
            (await db_session.execute(select(Notification).where(Notification.type == "reko_arrived"))).scalars().all()
        )
        assert [b.incident_id for b in bells] == [target_id]

        photo = await client.post(
            f"/api/reko/{dup_id}/photos",
            headers={"X-Reko-Token": token},
            files={"file": ("p.jpg", _jpeg(), "image/jpeg")},
        )
        assert photo.status_code == 200, photo.text
        filename = photo.json()["filename"]
        assert (photos_dir / str(target_id) / filename).exists()
        served = await client.get(f"/api/photos/{dup_id}/{filename}", params={"reko_token": token})
        assert served.status_code == 200, served.text

        patched = await client.patch(
            f"/api/reko/{report_id}", headers={"X-Reko-Token": token}, json={"summary_text": "Keller voll"}
        )
        assert patched.status_code == 200, patched.text

        submitted = await client.post(
            "/api/reko/", json={"incident_id": str(dup_id), "token": token, "summary_text": "Keller voll"}
        )
        assert submitted.status_code == 200, submitted.text
        assert submitted.json()["incident_id"] == str(target_id)
        # The submit's side effects run on the live card.
        assert (await db_session.get(Incident, target_id, populate_existing=True)).status == "reko_done"
        assert (await db_session.get(Incident, dup_id, populate_existing=True)).deleted_at is not None
        reports = (await db_session.execute(select(RekoReport).where(RekoReport.incident_id == dup_id))).scalars().all()
        assert reports == []

    async def test_a_link_never_reaches_a_third_card(
        self, client: AsyncClient, db_session: AsyncSession, test_event: Event
    ) -> None:
        other = await _card(db_session, test_event, "Bahnhofstrasse 3")
        token = generate_form_token(str(uuid4()), "reko")
        form = await client.get("/api/reko/form", params={"incident_id": str(other.id), "token": token})
        assert form.status_code == 400


class TestChainsAndTiming:
    async def test_a_kept_rapport_is_printed_after_a_chain_of_merges(
        self, editor_client: AsyncClient, db_session: AsyncSession, test_event: Event
    ) -> None:
        a = await _card(db_session, test_event, "Hauptstr. 6", status="active")
        b = await _card(db_session, test_event, "Hauptstrasse 6", status="active")
        c = await _card(db_session, test_event, "Hauptstrasse 6, 4104 Oberwil", status="active")
        a_id, b_id, c_id = a.id, b.id, c.id
        db_session.add_all(
            [
                SchadenplatzReport(incident_id=a_id, is_draft=False, kurzbericht="Trupp A"),
                SchadenplatzReport(incident_id=b_id, is_draft=False, kurzbericht="Trupp B"),
            ]
        )
        await db_session.commit()
        await _merge(editor_client, a_id, b_id)  # A's Rapport stays on A
        await _merge(editor_client, b_id, c_id)  # B's Rapport moves to C (C had none)

        data = await collect_event_report_data(db_session, test_event.id)
        assert [r.kurzbericht for _, r in data.merged_rapports.get(c_id, [])] == ["Trupp A"]
        assert any(r.kurzbericht == "Trupp B" and r.incident_id == c_id for r in data.schadenplatz_reports)

    async def test_reaction_times_count_from_the_first_report_not_the_merge(
        self, editor_client: AsyncClient, db_session: AsyncSession, test_event: Event
    ) -> None:
        early = datetime.now(UTC) - timedelta(hours=1)
        dup = await _card(db_session, test_event, "Hauptstr. 6", status="enroute", created_at=early)
        db_session.add(
            StatusTransition(
                incident_id=dup.id, from_status="incoming", to_status="enroute", timestamp=early + timedelta(minutes=4)
            )
        )
        await db_session.commit()
        target = await _card(db_session, test_event, "Hauptstrasse 6")  # created now, still «Eingegangen»
        target_id = target.id
        await _merge(editor_client, dup.id, target_id)

        data = await collect_event_report_data(db_session, test_event.id)
        folded, steps = fold_merged(data.incidents, data.transitions, data.merged_cards, data.merged_transitions)
        times = stage_times(folded, steps)[target_id]
        # Dispatched 4 minutes after the FIRST report — not at the merge an hour later.
        assert times.dispatched == pytest.approx(240, abs=1)

        incidents = list(
            (
                await db_session.execute(
                    select(Incident).where(Incident.event_id == test_event.id, Incident.deleted_at.is_(None))
                )
            )
            .scalars()
            .all()
        )
        figures = await load_event_figures(db_session, incidents)
        assert figures.overall.dispatched.median_seconds == pytest.approx(240, abs=1)


class TestSafety:
    async def test_a_photo_that_cannot_be_copied_aborts_the_merge(
        self, editor_client: AsyncClient, db_session: AsyncSession, test_event: Event, monkeypatch
    ) -> None:
        target = await _card(db_session, test_event, "Hauptstrasse 6")
        dup = await _card(db_session, test_event, "Hauptstr. 6", status="reko_done")
        target_id, dup_id = target.id, dup.id
        db_session.add(RekoReport(incident_id=dup_id, token="t", is_draft=False, photos_json=["a.jpg"]))
        await db_session.commit()

        def broken(*_a: object, **_k: object) -> int:
            raise PhotoCopyError("a.jpg")

        monkeypatch.setattr(photo_storage, "copy_photos", broken)
        response = await editor_client.post(f"/api/incidents/{dup_id}/merge", json={"target_id": str(target_id)})
        assert response.status_code == 409
        assert "Fotos" in response.json()["detail"]
        assert (await db_session.get(Incident, dup_id, populate_existing=True)).deleted_at is None
        reko = (await db_session.execute(select(RekoReport).where(RekoReport.token == "t"))).scalar_one()
        assert reko.incident_id == dup_id

    async def test_a_manual_card_without_leader_takes_the_merged_cards_leader(
        self, editor_client: AsyncClient, db_session: AsyncSession, test_event: Event
    ) -> None:
        target = await _card(db_session, test_event, "Hauptstrasse 6", leader_manual=True)
        dup = await _card(db_session, test_event, "Hauptstr. 6")
        target_id, dup_id = target.id, dup.id
        person = Personnel(id=uuid4(), name="Leiter", role="Feuerwehrmann", status="available")
        db_session.add(person)
        await db_session.commit()
        kept = IncidentAssignment(incident_id=target_id, resource_type="personnel", resource_id=person.id)
        doubled = IncidentAssignment(
            incident_id=dup_id, resource_type="personnel", resource_id=person.id, is_leader=True
        )
        db_session.add_all([kept, doubled])
        await db_session.commit()
        kept_id = kept.id

        await _merge(editor_client, dup_id, target_id)
        assert (await db_session.get(IncidentAssignment, kept_id, populate_existing=True)).is_leader is True

        response = await editor_client.post(f"/api/incidents/{dup_id}/unmerge")
        assert response.status_code == 200, response.text
        assert (await db_session.get(IncidentAssignment, kept_id, populate_existing=True)).is_leader is False

    async def test_an_automatic_card_picks_its_leader_again(
        self, editor_client: AsyncClient, db_session: AsyncSession, test_event: Event
    ) -> None:
        target = await _card(db_session, test_event, "Hauptstrasse 6")
        dup = await _card(db_session, test_event, "Hauptstr. 6")
        target_id, dup_id = target.id, dup.id
        senior = Personnel(id=uuid4(), name="Senior", role="Offizier", status="available", role_sort_order=1)
        junior = Personnel(id=uuid4(), name="Junior", role="Feuerwehrmann", status="available", role_sort_order=90)
        db_session.add_all([senior, junior])
        await db_session.commit()
        db_session.add_all(
            [
                IncidentAssignment(
                    incident_id=target_id, resource_type="personnel", resource_id=junior.id, is_leader=True
                ),
                IncidentAssignment(
                    incident_id=dup_id, resource_type="personnel", resource_id=senior.id, is_leader=True
                ),
            ]
        )
        await db_session.commit()
        senior_id = senior.id

        await _merge(editor_client, dup_id, target_id)
        leaders = (
            (
                await db_session.execute(
                    select(IncidentAssignment).where(
                        IncidentAssignment.incident_id == target_id,
                        IncidentAssignment.is_leader.is_(True),
                        IncidentAssignment.unassigned_at.is_(None),
                    )
                )
            )
            .scalars()
            .all()
        )
        assert [row.resource_id for row in leaders] == [senior_id]

    async def test_trennen_is_refused_while_the_surviving_card_is_closed(
        self, editor_client: AsyncClient, db_session: AsyncSession, test_event: Event
    ) -> None:
        target = await _card(db_session, test_event, "Hauptstrasse 6")
        dup = await _card(db_session, test_event, "Hauptstr. 6")
        target_id, dup_id = target.id, dup.id
        await _merge(editor_client, dup_id, target_id)
        closed = await db_session.get(Incident, target_id, populate_existing=True)
        closed.status = "complete"
        await db_session.commit()
        response = await editor_client.post(f"/api/incidents/{dup_id}/unmerge")
        assert response.status_code == 409
        assert "abgeschlossen" in response.json()["detail"]

    async def test_trennen_is_refused_when_the_surviving_card_was_merged_on(
        self, editor_client: AsyncClient, db_session: AsyncSession, test_event: Event
    ) -> None:
        a = await _card(db_session, test_event, "Hauptstr. 6")
        b = await _card(db_session, test_event, "Hauptstrasse 6")
        c = await _card(db_session, test_event, "Hauptstrasse 6, Oberwil")
        a_id, b_id, c_id = a.id, b.id, c.id
        await _merge(editor_client, a_id, b_id)
        await _merge(editor_client, b_id, c_id)
        response = await editor_client.post(f"/api/incidents/{a_id}/unmerge")
        assert response.status_code == 409
        assert "selbst zusammengeführt" in response.json()["detail"]
