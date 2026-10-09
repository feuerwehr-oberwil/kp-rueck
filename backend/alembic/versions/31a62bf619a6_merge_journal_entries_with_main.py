"""merge heads: journal_entries (R8) with main

Revision ID: 31a62bf619a6
Revises: d2a9e6f41c83, d5f1a7c3e9b2
Create Date: 2026-10-09 17:28:24.785057

No schema change. `d5f1a7c3e9b2` (journal_entries) branched off `c4e8a2f61d97` before main
gained its own migrations; this joins the two heads so `alembic upgrade head` has one
target. If the journal migration is re-chained onto main's head instead, delete this file.
"""

from collections.abc import Sequence

revision: str = "31a62bf619a6"
down_revision: str | Sequence[str] | None = ("d2a9e6f41c83", "d5f1a7c3e9b2")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
