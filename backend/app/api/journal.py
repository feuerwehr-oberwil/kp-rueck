"""Einsatztagebuch API — read the Ereignis' journal, append a manual line, correct one.

Append-only, like KP Front's Verlauf: there is no PUT and no DELETE. A correction is a new
row pointing at the line it corrects; the original stays readable on screen and on paper.
The automatic rows are written by the flush hook in `services/journal.py`, never here.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import schemas
from ..auth.dependencies import CurrentEditor, CurrentUser
from ..database import get_db
from ..models import Event, Incident, JournalEntry, User
from ..services.journal import entry_out as _out
from ..services.journal import journal_rows
from ..websocket_manager import broadcast_journal_update

router = APIRouter(prefix="/events", tags=["journal"])

EVENT_NOT_FOUND = "Ereignis nicht gefunden"


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


async def _title(db: AsyncSession, incident_id: uuid.UUID | None) -> str | None:
    if incident_id is None:
        return None
    return (await db.execute(select(Incident.title).where(Incident.id == incident_id))).scalar_one_or_none()


@router.get("/{event_id}/journal", response_model=schemas.JournalPage)
async def read_journal(
    event_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: CurrentUser,
    since_seq: int = 0,
) -> schemas.JournalPage:
    """The Einsatztagebuch. `since_seq=0` → all of it; a polling client passes the
    `latest_seq` it last saw and gets only what was written since (often nothing)."""
    await _event_or_404(db, event_id)
    entries = await journal_rows(db, event_id, since_seq)
    latest = entries[-1].seq if entries else since_seq
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
    existing = await _by_client_id(db, event_id, payload.client_id)
    if existing is not None:
        return _out(existing, await _title(db, existing.incident_id))
    if payload.incident_id is not None:
        incident = await db.get(Incident, payload.incident_id)
        if incident is None or incident.event_id != event_id:
            raise HTTPException(status_code=422, detail="Einsatz gehört nicht zu diesem Ereignis")
    entry = JournalEntry(
        event_id=event_id,
        incident_id=payload.incident_id,
        kind="manual",
        text=text,
        author_name=_author(user),
        created_by=user.id,
        client_id=payload.client_id,
    )
    db.add(entry)
    await db.commit()
    await db.refresh(entry)
    background_tasks.add_task(broadcast_journal_update, {"event_id": str(event_id), "seq": entry.seq})
    return _out(entry, await _title(db, entry.incident_id))


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
    existing = await _by_client_id(db, event_id, payload.client_id)
    if existing is not None:
        return _out(existing, await _title(db, existing.incident_id))
    original = await db.get(JournalEntry, entry_id)
    if original is None or original.event_id != event_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Eintrag nicht gefunden")
    if original.kind != "manual":
        raise HTTPException(status_code=422, detail="Nur eigene Einträge können korrigiert werden")
    # Always against the ORIGINAL line, so a second correction does not chain.
    root_id = original.corrects_id or original.id
    root = original if root_id == original.id else await db.get(JournalEntry, root_id)
    entry = JournalEntry(
        event_id=event_id,
        incident_id=root.incident_id if root else original.incident_id,
        kind="manual",
        text=text,
        author_name=_author(user),
        created_by=user.id,
        client_id=payload.client_id,
        corrects_id=root_id,
    )
    db.add(entry)
    await db.commit()
    await db.refresh(entry)
    background_tasks.add_task(broadcast_journal_update, {"event_id": str(event_id), "seq": entry.seq})
    return _out(entry, await _title(db, entry.incident_id))
