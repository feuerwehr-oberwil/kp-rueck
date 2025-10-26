# Task 11.2: Incident Export for Legal Trail

**Priority:** P1 (Critical - Legal compliance requirement)
**Complexity:** Medium
**Estimated Effort:** 3-5 hours
**Dependencies:** None
**Status:** Specification Complete - Not Implemented

---

## 1. Overview

Implement comprehensive incident data export functionality to PDF format for legal documentation, archival, and compliance purposes. Exports must include full incident details, status history, resource assignments, reko reports, and photos.

### Business Value
- Legal compliance for incident documentation
- Complete audit trail for insurance claims
- Archival records for post-incident analysis
- Court-admissible evidence documentation

### User Stories
1. **As a commander**, I want to export complete incident reports to PDF so I have legal documentation
2. **As an admin**, I want to export multiple incidents as a batch so I can archive event records
3. **As a legal officer**, I want exported PDFs to include timestamps and digital signatures so they're court-admissible
4. **As an analyst**, I want to export incident data to Excel/CSV so I can perform statistical analysis

---

## 2. Technical Specification

### 2.1 Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                Export Architecture                           │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  Frontend                    Backend                         │
│  ┌────────────────┐         ┌────────────────┐             │
│  │ Export Button  │         │ Export Service │             │
│  │ (Incident)     │ ──────> │ - PDF Gen      │             │
│  └────────────────┘         │ - Excel Gen    │             │
│                              │ - CSV Gen      │             │
│  ┌────────────────┐         └────────┬───────┘             │
│  │ Batch Export   │                  │                      │
│  │ (Event/Filter) │ ──────>          │                      │
│  └────────────────┘         ┌────────▼───────┐             │
│                              │ Template Engine│             │
│                              │ (Jinja2/HTML)  │             │
│                              └────────┬───────┘             │
│                                       │                      │
│                              ┌────────▼───────┐             │
│                              │ WeasyPrint/    │             │
│                              │ ReportLab      │             │
│                              │ (PDF Gen)      │             │
│                              └────────────────┘             │
│                                                               │
│  Export Formats:                                             │
│  - PDF (legal documentation)                                 │
│  - Excel (data analysis)                                     │
│  - CSV (external tools)                                      │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 PDF Export Structure

**Single Incident Report:**

```
┌─────────────────────────────────────────────────────┐
│                                                       │
│  KP Rück - Einsatzbericht                           │
│  [Logo/Header]                                       │
│                                                       │
│  Einsatz-Nr: EIN-2025-001                           │
│  Erstellt: 26.10.2025 14:30:00                      │
│  Exportiert: 26.10.2025 16:45:00                    │
│  Bearbeiter: Max Mustermann                          │
│                                                       │
├─────────────────────────────────────────────────────┤
│                                                       │
│  1. EINSATZDETAILS                                   │
│  ────────────────────────────────────────────────   │
│  Titel: Wohnungsbrand Hauptstrasse 12               │
│  Typ: Brandbekämpfung                                │
│  Priorität: Hoch                                     │
│  Status: Einsatz Beendet                             │
│  Ort: Hauptstrasse 12, 4102 Binningen               │
│  Koordinaten: 47.5456, 7.5678                        │
│                                                       │
│  2. ZEITVERLAUF                                      │
│  ────────────────────────────────────────────────   │
│  14:12:34 - Eingegangen                              │
│  14:14:10 - Reko (Benutzer: M. Mustermann)          │
│  14:18:05 - Disponiert (Benutzer: A. Schmidt)       │
│  14:22:00 - Einsatz (Benutzer: A. Schmidt)          │
│  15:35:12 - Einsatz Beendet (Benutzer: M. Müller)  │
│  15:45:00 - Abschluss (Benutzer: M. Mustermann)     │
│                                                       │
│  3. RESSOURCEN                                       │
│  ────────────────────────────────────────────────   │
│  Fahrzeuge:                                          │
│    - TLF 1 (14:15 - 15:40)                          │
│    - DLK 1 (14:18 - 15:38)                          │
│                                                       │
│  Personal:                                           │
│    - Max Mustermann (Einsatzleiter)                 │
│    - Anna Schmidt (Fahrer)                           │
│    - 6 weitere Personen                              │
│                                                       │
│  Material:                                           │
│    - Atemschutzgerät x4                              │
│    - Schlauch C-52 x8                                │
│                                                       │
│  4. REKO-BERICHTE                                    │
│  ────────────────────────────────────────────────   │
│  Eingereicht: 14:14:10                               │
│  Relevanz: Ja                                        │
│                                                       │
│  Gefahren:                                           │
│    ☑ Brand    ☐ Explosion    ☐ Einsturz            │
│    ☐ Chemisch ☐ Elektrisch                          │
│                                                       │
│  Einsatzumfang:                                      │
│    - Personal: 8 Personen                            │
│    - Dauer: ca. 2 Stunden                            │
│    - Fahrzeuge: TLF, DLK                             │
│                                                       │
│  Zusammenfassung:                                    │
│  Wohnungsbrand im 3. OG. Bewohner bereits           │
│  evakuiert. Starke Rauchentwicklung.                │
│                                                       │
│  Fotos: 4 Bilder                                     │
│  [Thumbnail images]                                  │
│                                                       │
│  5. ZUSÄTZLICHE NOTIZEN                              │
│  ────────────────────────────────────────────────   │
│  [Incident description field]                        │
│                                                       │
├─────────────────────────────────────────────────────┤
│                                                       │
│  Digitale Signatur:                                  │
│  SHA256: a3f5...9c2e                                 │
│  Zeitstempel: 2025-10-26T16:45:00Z                  │
│                                                       │
│  Seite 1 von 1                                       │
└─────────────────────────────────────────────────────┘
```

