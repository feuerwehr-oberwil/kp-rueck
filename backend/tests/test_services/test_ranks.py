"""The Grad on paper: the Lageblatt's «Wer» names the most senior Grad by its abbreviation."""

from app.models import Personnel
from app.services.lageblatt_service import _crew_compact


def _person(name: str, role: str) -> Personnel:
    return Personnel(name=name, role=role, role_sort_order=0, status="available", tags=[])


def test_the_most_senior_grad_heads_the_crew_with_its_abbreviation():
    crew = [_person("Feld Fritz", "Feldweibel"), _person("Haupt Hanna", "Hauptmann"), _person("Sold Sam", "Soldat")]
    assert _crew_compact(crew) == "Hptm Haupt Hanna +2"


def test_the_legacy_tier_words_print_as_before():
    assert _crew_compact([_person("Offi Olga", "Offizier"), _person("Mann Max", "Mannschaft")]) == "Of Offi Olga +1"
    assert _crew_compact([_person("Mann Max", "Mannschaft")]) == "Mann Max"
