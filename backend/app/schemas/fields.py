"""Constrained field types shared by the create, update and import paths.

One rule per stored column, written once: a create schema, the matching update schema and
the Excel import (`services/excel_import_export.py`, which validates every row through the
create schema) all use the same type, so none of them can let through a value the database
or the response model refuses later – that used to answer 500, and for a stored row, 500
on every read after it.

The lengths are the column lengths in `models.py` (or a tighter business limit where one
already existed). Update schemas declare these as `X | None = None` and add
`reject_null` for the columns that cannot be empty: an omitted field stays omitted (the
CRUD dumps `exclude_unset`), an explicit null on a NOT NULL column is a 422.
"""

from typing import Annotated

from pydantic import AfterValidator, Field, StringConstraints

# PostgreSQL INTEGER.
INT32_MAX = 2_147_483_647

# A required single-line text column: stripped, never blank, at most N characters.
RequiredText50 = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=50)]
RequiredText100 = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]

# An optional short text column (Funktion, Telefon): stripped, may be empty, capped at the column.
OptionalText50 = Annotated[str, StringConstraints(strip_whitespace=True, max_length=50)]

# A position in a sorted list (Reihenfolge): a non-negative INTEGER.
SortOrder = Annotated[int, Field(ge=0, le=INT32_MAX)]


def _collapse_whitespace(value: str) -> str:
    return " ".join(value.split())


# A person's name: a required text with inner runs of whitespace collapsed to one space.
PersonName = Annotated[RequiredText100, AfterValidator(_collapse_whitespace)]


def reject_null[T](value: T | None) -> T:
    """Refuse an explicit null for a column that cannot be empty.

    For update schemas only: `_not_null = field_validator("name", ...)(reject_null)`.
    Validators do not run on defaults, so a field the client omitted is untouched.
    """
    if value is None:
        raise ValueError("Field cannot be null")
    return value
