"""The Fahrzeugstatus block on the printed board slip (`_build_board_payload`).

The slip is read at the board when the screen is not, so it has to answer the
same question the screen does — «was steht noch bereit» — with the same three
axes and the same precedence: archived is not inventory at all, `out_of_service`
beats deployment, deployment beats free. It used to read the legacy `status`
mirror and no archive filter, so a sold vehicle printed and a defective one could
print as available once the mirror drifted.
"""

from datetime import UTC, datetime

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.print import _build_board_payload
from app.crud.materials import apply_out_of_service
from app.models import Event, Vehicle


async def _vehicle(db: AsyncSession, name: str, display_order: int) -> Vehicle:
    vehicle = Vehicle(
        name=name,
        type="TLF",
        status="available",
        display_order=display_order,
        radio_call_sign=name,
    )
    db.add(vehicle)
    await db.commit()
    await db.refresh(vehicle)
    return vehicle


@pytest.mark.asyncio
async def test_archived_vehicles_are_not_printed(db_session: AsyncSession, test_event: Event):
    """A vehicle the station no longer owns must not stand on the slip."""
    await _vehicle(db_session, "TLF 1", 1)
    sold = await _vehicle(db_session, "Alter MTW", 2)
    sold.archived_at = datetime.now(UTC)
    await db_session.commit()

    payload = await _build_board_payload(db_session, test_event.id)

    assert [row["name"] for row in payload["vehicle_status"]] == ["TLF 1"]


@pytest.mark.asyncio
async def test_an_out_of_service_vehicle_prints_as_unavailable(db_session: AsyncSession, test_event: Event):
    """«Nicht einsatzbereit» reaches the paper — it is why the vehicle is nowhere."""
    ready = await _vehicle(db_session, "TLF 1", 1)
    broken = await _vehicle(db_session, "MTW", 2)
    apply_out_of_service(broken, True)
    await db_session.commit()

    payload = await _build_board_payload(db_session, test_event.id)
    available = {row["name"]: row["available"] for row in payload["vehicle_status"]}

    assert available == {ready.name: True, broken.name: False}
