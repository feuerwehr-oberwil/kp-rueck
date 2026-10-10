"""Any open card can be merged — its work moves along (owner decision 10.10.2026).

The hard cases this pins down:

* crew / vehicles / material move, and so does the status when the merged card
  was further along; «Trennen» puts both back;
* a resource on BOTH cards ends up with ONE assignment (the surviving card's),
  and «Trennen» gives the merged card its row back;
* two Einsatzleiter: the surviving card's stays, the other one gets it back on
  «Trennen»;
* Reko reports move with their photo files (copied, never moved);
* one Rapport per Einsatz: a lone one moves; two are BOTH kept, and the event
  report prints the merged card's under the surviving card;
* flags travel (Nachbarhilfe set, Am Warten notes joined) and come back;
* KP messages move; the merged card keeps its number and gets it back;
* journal lines «übernommen von …», WebSocket updates, the crew's /feld view;
* closed cards: never merged away (and never merged into — test_duplicates).
"""

from decimal import Decimal
from io import BytesIO
from unittest.mock import AsyncMock, patch
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from pypdf import PdfReader
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.exports import _collect_report_photos
from app.crud.feld.visibility import visible_by_personnel
from app.models import (
    Event,
    Incident,
    IncidentAssignment,
    IncidentFieldMessage,
    JournalEntry,
    Material,
    Personnel,
    RekoReport,
    SchadenplatzReport,
    StatusTransition,
    Vehicle,
)
from app.services.audit_export_service import collect_event_report_data
from app.services.pdf_report_service import build_event_report_pdf
from app.services.photo_storage import photo_storage

LAT, LNG = Decimal("47.51500000"), Decimal("7.55600000")