### 2.3 Backend Implementation

**Dependencies:**

```toml
# pyproject.toml

[project]
dependencies = [
    "weasyprint>=62.0",  # HTML to PDF conversion
    "jinja2>=3.1.4",     # Template rendering
    "openpyxl>=3.1.5",   # Excel export (already added)
]
```

**File: `backend/app/services/export/pdf_generator.py`**

```python
"""
PDF export service for incident reports.
"""

from typing import Optional, List
from datetime import datetime
from pathlib import Path
from io import BytesIO
import hashlib

from jinja2 import Environment, FileSystemLoader
from weasyprint import HTML, CSS
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from ...models import Incident, StatusTransition, Assignment, RekoReport
from ...crud import incidents as crud

class IncidentPDFExporter:
    """Generate PDF reports for incidents."""

    def __init__(self):
        template_dir = Path(__file__).parent / "templates"
        self.env = Environment(loader=FileSystemLoader(template_dir))

    async def export_incident(
        self,
        db: AsyncSession,
        incident_id: str,
        include_photos: bool = True,
    ) -> BytesIO:
        """
        Generate PDF report for single incident.

        Args:
            db: Database session
            incident_id: UUID of incident
            include_photos: Include reko photos in PDF

        Returns:
            BytesIO containing PDF data
        """
        # Load incident with all related data
        incident = await self._load_incident_full(db, incident_id)

        # Load status history
        result = await db.execute(
            select(StatusTransition)
            .where(StatusTransition.incident_id == incident_id)
            .order_by(StatusTransition.timestamp)
        )
        status_history = result.scalars().all()

        # Load assignments
        result = await db.execute(
            select(Assignment)
            .where(Assignment.incident_id == incident_id)
            .order_by(Assignment.assigned_at)
        )
        assignments = result.scalars().all()

        # Load reko reports
        result = await db.execute(
            select(RekoReport)
            .where(RekoReport.incident_id == incident_id)
            .order_by(RekoReport.submitted_at)
        )
        reko_reports = result.scalars().all()

        # Group assignments by resource type
        vehicles = [a for a in assignments if a.resource_type == "vehicle"]
        personnel = [a for a in assignments if a.resource_type == "personnel"]
        materials = [a for a in assignments if a.resource_type == "material"]

        # Render HTML template
        template = self.env.get_template("incident_report.html")
        html_content = template.render(
            incident=incident,
            status_history=status_history,
            vehicles=vehicles,
            personnel=personnel,
            materials=materials,
            reko_reports=reko_reports,
            generated_at=datetime.utcnow(),
            include_photos=include_photos,
        )

        # Generate PDF
        pdf_bytes = HTML(string=html_content).write_pdf(
            stylesheets=[
                CSS(string=self._get_pdf_styles())
            ]
        )

        # Calculate digital signature (SHA256 hash)
        pdf_hash = hashlib.sha256(pdf_bytes).hexdigest()

        # Add signature page (simplified - full implementation would use proper digital signatures)
        # For now, just return the PDF
        output = BytesIO(pdf_bytes)
        output.seek(0)

        return output

    async def export_batch(
        self,
        db: AsyncSession,
        incident_ids: List[str],
    ) -> BytesIO:
        """
        Generate combined PDF for multiple incidents.

        Useful for exporting all incidents from an event.
        """
        # Generate individual reports
        reports = []
        for incident_id in incident_ids:
            report = await self.export_incident(db, incident_id)
            reports.append(report.read())

        # Combine PDFs (requires pypdf or pdfrw)
        # For simplicity, concatenate HTML and render as one PDF
        combined_html = ""
        for incident_id in incident_ids:
            # Render each incident
            # ... (implementation details)
            pass

        # Generate combined PDF
        output = BytesIO()
        # ... (implementation)
        return output

    def _get_pdf_styles(self) -> str:
        """Get CSS styles for PDF layout."""
        return """
            @page {
                size: A4;
                margin: 2cm;
                @top-right {
                    content: "KP Rück - Einsatzbericht";
                }
                @bottom-right {
                    content: "Seite " counter(page) " von " counter(pages);
                }
            }

            body {
                font-family: 'DejaVu Sans', sans-serif;
                font-size: 10pt;
                line-height: 1.4;
            }

            h1 {
                font-size: 18pt;
                margin-bottom: 20pt;
                border-bottom: 2pt solid #333;
            }

            h2 {
                font-size: 14pt;
                margin-top: 15pt;
                margin-bottom: 10pt;
                color: #2563eb;
            }

            .header {
                text-align: center;
                margin-bottom: 30pt;
            }

            .info-grid {
                display: grid;
                grid-template-columns: 150pt 1fr;
                gap: 5pt;
                margin-bottom: 15pt;
            }

            .info-label {
                font-weight: bold;
            }

            .timeline-entry {
                margin-bottom: 8pt;
                padding-left: 15pt;
                border-left: 2pt solid #e5e7eb;
            }

            .signature {
                margin-top: 30pt;
                padding-top: 15pt;
                border-top: 1pt solid #ccc;
                font-size: 8pt;
                color: #666;
            }

            .page-break {
                page-break-after: always;
            }
        """

    async def _load_incident_full(self, db: AsyncSession, incident_id: str):
        """Load incident with all relationships."""
        # Implementation would use eager loading
        return await crud.get_incident(db, incident_id)
```

