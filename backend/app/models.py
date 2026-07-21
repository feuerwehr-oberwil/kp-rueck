"""Database models for KP Rück system."""

from datetime import datetime
from typing import Optional
from uuid import UUID, uuid4

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy import text as sa_text
from sqlalchemy.dialects.postgresql import INET, JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base

# ============================================
# USERS & AUTHENTICATION
# ============================================


class User(Base):
    """User model for authentication and authorization.

    Roles:
        - admin: Full access including user management
        - editor: Full operational access (incidents, events, resources)
        - viewer: Read-only access (login + cookie, no mutations) for shared/kiosk PCs

    Note: A public, login-free viewer is also available via signed link tokens.
    """

    __tablename__ = "users"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    username: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    email: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True)
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    display_name: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_login: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Relationships
    created_incidents: Mapped[list["Incident"]] = relationship(
        "Incident", back_populates="creator", foreign_keys="Incident.created_by"
    )
    assignments: Mapped[list["IncidentAssignment"]] = relationship("IncidentAssignment", back_populates="assigner")
    status_transitions: Mapped[list["StatusTransition"]] = relationship("StatusTransition", back_populates="user")
    audit_logs: Mapped[list["AuditLog"]] = relationship("AuditLog", back_populates="user")
    setting_updates: Mapped[list["Setting"]] = relationship("Setting", back_populates="updater")

    __table_args__ = (CheckConstraint("role IN ('admin', 'editor', 'viewer')", name="valid_user_role"),)


# ============================================
# MASTER LISTS
# ============================================


class Vehicle(Base):
    """Vehicle model."""

    __tablename__ = "vehicles"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    type: Mapped[str] = mapped_column(String(50), nullable=False)
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    radio_call_sign: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        CheckConstraint("status IN ('available', 'unavailable')", name="valid_vehicle_status"),
        Index("idx_vehicles_status", "status"),
        Index("idx_vehicles_display_order", "display_order"),
    )


class Personnel(Base):
    """Personnel model."""

    __tablename__ = "personnel"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    role: Mapped[str | None] = mapped_column(String(50), nullable=True)
    role_sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    availability: Mapped[str] = mapped_column(String(20), nullable=False)
    tags: Mapped[list | None] = mapped_column(JSONB, nullable=True, default=list)

    # DEPRECATED dual-write: superseded by PersonnelExternalIdentity
    # (provider="divera"). Kept in sync for one compatibility release, then
    # removed. Do not add new readers.
    divera_user_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)

    # Check-in tracking
    checked_in: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)
    checked_in_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    checked_out_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        CheckConstraint(
            "availability IN ('available', 'unavailable')",
            name="valid_personnel_availability",
        ),
        # Check-in only allowed if not unavailable
        CheckConstraint(
            "(checked_in = false) OR (checked_in = true AND availability != 'unavailable')",
            name="valid_checkin_availability",
        ),
        Index("idx_personnel_checked_in", "checked_in"),
        Index("idx_personnel_availability", "availability"),
        Index("idx_personnel_role_sort_order", "role_sort_order"),
    )


class PersonnelExternalIdentity(Base):
    """Provider-neutral link between a local person and their id in an external system.

    Providers (Divera, Alamos, …) attach identity to canonical local personnel
    instead of vendor columns on the personnel table. One row per person per
    provider; ``external_id`` is opaque (Divera: user_cluster_relation id).
    Disconnecting a provider deletes rows here, never local personnel.
    """

    __tablename__ = "personnel_external_identities"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    personnel_id: Mapped[UUID] = mapped_column(
        ForeignKey("personnel.id", ondelete="CASCADE"), nullable=False, index=True
    )
    provider: Mapped[str] = mapped_column(String(32), nullable=False)
    external_id: Mapped[str] = mapped_column(Text, nullable=False)
    metadata_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("provider", "external_id", name="uq_personnel_ext_provider_external_id"),
        UniqueConstraint("personnel_id", "provider", name="uq_personnel_ext_personnel_provider"),
    )


