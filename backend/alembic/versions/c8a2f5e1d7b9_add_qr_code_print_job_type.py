"""add qr_code print job type

Revision ID: c8a2f5e1d7b9
Revises: f7e3a9c2b1d4
Create Date: 2026-06-16 00:00:00.000000

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c8a2f5e1d7b9"
down_revision: str | Sequence[str] | None = "f7e3a9c2b1d4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Allow 'qr_code' as a print job type (for printing shareable-link QR slips)."""
    op.drop_constraint("valid_print_job_type", "print_jobs", type_="check")
    op.create_check_constraint(
        "valid_print_job_type", "print_jobs", "job_type IN ('assignment', 'board', 'test', 'qr_code')"
    )


def downgrade() -> None:
    """Restore the previous constraint (assignment, board, test)."""
    # Remove any qr_code jobs first so the stricter constraint can be applied.
    op.execute("DELETE FROM print_jobs WHERE job_type = 'qr_code'")
    op.drop_constraint("valid_print_job_type", "print_jobs", type_="check")
    op.create_check_constraint("valid_print_job_type", "print_jobs", "job_type IN ('assignment', 'board', 'test')")
