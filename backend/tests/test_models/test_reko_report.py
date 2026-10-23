"""Tests for RekoReport model."""

from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Incident, RekoReport


class TestRekoReportModel:
    """Test RekoReport model operations."""

    async def test_reko_report_cascade_delete(self, db_session: AsyncSession, test_incident: Incident):
        """Test that Reko report is deleted when incident is deleted."""
        report = RekoReport(
            id=uuid4(),
            incident_id=test_incident.id,
            token="cascade-test",
            is_draft=False,
        )
        db_session.add(report)
        await db_session.commit()
        report_id = report.id

        # Delete incident
        await db_session.delete(test_incident)
        await db_session.commit()

        # Report should be deleted
        result = await db_session.execute(select(RekoReport).where(RekoReport.id == report_id))
        assert result.scalar_one_or_none() is None