@pytest.fixture(autouse=True)
def _quiet_broadcasts():
    with (
        patch("app.api.incidents.broadcast_incident_update", new_callable=AsyncMock),
        patch("app.api.incidents.trigger_sync_background", new_callable=AsyncMock),
        patch("app.api.incidents.broadcast_reko_update", new_callable=AsyncMock),
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


async def _person(db: AsyncSession, name: str, sort: int = 50) -> Personnel:
    person = Personnel(id=uuid4(), name=name, role="Feuerwehrmann", status="available", role_sort_order=sort)
    db.add(person)
    await db.commit()
    return person


async def _assign(db: AsyncSession, incident_id: UUID, resource_type: str, resource_id: UUID, **kw: object) -> UUID:
    row = IncidentAssignment(incident_id=incident_id, resource_type=resource_type, resource_id=resource_id, **kw)
    db.add(row)
    await db.commit()
    return row.id


async def _merge(client: AsyncClient, dup_id: UUID, target_id: UUID) -> dict:
    response = await client.post(f"/api/incidents/{dup_id}/merge", json={"target_id": str(target_id)})
    assert response.status_code == 200, response.text
    return response.json()


async def _unmerge(client: AsyncClient, dup_id: UUID) -> dict:
    response = await client.post(f"/api/incidents/{dup_id}/unmerge")
    assert response.status_code == 200, response.text
    return response.json()


async def _active(db: AsyncSession, incident_id: UUID) -> list[IncidentAssignment]:
    rows = await db.execute(
        select(IncidentAssignment)
        .where(IncidentAssignment.incident_id == incident_id, IncidentAssignment.unassigned_at.is_(None))
        .execution_options(populate_existing=True)
    )
    return list(rows.scalars().all())


async def _get(db: AsyncSession, model: type, row_id: UUID):
    return await db.get(model, row_id, populate_existing=True)


class TestCrewAndStatus:
    async def test_crew_vehicles_material_and_status_move_and_come_back(
        self, editor_client: AsyncClient, db_session: AsyncSession, test_event: Event
    ) -> None:
        target = await _card(db_session, test_event, "Hauptstrasse 6", status="incoming")
        dup = await _card(db_session, test_event, "Hauptstr. 6", status="active", possible_duplicate_of_id=target.id)
        target_id, dup_id, dup_number = target.id, dup.id, dup.number
        person = await _person(db_session, "Meier Hans")
        vehicle = Vehicle(id=uuid4(), name="TLF 1", type="TLF", status="available")
        material = Material(id=uuid4(), name="Tauchpumpe", type="Pumpe", status="available")
        db_session.add_all([vehicle, material])
        await db_session.commit()
        for kind, rid in (("personnel", person.id), ("vehicle", vehicle.id), ("material", material.id)):
            await _assign(db_session, dup_id, kind, rid)

        with patch("app.api.incidents.broadcast_assignment_update", new_callable=AsyncMock) as assignment_ws:
            body = await _merge(editor_client, dup_id, target_id)
        assignment_ws.assert_called()
        assert {(r.resource_type, r.resource_id) for r in await _active(db_session, target_id)} == {
            ("personnel", person.id),
            ("vehicle", vehicle.id),
            ("material", material.id),
        }
        # Crew on site moved over: the card it moved to does not claim nobody was sent.
        assert body["target"]["status"] == "active"
        transition = (
            await db_session.execute(
                select(StatusTransition).where(
                    StatusTransition.incident_id == target_id, StatusTransition.to_status == "active"
                )
            )
        ).scalar_one()
        assert f"#{dup_number}" in (transition.notes or "")
        # One journal line on the surviving card, naming what came over.
        line = (
            (
                await db_session.execute(
                    select(JournalEntry).where(JournalEntry.incident_id == target_id, JournalEntry.kind == "incident")
                )
            )
            .scalars()
            .all()
        )
        moved = [j for j in line if (j.data or {}).get("action") == "items_moved"]
        assert len(moved) == 1
        assert "TLF 1" in moved[0].text and "Meier Hans" in moved[0].text and "Tauchpumpe" in moved[0].text
        # The Nachtrag names the merged card by its number.
        assert f"Weitere Meldung #{dup_number}" in body["target"]["internal_notes"]

        undone = await _unmerge(editor_client, dup_id)
        assert undone["target"]["status"] == "incoming"
        assert undone["restored"]["number"] == dup_number
        assert len(await _active(db_session, dup_id)) == 3
        assert await _active(db_session, target_id) == []
        assert undone["target"]["internal_notes"] in (None, "")

    async def test_a_survivor_further_along_keeps_its_status(
        self, editor_client: AsyncClient, db_session: AsyncSession, test_event: Event
    ) -> None:
        target = await _card(db_session, test_event, "Hauptstrasse 6", status="active")
        dup = await _card(db_session, test_event, "Hauptstr. 6", status="reko")
        body = await _merge(editor_client, dup.id, target.id)
        assert body["target"]["status"] == "active"

    async def test_a_resource_on_both_cards_keeps_one_assignment(
        self, editor_client: AsyncClient, db_session: AsyncSession, test_event: Event
    ) -> None:
        target = await _card(db_session, test_event, "Hauptstrasse 6")
        dup = await _card(db_session, test_event, "Hauptstr. 6")
        target_id, dup_id = target.id, dup.id
        person = await _person(db_session, "Meier Hans")
        kept = await _assign(db_session, target_id, "personnel", person.id)
        doubled = await _assign(db_session, dup_id, "personnel", person.id)

        await _merge(editor_client, dup_id, target_id)
        active = await _active(db_session, target_id)
        assert [r.id for r in active] == [kept]
        closed = await _get(db_session, IncidentAssignment, doubled)
        assert closed.unassigned_at is not None and closed.incident_id == dup_id

        # Trennen: it was on both before — it is on both again.
        await _unmerge(editor_client, dup_id)
        assert [r.id for r in await _active(db_session, dup_id)] == [doubled]
        assert [r.id for r in await _active(db_session, target_id)] == [kept]

    async def test_two_leaders_the_survivors_stays(
        self, editor_client: AsyncClient, db_session: AsyncSession, test_event: Event
    ) -> None:
        target = await _card(db_session, test_event, "Hauptstrasse 6")
        dup = await _card(db_session, test_event, "Hauptstr. 6")
        target_id, dup_id = target.id, dup.id
        a, b = await _person(db_session, "Leiter A"), await _person(db_session, "Leiter B")
        lead_a = await _assign(db_session, target_id, "personnel", a.id, is_leader=True)
        lead_b = await _assign(db_session, dup_id, "personnel", b.id, is_leader=True)

        await _merge(editor_client, dup_id, target_id)
        leaders = [r.id for r in await _active(db_session, target_id) if r.is_leader]
        assert leaders == [lead_a]

        await _unmerge(editor_client, dup_id)
        assert (await _get(db_session, IncidentAssignment, lead_b)).is_leader is True
        assert (await _get(db_session, IncidentAssignment, lead_b)).incident_id == dup_id

    async def test_a_closed_card_is_never_merged_away(
        self, editor_client: AsyncClient, db_session: AsyncSession, test_event: Event
    ) -> None:
        target = await _card(db_session, test_event, "Hauptstrasse 6")
        dup = await _card(db_session, test_event, "Hauptstr. 6", status="complete")
        response = await editor_client.post(f"/api/incidents/{dup.id}/merge", json={"target_id": str(target.id)})
        assert response.status_code == 409


class TestRekoRapportPhotos:
    async def test_reko_moves_with_its_photos_copied(
        self, editor_client: AsyncClient, db_session: AsyncSession, test_event: Event, photos_dir
    ) -> None:
        target = await _card(db_session, test_event, "Hauptstrasse 6")
        dup = await _card(db_session, test_event, "Hauptstr. 6", status="reko_done")
        target_id, dup_id = target.id, dup.id
        (photos_dir / str(dup_id)).mkdir()
        (photos_dir / str(dup_id) / "keller.jpg").write_bytes(b"jpeg")
        reko = RekoReport(incident_id=dup_id, token="t", is_draft=False, photos_json=["keller.jpg"])
        db_session.add(reko)
        await db_session.commit()
        reko_id = reko.id

        await _merge(editor_client, dup_id, target_id)
        assert (await _get(db_session, RekoReport, reko_id)).incident_id == target_id
        assert (photos_dir / str(target_id) / "keller.jpg").read_bytes() == b"jpeg"
        assert (photos_dir / str(dup_id) / "keller.jpg").exists()  # copied, never moved

        await _unmerge(editor_client, dup_id)
        assert (await _get(db_session, RekoReport, reko_id)).incident_id == dup_id

    async def test_a_lone_rapport_moves(
        self, editor_client: AsyncClient, db_session: AsyncSession, test_event: Event, photos_dir
    ) -> None:
        target = await _card(db_session, test_event, "Hauptstrasse 6")
        dup = await _card(db_session, test_event, "Hauptstr. 6", status="active")
        target_id, dup_id = target.id, dup.id
        rapport = SchadenplatzReport(incident_id=dup_id, is_draft=False, kurzbericht="Keller ausgepumpt")
        db_session.add(rapport)
        await db_session.commit()
        rapport_id = rapport.id

        await _merge(editor_client, dup_id, target_id)
        assert (await _get(db_session, SchadenplatzReport, rapport_id)).incident_id == target_id
        await _unmerge(editor_client, dup_id)
        assert (await _get(db_session, SchadenplatzReport, rapport_id)).incident_id == dup_id

    async def test_two_rapports_are_both_kept_and_printed(
        self, editor_client: AsyncClient, db_session: AsyncSession, test_event: Event, photos_dir
    ) -> None:
        target = await _card(db_session, test_event, "Hauptstrasse 6", status="active")
        dup = await _card(db_session, test_event, "Hauptstr. 6", status="active")
        target_id, dup_id, dup_number = target.id, dup.id, dup.number
        (photos_dir / str(dup_id)).mkdir()
        (photos_dir / str(dup_id) / "schaden.jpg").write_bytes(b"jpeg")
        db_session.add_all(
            [
                SchadenplatzReport(incident_id=target_id, is_draft=False, kurzbericht="Erster Trupp: Keller leer"),
                SchadenplatzReport(
                    incident_id=dup_id, is_draft=False, kurzbericht="Zweiter Trupp: Garage", photos_json=["schaden.jpg"]
                ),
            ]
        )
        await db_session.commit()

        await _merge(editor_client, dup_id, target_id)
        kept = (
            await db_session.execute(select(SchadenplatzReport).where(SchadenplatzReport.incident_id == dup_id))
        ).scalar_one()
        assert kept.kurzbericht == "Zweiter Trupp: Garage"

        data = await collect_event_report_data(db_session, test_event.id)
        assert [r.kurzbericht for _, r in data.merged_rapports[target_id]] == ["Zweiter Trupp: Garage"]
        photos = _collect_report_photos(data)
        assert [p.filename for p in photos[target_id]] == ["schaden.jpg"]
        pdf = PdfReader(BytesIO(build_event_report_pdf(data, "u")))
        text = "\n".join(page.extract_text() for page in pdf.pages)
        assert "Erster Trupp: Keller leer" in text
        assert "Zweiter Trupp: Garage" in text
        assert f"Schadenplatz-Rapport von #{dup_number}" in text


class TestFlagsMessagesAndFeld:
    async def test_flags_travel_and_come_back(
        self, editor_client: AsyncClient, db_session: AsyncSession, test_event: Event
    ) -> None:
        target = await _card(db_session, test_event, "Hauptstrasse 6", am_warten=True, am_warten_note="DL Reinach")
        dup = await _card(
            db_session,
            test_event,
            "Hauptstr. 6",
            nachbarhilfe=True,
            nachbarhilfe_note="Therwil",
            am_warten=True,
            am_warten_note="Kran",
        )
        body = await _merge(editor_client, dup.id, target.id)
        assert body["target"]["nachbarhilfe"] is True
        assert body["target"]["nachbarhilfe_note"] == "Therwil"
        assert body["target"]["am_warten_note"] == "DL Reinach + Kran"

        undone = await _unmerge(editor_client, dup.id)
        assert undone["target"]["nachbarhilfe"] is False
        assert undone["target"]["am_warten_note"] == "DL Reinach"

    async def test_kp_messages_move_and_come_back(
        self, editor_client: AsyncClient, db_session: AsyncSession, test_event: Event
    ) -> None:
        target = await _card(db_session, test_event, "Hauptstrasse 6")
        dup = await _card(db_session, test_event, "Hauptstr. 6")
        target_id, dup_id = target.id, dup.id
        message = IncidentFieldMessage(incident_id=dup_id, message="Rückzug über Hauptstrasse", author_name="Dispo")
        db_session.add(message)
        await db_session.commit()
        message_id = message.id

        await _merge(editor_client, dup_id, target_id)
        assert (await _get(db_session, IncidentFieldMessage, message_id)).incident_id == target_id
        await _unmerge(editor_client, dup_id)
        assert (await _get(db_session, IncidentFieldMessage, message_id)).incident_id == dup_id

    async def test_an_active_crew_finds_the_surviving_card_on_feld(
        self, editor_client: AsyncClient, db_session: AsyncSession, test_event: Event
    ) -> None:
        target = await _card(db_session, test_event, "Hauptstrasse 6")
        dup = await _card(db_session, test_event, "Hauptstr. 6", status="active")
        target_id, dup_id = target.id, dup.id
        person = await _person(db_session, "Frey Marc")
        person_id = person.id
        await _assign(db_session, dup_id, "personnel", person_id)

        await _merge(editor_client, dup_id, target_id)
        visible = await visible_by_personnel(db_session, test_event.id)
        assert visible[person_id][target_id].is_active is True
        assert dup_id not in visible[person_id]


@pytest.mark.parametrize("closed_side", ["target", "dup"])
async def test_closed_cards_stay_out_on_both_sides(
    editor_client: AsyncClient, db_session: AsyncSession, test_event: Event, closed_side: str
) -> None:
    target = await _card(
        db_session, test_event, "Hauptstrasse 6", status="complete" if closed_side == "target" else "active"
    )
    dup = await _card(db_session, test_event, "Hauptstr. 6", status="complete" if closed_side == "dup" else "active")
    response = await editor_client.post(f"/api/incidents/{dup.id}/merge", json={"target_id": str(target.id)})
    assert response.status_code == 409
