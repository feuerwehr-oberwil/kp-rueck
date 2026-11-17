"""The Grad on paper: the Lageblatt's «Wer» names the most senior Grad by its abbreviation."""

from app.models import Personnel
from app.services.lageblatt_service import _crew_compact
from app.services.person_label import namesakes, person_text


def _person(name: str, role: str, kennung: str | None = None) -> Personnel:
    return Personnel(name=name, role=role, kennung=kennung, role_sort_order=0, status="available", tags=[])


def _plain(person: Personnel) -> str:
    return person.name


def test_the_most_senior_grad_heads_the_crew_with_its_abbreviation():
    crew = [_person("Feld Fritz", "Feldweibel"), _person("Haupt Hanna", "Hauptmann"), _person("Sold Sam", "Soldat")]
    assert _crew_compact(crew, _plain) == "Hptm Haupt Hanna +2"


def test_the_legacy_tier_words_print_as_before():
    assert _crew_compact([_person("Offi Olga", "Offizier"), _person("Mann Max", "Mannschaft")], _plain) == (
        "Of Offi Olga +1"
    )
    assert _crew_compact([_person("Mann Max", "Mannschaft")], _plain) == "Mann Max"


def test_the_crew_head_carries_the_kennung_when_the_name_is_shared():
    shared = namesakes(["Meier Alex", "Meier Alex", "Huber Max"])
    crew = [_person("Meier Alex", "Hauptmann", "1985"), _person("Huber Max", "Soldat")]
    assert _crew_compact(crew, lambda p: person_text(p.name, p.kennung, shared)) == "Hptm Meier Alex (1985) +1"
