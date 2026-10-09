"""Einsatztagebuch API — read the Ereignis' journal, append a manual line, correct one.

Append-only, like KP Front's Verlauf: there is no PUT and no DELETE. A correction is a new
row pointing at the line it corrects; the original stays readable on screen and on paper.
The automatic rows are written by the flush hook in `services/journal.py`, never here.

`client_id` is the write's identity. The same id again is a retry (the answer was lost),
and gets the row already written — also when the two copies race each other into the
unique index. The same id with a DIFFERENT line is not a retry but a client bug, and is
refused with 409 rather than silently answered with the old text.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .. import schemas
from ..auth.dependencies import CurrentEditor, CurrentUser
from ..database import get_db
from ..models import Event, Incident, JournalEntry, User
from ..services.journal import entry_out, journal_rows
from ..websocket_manager import broadcast_journal_update

router = APIRouter(prefix="/events", tags=["journal"])

EVENT_NOT_FOUND = "Ereignis nicht gefunden"
CLIENT_ID_REUSED = "Diese Eintrags-ID ist bereits mit einem anderen Text vergeben"


def _author(user: User) -> str:
    return (user.display_name or user.username)[:100]


async def _event_or_404(db: AsyncSession, event_id: uuid.UUID) -> Event:
    event = await db.get(Event, event_id)
    if event is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=EVENT_NOT_FOUND)
    return event


async def _by_client_id(db: AsyncSession, event_id: uuid.UUID, client_id: str) -> JournalEntry | None:
    return (
        await db.execute(
            select(JournalEntry).where(JournalEntry.event_id == event_id, JournalEntry.client_id == client_id)
        )
    ).scalar_one_or_none()


async def _out(db: AsyncSession, entry: JournalEntry) -> schemas.JournalEntryOut:
    title, deleted_at = None, None
    if entry.incident_id is not None:
        row = (
            await db.execute(select(Incident.title, Incident.deleted_at).where(Incident.id == entry.incident_id))
        ).one_or_none()
        if row is not None:
            title, deleted_at = row
    return entry_out(entry, title, deleted_at is not None)


def _same_write(existing: JournalEntry, entry: JournalEntry) -> bool:
    return (
        existing.text == entry.text
        and existing.incident_id == entry.incident_id
        and existing.corrects_id == entry.corrects_id
    )


async def _write_once(db: AsyncSession, event_id: uuid.UUID, entry: JournalEntry) -> JournalEntry:
    """Insert `entry`, or hand back the row its `client_id` already wrote."""
    client_id = entry.client_id or ""
    existing = await _by_client_id(db, event_id, client_id)
    if existing is None:
        db.add(entry)
        try:
            await db.commit()
        except IntegrityError:
            # the same line raced in twice (double tap, retry overtaking the original)
            await db.rollback()
            existing = await _by_client_id(db, event_id, client_id)
            if existing is None:
                raise
        else:
            await db.refresh(entry)
            return entry
    if not _same_write(existing, entry):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=CLIENT_ID_REUSED)
    return existing


@router.get("/{event_id}/journal", response_model=schemas.JournalPage)
async def read_journal(
    event_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: CurrentUser,
    since_seq: int = 0,
) -> schemas.JournalPage:
    """The Einsatztagebuch. `since_seq=0` → all of it; a polling client passes the
    `latest_seq` it last saw and gets what was written since — plus the last two minutes
    again (services/journal.OVERLAP), so a row a long transaction committed late is not
    lost behind the cursor. Rows are merged by id on the client."""
    await _event_or_404(db, event_id)
    entries = await journal_rows(db, event_id, since_seq)
    latest = max([since_seq, *(e.seq for e in entries)])
    return schemas.JournalPage(entries=entries, latest_seq=latest)


@router.post("/{event_id}/journal", response_model=schemas.JournalEntryOut, status_code=status.HTTP_201_CREATED)
async def append_journal_line(
    event_id: uuid.UUID,
    payload: schemas.JournalEntryCreate,
    background_tasks: BackgroundTasks,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentEditor,
) -> schemas.JournalEntryOut:
    """A manual line — something that happened and belongs to no card, or one that the
    operator wants on record next to a card (`incident_id`). Idempotent on `client_id`."""
    text = payload.text.strip()
    if not text:
        raise HTTPException(status_code=422, detail="Leerer Eintrag")
    await _event_or_404(db, event_id)
    if payload.incident_id is not None:
        incident = await db.get(Incident, payload.incident_id)
        if incident is None or incident.event_id != event_id:
            raise HTTPException(status_code=422, detail="Einsatz gehört nicht zu diesem Ereignis")
    entry = await _write_once(
        db,
        event_id,
        JournalEntry(
            event_id=event_id,
            incident_id=payload.incident_id,
            kind="manual",
            text=text,
            author_name=_author(user),
            created_by=user.id,
            client_id=payload.client_id,
        ),
    )
    background_tasks.add_task(broadcast_journal_update, {"event_id": str(event_id), "seq": entry.seq})
    return await _out(db, entry)


@router.post(
    "/{event_id}/journal/{entry_id}/corrections",
    response_model=schemas.JournalEntryOut,
    status_code=status.HTTP_201_CREATED,
)
async def correct_journal_line(
    event_id: uuid.UUID,
    entry_id: uuid.UUID,
    payload: schemas.JournalCorrectionCreate,
    background_tasks: BackgroundTasks,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentEditor,
) -> schemas.JournalEntryOut:
    """Correct a MANUAL line by appending its new wording. Automatic rows are facts from
    the board — they are corrected on the board (the next status change, the release),
    which writes its own row."""
    text = payload.text.strip()
    if not text:
        raise HTTPException(status_code=422, detail="Leerer Eintrag")
    await _event_or_404(db, event_id)
    original = await db.get(JournalEntry, entry_id)
    if original is None or original.event_id != event_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Eintrag nicht gefunden")
    if original.kind != "manual":
        raise HTTPException(status_code=422, detail="Nur eigene Einträge können korrigiert werden")
    # Always against the ORIGINAL line, so a second correction does not chain.
    root_id = original.corrects_id or original.id
    root = original if root_id == original.id else await db.get(JournalEntry, root_id)
    entry = await _write_once(
        db,
        event_id,
        JournalEntry(
            event_id=event_id,
            incident_id=root.incident_id if root else original.incident_id,
            kind="manual",
            text=text,
            author_name=_author(user),
            created_by=user.id,
            client_id=payload.client_id,
            corrects_id=root_id,
        ),
    )
    background_tasks.add_task(broadcast_journal_update, {"event_id": str(event_id), "seq": entry.seq})
    return await _out(db, entry)
