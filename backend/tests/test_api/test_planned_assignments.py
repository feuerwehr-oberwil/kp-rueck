"""Jetzt / Danach (owner picks 24.11.2026): never on two, the Danach queue, «Zuteilen», and
completion freeing (Abgeschlossen) and dropping (target closed) – with the reopen undo."""

from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Event, Incident, IncidentAssignment, Material, Personnel, User

pytestmark = [pytest.mark.asyncio, pytest.mark.api]


async def _incident(db: AsyncSession, event: Event, user: User, title: str) -> Incident:
    incident = Incident(
        id=uuid4(),
        title=title,
        location_address=title,
        type="elementarereignis",
        priority="medium",
        status="incoming",
        event_id=event.id,
        created_by=user.id,
    )
    db.add(incident)
    await db.commit()
    return incident


@pytest_asyncio.fixture
async def three(db_session: AsyncSession, test_event: Event, test_user: User) -> list[Incident]:
    return [await _incident(db_session, test_event, test_user, t) for t in ("Langegasse 28", "Mühleweg 12", "Post 6")]


async def _assign(client: AsyncClient, incident: Incident, kind: str, rid) -> int:
    response = await client.post(
        f"/api/incidents/{incident.id}/assign", json={"resource_type": kind, "resource_id": str(rid)}
    )
    return response.status_code


async def _plan(client: AsyncClient, incident: Incident, kind: str, rid) -> dict:
    response = await client.post(
        "/api/planned-assignments/",
        json={"resource_type": kind, "resource_id": str(rid), "incident_id": str(incident.id)},
    )
    assert response.status_code == 201, response.text
    return response.json()


async def _list(client: AsyncClient, event: Event) -> list[dict]:
    response = await client.get(f"/api/planned-assignments/?event_id={event.id}")
    assert response.status_code == 200
    return response.json()


async def _status(client: AsyncClient, incident: Incident, frm: str, to: str) -> None:
    response = await client.post(f"/api/incidents/{incident.id}/status", json={"from_status": frm, "to_status": to})
    assert response.status_code == 200, response.text


async def test_never_on_two(editor_client: AsyncClient, three, test_personnel: Personnel):
    a, b, _ = three
    assert await _assign(editor_client, a, "personnel", test_personnel.id) == 200
    response = await editor_client.post(
        f"/api/incidents/{b.id}/assign", json={"resource_type": "personnel", "resource_id": str(test_personnel.id)}
    )
    assert response.status_code == 409
    assert response.json()["code"] == "resource_busy"
    assert response.json()["params"]["holders"] == "Langegasse 28"


async def test_consumable_and_reko_never_bind(
    editor_client: AsyncClient, db_session: AsyncSession, three, test_personnel: Personnel
):
    a, b, _ = three
    sand = Material(id=uuid4(), name="Sandsäcke", type="Sonstiges", location="Magazin", consumable=True)
    db_session.add(sand)
    db_session.add(
        IncidentAssignment(incident_id=a.id, resource_type="personnel", resource_id=test_personnel.id, purpose="reko")
    )
    await db_session.commit()
    assert await _assign(editor_client, a, "material", sand.id) == 200
    assert await _assign(editor_client, b, "material", sand.id) == 200
    assert await _assign(editor_client, b, "personnel", test_personnel.id) == 200
    refused = await editor_client.post(
        "/api/planned-assignments/",
        json={"resource_type": "material", "resource_id": str(sand.id), "incident_id": str(a.id)},
    )
    assert refused.status_code == 409
    assert refused.json()["code"] == "plan_refused"


async def test_queue_ready_and_promote(editor_client: AsyncClient, test_event: Event, three, test_personnel: Personnel):
    a, b, c = three
    await _assign(editor_client, a, "personnel", test_personnel.id)
    first = await _plan(editor_client, b, "personnel", test_personnel.id)
    second = await _plan(editor_client, c, "personnel", test_personnel.id)
    assert (first["position"], first["ready"]) == (1, False)
    assert (second["position"], second["ready"]) == (2, False)

    busy = await editor_client.post(f"/api/planned-assignments/{first['id']}/promote")
    assert busy.status_code == 409
    assert busy.json()["code"] == "resource_busy"

    # Freed by completion (owner pick 4: Abgeschlossen) – only the first Danach is ready.
    await _status(editor_client, a, "incoming", "complete")
    listed = await _list(editor_client, test_event)
    assert {p["id"]: p["ready"] for p in listed} == {first["id"]: True, second["id"]: False}
    # The bell's 5' clock starts at the release, not at the planning.
    since = {p["id"]: p["ready_since"] for p in listed}
    assert since[first["id"]] is not None and since[first["id"]] >= first["planned_at"]
    assert since[second["id"]] is None

    promoted = await editor_client.post(f"/api/planned-assignments/{first['id']}/promote")
    assert promoted.status_code == 200, promoted.text
    assert promoted.json()["incident_id"] == str(b.id)
    left = await _list(editor_client, test_event)
    assert [(p["id"], p["position"], p["ready"]) for p in left] == [(second["id"], 1, False)]


