"""Database models for KP Rück system."""
from datetime import datetime
from typing import Optional
from uuid import UUID, uuid4

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import INET, JSONB, UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


# ============================================
# USERS & AUTHENTICATION
# ============================================


class User(Base):
    """User model for authentication and authorization."""

    __tablename__ = "users"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    username: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_login: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    # Relationships
    created_incidents: Mapped[list["Incident"]] = relationship(
        "Incident", back_populates="creator", foreign_keys="Incident.created_by"
    )
    assignments: Mapped[list["IncidentAssignment"]] = relationship(
        "IncidentAssignment", back_populates="assigner"
    )
    status_transitions: Mapped[list["StatusTransition"]] = relationship(
        "StatusTransition", back_populates="user"
    )
    audit_logs: Mapped[list["AuditLog"]] = relationship("AuditLog", back_populates="user")
    setting_updates: Mapped[list["Setting"]] = relationship("Setting", back_populates="updater")

    __table_args__ = (CheckConstraint("role IN ('editor', 'viewer')", name="valid_user_role"),)


# ============================================
# MASTER LISTS
# ============================================


class Vehicle(Base):
    """Vehicle model."""

    __tablename__ = "vehicles"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    type: Mapped[str] = mapped_column(String(50), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        CheckConstraint(
            "status IN ('available', 'assigned', 'planned', 'maintenance')", name="valid_vehicle_status"
        ),
    )


class Personnel(Base):
    """Personnel model."""

    __tablename__ = "personnel"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    role: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    availability: Mapped[str] = mapped_column(String(20), nullable=False)

    # Check-in tracking
    checked_in: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)
    checked_in_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    checked_out_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        CheckConstraint(
            "availability IN ('available', 'assigned', 'unavailable')",
            name="valid_personnel_availability",
        ),
        # Check-in only allowed if not unavailable
        CheckConstraint(
            "(checked_in = false) OR (checked_in = true AND availability != 'unavailable')",
            name="valid_checkin_availability"
        ),
        Index('idx_personnel_checked_in', 'checked_in'),
    )


class Material(Base):
    """Material model."""

    __tablename__ = "materials"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    location: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        CheckConstraint(
            "status IN ('available', 'assigned', 'planned', 'maintenance')", name="valid_material_status"
        ),
    )


# ============================================
# EVENTS
# ============================================


class Event(Base):
    """Event (Ereignis) - High-level container for emergency scenarios."""

    __tablename__ = "events"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    training_flag: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
    archived_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    last_activity_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Relationships
    incidents: Mapped[list["Incident"]] = relationship(
        "Incident", back_populates="event", cascade="all, delete-orphan"
    )
    attendance_records: Mapped[list["EventAttendance"]] = relationship(
        "EventAttendance", back_populates="event", cascade="all, delete-orphan"
    )

    def __repr__(self):
        return f"<Event {self.name} (training={self.training_flag})>"


class EventAttendance(Base):
    """Event-specific personnel attendance tracking."""

    __tablename__ = "event_attendance"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    event_id: Mapped[UUID] = mapped_column(
        ForeignKey("events.id", ondelete="CASCADE"), nullable=False, index=True
    )
    personnel_id: Mapped[UUID] = mapped_column(
        ForeignKey("personnel.id", ondelete="CASCADE"), nullable=False, index=True
    )
    checked_in: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    checked_in_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    checked_out_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    event: Mapped["Event"] = relationship("Event", back_populates="attendance_records")

    __table_args__ = (
        UniqueConstraint("event_id", "personnel_id", name="unique_event_personnel_attendance"),
        Index("idx_event_attendance_event", "event_id"),
        Index("idx_event_attendance_personnel", "personnel_id"),
        Index("idx_event_attendance_checked_in", "event_id", "checked_in"),
    )


# ============================================
# INCIDENTS
# ============================================


class Incident(Base):
    """Incident (Einsatz) - Individual emergency card on kanban board."""

    __tablename__ = "incidents"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)

    # Event relationship
    event_id: Mapped[UUID] = mapped_column(
        ForeignKey("events.id", ondelete="CASCADE"), nullable=False, index=True
    )
    event: Mapped["Event"] = relationship("Event", back_populates="incidents")

    title: Mapped[str] = mapped_column(String(255), nullable=False)
    type: Mapped[str] = mapped_column(String(50), nullable=False)
    priority: Mapped[str] = mapped_column(String(20), nullable=False)
    location_address: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    location_lat: Mapped[Optional[float]] = mapped_column(Numeric(10, 8), nullable=True)
    location_lng: Mapped[Optional[float]] = mapped_column(Numeric(11, 8), nullable=True)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="eingegangen")
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    created_by: Mapped[Optional[UUID]] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    # Relationships
    creator: Mapped[Optional["User"]] = relationship(
        "User", back_populates="created_incidents", foreign_keys=[created_by]
    )
    assignments: Mapped[list["IncidentAssignment"]] = relationship(
        "IncidentAssignment", back_populates="incident", cascade="all, delete-orphan"
    )
    reko_reports: Mapped[list["RekoReport"]] = relationship(
        "RekoReport", back_populates="incident", cascade="all, delete-orphan"
    )
    status_transitions: Mapped[list["StatusTransition"]] = relationship(
        "StatusTransition", back_populates="incident", cascade="all, delete-orphan"
    )

    __table_args__ = (
        CheckConstraint(
            "type IN ("
            "'brandbekaempfung', 'elementarereignis', 'strassenrettung', "
            "'technische_hilfeleistung', 'oelwehr', 'chemiewehr', 'strahlenwehr', "
            "'einsatz_bahnanlagen', 'bma_unechte_alarme', 'dienstleistungen', "
            "'diverse_einsaetze', 'gerettete_menschen', 'gerettete_tiere'"
            ")",
            name="valid_incident_type"
        ),
        CheckConstraint(
            "priority IN ('low', 'medium', 'high')", name="valid_priority"
        ),
        CheckConstraint(
            "status IN ('eingegangen', 'reko', 'disponiert', 'einsatz', 'einsatz_beendet', 'abschluss')",
            name="valid_status",
        ),
        CheckConstraint(
            "(location_lat IS NULL AND location_lng IS NULL) OR "
            "(location_lat IS NOT NULL AND location_lng IS NOT NULL)",
            name="valid_location",
        ),
        Index('idx_incidents_status', 'status'),
    )


