"""The server's German status and priority words are the board's (frontend/messages/de.json).

Paper, notification sentences and 409 details read ``STATUS_LABELS`` / ``PRIORITY_LABELS``;
the board reads the catalogue. Read from the frontend source itself so the two cannot drift
the way «Einsatz beendet» and «Abschluss» once did.
"""

import json
from pathlib import Path

import pytest

from app.services.rapport_rows import PRIORITY_LABELS, STATUS_LABELS

DE_JSON = Path(__file__).resolve().parents[3] / "frontend" / "messages" / "de.json"


@pytest.mark.skipif(not DE_JSON.exists(), reason="frontend sources not present")
def test_status_and_priority_labels_are_the_board_words():
    catalogue = json.loads(DE_JSON.read_text())
    assert catalogue["kanban"]["columns"] == STATUS_LABELS
    assert catalogue["incidents"]["priority"] == PRIORITY_LABELS
