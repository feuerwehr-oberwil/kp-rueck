"""Paper names a namesake with the Kennung, like the board's `personLabelText` (style "text")."""

from app.services.person_label import namesakes, person_text


def test_only_a_shared_name_carries_the_kennung():
    shared = namesakes(["Meier Alex", " meier  ALEX ", "Huber Max", ""])
    assert person_text("Meier Alex", "1985", shared) == "Meier Alex (1985)"
    assert person_text("Huber Max", "1970", shared) == "Huber Max"


def test_a_namesake_without_a_kennung_says_so():
    assert person_text("Meier Alex", "  ", namesakes(["Meier Alex", "Meier Alex"])) == "Meier Alex (?)"