async def test_plan_refusals(editor_client: AsyncClient, three, test_personnel: Personnel):
    a, b, _ = three
    await _assign(editor_client, a, "personnel", test_personnel.id)
    here = await editor_client.post(
        "/api/planned-assignments/",
        json={"resource_type": "personnel", "resource_id": str(test_personnel.id), "incident_id": str(a.id)},
    )
    assert here.status_code == 409
    await _plan(editor_client, b, "personnel", test_personnel.id)
    twice = await editor_client.post(
        "/api/planned-assignments/",
        json={"resource_type": "personnel", "resource_id": str(test_personnel.id), "incident_id": str(b.id)},
    )
    assert twice.status_code == 409


async def test_target_closing_drops_the_plan_and_reopen_restores_it(
    editor_client: AsyncClient, test_event: Event, three, test_personnel: Personnel
):
    a, b, c = three
    await _assign(editor_client, a, "personnel", test_personnel.id)
    first = await _plan(editor_client, b, "personnel", test_personnel.id)
    second = await _plan(editor_client, c, "personnel", test_personnel.id)

    await _status(editor_client, b, "incoming", "complete")
    assert [(p["id"], p["position"]) for p in await _list(editor_client, test_event)] == [(second["id"], 1)]

    await _status(editor_client, b, "complete", "incoming")
    order = [(p["incident_id"], p["position"]) for p in await _list(editor_client, test_event)]
    assert order == [(str(b.id), 1), (str(c.id), 2)], "the restored plan keeps its place in the queue"
    assert first["incident_id"] == str(b.id)


async def test_assigning_jetzt_fulfils_the_plan(
    editor_client: AsyncClient, test_event: Event, three, test_personnel: Personnel
):
    _, b, _ = three
    await _plan(editor_client, b, "personnel", test_personnel.id)
    assert await _assign(editor_client, b, "personnel", test_personnel.id) == 200
    assert await _list(editor_client, test_event) == []


async def test_auftrag_holds_jetzt_and_danach(
    editor_client: AsyncClient, test_event: Event, three, test_personnel: Personnel
):
    a, _, _ = three
    group = (
        await editor_client.post("/api/incident-groups/", json={"name": "Route West", "event_id": str(test_event.id)})
    ).json()
    on_route = await editor_client.post(
        f"/api/incident-groups/{group['id']}/assign",
        json={"resource_type": "personnel", "resource_id": str(test_personnel.id)},
    )
    assert on_route.status_code == 200
    assert await _assign(editor_client, a, "personnel", test_personnel.id) == 409

    plan = await _plan(editor_client, a, "personnel", test_personnel.id)
    assert plan["ready"] is False
    await editor_client.post(f"/api/incident-groups/{group['id']}/unassign/{on_route.json()['id']}")
    assert (await _list(editor_client, test_event))[0]["ready"] is True


async def test_dismiss_keeps_the_plan(editor_client: AsyncClient, test_event: Event, three, test_personnel: Personnel):
    _, b, _ = three
    plan = await _plan(editor_client, b, "personnel", test_personnel.id)
    dismissed = await editor_client.patch(f"/api/planned-assignments/{plan['id']}", json={"dismissed": True})
    assert dismissed.status_code == 200
    assert dismissed.json()["dismissed_at"] is not None
    assert len(await _list(editor_client, test_event)) == 1
    removed = await editor_client.delete(f"/api/planned-assignments/{plan['id']}")
    assert removed.status_code == 204
    assert await _list(editor_client, test_event) == []


async def test_another_ereignis_never_binds(
    editor_client: AsyncClient, db_session: AsyncSession, test_user: User, three, test_personnel: Personnel
):
    """The roster is shared: a person on an open training Ereignis is free for this one."""
    a, _, _ = three
    other = Event(id=uuid4(), name="Übung", training_flag=True)
    db_session.add(other)
    await db_session.commit()
    training = await _incident(db_session, other, test_user, "Übungsweg 1")
    assert await _assign(editor_client, training, "personnel", test_personnel.id) == 200
    assert await _assign(editor_client, a, "personnel", test_personnel.id) == 200


async def test_feld_lists_the_persons_danach_in_queue_order(
    editor_client: AsyncClient, db_session: AsyncSession, test_event: Event, three, test_personnel: Personnel
):
    """Owner pick 5C: /feld shows «Danach» after «Jetzt», in queue order, ready once free."""
    from app.api.feld import _feld_planned

    a, b, c = three
    await _assign(editor_client, a, "personnel", test_personnel.id)
    await _plan(editor_client, c, "personnel", test_personnel.id)
    await _plan(editor_client, b, "personnel", test_personnel.id)
    rows = await _feld_planned(db_session, test_event.id, test_personnel.id, "Oberwil")
    assert [(r.place, r.position, r.ready) for r in rows] == [("Post 6", 1, False), ("Mühleweg 12", 2, False)]
