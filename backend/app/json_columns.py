"""What the domain JSONB columns hold: one TypedDict per column shape.

``models.py`` types its columns with these (``Mapped[RekoEffort | None]``), so a reader that
indexes a key the shape does not have fails mypy instead of reading ``None`` forever. The
Pydantic schemas validate what comes IN; the stored shape is what goes into the column, and
``tests/test_json_columns.py`` holds each pair to the same keys (a stored row leaves out
what every read recomputes, such as ``on_board``).

Rows written before a key existed can lack it, so readers of the Reko shapes use ``.get``
(``total=False``). The Rapport rows are written whole by ``crud/feld/rapport_reconcile``;
their readers stay defensive anyway, because the column is JSONB written by two doors.

Not here, on purpose – free-form blobs whose shape belongs to someone else: audit and change
logs (``old_value``/``new_value``, ``changes_json``, ``row_json``), provider payloads
(``raw_payload_json``, ``metadata_json``), print-job and notification payloads, import
previews (``columns``/``row``/``subject``) and the Divera responses snapshot.
"""

from typing import TypedDict


class RekoDangers(TypedDict, total=False):
    """``RekoReport.dangers_json`` – the danger checklist (``schemas.DangersAssessment``)."""

    fire: bool
    fire_danger: bool
    explosion: bool
    collapse: bool
    chemical: bool
    electrical: bool
    other_notes: str | None


class RekoEffort(TypedDict, total=False):
    """``RekoReport.effort_json`` – the effort estimate (``schemas.EffortEstimation``)."""

    personnel_count: int | None
    vehicles_needed: list[str]
    equipment_needed: list[str]
    estimated_duration_hours: float | None


def reko_effort_figures(effort: RekoEffort | None) -> tuple[int | None, float | None]:
    """How many people for how many hours – the two figures every Reko summary prints.

    The bell, the Einsatzzettel and the wall display read them here, not each on its own.
    """
    effort = effort or {}
    return effort.get("personnel_count"), effort.get("estimated_duration_hours")


class RapportMaterialEntry(TypedDict):
    """``SchadenplatzReport.materials_json`` – one material unit on the checklist.

    ``schemas.RapportMaterialRow`` without ``location`` and ``on_board``, which every read
    recomputes from the live board. Ids as strings.
    """

    assignment_id: str
    material_id: str | None
    name: str | None
    consumable: bool
    used: bool
    left_on_site: bool


class RapportExtraMaterialEntry(TypedDict):
    """``SchadenplatzReport.extra_materials_json`` – «Weiteres gebrauchtes Material»."""

    name: str
    left_on_site: bool


class RapportVehicleEntry(TypedDict):
    """``SchadenplatzReport.vehicles_json`` – a vehicle the crew confirms (no ``on_board``)."""

    vehicle_id: str
    name: str | None
    present: bool


class RapportPersonnelEntry(TypedDict):
    """``SchadenplatzReport.personnel_json`` – a name on the crew list (no ``on_board``)."""

    personnel_id: str
    name: str
    present: bool


class RapportExtraPersonnelEntry(TypedDict):
    """``SchadenplatzReport.extra_personnel_json`` – somebody on no roster of this station."""

    name: str
    note: str


# ``SchadenplatzReport.cost_snapshot_json`` – who and which vehicle, from/to, frozen at
# submit. Functional syntax because ``from`` is a keyword. Also the response schema's type.
CostSnapshotEntry = TypedDict(
    "CostSnapshotEntry",
    {"kind": str, "name": str, "from": str | None, "to": str | None},
)
