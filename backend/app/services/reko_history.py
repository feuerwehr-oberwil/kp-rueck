"""Who changed what on the Reko report, for the incident's Chronik (owner pick 23.11.2026, #6).

An incident has ONE live Reko report that the field and the KP edit together. Its filing is
ONE Chronik fact («Reko-Bericht eingegangen», the journal); the change rows are only for the
edits AFTER it – a draft's edits and the draft → filed write record nothing (sign-off
24.11.2026). Every writer of its fields brackets the write the same way::

    before = reko_history.snapshot(report)
    ...  # change the report
    await reko_history.record_changes(db, report, before, author)

`record_changes` writes one `RekoReportChange` per field that moved (when the report was
already filed at `snapshot`), and folds an
autosave burst into the row it started: the same author on the same field within
`COALESCE_WINDOW` moves that row on instead of adding one, so typing a sentence is one
Chronik line, not forty. A field typed back to where it was drops its row. A link that
names nobody (`RekoAuthor.identified` false) never coalesces: two crews on two such links
look the same, so each of their saves keeps its own row.

`timeline_events` reads them back as `reko_change` events for `incident_history.timeline`.
The values stay raw (`TRACKED_FIELDS`): the client words them in the operator's language.
"""

import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import models, schemas
from .notification_params import DANGER_LABELS_DE

COALESCE_WINDOW = timedelta(minutes=2)


@dataclass(frozen=True)
class RekoAuthor:
    """Who a write came from: a form link (`feld`, with the person when the link names one)
    or the board (`kp`, with the operator)."""

    source: Literal["feld", "kp"]
    personnel_id: uuid.UUID | None = None
    user_id: uuid.UUID | None = None

    @classmethod
    def kp(cls, user: models.User) -> "RekoAuthor":
        return cls(source="kp", user_id=user.id)

    @classmethod
    def feld(cls, personnel_id: uuid.UUID | None) -> "RekoAuthor":
        return cls(source="feld", personnel_id=personnel_id)

    @property
    def identified(self) -> bool:
        """Whether two writes with this author are surely one person – not for a link that
        names nobody (Sol review G, S6)."""
        return self.personnel_id is not None or self.user_id is not None


def _text(value: Any) -> str | None:
    """Text as the Chronik compares it: blank is the same as nothing."""
    if not isinstance(value, str):
        return None
    return value.strip() or None


def _effort(key: str) -> Callable[[models.RekoReport], Any]:
    return lambda report: (report.effort_json or {}).get(key)


def _effort_list(key: str) -> Callable[[models.RekoReport], Any]:
    return lambda report: list((report.effort_json or {}).get(key) or [])


def _power(report: models.RekoReport) -> str | None:
    # «unknown» is the form's blank answer, the same as no answer.
    return None if report.power_supply in (None, "", "unknown") else report.power_supply


# The report's fields as the Chronik names them. Gefahren are the list of ticked keys
# (the client shows +Einsturz / −Feuer), photos the list of filenames.
TRACKED_FIELDS: dict[str, Callable[[models.RekoReport], Any]] = {
    "is_relevant": lambda report: report.is_relevant,
    "dangers": lambda report: [key for key in DANGER_LABELS_DE if (report.dangers_json or {}).get(key)],
    "dangers_other": lambda report: _text((report.dangers_json or {}).get("other_notes")),
    "personnel_count": _effort("personnel_count"),
    "estimated_duration_hours": _effort("estimated_duration_hours"),
    "vehicles_needed": _effort_list("vehicles_needed"),
    "equipment_needed": _effort_list("equipment_needed"),
    "power_supply": _power,
    "summary_text": lambda report: _text(report.summary_text),
    "additional_notes": lambda report: _text(report.additional_notes),
    "photos": lambda report: list(report.photos_json or []),
}


@dataclass(frozen=True)
class RekoSnapshot:
    """The report before a write: whether it was filed, and its tracked fields."""

    filed: bool
    values: dict[str, Any]


def _values(report: models.RekoReport) -> dict[str, Any]:
    return {field: read(report) for field, read in TRACKED_FIELDS.items()}


def snapshot(report: models.RekoReport) -> RekoSnapshot:
    """`report` now – taken before a write, compared after it."""
    return RekoSnapshot(filed=not report.is_draft, values=_values(report))


def _same_author(change: models.RekoReportChange, author: RekoAuthor) -> bool:
    return (
        change.source == author.source
        and change.personnel_id == author.personnel_id
        and change.user_id == author.user_id
    )


async def record_changes(
    db: AsyncSession,
    report: models.RekoReport,
    before: RekoSnapshot,
    author: RekoAuthor,
    *,
    now: datetime | None = None,
) -> None:
    """One Chronik row per field that differs from `before`, coalesced (module docstring).
    Nothing while `before` is a draft: the filing is the one fact for everything up to it.

    The caller holds the report's row (or its incident's) lock, so two writes of one report
    never coalesce into the same row at once.
    """
    if not before.filed:
        return
    at = now or datetime.now(UTC)
    for field, new in _values(report).items():
        old = before.values.get(field)
        if new == old:
            continue
        latest = await db.scalar(
            select(models.RekoReportChange)
            .where(models.RekoReportChange.report_id == report.id, models.RekoReportChange.field == field)
            .order_by(models.RekoReportChange.changed_at.desc())
            .limit(1)
        )
        if (
            latest is not None
            and author.identified
            and _same_author(latest, author)
            and at - latest.changed_at < COALESCE_WINDOW
        ):
            if latest.old_value == new:
                await db.delete(latest)
            else:
                latest.new_value = new
                latest.changed_at = at
            continue
        db.add(
            models.RekoReportChange(
                report_id=report.id,
                field=field,
                old_value=old,
                new_value=new,
                source=author.source,
                personnel_id=author.personnel_id,
                user_id=author.user_id,
                changed_at=at,
            )
        )
    await db.flush()


async def timeline_events(db: AsyncSession, incident_id: uuid.UUID) -> list[schemas.IncidentTimelineEvent]:
    """The incident's Reko changes as Chronik events (`event_type="reko_change"`)."""
    rows = await db.execute(
        select(models.RekoReportChange, models.Personnel.name, models.User)
        .join(models.RekoReport, models.RekoReport.id == models.RekoReportChange.report_id)
        .outerjoin(models.Personnel, models.Personnel.id == models.RekoReportChange.personnel_id)
        .outerjoin(models.User, models.User.id == models.RekoReportChange.user_id)
        .where(models.RekoReport.incident_id == incident_id)
    )
    return [
        schemas.IncidentTimelineEvent(
            event_type="reko_change",
            timestamp=change.changed_at,
            actor_name=personnel_name or (user.display_name or user.username if user else None),
            source=change.source,
            reko_field=change.field,
            old_value=change.old_value,
            new_value=change.new_value,
        )
        for change, personnel_name, user in rows.all()
    ]