class MaterialGroup(Base):
    """Material group/block model. Groups materials into logical units (e.g., 'Modul 1')."""

    __tablename__ = "material_groups"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    location: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    location_sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    materials: Mapped[list["Material"]] = relationship("Material", back_populates="group")


class Material(Base):
    """Material model."""

    __tablename__ = "materials"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    type: Mapped[str] = mapped_column(String(50), nullable=False, default="Sonstiges")
    location: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    location_sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="available")
    consumable: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, server_default="false")
    group_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("material_groups.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    group: Mapped["MaterialGroup | None"] = relationship("MaterialGroup", back_populates="materials")

    __table_args__ = (
        CheckConstraint("status IN ('available', 'unavailable')", name="valid_material_status"),
        Index("idx_materials_status", "status"),
        Index("idx_materials_location_sort_order", "location_sort_order"),
        Index("idx_materials_group_id", "group_id"),
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
    auto_attach_divera: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_activity_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Relationships
    incidents: Mapped[list["Incident"]] = relationship("Incident", back_populates="event", cascade="all, delete-orphan")
    incident_groups: Mapped[list["IncidentGroup"]] = relationship(
        "IncidentGroup", back_populates="event", cascade="all, delete-orphan"
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
    event_id: Mapped[UUID] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), nullable=False, index=True)
    personnel_id: Mapped[UUID] = mapped_column(
        ForeignKey("personnel.id", ondelete="CASCADE"), nullable=False, index=True
    )
    checked_in: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    checked_in_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    checked_out_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
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


class EventSpecialFunction(Base):
    """Event-specific special function assignments for personnel (drivers, Reko, Magazin)."""

    __tablename__ = "event_special_functions"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    event_id: Mapped[UUID] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), nullable=False, index=True)
    personnel_id: Mapped[UUID] = mapped_column(
        ForeignKey("personnel.id", ondelete="CASCADE"), nullable=False, index=True
    )
    function_type: Mapped[str] = mapped_column(String(20), nullable=False)

    # For driver assignments: which vehicle they drive
    vehicle_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("vehicles.id", ondelete="CASCADE"), nullable=True, index=True
    )

    assigned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    assigned_by: Mapped[UUID | None] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)

    __table_args__ = (
        CheckConstraint("function_type IN ('driver', 'reko', 'magazin')", name="valid_function_type"),
        # Driver assignments require a vehicle
        CheckConstraint(
            "(function_type != 'driver') OR (function_type = 'driver' AND vehicle_id IS NOT NULL)",
            name="driver_requires_vehicle",
        ),
        # For drivers: one driver per vehicle per event (unique)
        # For reko/magazin: same person can have the function multiple times if needed (no vehicle_id)
        UniqueConstraint("event_id", "vehicle_id", name="unique_event_vehicle_driver"),
        # Also ensure one person can only drive one vehicle per event
        UniqueConstraint(
            "event_id", "personnel_id", "function_type", "vehicle_id", name="unique_personnel_function_assignment"
        ),
        Index("idx_event_special_functions_event", "event_id"),
        Index("idx_event_special_functions_personnel", "personnel_id"),
        Index("idx_event_special_functions_function_type", "event_id", "function_type"),
    )


# ============================================
# INCIDENTS
# ============================================