**File: `backend/app/services/export/templates/incident_report.html`**

```html
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <title>Einsatzbericht - {{ incident.title }}</title>
</head>
<body>
    <div class="header">
        <h1>KP Rück - Einsatzbericht</h1>
        <p><strong>Einsatz-Nr:</strong> {{ incident.id }}</p>
        <p><strong>Exportiert:</strong> {{ generated_at.strftime('%d.%m.%Y %H:%M:%S') }}</p>
    </div>

    <h2>1. Einsatzdetails</h2>
    <div class="info-grid">
        <div class="info-label">Titel:</div>
        <div>{{ incident.title }}</div>

        <div class="info-label">Typ:</div>
        <div>{{ incident.type }}</div>

        <div class="info-label">Priorität:</div>
        <div>{{ incident.priority }}</div>

        <div class="info-label">Status:</div>
        <div>{{ incident.status }}</div>

        <div class="info-label">Ort:</div>
        <div>{{ incident.location_address or 'Keine Adresse' }}</div>

        {% if incident.location_lat and incident.location_lng %}
        <div class="info-label">Koordinaten:</div>
        <div>{{ incident.location_lat }}, {{ incident.location_lng }}</div>
        {% endif %}

        <div class="info-label">Erstellt:</div>
        <div>{{ incident.created_at.strftime('%d.%m.%Y %H:%M:%S') }}</div>
    </div>

    <h2>2. Zeitverlauf</h2>
    {% for transition in status_history %}
    <div class="timeline-entry">
        <strong>{{ transition.timestamp.strftime('%H:%M:%S') }}</strong> -
        {{ transition.from_status }} → {{ transition.to_status }}
        {% if transition.user_id %}
        (Benutzer: {{ transition.user_id }})
        {% endif %}
        {% if transition.notes %}
        <br><em>{{ transition.notes }}</em>
        {% endif %}
    </div>
    {% endfor %}

    <h2>3. Ressourcen</h2>

    <h3>Fahrzeuge ({{ vehicles|length }})</h3>
    {% for assignment in vehicles %}
    <div>
        - {{ assignment.resource_id }}
        ({{ assignment.assigned_at.strftime('%H:%M') }} -
        {% if assignment.unassigned_at %}
        {{ assignment.unassigned_at.strftime('%H:%M') }}
        {% else %}
        laufend
        {% endif %})
    </div>
    {% endfor %}

    <h3>Personal ({{ personnel|length }})</h3>
    {% for assignment in personnel %}
    <div>- {{ assignment.resource_id }}</div>
    {% endfor %}

    <h3>Material ({{ materials|length }})</h3>
    {% for assignment in materials %}
    <div>- {{ assignment.resource_id }}</div>
    {% endfor %}

    {% if reko_reports %}
    <div class="page-break"></div>
    <h2>4. Reko-Berichte</h2>
    {% for report in reko_reports %}
    <div>
        <p><strong>Eingereicht:</strong> {{ report.submitted_at.strftime('%d.%m.%Y %H:%M:%S') }}</p>
        <p><strong>Relevanz:</strong> {{ 'Ja' if report.is_relevant else 'Nein' }}</p>

        {% if report.dangers_json %}
        <p><strong>Gefahren:</strong></p>
        <ul>
            {% if report.dangers_json.fire %}<li>Brand</li>{% endif %}
            {% if report.dangers_json.explosion %}<li>Explosion</li>{% endif %}
            {% if report.dangers_json.collapse %}<li>Einsturz</li>{% endif %}
            {% if report.dangers_json.chemical %}<li>Chemisch</li>{% endif %}
            {% if report.dangers_json.electrical %}<li>Elektrisch</li>{% endif %}
        </ul>
        {% endif %}

        {% if report.summary_text %}
        <p><strong>Zusammenfassung:</strong></p>
        <p>{{ report.summary_text }}</p>
        {% endif %}

        {% if include_photos and report.photos_json %}
        <p><strong>Fotos:</strong> {{ report.photos_json|length }} Bilder</p>
        <!-- Photos would be embedded here -->
        {% endif %}
    </div>
    {% endfor %}
    {% endif %}

    {% if incident.description %}
    <h2>5. Zusätzliche Notizen</h2>
    <p>{{ incident.description }}</p>
    {% endif %}

    <div class="signature">
        <p><strong>Digitale Signatur:</strong></p>
        <p>Zeitstempel: {{ generated_at.isoformat() }}</p>
        <p>Exportiert von KP Rück System v{{ version }}</p>
    </div>
</body>
</html>
```

