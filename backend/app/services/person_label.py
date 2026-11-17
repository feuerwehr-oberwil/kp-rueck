"""Telling two people of the same name apart on paper – the server's `lib/person-label.ts`.

The Kennung (Jahrgang «1985», Personal-Nr. «412») follows a name only when two or more people on
the roster share it: «Meier Alex (1985)», and «Meier Alex (?)» for a namesake without one – the
reader has to know the name is not unique. The same rule and the same text form as the board's
print, radio and WhatsApp texts (`personLabelText`, style ``"text"``). Used by the thermal slips,
the Lageblatt and the Einsatzrapport PDF.

Read the roster's namesakes ONCE per output (`roster_namesakes`) and pass the set along.
"""

from collections.abc import Iterable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..crud.personnel import name_key
from ..models import Personnel


def _key(name: str) -> str:
    return name_key(name, None)[0]


def namesakes(names: Iterable[str]) -> frozenset[str]:
    """The name keys two or more of ``names`` share."""
    seen: set[str] = set()
    shared: set[str] = set()
    for name in names:
        key = _key(name)
        if not key:
            continue
        (shared if key in seen else seen).add(key)
    return frozenset(shared)


async def roster_namesakes(db: AsyncSession) -> frozenset[str]:
    """The namesakes of the whole roster – every row counts, as on the board."""
    return namesakes((await db.execute(select(Personnel.name))).scalars())


def person_text(name: str, kennung: str | None, shared: frozenset[str]) -> str:
    """«Meier Alex (1985)» for a namesake, just the name when it is unique."""
    if _key(name) not in shared:
        return name
    return f"{name} ({(kennung or '').strip() or '?'})"