class Incident(Base):
    """Incident (Einsatz) - Individual emergency card on kanban board."""

    __tablename__ = "incidents"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)

    # Event relationship
    event_id: Mapped[UUID] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), nullable=False, index=True)
    event: Mapped["Event"] = relationship("Event", back_populates="incidents")

    title: Mapped[str] = mapped_column(String(255), nullable=False)
    type: Mapped[str] = mapped_column(String(50), nullable=False)
    priority: Mapped[str] = mapped_column(String(20), nullable=False)
    location_address: Mapped[str | None] = mapped_column(Text, nullable=True)
    location_lat: Mapped[float | None] = mapped_column(Numeric(10, 8), nullable=True)
    location_lng: Mapped[float | None] = mapped_column(Numeric(11, 8), nullable=True)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="eingegangen")
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    contact: Mapped[str | None] = mapped_column(Text, nullable=True)  # Reporter/contact info (Melder/Anrufer)
    contact_phone: Mapped[str | None] = mapped_column(String(50), nullable=True)  # Direct phone number for the reporter
    internal_notes: Mapped[str | None] = mapped_column(Text, nullable=True)  # Internal notes
    nachbarhilfe: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)  # Neighboring station assistance
    nachbarhilfe_note: Mapped[str | None] = mapped_column(Text, nullable=True)  # Note for nachbarhilfe
    am_warten: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)  # Delayed/waiting emergency
    am_warten_note: Mapped[str | None] = mapped_column(Text, nullable=True)  # Note for am_warten
    zu_fuss: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False
    )  # Personnel go by foot (not by vehicle)
    # Where the alarm originated: "operator" (created in the dashboard by a logged-in user),
    # "intake" (public token-gated alarm form), "divera", or the source slug of a
    # generic-webhook sender. source_ref is the alarm's id in that system (pool
    # source_id), set when an incident is created from a pool alarm.
    source: Mapped[str] = mapped_column(String(20), nullable=False, default="operator", server_default="operator")
    source_ref: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Manual sort order within a status column (lower = higher on the board). Operators
    # reorder cards to prioritize alarms; this is the persisted, shared order.
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    # Auftrag (incident group) membership. An incident may be a "stop" in one
    # ordered route (IncidentGroup). SET NULL so deleting an Auftrag leaves its
    # stops on the board, ungrouped. group_position mirrors `position` exactly:
    # order of the stop within its Auftrag.
    group_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("incident_groups.id", ondelete="SET NULL"), nullable=True, index=True
    )
    group_position: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    created_by: Mapped[UUID | None] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Set when the field crew reports the incident finished ("Einsatz beendet").
    # Purely informational: it surfaces a badge on the card so the operator can
    # decide to close the incident — it does NOT change status on its own.
    field_complete_reported_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

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
            name="valid_incident_type",
        ),
        CheckConstraint("priority IN ('low', 'medium', 'high')", name="valid_priority"),
        CheckConstraint(
            "status IN ('eingegangen', 'reko', 'reko_done', 'disponiert', 'einsatz', 'einsatz_beendet', 'abschluss')",
            name="valid_status",
        ),
        CheckConstraint(
            "(location_lat IS NULL AND location_lng IS NULL) OR "
            "(location_lat IS NOT NULL AND location_lng IS NOT NULL)",
            name="valid_location",
        ),
        Index("idx_incidents_status", "status"),
        # Composite index for common query pattern (event_id, status, deleted_at)
        Index("idx_incidents_event_status_deleted", "event_id", "status", "deleted_at"),
        Index("idx_incidents_priority", "priority"),
        Index("idx_incidents_created_at", "created_at"),
        # Supports ORDER BY position within an event's status column.
        Index("idx_incidents_event_status_position", "event_id", "status", "position"),
        # Supports ORDER BY group_position within an Auftrag (incident group).
        Index("idx_incidents_group_position", "group_id", "group_position"),
    )


# ============================================
# INCIDENT GROUPS (Aufträge — multi-stop routes)
# ============================================


