"""Token-type confusion is cheapest to catch here.

Five token pairs share one secret and one `type` claim, and the whole
authorization story of `/feld`, `/alarm`, `/check-in` and the
viewer link rests on that claim being checked in both directions. So every
direction is asserted: a feld token opens nothing else, and nothing else opens
feld.
"""

from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import jwt
import pytest

from app.config import get_settings
from app.services.tokens import (
    FormTokenBinding,
    decode_form_token,
    generate_alarm_token,
    generate_checkin_token,
    generate_feld_token,
    generate_form_token,
    generate_viewer_token,
    validate_alarm_token,
    validate_checkin_token,
    validate_feld_token,
    validate_form_token,
    validate_viewer_token,
)

OTHER_GENERATORS = {
    "checkin": generate_checkin_token,
    "viewer": generate_viewer_token,
    "alarm": generate_alarm_token,
}

OTHER_VALIDATORS = {
    "checkin": validate_checkin_token,
    "viewer": validate_viewer_token,
    "alarm": validate_alarm_token,
}


@pytest.mark.parametrize("kind", ["checkin", "viewer", "alarm"])
def test_event_token_roundtrip_preserves_scope(kind):
    event_id = uuid4()
    token = OTHER_GENERATORS[kind](event_id)
    assert OTHER_VALIDATORS[kind](token) == event_id


@pytest.mark.parametrize("kind,hours", [("checkin", 24), ("viewer", 24), ("alarm", 720)])
def test_event_token_default_lifetime_and_claims(kind, hours):
    event_id = uuid4()
    before = datetime.now(UTC).timestamp()
    token = OTHER_GENERATORS[kind](event_id)
    after = datetime.now(UTC).timestamp()
    claims = jwt.decode(token, get_settings().secret_key, algorithms=["HS256"])

    assert claims["event_id"] == str(event_id)
    assert claims["type"] == kind
    assert type(claims["exp"]) is int
    assert int(before + hours * 3600) <= claims["exp"] <= int(after + hours * 3600)


@pytest.mark.parametrize("kind", ["viewer", "alarm"])
def test_event_token_respects_custom_lifetime(kind):
    before = datetime.now(UTC).timestamp()
    token = OTHER_GENERATORS[kind](uuid4(), expires_hours=3)
    after = datetime.now(UTC).timestamp()
    claims = jwt.decode(token, get_settings().secret_key, algorithms=["HS256"])
    assert int(before + 3 * 3600) <= claims["exp"] <= int(after + 3 * 3600)


@pytest.mark.parametrize("kind", ["checkin", "viewer", "alarm"])
@pytest.mark.parametrize(
    "bad_claim", ["expired", "event_missing", "event_empty", "event_invalid", "wrong_type", "bad_signature"]
)
def test_event_token_rejects_invalid_credentials(kind, bad_claim):
    claims = {"event_id": str(uuid4()), "type": kind, "exp": datetime.now(UTC) + timedelta(hours=1)}
    key = get_settings().secret_key
    if bad_claim == "expired":
        claims["exp"] = datetime.now(UTC) - timedelta(seconds=1)
    elif bad_claim == "event_missing":
        del claims["event_id"]
    elif bad_claim == "event_empty":
        claims["event_id"] = ""
    elif bad_claim == "event_invalid":
        claims["event_id"] = "not-a-uuid"
    elif bad_claim == "wrong_type":
        claims["type"] = "access"
    else:
        key = "a-different-test-signing-key-at-least-32-bytes"
    assert OTHER_VALIDATORS[kind](jwt.encode(claims, key, algorithm="HS256")) is None


@pytest.mark.parametrize("kind", ["checkin", "viewer", "alarm"])
def test_event_token_rejects_unreadable_jwt(kind):
    assert OTHER_VALIDATORS[kind]("not.a.jwt") is None


@pytest.mark.parametrize("version", [None, 0, 2, "1", True])
def test_old_or_invalid_reko_version_cannot_reopen_a_form(version):
    incident_id = str(uuid4())
    current = generate_form_token(incident_id)
    assert validate_form_token(current, incident_id)
    payload = jwt.decode(current, get_settings().secret_key, algorithms=["HS256"])
    if version is None:
        del payload["form_version"]
    else:
        payload["form_version"] = version
    old = jwt.encode(payload, get_settings().secret_key, algorithm="HS256")
    assert not validate_form_token(old, incident_id)


@pytest.mark.parametrize("hours", [24, 3])
def test_form_credentials_preserve_scope_lifetime_and_unique_id(hours):
    incident_id = str(uuid4())
    before = datetime.now(UTC).timestamp()
    token = generate_form_token(incident_id, expires_hours=hours)
    after = datetime.now(UTC).timestamp()
    payload = jwt.decode(token, get_settings().secret_key, algorithms=["HS256"])
    assert payload["incident_id"] == incident_id
    assert payload["form_type"] == "reko"
    assert payload["type"] == "reko_form"
    assert int(before + hours * 3600) <= payload["exp"] <= int(after + hours * 3600)
    assert int(before) <= payload["iat"] <= int(after)
    assert UUID(payload["jti"]).version == 4
    second = jwt.decode(generate_form_token(incident_id), get_settings().secret_key, algorithms=["HS256"])
    assert second["jti"] != payload["jti"]
    claims = decode_form_token(token, incident_id)
    assert claims is not None and claims.field_binding is None
    assert decode_form_token(token, str(uuid4())) is None
    assert decode_form_token(token, incident_id, "another-form") is None


