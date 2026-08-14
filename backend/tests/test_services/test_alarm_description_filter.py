"""The station's standing-line filter for inbound alarm descriptions.

Divera injects a brigade-configured boilerplate line into every alarm text
("Ausrückeordnung: 1. TLF → 2. PIO"). It is identical on every emergency, so it is noise on
the board and crowds out the «Details:» line that says what happened. The filter is a
configurable prefix list (`alarm.description_filter_prefixes`) and applies to the INCIDENT's
description only — the emergency row stays the untouched provenance record.
"""

from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import DiveraEmergency, Event, Incident, Setting
from app.services.divera_intake import filter_description_lines
from app.services.settings import (
    ALARM_DESCRIPTION_FILTER_PREFIXES_KEY,
    DEFAULT_SETTINGS,
    get_alarm_description_filter_prefixes,
)

# The real production payload, verbatim.
REAL_PAYLOAD = "Details: brennt nicht mehr! nur Nachkontrolle\nAusrückeordnung: 1. TLF → 2. PIO"
STANDING_ONLY = "Ausrückeordnung: 1. TLF → 2. PIO"

DEFAULT_PREFIXES = [DEFAULT_SETTINGS[ALARM_DESCRIPTION_FILTER_PREFIXES_KEY]]


class TestFilterDescriptionLines:
    def test_keeps_details_drops_standing_line(self):
        assert filter_description_lines(REAL_PAYLOAD, DEFAULT_PREFIXES) == (
            "Details: brennt nicht mehr! nur Nachkontrolle"
        )

    def test_only_standing_line_becomes_none(self):
        """Nothing left is None, not an empty-looking description on the card."""
        assert filter_description_lines(STANDING_ONLY, DEFAULT_PREFIXES) is None

    def test_text_without_the_standing_line_is_untouched(self):
        text = "Details: Rauch aus dem 2. OG\nPerson vermisst"
        assert filter_description_lines(text, DEFAULT_PREFIXES) == text

    @pytest.mark.parametrize(
        "line",
        [
            "ausrückeordnung: 1. TLF",  # lower case
            "AUSRÜCKEORDNUNG: 1. TLF",  # shouted
            "   Ausrückeordnung: 1. TLF",  # indented
            "\tAusrückeordnung: 1. TLF",  # tabbed
        ],
    )
    def test_case_and_leading_whitespace_variants_are_dropped(self, line: str):
        assert filter_description_lines(f"Details: X\n{line}", DEFAULT_PREFIXES) == "Details: X"

    def test_does_not_match_mid_line(self):
        """Prefix means start of line — a mention inside a sentence is real content."""
        text = "Details: siehe Ausrückeordnung: nicht eingehalten"
        assert filter_description_lines(text, DEFAULT_PREFIXES) == text

    def test_no_blank_line_left_behind(self):
        text = "Details: A\nAusrückeordnung: 1. TLF\n\nAusrückeordnung: 2. PIO\n\nRest"
        assert filter_description_lines(text, DEFAULT_PREFIXES) == "Details: A\n\nRest"

    def test_multiple_prefixes(self):
        text = "Alarmstichwort: B1\nDetails: X\nAusrückeordnung: 1. TLF"
        assert filter_description_lines(text, ["Ausrückeordnung:", "Alarmstichwort:"]) == "Details: X"

    def test_empty_configuration_changes_nothing(self):
        assert filter_description_lines(REAL_PAYLOAD, []) == REAL_PAYLOAD
        assert filter_description_lines(REAL_PAYLOAD, ["", "   "]) == REAL_PAYLOAD

    def test_missing_text_stays_missing(self):
        assert filter_description_lines(None, DEFAULT_PREFIXES) is None
        assert filter_description_lines("", DEFAULT_PREFIXES) is None


class TestSettingLookup:
    @pytest.mark.asyncio
    async def test_default_when_unset(self, db_session: AsyncSession):
        assert await get_alarm_description_filter_prefixes(db_session) == ["Ausrückeordnung:"]

    @pytest.mark.asyncio
    async def test_one_prefix_per_line_blank_lines_dropped(self, db_session: AsyncSession):
        db_session.add(
            Setting(key=ALARM_DESCRIPTION_FILTER_PREFIXES_KEY, value="Ausrückeordnung:\n\n  Alarmstichwort: \n")
        )
        await db_session.commit()
        assert await get_alarm_description_filter_prefixes(db_session) == ["Ausrückeordnung:", "Alarmstichwort:"]


@pytest_asyncio.fixture
async def auto_attach_event(db_session: AsyncSession) -> Event:
    event = Event(
        id=uuid4(),
        name="Lage mit Auto-Attach",
        training_flag=False,
        auto_attach_divera=True,
        created_at=datetime.now(UTC),
    )
    db_session.add(event)
    db_session.add(Setting(key="alarm_webhook_secret", value="test_secret"))
    await db_session.commit()
    await db_session.refresh(event)
    return event


@pytest.mark.asyncio
@pytest.mark.api
async def test_webhook_filters_incident_but_keeps_raw_emergency(
    client: AsyncClient, db_session: AsyncSession, auto_attach_event: Event
):
    """The board card is trimmed; what the Leitstelle sent is still on file."""
    payload = {"id": 556001, "title": "FEUER Dachstock", "text": REAL_PAYLOAD}
    with patch("app.api.divera.broadcast_emergency_received", new_callable=AsyncMock):
        response = await client.post("/api/divera/webhook", json=payload, params={"secret": "test_secret"})
    assert response.status_code == 200

    incident = (
        await db_session.execute(select(Incident).where(Incident.event_id == auto_attach_event.id))
    ).scalar_one()
    assert incident.description == "Details: brennt nicht mehr! nur Nachkontrolle"

    emergency = (
        await db_session.execute(select(DiveraEmergency).where(DiveraEmergency.divera_id == 556001))
    ).scalar_one()
    assert emergency.text == REAL_PAYLOAD
    assert emergency.raw_payload_json["text"] == REAL_PAYLOAD