class IncidentGroup(Base):
    """Auftrag - an ordered, lightweight container grouping incidents into a route.

    User-facing term is "Auftrag" (plural "Aufträge"). An Auftrag is a checklist
    over real incidents: each member incident (a "stop") stays a first-class
    Incident with its own status/reko/priority/print/GPS. The group itself has no
    lifecycle of its own — its "state" is the derived roll-up of its stops'
    statuses. Mirrors the Incident conventions (UUID PK, event scope, soft delete,
    `position`).
    """

    __tablename__ = "incident_groups"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)

    # Event relationship (event-scoped like incidents; cascade-deleted with the event)
    event_id: Mapped[UUID] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), nullable=False, index=True)
    event: Mapped["Event"] = relationship("Event", back_populates="incident_groups")

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    color: Mapped[str | None] = mapped_column(String(20), nullable=True)  # hex/token for map+board tint
    # 'squad' (vehicle + crew move together) or 'vehicle_only' (shuttle / Pendeldienst:
    # only the vehicle's route is shared, crew assigned per-incident). Drives the
    # copy-picker default + header label.
    mode: Mapped[str] = mapped_column(String(20), nullable=False, default="squad", server_default="squad")
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Order among Aufträge in the event (mirrors Incident.position).
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    created_by: Mapped[UUID | None] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Relationships
    creator: Mapped[Optional["User"]] = relationship("User", foreign_keys=[created_by])
    # Member stops. The FK lives on incidents.group_id. viewonly + no cascade so
    # deleting a group never deletes its incidents (they stay on the board).
    incidents: Mapped[list["Incident"]] = relationship(
        "Incident",
        primaryjoin="IncidentGroup.id == Incident.group_id",
        order_by="Incident.group_position",
        viewonly=True,
    )

    __table_args__ = (
        CheckConstraint("mode IN ('squad', 'vehicle_only')", name="valid_group_mode"),
        Index("idx_incident_groups_event_position", "event_id", "position"),
    )

    def __repr__(self):
        return f"<IncidentGroup {self.name} (mode={self.mode})>"


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
    assigned_by: Mapped[UUID | None] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    unassigned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    driver_stay: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)  # Driver+car stays on scene

    # Relationships
    incident: Mapped["Incident"] = relationship("Incident", back_populates="assignments")
    assigner: Mapped[Optional["User"]] = relationship("User", back_populates="assignments")

    # Add relationship to vehicle for eager loading
    vehicle: Mapped[Optional["Vehicle"]] = relationship(
        "Vehicle",
        primaryjoin="and_(IncidentAssignment.resource_id == Vehicle.id, IncidentAssignment.resource_type == 'vehicle')",
        foreign_keys=[resource_id],
        viewonly=True,
    )

    __table_args__ = (
        CheckConstraint("resource_type IN ('personnel', 'vehicle', 'material')", name="valid_resource_type"),
        UniqueConstraint("incident_id", "resource_type", "resource_id", "unassigned_at", name="unique_assignment"),
        Index("idx_assignments_incident", "incident_id"),
        Index("idx_assignments_resource", "resource_type", "resource_id"),
        Index("idx_assignments_resource_id", "resource_id"),
        Index("idx_assignments_unassigned", "unassigned_at"),
        # Compound index for active assignment queries: finding all active resources for an incident
        Index("idx_assignments_incident_active", "incident_id", "resource_type", "unassigned_at"),
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
    token: Mapped[str] = mapped_column(String(500), nullable=False)
    arrived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Form fields
    is_relevant: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    dangers_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    effort_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    power_supply: Mapped[str | None] = mapped_column(String(50), nullable=True)
    photos_json: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    summary_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    additional_notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Metadata
    submitted_by_token: Mapped[str | None] = mapped_column(String(255), nullable=True)
    submitted_by_personnel_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("personnel.id", ondelete="SET NULL"), nullable=True
    )
    is_draft: Mapped[bool] = mapped_column(Boolean, default=False)

    # Relationships
    incident: Mapped["Incident"] = relationship("Incident", back_populates="reko_reports")
    submitted_by_personnel: Mapped[Optional["Personnel"]] = relationship("Personnel")

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
    user_id: Mapped[UUID | None] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

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
    user_id: Mapped[UUID | None] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    action_type: Mapped[str] = mapped_column(String(50), nullable=False)
    resource_type: Mapped[str] = mapped_column(String(50), nullable=False)
    resource_id: Mapped[UUID | None] = mapped_column(PG_UUID(as_uuid=True), nullable=True)
    changes_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    ip_address: Mapped[str | None] = mapped_column(INET, nullable=True)
    user_agent: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Relationships
    user: Mapped[Optional["User"]] = relationship("User", back_populates="audit_logs")

    __table_args__ = (
        Index("idx_audit_user", "user_id"),
        Index("idx_audit_resource", "resource_type", "resource_id"),
        Index("idx_audit_timestamp", timestamp.desc()),
    )


# ============================================
# SYNC LOGGING
# ============================================