### 2.4 Excel/CSV Export

**File: `backend/app/services/export/excel_generator.py`**

```python
"""
Excel/CSV export for incident data analysis.
"""

from io import BytesIO
from typing import List
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill
import csv
from sqlalchemy.ext.asyncio import AsyncSession

class IncidentExcelExporter:
    """Export incident data to Excel/CSV."""

    async def export_incidents_excel(
        self,
        db: AsyncSession,
        incident_ids: List[str],
    ) -> BytesIO:
        """Export incidents to Excel for analysis."""
        wb = Workbook()
        ws = wb.active
        ws.title = "Einsätze"

        # Headers
        headers = [
            "ID", "Titel", "Typ", "Priorität", "Status",
            "Erstellt", "Abgeschlossen", "Dauer (Min)",
            "Ort", "Lat", "Lng",
            "Fahrzeuge", "Personal", "Material",
        ]
        ws.append(headers)

        # Style headers
        for cell in ws[1]:
            cell.font = Font(bold=True)
            cell.fill = PatternFill(start_color="366092", end_color="366092", fill_type="solid")

        # Load and append incident data
        for incident_id in incident_ids:
            incident = await self._load_incident(db, incident_id)
            # Calculate duration
            duration = None
            if incident.created_at and incident.completed_at:
                duration = (incident.completed_at - incident.created_at).total_seconds() / 60

            # Count resources
            vehicles_count = len([a for a in incident.assignments if a.resource_type == "vehicle"])
            personnel_count = len([a for a in incident.assignments if a.resource_type == "personnel"])
            materials_count = len([a for a in incident.assignments if a.resource_type == "material"])

            row = [
                str(incident.id),
                incident.title,
                incident.type,
                incident.priority,
                incident.status,
                incident.created_at.isoformat() if incident.created_at else "",
                incident.completed_at.isoformat() if incident.completed_at else "",
                duration,
                incident.location_address or "",
                incident.location_lat or "",
                incident.location_lng or "",
                vehicles_count,
                personnel_count,
                materials_count,
            ]
            ws.append(row)

        # Save to BytesIO
        output = BytesIO()
        wb.save(output)
        output.seek(0)
        return output
```

### 2.5 API Endpoints

**File: `backend/app/api/exports.py`**

