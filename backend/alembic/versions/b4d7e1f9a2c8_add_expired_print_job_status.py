"""add expired print job status

Revision ID: b4d7e1f9a2c8
Revises: 23a79cae1e20
Create Date: 2026-07-31 09:10:00.000000

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b4d7e1f9a2c8"
down_revision: str | Sequence[str] | None = "23a79cae1e20"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Allow 'expired' as a print job status.

    Queued jobs now age out instead of waiting forever: after a two-hour printer outage the
    agent used to drain the whole backlog at once, printing slips for incidents that had
    since closed while the operation was still running. Expired jobs are retained rather
    than deleted — "this was never printed" is part of the operational record.
    """
    op.drop_constraint("valid_print_job_status", "print_jobs", type_="check")
    op.create_check_constraint(
        "valid_print_job_status",
        "print_jobs",
        "status IN ('pending', 'printing', 'completed', 'failed', 'expired')",
    )


def downgrade() -> None:
    """Restore the previous constraint.

    Expired jobs become 'failed' with a reason rather than being deleted: they are a record
    of a slip the station never got, and downgrading the schema is not a reason to lose it.
    """
    op.execute(
        "UPDATE print_jobs SET status = 'failed', "
        "error_message = COALESCE(error_message, 'Auftrag abgelaufen (TTL)') "
        "WHERE status = 'expired'"
    )
    op.drop_constraint("valid_print_job_status", "print_jobs", type_="check")
    op.create_check_constraint(
        "valid_print_job_status",
        "print_jobs",
        "status IN ('pending', 'printing', 'completed', 'failed')",
    )