class SyncLog(Base):
    """Sync operation tracking for Railway ↔ Local bidirectional sync."""

    __tablename__ = "sync_log"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    sync_direction: Mapped[str] = mapped_column(String(20), nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    records_synced: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    errors: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    __table_args__ = (
        CheckConstraint("sync_direction IN ('from_railway', 'to_railway')", name="valid_sync_direction"),
        CheckConstraint("status IN ('success', 'failed', 'partial', 'in_progress')", name="valid_sync_status"),
        Index("idx_sync_log_started_at", "started_at"),
        Index("idx_sync_log_status", "status"),
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
    updated_by: Mapped[UUID | None] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)

    # Relationships
    updater: Mapped[Optional["User"]] = relationship("User", back_populates="setting_updates")


# ============================================
# NOTIFICATIONS
# ============================================


class Notification(Base):
    """Notification for time delays, resource constraints, and data quality issues."""

    __tablename__ = "notifications"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    type: Mapped[str] = mapped_column(String(50), nullable=False)
    severity: Mapped[str] = mapped_column(String(20), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)

    # Optional associations
    incident_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("incidents.id", ondelete="CASCADE"), nullable=True, index=True
    )
    event_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("events.id", ondelete="CASCADE"), nullable=True, index=True
    )

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    dismissed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    dismissed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    dismissed_by: Mapped[UUID | None] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)

    __table_args__ = (
        CheckConstraint("severity IN ('critical', 'warning', 'info')", name="valid_notification_severity"),
        CheckConstraint(
            "type IN ("
            "'time_overdue', 'no_personnel', 'no_materials', 'personnel_fatigue', "
            "'missing_location', 'event_size_limit', 'reko_submitted', 'reko_arrived', "
            "'training_emergency', 'vehicle_arrived'"
            ")",
            name="valid_notification_type",
        ),
        Index("idx_notifications_event", "event_id"),
        Index("idx_notifications_incident", "incident_id"),
        Index("idx_notifications_dismissed", "dismissed"),
        Index("idx_notifications_created_at", "created_at"),
    )


# ============================================
# TRAINING AUTOMATION
# ============================================


class EmergencyTemplate(Base):
    """Pre-defined emergency scenarios for training exercises."""

    __tablename__ = "emergency_templates"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)

    # Template metadata
    title_pattern: Mapped[str] = mapped_column(String(255), nullable=False)
    incident_type: Mapped[str] = mapped_column(String(50), nullable=False)
    category: Mapped[str] = mapped_column(String(20), nullable=False)

    # Scenario content
    message_pattern: Mapped[str] = mapped_column(Text, nullable=False)

    # Optional alternates: when populated, the auto-generator picks a random
    # entry (including title_pattern / message_pattern itself) so two spawns
    # of the same template don't read identically.
    title_variations: Mapped[list[str] | None] = mapped_column(JSONB, nullable=True)
    message_variations: Mapped[list[str] | None] = mapped_column(JSONB, nullable=True)

    # Metadata
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    __table_args__ = (
        CheckConstraint("category IN ('normal', 'critical')", name="valid_emergency_category"),
        Index("ix_emergency_templates_category", "category"),
        Index("ix_emergency_templates_is_active", "is_active"),
    )

    def __repr__(self):
        return f"<EmergencyTemplate {self.title_pattern} ({self.category})>"


class TrainingLocation(Base):
    """Pool of realistic addresses for training scenarios."""

    __tablename__ = "training_locations"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)

    # Address components
    street: Mapped[str] = mapped_column(String(255), nullable=False)
    house_number: Mapped[str] = mapped_column(String(20), nullable=False)
    postal_code: Mapped[str] = mapped_column(String(10), nullable=False, default="4104")
    city: Mapped[str] = mapped_column(String(100), nullable=False, default="Oberwil")

    # Building type (optional, for realism)
    building_type: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # Geocoding
    latitude: Mapped[float | None] = mapped_column(Numeric(10, 8), nullable=True)
    longitude: Mapped[float | None] = mapped_column(Numeric(11, 8), nullable=True)

    # Metadata
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    __table_args__ = (Index("ix_training_locations_is_active", "is_active"),)

    def get_full_address(self) -> str:
        return f"{self.street} {self.house_number}, {self.postal_code} {self.city}"

    def __repr__(self):
        return f"<TrainingLocation {self.get_full_address()}>"