```python
"""Export API endpoints."""

from typing import List
from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime

from ..auth.dependencies import CurrentUser
from ..database import get_db
from ..services.export.pdf_generator import IncidentPDFExporter
from ..services.export.excel_generator import IncidentExcelExporter

router = APIRouter(prefix="/export", tags=["export"])

@router.get("/incident/{incident_id}/pdf")
async def export_incident_pdf(
    incident_id: str,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
    include_photos: bool = Query(True, description="Include reko photos"),
):
    """Export single incident to PDF."""
    exporter = IncidentPDFExporter()
    pdf_bytes = await exporter.export_incident(
        db, incident_id, include_photos=include_photos
    )

    filename = f"einsatz_{incident_id}_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.pdf"

    return StreamingResponse(
        pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

@router.post("/incidents/pdf")
async def export_incidents_batch_pdf(
    incident_ids: List[str],
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """Export multiple incidents to combined PDF."""
    exporter = IncidentPDFExporter()
    pdf_bytes = await exporter.export_batch(db, incident_ids)

    filename = f"einsaetze_batch_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.pdf"

    return StreamingResponse(
        pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

@router.post("/incidents/excel")
async def export_incidents_excel(
    incident_ids: List[str],
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """Export incidents to Excel for analysis."""
    exporter = IncidentExcelExporter()
    excel_bytes = await exporter.export_incidents_excel(db, incident_ids)

    filename = f"einsaetze_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.xlsx"

    return StreamingResponse(
        excel_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )
```

---

## 3. Implementation Checklist

### Phase 1: PDF Generation (2-3 hours)
- [ ] Install WeasyPrint and Jinja2 dependencies
- [ ] Create `backend/app/services/export/` directory
- [ ] Create HTML template for incident reports
- [ ] Implement `IncidentPDFExporter` class
- [ ] Add PDF CSS styling
- [ ] Test PDF generation with sample data

### Phase 2: Excel/CSV Export (1 hour)
- [ ] Implement `IncidentExcelExporter` class
- [ ] Add Excel formatting and headers
- [ ] Add CSV export variant

### Phase 3: API & Frontend (1-2 hours)
- [ ] Create export API endpoints
- [ ] Add export buttons to incident detail page
- [ ] Add batch export to incident list view
- [ ] Add download handling in frontend

---

## 4. Testing Strategy

```python
# tests/services/export/test_pdf_generator.py

async def test_export_single_incident():
    """Test PDF export for single incident."""
    exporter = IncidentPDFExporter()
    pdf_bytes = await exporter.export_incident(db, incident_id)

    assert pdf_bytes is not None
    assert pdf_bytes.getvalue().startswith(b'%PDF')

async def test_export_with_photos():
    """Test PDF includes reko photos."""
    # Test with include_photos=True
    # Verify photos embedded in PDF

async def test_export_batch():
    """Test batch PDF export."""
    # Export 3 incidents
    # Verify combined PDF has multiple pages
```

---

## 5. Future Enhancements

### 5.1 Digital Signatures
Implement proper digital signatures using asymmetric cryptography:

```python
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import rsa, padding

def sign_pdf(pdf_bytes: bytes, private_key) -> bytes:
    """Add cryptographic signature to PDF."""
    signature = private_key.sign(
        pdf_bytes,
        padding.PSS(
            mgf=padding.MGF1(hashes.SHA256()),
            salt_length=padding.PSS.MAX_LENGTH
        ),
        hashes.SHA256()
    )
    return signature
```

### 5.2 Automatic Archival
Schedule automatic export and archival of completed incidents:

```python
@router.post("/archive/event/{event_id}")
async def archive_event_automatically():
    """Export all incidents from event and archive."""
    # Export to PDF
    # Upload to S3/cloud storage
    # Update database archive status
```

### 5.3 Multi-Language Support
Generate reports in multiple languages (DE, EN, FR):

```python
def render_template(template_name: str, lang: str = "de"):
    i18n = load_translations(lang)
    return template.render(i18n=i18n, ...)
```

---

## Acceptance Criteria

✅ **Must Have:**
- [ ] Export single incident to PDF
- [ ] PDF includes incident details, status history, resources
- [ ] PDF includes reko reports and summaries
- [ ] Export button on incident detail page
- [ ] Batch export for multiple incidents
- [ ] Export to Excel for data analysis

🎯 **Should Have:**
- [ ] Professional PDF styling and layout
- [ ] Digital signature/hash for authenticity
- [ ] Include reko photos in PDF (optional toggle)
- [ ] Export filter: training vs live incidents

💡 **Nice to Have:**
- [ ] Cryptographic digital signatures
- [ ] Automatic archival to cloud storage
- [ ] Multi-language report generation
- [ ] Custom report templates
