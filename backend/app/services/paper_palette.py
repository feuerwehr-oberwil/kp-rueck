"""The one paper palette: every document KP Rück prints or files.

Shared in spirit with the KP-Front Einsatzrapport (kp-front `backend/app/report_pdf.py`), so
the documents a station files for one night look like they come from one house: a cool slate
family, ink for text, no hue except the ÜBUNG marker. The Einsatzrapport
(`pdf_report_service`) and the Lageblatt (`lageblatt_service`) both read it; before
17.11.2026 the Lageblatt drew in zinc and reportlab's stock grey and the report's own footer
was zinc too (sweep COL-13). The browser print view mirrors these values in app/globals.css
(`.print-view`).
"""

from reportlab.lib import colors

#: Headings and body text.
INK = colors.HexColor("#1b2330")
#: Secondary text, column heads, filing lines, page footers.
DIM = colors.HexColor("#5b6573")
#: Table heads and label columns.
PANEL = colors.HexColor("#eef2f7")
#: Hairlines between rows.
GRID = colors.HexColor("#d7dde5")
#: Alternating rows – the report's tables run for pages.
ZEBRA = colors.HexColor("#f7f9fb")
#: The ruled grid of a sheet that is written on by hand (the Lageblatt): a cool step darker
#: than GRID, so the lines survive a photocopy.
RULE = colors.HexColor("#a3acb9")
#: The ÜBUNG marker – the one thing on the paper that genuinely has to shout.
EXERCISE = colors.HexColor("#b4690a")
