"""Token-type confusion is cheapest to catch here.

Five token pairs share one secret and one `type` claim, and the whole
authorization story of `/feld`, `/alarm`, `/check-in`, `/reko-dashboard` and the
viewer link rests on that claim being checked in both directions. So every
direction is asserted: a feld token opens nothing else, and nothing else opens
feld.
"""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import jwt
import pytest

from app.config import get_settings
from app.services.tokens import (
    generate_alarm_token,
    generate_checkin_token,
    generate_feld_token,
    generate_reko_dashboard_token,
    generate_viewer_token,
    validate_alarm_token,
    validate_checkin_token,
    validate_feld_token,
    validate_reko_dashboard_token,
    validate_viewer_token,
)

OTHER_GENERATORS = {
    "checkin": generate_checkin_token,
    "viewer": generate_viewer_token,
    "reko_dashboard": generate_reko_dashboard_token,
    "alarm": generate_alarm_token,
}

OTHER_VALIDATORS = {
    "checkin": validate_checkin_token,
    "viewer": validate_viewer_token,
    "reko_dashboard": validate_reko_dashboard_token,
    "alarm": validate_alarm_token,
}


class TestFeldToken:
    """generate_feld_token / validate_feld_token (plan 25, §2)."""

    def test_roundtrip(self):
        event_id = uuid4()
        assert validate_feld_token(generate_feld_token(event_id)) == event_id

    def test_default_lifetime_is_720_hours(self):
        # A storm Ereignis runs for days and the QR lives on a printed poster.
        settings = get_settings()
        payload = jwt.decode(
            generate_feld_token(uuid4()),
            settings.secret_key,
            algorithms=["HS256"],
        )
        assert payload["type"] == "feld"
        expected = datetime.now(UTC) + timedelta(hours=720)
        actual = datetime.fromtimestamp(payload["exp"], UTC)
        assert abs((actual - expected).total_seconds()) < 60

    def test_garbage_is_rejected(self):
        assert validate_feld_token("not-a-token") is None

    def test_expired_is_rejected(self):
        settings = get_settings()
        expired = jwt.encode(
            {
                "event_id": str(uuid4()),
                "exp": datetime.now(UTC) - timedelta(minutes=1),
                "type": "feld",
            },
            settings.secret_key,
            algorithm="HS256",
        )
        assert validate_feld_token(expired) is None

    def test_wrong_signature_is_rejected(self):
        forged = jwt.encode(
            {
                "event_id": str(uuid4()),
                "exp": datetime.now(UTC) + timedelta(hours=1),
                "type": "feld",
            },
            "not-the-secret",
            algorithm="HS256",
        )
        assert validate_feld_token(forged) is None

    @pytest.mark.parametrize("token_type", sorted(OTHER_GENERATORS))
    def test_other_token_types_do_not_validate_as_feld(self, token_type: str):
        token = OTHER_GENERATORS[token_type](uuid4())
        assert validate_feld_token(token) is None

    @pytest.mark.parametrize("token_type", sorted(OTHER_VALIDATORS))
    def test_feld_token_does_not_validate_as_anything_else(self, token_type: str):
        token = generate_feld_token(uuid4())
        assert OTHER_VALIDATORS[token_type](token) is None
