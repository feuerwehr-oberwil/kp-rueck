"""add test print job type

Revision ID: f7e3a9c2b1d4
Revises: 519285812db1
Create Date: 2026-06-08 00:00:00.000000

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f7e3a9c2b1d4"
down_revision: str | Sequence[str] | None = "519285812db1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Allow 'test' as a print job type (for the Testdruck feature)."""
    op.drop_constraint("valid_print_job_type", "print_jobs", type_="check")
    op.create_check_constraint("valid_print_job_type", "print_jobs", "job_type IN ('assignment', 'board', 'test')")


def downgrade() -> None:
    """Restore the previous constraint (assignment, board only)."""
    # Remove any test jobs first so the stricter constraint can be applied.
    op.execute("DELETE FROM print_jobs WHERE job_type = 'test'")
    op.drop_constraint("valid_print_job_type", "print_jobs", type_="check")
    op.create_check_constraint("valid_print_job_type", "print_jobs", "job_type IN ('assignment', 'board')")