# ============================================
# ASSIGNMENTS (Many-to-Many Junction)
# ============================================


class IncidentAssignment(Base):
    """Junction table for incident resource assignments."""

    __tablename__ = "incident_assignments"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    incident_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("incidents.id", ondelete="CASCADE"), nullable=False
    )
    resource_type: Mapped[str] = mapped_column(String(20), nullable=False)
    resource_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    assigned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    assigned_by: Mapped[Optional[UUID]] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    unassigned_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    # Relationships
    incident: Mapped["Incident"] = relationship("Incident", back_populates="assignments")
    assigner: Mapped[Optional["User"]] = relationship("User", back_populates="assignments")

    __table_args__ = (
        CheckConstraint(
            "resource_type IN ('personnel', 'vehicle', 'material')", name="valid_resource_type"
        ),
        UniqueConstraint(
            "incident_id", "resource_type", "resource_id", "unassigned_at", name="unique_assignment"
        ),
        Index("idx_assignments_incident", "incident_id"),
        Index("idx_assignments_resource", "resource_type", "resource_id"),
    )


# ============================================
# REKO FIELD REPORTS
# ============================================


class RekoReport(Base):
    """Reko field reconnaissance report."""

    __tablename__ = "reko_reports"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    incident_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("incidents.id", ondelete="CASCADE"), nullable=False
    )
    token: Mapped[str] = mapped_column(String(255), nullable=False)
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Form fields
    is_relevant: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    dangers_json: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    effort_json: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    power_supply: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    photos_json: Mapped[Optional[list]] = mapped_column(JSONB, nullable=True)
    summary_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    additional_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Metadata
    submitted_by_token: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    is_draft: Mapped[bool] = mapped_column(Boolean, default=False)

    # Relationships
    incident: Mapped["Incident"] = relationship("Incident", back_populates="reko_reports")

    __table_args__ = (
        Index("idx_reko_incident", "incident_id"),
        Index("idx_reko_token", "token"),
    )


# ============================================
# AUDIT LOGGING
# ============================================


class StatusTransition(Base):
    """Status transition tracking for incidents."""

    __tablename__ = "status_transitions"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    incident_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("incidents.id", ondelete="CASCADE"), nullable=False
    )
    from_status: Mapped[str] = mapped_column(String(50), nullable=False)
    to_status: Mapped[str] = mapped_column(String(50), nullable=False)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    user_id: Mapped[Optional[UUID]] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Relationships
    incident: Mapped["Incident"] = relationship("Incident", back_populates="status_transitions")
    user: Mapped[Optional["User"]] = relationship("User", back_populates="status_transitions")

    __table_args__ = (
        Index("idx_transitions_incident", "incident_id"),
        Index("idx_transitions_timestamp", "timestamp"),
    )


class AuditLog(Base):
    """Comprehensive audit log for all actions."""

    __tablename__ = "audit_log"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    user_id: Mapped[Optional[UUID]] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    action_type: Mapped[str] = mapped_column(String(50), nullable=False)
    resource_type: Mapped[str] = mapped_column(String(50), nullable=False)
    resource_id: Mapped[Optional[UUID]] = mapped_column(PG_UUID(as_uuid=True), nullable=True)
    changes_json: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    ip_address: Mapped[Optional[str]] = mapped_column(INET, nullable=True)
    user_agent: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Relationships
    user: Mapped[Optional["User"]] = relationship("User", back_populates="audit_logs")

    __table_args__ = (
        Index("idx_audit_user", "user_id"),
        Index("idx_audit_resource", "resource_type", "resource_id"),
        Index("idx_audit_timestamp", timestamp.desc()),
    )


# ============================================
# SETTINGS & CONFIGURATION
# ============================================


class Setting(Base):
    """System settings and configuration."""

    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    updated_by: Mapped[Optional[UUID]] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )

    # Relationships
    updater: Mapped[Optional["User"]] = relationship("User", back_populates="setting_updates")
