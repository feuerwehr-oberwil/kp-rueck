"""``IncidentResponse.from_real_alarm`` — is this card a GENUINE dispatch alarm?

The flag exists for exactly one situation: a real alarm attached to a training
Ereignis. Its Ausalarmierung is simulated and its overdue thresholds are 50%
longer, but the thing at the address is real — so the card says so, and it is
the one per-incident marker the training mode has.

The rule is derived from two columns the incident already carries, and these
tests pin the derivation against every write path that sets them:

* ``crud.divera.create_divera_emergency`` — real Divera, always a ``source_id``.
* ``services.training.generate_alarm`` — simulated, never a ``source_id``, and
  ``divera_emergencies.source`` defaults to "divera".
* ``crud.divera.create_alarm_emergency`` — a generic webhook, whose ``source_id``
  is OPTIONAL. That is why the derivation cannot be `source_ref is not None`
  alone: it would call a real alarm a drill, which is the dangerous direction.
* everything an operator, a Trupp or an import writes.
"""

from datetime import UTC, datetime
from uuid import uuid4

import pytest

from app import schemas


def incident(source: str, source_ref: str | None) -> schemas.IncidentResponse:
    """A minimal valid IncidentResponse with the two fields under test."""
    now = datetime.now(UTC)
    return schemas.IncidentResponse(
        id=uuid4(),
        event_id=uuid4(),
        title="Wasser im Keller",
        type=schemas.IncidentType.ELEMENTAREREIGNIS,
        priority=schemas.IncidentPriority.MEDIUM,
        status=schemas.IncidentStatus.INCOMING,
        source=source,
        source_ref=source_ref,
        created_at=now,
        updated_at=now,
    )


@pytest.mark.parametrize(
    ("source", "source_ref"),
    [
        # Real Divera: the adapter always carries the alarm's Divera id.
        ("divera", "4711"),
        # A generic webhook sender — no simulated variant exists for these, so
        # they are real whether or not they bothered to send an id.
        ("webhook", "abc-123"),
        ("elzs", None),
    ],
)
def test_delivered_alarms_are_real(source: str, source_ref: str | None) -> None:
    assert incident(source, source_ref).from_real_alarm is True


@pytest.mark.parametrize(
    ("source", "source_ref"),
    [
        # A simulated drill alarm: minted locally into the pool, so it keeps the
        # "divera" default and has no sender-side id at all.
        ("divera", None),
        # Nothing a human typed is an alarm delivery, whatever door they used.
        ("operator", None),
        ("intake", None),
        ("feld", None),
        ("manual", None),
        ("migrated", None),
        ("training", None),
    ],
)
def test_everything_else_is_not(source: str, source_ref: str | None) -> None:
    assert incident(source, source_ref).from_real_alarm is False


def test_it_is_serialized_so_a_client_never_re_derives_it() -> None:
    """The board reads the answer; it must not reimplement the rule."""
    assert incident("divera", "4711").model_dump(mode="json")["from_real_alarm"] is True
