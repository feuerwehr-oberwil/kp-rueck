"""Tests for RekoReport model."""
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Incident, RekoReport, User


class TestRekoReportModel:
    """Test RekoReport model operations."""

    async def test_create_reko_report(
        self, db_session: AsyncSession, test_incident: Incident
    ):
        """Test creating a Reko report."""
        report = RekoReport(
            id=uuid4(),
            incident_id=test_incident.id,
            token="test-token-123",
            is_relevant=True,
            power_supply="available",
            summary_text="Test summary",
            is_draft=False,
        )
        db_session.add(report)
        await db_session.commit()
        await db_session.refresh(report)

        assert report.id is not None
        assert report.incident_id == test_incident.id
        assert report.token == "test-token-123"
        assert report.is_relevant is True
        assert report.power_supply == "available"
        assert report.summary_text == "Test summary"
        assert report.is_draft is False
        assert report.submitted_at is not None
        assert report.updated_at is not None

    async def test_reko_report_with_jsonb_fields(
        self, db_session: AsyncSession, test_incident: Incident
    ):
        """Test Reko report with JSONB structured data."""
        dangers_data = {
            "fire": True,
            "explosion": False,
            "collapse": True,
            "hazmat": False,
        }
        effort_data = {
            "personnel": 10,
            "vehicles": ["TLF 1", "DLK"],
            "equipment": ["Atemschutz", "Pumpe"],
        }
        photos_data = ["photo1.jpg", "photo2.jpg"]

        report = RekoReport(
            id=uuid4(),
            incident_id=test_incident.id,
            token="jsonb-test-token",
            dangers_json=dangers_data,
            effort_json=effort_data,
            photos_json=photos_data,
            is_draft=True,
        )
        db_session.add(report)
        await db_session.commit()
        await db_session.refresh(report)

        assert report.dangers_json == dangers_data
        assert report.effort_json == effort_data
        assert report.photos_json == photos_data

    async def test_reko_report_cascade_delete(
        self, db_session: AsyncSession, test_incident: Incident
    ):
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
        result = await db_session.execute(
            select(RekoReport).where(RekoReport.id == report_id)
        )
        assert result.scalar_one_or_none() is None

    async def test_reko_report_optional_fields(
        self, db_session: AsyncSession, test_incident: Incident
    ):
        """Test Reko report with minimal required fields."""
        report = RekoReport(
            id=uuid4(),
            incident_id=test_incident.id,
            token="minimal-token",
            is_draft=False,
        )
        db_session.add(report)
        await db_session.commit()
        await db_session.refresh(report)

        assert report.is_relevant is None
        assert report.dangers_json is None
        assert report.effort_json is None
        assert report.power_supply is None
        assert report.photos_json is None
        assert report.summary_text is None
        assert report.additional_notes is None