def test_form_type_can_be_selected_explicitly():
    incident_id = str(uuid4())
    token = generate_form_token(incident_id, form_type="custom-form")
    assert decode_form_token(token, incident_id, "custom-form") is not None
    assert decode_form_token(token, incident_id) is None


def test_field_derived_form_keeps_all_three_provenance_ids():
    incident_id = str(uuid4())
    binding = FormTokenBinding(claim_id=uuid4(), event_id=uuid4(), personnel_id=uuid4())
    token = generate_form_token(incident_id, field_binding=binding)
    claims = decode_form_token(token, incident_id)
    assert claims is not None and claims.field_binding == binding


@pytest.mark.parametrize("field", ["field_claim_id", "field_event_id", "field_personnel_id"])
@pytest.mark.parametrize("bad_value", ["missing", "not-a-uuid", None, 123, {}])
def test_malformed_form_provenance_never_becomes_an_unbound_credential(field, bad_value):
    incident_id = str(uuid4())
    token = generate_form_token(incident_id, field_binding=FormTokenBinding(uuid4(), uuid4(), uuid4()))
    payload = jwt.decode(token, get_settings().secret_key, algorithms=["HS256"])
    if bad_value == "missing":
        del payload[field]
    else:
        payload[field] = bad_value
    malformed = jwt.encode(payload, get_settings().secret_key, algorithm="HS256")
    assert decode_form_token(malformed, incident_id) is None
    assert not validate_form_token(malformed, incident_id)


@pytest.mark.parametrize("minutes", [0, 7])
def test_picker_minutes_override_the_long_lived_field_token_default(minutes):
    before = datetime.now(UTC).timestamp()
    token = generate_feld_token(uuid4(), expires_hours=99, expires_minutes=minutes, unlocked=True, unlock_id=uuid4())
    after = datetime.now(UTC).timestamp()
    payload = jwt.decode(token, get_settings().secret_key, algorithms=["HS256"], options={"verify_exp": False})
    assert int(before + minutes * 60) <= payload["exp"] <= int(after + minutes * 60)


class TestFeldToken:
    """generate_feld_token / validate_feld_token (plan 25, §2)."""

    def test_roundtrip(self):
        event_id = uuid4()
        claims = validate_feld_token(generate_feld_token(event_id))
        assert claims is not None
        assert claims.event_id == event_id
        # Unbound by default: that is what the poster QR and the slip carry.
        assert claims.personnel_id is None

    def test_person_binding_survives_the_roundtrip(self):
        event_id, personnel_id = uuid4(), uuid4()
        claims = validate_feld_token(
            generate_feld_token(event_id, personnel_id=personnel_id, unlocked=True, claim_id=uuid4())
        )
        assert claims is not None
        assert claims.event_id == event_id
        assert claims.personnel_id == personnel_id

    @pytest.mark.parametrize(
        "extra",
        [
            {"unlocked": True},  # legacy stateless picker credential
            {"personnel_id": str(uuid4())},
            {"unlocked": True, "personnel_id": str(uuid4())},
            {"unlocked": "true", "unlock_id": str(uuid4())},
            {"unlocked": True, "unlock_id": str(uuid4()), "claim_id": str(uuid4())},
            {"unlocked": True, "personnel_id": "", "claim_id": str(uuid4())},
            {"unlocked": True, "unlock_id": 123},
        ],
    )
    def test_incomplete_or_mixed_stages_are_rejected(self, extra):
        payload = {"type": "feld", "event_id": str(uuid4()), "exp": datetime.now(UTC) + timedelta(hours=1), **extra}
        assert validate_feld_token(jwt.encode(payload, get_settings().secret_key, algorithm="HS256")) is None

    def test_expiration_is_required(self):
        payload = {"type": "feld", "event_id": str(uuid4())}
        assert validate_feld_token(jwt.encode(payload, get_settings().secret_key, algorithm="HS256")) is None

    def test_unreadable_person_binding_is_rejected_not_widened(self):
        """A broken binding must fail shut — never fall back to event-wide."""
        settings = get_settings()
        broken = jwt.encode(
            {
                "event_id": str(uuid4()),
                "personnel_id": "not-a-uuid",
                "exp": datetime.now(UTC) + timedelta(hours=1),
                "type": "feld",
            },
            settings.secret_key,
            algorithm="HS256",
        )
        assert validate_feld_token(broken) is None

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
            "not-the-secret-but-32-bytes-long",
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
