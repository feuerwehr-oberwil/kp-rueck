"""Duplicate matching (services/duplicates.py) — the pure half.

Address normalisation decides whether «Hauptstr. 6» and «Hauptstrasse 6,
4104 Oberwil» are one door. Getting it too loose flags half the board (every
«Hauptstrasse»), too strict and the second call is a second card again.
"""

from datetime import UTC, datetime
from uuid import uuid4

import pytest

from app.models import Incident
from app.services.duplicates import _remove_entry, addresses_match, merge_note, normalize_address


@pytest.mark.parametrize(
    ("a", "b"),
    [
        ("Hauptstrasse 6", "Hauptstr. 6"),
        ("Hauptstrasse 6, 4104 Oberwil", "Hauptstr. 6"),
        ("Hauptstraße 6", "HAUPTSTRASSE 6"),
        ("St. Jakobs-Strasse 12", "St Jakobsstrasse 12"),
        ("Rebbergweg 14a", "Rebbergweg 14 A"),
        ("Bahnhofplatz 3, Oberwil", "Bahnhofplatz 3, 4104 Oberwil BL"),
        ("Hauptstrasse 6 Oberwil", "Hauptstrasse 6"),
        ("12 rue de Lausanne", "12 Rue de Lausanne, 1003 Lausanne"),
    ],
)
def test_addresses_that_name_the_same_door_match(a: str, b: str) -> None:
    assert addresses_match(a, b)


@pytest.mark.parametrize(
    ("a", "b"),
    [
        # Another house on the same street.
        ("Hauptstrasse 6", "Hauptstrasse 8"),
        ("Hauptstrasse 6", "Hauptstrasse 6a"),
        # Same street name, two villages — both say so.
        ("Hauptstrasse 6, 4104 Oberwil", "Hauptstrasse 6, 4103 Bottmingen"),
        # A street without a number is a kilometre of road.
        ("Hauptstrasse", "Hauptstrasse"),
        ("Hauptstrasse, Oberwil", "Hauptstr."),
        # Nothing to compare.
        (None, "Hauptstrasse 6"),
        ("", ""),
    ],
)
def test_addresses_that_do_not_name_the_same_door_do_not(a: str | None, b: str | None) -> None:
    assert not addresses_match(a, b)


def test_normalize_spells_out_str_and_drops_leading_zeros() -> None:
    assert normalize_address("Hauptstr. 06") == ("hauptstrasse|6", None)
    assert normalize_address("Hauptstrasse 6, 4104 Oberwil") == ("hauptstrasse|6", "4104")


def _report(**fields: object) -> Incident:
    base: dict[str, object] = {
        "id": uuid4(),
        "title": "Hauptstrasse 6",
        "type": "elementarereignis",
        "priority": "low",
        "status": "incoming",
        "source": "intake",
        "event_id": uuid4(),
        "created_at": datetime(2026, 10, 8, 12, 32, tzinfo=UTC),
    }
    return Incident(**{**base, **fields})


def test_merge_note_carries_the_whole_second_report_in_local_time() -> None:
    note = merge_note(
        _report(
            description="Wasser im Keller",
            location_address="Hauptstr. 6",
            contact="Meier",
            contact_phone="079 123 45 67",
        )
    )
    # 12:32 UTC is 14:32 in Oberwil in October.
    assert note == "Weitere Meldung 14:32 (Telefon): Wasser im Keller · Hauptstr. 6 · Melder: Meier, 079 123 45 67"


def test_merge_note_names_the_sender_and_its_reference() -> None:
    note = merge_note(
        _report(
            source="divera",
            source_ref="4711",
            title="FEUER Dachstock",
            description="Rauch",
            location_address="Hauptstrasse 6",
        )
    )
    assert note == "Weitere Meldung 14:32 (Divera 4711): FEUER Dachstock · Rauch · Hauptstrasse 6"
    feld = merge_note(_report(source="feld", description="Ast"), reporter_name="Brunner Marco")
    assert "(Feld · Brunner Marco)" in feld


def test_merge_note_keeps_the_stichwort_but_not_a_title_that_is_the_address() -> None:
    # The board titles a card with its Einsatzort: no need to say it twice.
    assert "Hauptstrasse 6 · Hauptstrasse 6" not in merge_note(
        _report(title="Hauptstrasse 6", location_address="Hauptstrasse 6, 4104 Oberwil", description="Wasser")
    )
    # A Leitstelle's Stichwort is the classification — it must survive the merge.
    assert "ELEMENTAR Wasser" in merge_note(
        _report(title="ELEMENTAR Wasser", location_address="Hauptstrasse 6", description=None)
    )


def test_merge_note_is_one_line() -> None:
    note = merge_note(_report(description="Wasser im Keller\nca. 20 cm", location_address="Hauptstrasse 6"))
    assert "\n" not in note
    assert "Wasser im Keller / ca. 20 cm" in note


def test_remove_entry_never_cuts_into_a_longer_line() -> None:
    entry = "Weitere Meldung 14:32 (Telefon): Wasser"
    # The operator continued the Nachtrag on the same line — it is theirs now.
    continued = f"Zufahrt hinten\n{entry} – Meier zurückgerufen"
    assert _remove_entry(continued, entry) == (continued, False)
    # A sibling Nachtrag that merely starts the same way stays whole.
    sibling = f"{entry}, Keller 2\nAndere Zeile"
    assert _remove_entry(sibling, entry) == (sibling, False)
    # Two identical lines: the newest goes, the other stays.
    assert _remove_entry(f"{entry}\nx\n{entry}", entry) == (f"{entry}\nx", True)


def test_remove_entry_only_takes_out_what_still_stands_verbatim() -> None:
    entry = "Weitere Meldung 14:32 (Telefon): Wasser"
    assert _remove_entry(f"Zufahrt hinten\n{entry}", entry) == ("Zufahrt hinten", True)
    assert _remove_entry(entry, entry) == (None, True)
    # The operator wrote below it: their line stays.
    assert _remove_entry(f"{entry}\nSchlüssel beim Hauswart", entry) == ("Schlüssel beim Hauswart", True)
    # The operator edited the Nachtrag itself: it is theirs now.
    edited = "Weitere Meldung 14:32 (Telefon): Wasser – erledigt"
    assert _remove_entry(edited, entry) == (edited, False)
