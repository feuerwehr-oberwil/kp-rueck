"""Serialize data-only workbooks without interpreting operational text as formulas."""

from io import BytesIO

from openpyxl import Workbook


def workbook_bytes(workbook: Workbook) -> BytesIO:
    """Preserve text verbatim, including leading '=' and Excel error-like strings.

    None of our exports contains calculated cells. openpyxl otherwise infers formulas
    from user-controlled text, including public alarm and field-report inputs.
    Explicit string cells avoid changing the data with a visible apostrophe prefix.
    """
    for sheet in workbook:
        for row in sheet:
            for cell in row:
                if isinstance(cell.value, str):
                    cell.data_type = "s"
    output = BytesIO()
    workbook.save(output)
    output.seek(0)
    return output