# ============================================
# DIVERA INTEGRATION
# ============================================


# ============================================
# PRINT JOBS
# ============================================


class PrintJob(Base):
    """Print job queue for thermal printer integration."""

    __tablename__ = "print_jobs"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    job_type: Mapped[str] = mapped_column(String(20), nullable=False)  # 'assignment', 'board', 'test', or 'qr_code'
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)

    # Optional link to incident (for assignment slips)
    # NOTE: indexed via the explicitly named idx_* entries in __table_args__
    # (matching the migration) — `index=True` would autogenerate ix_* names
    # and drift from the real schema.
    incident_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("incidents.id", ondelete="SET NULL"), nullable=True
    )
    event_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("events.id", ondelete="SET NULL"), nullable=True
    )

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Error tracking
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    retry_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    __table_args__ = (
        CheckConstraint("job_type IN ('assignment', 'board', 'test', 'qr_code')", name="valid_print_job_type"),
        CheckConstraint("status IN ('pending', 'printing', 'completed', 'failed')", name="valid_print_job_status"),
        Index("idx_print_jobs_status", "status"),
        Index("idx_print_jobs_created_at", "created_at"),
        Index("idx_print_jobs_incident_id", "incident_id"),
        Index("idx_print_jobs_event_id", "event_id"),
    )


class DiveraEmergency(Base):
    """Alarm in the intake pool, stored for selective attachment to Events.

    Alarms arrive from Divera 24/7 (webhook/poller) or from any other dispatch
    system via the generic webhook (POST /api/alarms). Provenance lives in
    `source` (slug) + `source_id` (opaque sender id, used for idempotent
    dedupe); `divera_id` only exists on Divera-delivered alarms.
    """

    __tablename__ = "divera_emergencies"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)

    # Divera identifiers for deduplication (NULL for generic-webhook alarms)
    divera_id: Mapped[int | None] = mapped_column(Integer, nullable=True, unique=True, index=True)
    divera_number: Mapped[str | None] = mapped_column(String(50), nullable=True)  # e.g., "E-123"

    # Provider-neutral provenance: which system delivered the alarm ("divera",
    # "webhook", or a custom per-sender slug) and its id there. Matches the
    # 20-char budget of incidents.source so the slug can flow onto incidents.
    source: Mapped[str] = mapped_column(String(20), nullable=False, default="divera", server_default="divera")
    source_id: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Emergency details from Divera
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    text: Mapped[str | None] = mapped_column(Text, nullable=True)
    address: Mapped[str | None] = mapped_column(Text, nullable=True)
    latitude: Mapped[float | None] = mapped_column(Numeric(10, 8), nullable=True)
    longitude: Mapped[float | None] = mapped_column(Numeric(11, 8), nullable=True)
    # Note: priority is inferred from title/text when creating incidents, not stored

    # Store raw Divera payload for reference
    raw_payload_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    # Timestamps
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )

    # Attachment tracking
    attached_to_event_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("events.id", ondelete="SET NULL"), nullable=True, index=True
    )
    attached_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_incident_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("incidents.id", ondelete="SET NULL"), nullable=True
    )

    # Archival
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Simulated alarm injected by the Übungssteuerung: badge in the pool UI,
    # excluded from auto-attach, only attachable to training events.
    is_training: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    __table_args__ = (
        Index("idx_divera_emergencies_divera_id", "divera_id"),
        Index("idx_divera_emergencies_received_at", "received_at"),
        Index("idx_divera_emergencies_attached", "attached_to_event_id"),
        Index("idx_divera_emergencies_archived", "is_archived"),
        Index("idx_divera_emergencies_is_training", "is_training"),
        Index(
            "uq_divera_emergencies_source_source_id",
            "source",
            "source_id",
            unique=True,
            postgresql_where=sa_text("source_id IS NOT NULL"),
        ),
    )

    def __repr__(self):
        status = "attached" if self.attached_to_event_id else "unattached"
        return f"<DiveraEmergency {self.source}:{self.source_id} ({status})>"
