"""Each stored JSON shape (`app/json_columns.py`) has the keys of the schema that validates it.

A field added to the Pydantic schema but not to the column's TypedDict would be written into
the column and read by nobody mypy can check; the reverse is a key no write ever fills.
"""

import pytest
from pydantic import BaseModel

from app import json_columns as shapes
from app import schemas

# (stored shape, the schema the form validates it with, keys every read recomputes)
PAIRS: list[tuple[type, type[BaseModel], set[str]]] = [
    (shapes.RekoDangers, schemas.DangersAssessment, set()),
    (shapes.RekoEffort, schemas.EffortEstimation, set()),
    (shapes.RapportMaterialEntry, schemas.RapportMaterialRow, {"location", "on_board"}),
    (shapes.RapportExtraMaterialEntry, schemas.RapportExtraMaterialRow, set()),
    (shapes.RapportVehicleEntry, schemas.RapportVehicleRow, {"on_board"}),
    (shapes.RapportPersonnelEntry, schemas.RapportPersonnelRow, {"on_board"}),
    (shapes.RapportExtraPersonnelEntry, schemas.RapportExtraPersonnelRow, set()),
]


@pytest.mark.parametrize(("shape", "schema", "derived"), PAIRS, ids=[shape.__name__ for shape, _, _ in PAIRS])
def test_stored_shape_has_the_schema_keys(shape: type, schema: type[BaseModel], derived: set[str]):
    assert set(shape.__annotations__) == set(schema.model_fields) - derived
