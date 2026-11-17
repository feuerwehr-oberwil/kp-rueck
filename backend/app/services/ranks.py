"""The Grad: the Swiss Dienstgrade a roster snapshot names by key, and how senior each is.

``personnel.role`` holds the Grad as a word – «Feldweibel», «Hauptmann» – the same word KP Front
shows for the same key, so one roster file gives a person the same Grad in both products. The
keys, labels and abbreviations mirror KP Front's default list (``backend/app/ranks.py`` there,
``SWISS_DEFAULT_RANKS``), plus «Soldat», which snapshots also carry.

Seniority is a coarse tier and only a sort key (who leads a crew, who heads the Lageblatt's
«Wer»): 1 Offizier · 2 höherer Unteroffizier · 3 Korporal · 4 Mannschaftsgrad. It is never
shown. The four words Rück stored before it kept the Grad («Offizier», «Wachtmeister»,
«Korporal», «Mannschaft» – the sample seeds still use them) rank the same as before.
"""

from typing import NamedTuple


class Rank(NamedTuple):
    key: str
    label: str
    abbr: str
    #: 1 = most senior. A sort key, never a word on screen.
    tier: int


#: Most senior first.
RANKS: tuple[Rank, ...] = (
    Rank("kdt", "Kommandant", "Kdt", 1),
    Rank("maj", "Major", "Maj", 1),
    Rank("hptm", "Hauptmann", "Hptm", 1),
    Rank("oblt", "Oberleutnant", "Oblt", 1),
    Rank("lt", "Leutnant", "Lt", 1),
    Rank("fw", "Feldweibel", "Fw", 2),
    Rank("wm", "Wachtmeister", "Wm", 2),
    Rank("kpl", "Korporal", "Kpl", 3),
    Rank("gfr", "Gefreiter", "Gfr", 4),
    Rank("fwm", "Feuerwehrmann", "Fwm", 4),
    Rank("sdt", "Soldat", "Sdt", 4),
)

#: Snapshot rank key → the Grad stored in ``personnel.role``.
RANK_LABEL: dict[str, str] = {rank.key: rank.label for rank in RANKS}

#: Lower-cased Grad → (tier, abbreviation). The legacy coarse words carry the prefix the
#: Lageblatt has always printed for them («Of», none for «Mannschaft»).
_BY_WORD: dict[str, tuple[int, str]] = {
    "offizier": (1, "Of"),
    "mannschaft": (4, ""),
    **{rank.label.lower(): (rank.tier, rank.abbr) for rank in RANKS},
}


def rank_tier(role: str | None) -> int | None:
    """The seniority tier of a stored Grad (1 = most senior), None for a word it does not know."""
    known = _BY_WORD.get((role or "").strip().lower())
    return known[0] if known else None


def rank_abbr(role: str | None) -> str | None:
    """The short form of a stored Grad («Fw»), None for a word it does not know."""
    known = _BY_WORD.get((role or "").strip().lower())
    return known[1] if known else None
