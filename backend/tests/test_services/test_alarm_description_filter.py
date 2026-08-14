"""Tidying the description of an inbound alarm — two station-configured lists.

Divera sends its alarm text as labelled lines:

    Meldung: Wasser dringt ein
    Ausrückeordnung: 1. TLF → 2. PIO

`alarm.description_filter_prefixes` drops a whole line (the turnout order is identical on
every alarm, so it is noise on the board), and `alarm.description_label_prefixes` strips a
label off a line that is kept (our own UI already writes «Meldung» above that field).

BOTH SHIP EMPTY: that vocabulary is one brigade's arrangement with its Leitstelle, and this
is a product other stations self-host — a fresh install filters nothing. Both apply to the
INCIDENT's description only; the emergency row stays the untouched provenance record.
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
from app.schemas import IncidentPriority
from app.services.divera_intake import (
    clean_description,
    filter_description_lines,
    incident_create_from_emergency,
    strip_description_labels,
)
from app.services.settings import (
    ALARM_DESCRIPTION_FILTER_PREFIXES_KEY,
    ALARM_DESCRIPTION_LABEL_PREFIXES_KEY,
    DEFAULT_SETTINGS,
    get_alarm_description_filter_prefixes,
    get_alarm_description_label_prefixes,
)

# The real production payload, verbatim.
REAL_PAYLOAD = "Meldung: Wasser dringt ein\nAusrückeordnung: 1. TLF → 2. PIO"
# What arrives when the Alarmzentrale sent no text of its own.
EMPTY_MELDUNG_PAYLOAD = "Meldung: -\nAusrückeordnung: 1. TLF → 2. PIO"
STANDING_ONLY = "Ausrückeordnung: 1. TLF → 2. PIO"

# What ONE station configures — deliberately not a shipped default, see the module docstring.
STATION_DROP = ["Ausrückeordnung:", "Meldung: -"]
STATION_LABELS = ["Meldung:"]


class TestShippedDefaultsFilterNothing:
    """The open-source default must pass every alarm description through untouched."""

    @pytest.mark.parametrize(
        "key",
        [ALARM_DESCRIPTION_FILTER_PREFIXES_KEY, ALARM_DESCRIPTION_LABEL_PREFIXES_KEY],
    )
    def test_default_is_empty(self, key: str):
        assert DEFAULT_SETTINGS[key] == "", f"{key} must ship empty — no brigade's vocabulary in the defaults"

    def test_unconfigured_text_survives_verbatim(self):
        assert clean_description(REAL_PAYLOAD) == REAL_PAYLOAD


class TestFilterDescriptionLines:
    """The drop list: the matched line goes away entirely."""

    def test_keeps_the_dispatch_text_drops_the_standing_line(self):
        assert filter_description_lines(REAL_PAYLOAD, STATION_DROP) == "Meldung: Wasser dringt ein"

    def test_only_standing_line_becomes_none(self):
        """Nothing left is None, not an empty-looking description on the card."""
        assert filter_description_lines(STANDING_ONLY, STATION_DROP) is None

    def test_text_without_a_standing_line_is_untouched(self):
        text = "Rauch aus dem 2. OG\nPerson vermisst"
        assert filter_description_lines(text, STATION_DROP) == text

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
        assert filter_description_lines(f"Details: X\n{line}", STATION_DROP) == "Details: X"

    def test_does_not_match_mid_line(self):
        """Prefix means start of line — a mention inside a sentence is real content."""
        text = "Details: siehe Ausrückeordnung: nicht eingehalten"
        assert filter_description_lines(text, STATION_DROP) == text

    def test_no_blank_line_left_behind(self):
        text = "Details: A\nAusrückeordnung: 1. TLF\n\nAusrückeordnung: 2. PIO\n\nRest"
        assert filter_description_lines(text, STATION_DROP) == "Details: A\n\nRest"

    def test_multiple_prefixes(self):
        text = "Alarmstichwort: B1\nDetails: X\nAusrückeordnung: 1. TLF"
        assert filter_description_lines(text, ["Ausrückeordnung:", "Alarmstichwort:"]) == "Details: X"

    def test_empty_configuration_changes_nothing(self):
        assert filter_description_lines(REAL_PAYLOAD, []) == REAL_PAYLOAD
        assert filter_description_lines(REAL_PAYLOAD, ["", "   "]) == REAL_PAYLOAD

    def test_missing_text_stays_missing(self):
        assert filter_description_lines(None, STATION_DROP) is None
        assert filter_description_lines("", STATION_DROP) is None


class TestStripDescriptionLabels:
    """The label list: the label goes away, the line stays."""

    def test_label_goes_content_stays(self):
        assert strip_description_labels("Meldung: Wasser dringt ein", STATION_LABELS) == "Wasser dringt ein"

    def test_line_without_a_known_label_is_untouched(self):
        text = "Wasser dringt ein\nKeller unter Wasser"
        assert strip_description_labels(text, STATION_LABELS) == text

    @pytest.mark.parametrize(
        "line",
        [
            "meldung: Wasser dringt ein",  # lower case
            "MELDUNG: Wasser dringt ein",  # shouted
            "   Meldung: Wasser dringt ein",  # indented
            "\tMeldung:   Wasser dringt ein",  # tabbed, padded
        ],
    )
    def test_case_and_whitespace_variants(self, line: str):
        assert strip_description_labels(line, STATION_LABELS) == "Wasser dringt ein"

    def test_label_with_nothing_behind_it_drops_the_line(self):
        """A label alone is not content."""
        assert strip_description_labels("Meldung:", STATION_LABELS) is None
        assert strip_description_labels("Meldung:   ", STATION_LABELS) is None
        assert strip_description_labels("Meldung:\nKeller voll", STATION_LABELS) == "Keller voll"

    def test_only_the_start_of_a_line_counts(self):
        text = "Siehe Meldung: von gestern"
        assert strip_description_labels(text, STATION_LABELS) == text

    def test_strips_each_line_independently(self):
        text = "Meldung: A\nOrt: Hauptstrasse 1\nMeldung: B"
        assert strip_description_labels(text, ["Meldung:", "Ort:"]) == "A\nHauptstrasse 1\nB"

    def test_empty_configuration_changes_nothing(self):
        assert strip_description_labels(REAL_PAYLOAD, []) == REAL_PAYLOAD
        assert strip_description_labels(REAL_PAYLOAD, ["", "   "]) == REAL_PAYLOAD

    def test_missing_text_stays_missing(self):
        assert strip_description_labels(None, STATION_LABELS) is None
        assert strip_description_labels("", STATION_LABELS) is None


class TestOrderIsDropThenStrip:
    """The order is load-bearing, so it is pinned in both directions."""

    def test_real_alarm_keeps_only_the_dispatch_text(self):
        assert clean_description(REAL_PAYLOAD, drop_prefixes=STATION_DROP, label_prefixes=STATION_LABELS) == (
            "Wasser dringt ein"
        )

    def test_empty_meldung_is_dropped_whole_never_left_as_a_dash(self):
        """`Meldung: -` matches the drop list first; a bare "-" on the card is the bug."""
        cleaned = clean_description(EMPTY_MELDUNG_PAYLOAD, drop_prefixes=STATION_DROP, label_prefixes=STATION_LABELS)
        assert cleaned is None

    def test_the_reverse_order_would_be_wrong(self):
        """Documents what stripping first costs: the drop rule can no longer name the line."""
        stripped_first = strip_description_labels(EMPTY_MELDUNG_PAYLOAD, STATION_LABELS)
        assert filter_description_lines(stripped_first, STATION_DROP) == "-"


class TestClassificationReadsTheRawText:
    """Tidying what an operator sees must never change how an alarm is classified."""

    def test_priority_still_sees_a_keyword_from_a_dropped_line(self):
        emergency = DiveraEmergency(
            divera_id=556003,
            title="Wasser im Keller",
            text="Meldung: -\nAusrückeordnung: RAUCH aus dem Schacht",
            raw_payload_json={},
        )
        data = incident_create_from_emergency(
            emergency,
            uuid4(),
            description_filter_prefixes=STATION_DROP,
            description_label_prefixes=STATION_LABELS,
        )
        assert data.description is None
        assert data.priority == IncidentPriority.HIGH


class TestSettingLookup:
    @pytest.mark.asyncio
    async def test_both_default_to_nothing_when_unset(self, db_session: AsyncSession):
        assert await get_alarm_description_filter_prefixes(db_session) == []
        assert await get_alarm_description_label_prefixes(db_session) == []

    @pytest.mark.asyncio
    async def test_one_prefix_per_line_blank_lines_dropped(self, db_session: AsyncSession):
        db_session.add(
            Setting(key=ALARM_DESCRIPTION_FILTER_PREFIXES_KEY, value="Ausrückeordnung:\n\n  Alarmstichwort: \n")
        )
        db_session.add(Setting(key=ALARM_DESCRIPTION_LABEL_PREFIXES_KEY, value="\nMeldung: \n\n"))
        await db_session.commit()
        assert await get_alarm_description_filter_prefixes(db_session) == ["Ausrückeordnung:", "Alarmstichwort:"]
        assert await get_alarm_description_label_prefixes(db_session) == ["Meldung:"]


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


async def _configure_station(db_session: AsyncSession) -> None:
    """What the station types into Settings → Alarmierung; nothing ships with this."""
    db_session.add(Setting(key=ALARM_DESCRIPTION_FILTER_PREFIXES_KEY, value="\n".join(STATION_DROP)))
    db_session.add(Setting(key=ALARM_DESCRIPTION_LABEL_PREFIXES_KEY, value="\n".join(STATION_LABELS)))
    await db_session.commit()


@pytest.mark.asyncio
@pytest.mark.api
async def test_webhook_leaves_the_description_alone_when_nothing_is_configured(
    client: AsyncClient, db_session: AsyncSession, auto_attach_event: Event
):
    """A fresh install filters nothing — the alarm reaches the board as it was sent."""
    payload = {"id": 556002, "title": "FEUER Dachstock", "text": REAL_PAYLOAD}
    with patch("app.api.divera.broadcast_emergency_received", new_callable=AsyncMock):
        response = await client.post("/api/divera/webhook", json=payload, params={"secret": "test_secret"})
    assert response.status_code == 200

    incident = (
        await db_session.execute(select(Incident).where(Incident.event_id == auto_attach_event.id))
    ).scalar_one()
    assert incident.description == REAL_PAYLOAD


@pytest.mark.asyncio
@pytest.mark.api
async def test_webhook_cleans_incident_but_keeps_raw_emergency(
    client: AsyncClient, db_session: AsyncSession, auto_attach_event: Event
):
    """The board card is tidied; what the Leitstelle sent is still on file."""
    await _configure_station(db_session)
    payload = {"id": 556001, "title": "FEUER Dachstock", "text": REAL_PAYLOAD}
    with patch("app.api.divera.broadcast_emergency_received", new_callable=AsyncMock):
        response = await client.post("/api/divera/webhook", json=payload, params={"secret": "test_secret"})
    assert response.status_code == 200

    incident = (
        await db_session.execute(select(Incident).where(Incident.event_id == auto_attach_event.id))
    ).scalar_one()
    assert incident.description == "Wasser dringt ein"

    emergency = (
        await db_session.execute(select(DiveraEmergency).where(DiveraEmergency.divera_id == 556001))
    ).scalar_one()
    assert emergency.text == REAL_PAYLOAD
    assert emergency.raw_payload_json["text"] == REAL_PAYLOAD
