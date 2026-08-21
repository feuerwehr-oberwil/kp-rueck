"""notifications: a Schadenplatz reported from the field is worth a bell entry

Revision ID: a7f2c9e14b83
Revises: f3b6a92c1e40
Create Date: 2026-08-18 00:40:00.000000

Every OTHER thing `/feld` does raises a notification — angekommen, beendet,
Abholung, eine Meldung im Thread, ein Rapport — and the one that creates a whole
new Schadenplatz raised none. The card simply appeared in Eingegangen and waited
to be noticed.

«Wir übernehmen das gleich» makes that worse rather than better: the Meldung is
put straight into `enroute`, so it does not even land in the column an operator
watches for new work. A crew is driving to an address the KP has never been told
about.

One new type. The severity is decided per Meldung by the caller
(`crud/feld/melden.py`): a plain Meldung is `info` — it is in Eingegangen where
somebody is looking — and a taken-over one is `warning`, because it is not.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a7f2c9e14b83"
down_revision: str | Sequence[str] | None = "f3b6a92c1e40"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

OLD_NOTIFICATION_TYPES = (
    "'time_overdue', 'no_personnel', 'no_materials', 'personnel_fatigue', "
    "'missing_location', 'event_size_limit', 'reko_submitted', 'reko_arrived', "
    "'training_emergency', 'vehicle_arrived', "
    "'rapport_submitted', 'field_arrived', 'field_complete', 'field_message', "
    "'field_pickup'"
)
NEW_NOTIFICATION_TYPES = OLD_NOTIFICATION_TYPES + ", 'field_report'"


def upgrade() -> None:
    op.drop_constraint("valid_notification_type", "notifications", type_="check")
    op.create_check_constraint("valid_notification_type", "notifications", f"type IN ({NEW_NOTIFICATION_TYPES})")


def downgrade() -> None:
    # Rows carrying the new type have to go first, or the narrower constraint
    # cannot be applied and the downgrade fails halfway.
    op.execute("DELETE FROM notifications WHERE type = 'field_report'")
    op.drop_constraint("valid_notification_type", "notifications", type_="check")
    op.create_check_constraint("valid_notification_type", "notifications", f"type IN ({OLD_NOTIFICATION_TYPES})")
