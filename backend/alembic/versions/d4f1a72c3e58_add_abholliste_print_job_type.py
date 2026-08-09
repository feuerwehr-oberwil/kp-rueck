"""add abholliste print job type

Revision ID: d4f1a72c3e58
Revises: c8d5a4f21b90
Create Date: 2026-08-09 00:00:00.000000

The material half of the Restliste on paper (plan 25, decision 25): address ·
unit · since when, the sheet somebody takes along the next morning. It rides the
existing print-job path rather than becoming a fourth document format, which is
why this is a one-value widening of the type constraint and nothing else.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d4f1a72c3e58"
down_revision: str | Sequence[str] | None = "c8d5a4f21b90"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Allow 'abholliste' as a print job type."""
    op.drop_constraint("valid_print_job_type", "print_jobs", type_="check")
    op.create_check_constraint(
        "valid_print_job_type",
        "print_jobs",
        "job_type IN ('assignment', 'board', 'test', 'qr_code', 'abholliste')",
    )


def downgrade() -> None:
    """Restore the previous constraint (assignment, board, test, qr_code)."""
    # Remove any abholliste jobs first, or the stricter constraint will not apply.
    op.execute("DELETE FROM print_jobs WHERE job_type = 'abholliste'")
    op.drop_constraint("valid_print_job_type", "print_jobs", type_="check")
    op.create_check_constraint(
        "valid_print_job_type", "print_jobs", "job_type IN ('assignment', 'board', 'test', 'qr_code')"
    )
