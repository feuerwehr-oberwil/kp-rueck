"""The server's German label tables are the board's words (frontend/messages/de.json).

Paper, notification sentences and 409 details read the Python tables; the board reads the
catalogue. Read from the frontend source itself so the two cannot drift
the way «Einsatz beendet» and «Abschluss» once did.
"""

import json
from pathlib import Path

import pytest

from app.services.notification_params import DANGER_LABELS_DE
from app.services.rapport_rows import POWER_LABELS, PRIORITY_LABELS, STATUS_LABELS, TYPE_LABELS

DE_JSON = Path(__file__).resolve().parents[3] / "frontend" / "messages" / "de.json"


@pytest.mark.skipif(not DE_JSON.exists(), reason="frontend sources not present")
def test_label_tables_are_the_board_words():
    catalogue = json.loads(DE_JSON.read_text())
    assert catalogue["kanban"]["columns"] == STATUS_LABELS
    assert catalogue["incidents"]["priority"] == PRIORITY_LABELS
    assert catalogue["incidents"]["types"] == TYPE_LABELS
    report = catalogue["reko"]["reportSection"]
    assert report["dangerBadges"] == DANGER_LABELS_DE
    assert {
        "unknown": catalogue["reko"]["form"]["powerLabels"]["unknown"],
        "available": report["powerAvailable"],
        "unavailable": report["powerUnavailable"],
        "emergency_needed": report["powerEmergencyNeeded"],
    } == POWER_LABELS
    # The form says the same words as the board and the paper.
    assert catalogue["reko"]["form"]["powerLabels"] == POWER_LABELS
