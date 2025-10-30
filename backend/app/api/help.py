"""
Help Documentation API

Provides endpoints for help documentation, including PDF export.
"""

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from io import BytesIO
from pathlib import Path
from typing import List
import markdown
from app.auth.dependencies import CurrentUser

router = APIRouter(prefix="/help", tags=["help"])


@router.post("/export-pdf")
async def export_help_pdf(current_user: CurrentUser):
    """
    Export all help documentation as PDF.

    Combines all markdown files from frontend/content/help/ into a single PDF.
    """
    try:
        # Import PDF generation libraries
        try:
            from reportlab.lib.pagesizes import A4
            from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
            from reportlab.lib.units import inch
            from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle
            from reportlab.lib.enums import TA_LEFT, TA_CENTER
            from reportlab.lib import colors
        except ImportError:
            return {"error": "PDF generation requires reportlab package. Install with: uv add reportlab"}

        # Create PDF buffer
        buffer = BytesIO()
        doc = SimpleDocTemplate(
            buffer,
            pagesize=A4,
            rightMargin=inch,
            leftMargin=inch,
            topMargin=inch,
            bottomMargin=inch,
        )

        # Container for the 'Flowable' objects
        elements = []

        # Define styles
        styles = getSampleStyleSheet()
        title_style = ParagraphStyle(
            'CustomTitle',
            parent=styles['Heading1'],
            fontSize=24,
            textColor=colors.HexColor('#1a56db'),
            spaceAfter=30,
            alignment=TA_CENTER,
        )

        heading_style = ParagraphStyle(
            'CustomHeading',
            parent=styles['Heading2'],
            fontSize=16,
            textColor=colors.HexColor('#1a56db'),
            spaceAfter=12,
            spaceBefore=12,
        )

        # Title Page
        elements.append(Paragraph("KP Rück", title_style))
        elements.append(Paragraph("Hilfe & Dokumentation", title_style))
        elements.append(Spacer(1, 0.5*inch))
        elements.append(Paragraph("Umfassende Anleitung für die Einsatzverwaltung", styles['Normal']))
        elements.append(PageBreak())

        # Find all markdown files
        help_dir = Path(__file__).parent.parent.parent.parent / "frontend" / "content" / "help"

        if not help_dir.exists():
            return {"error": f"Help content directory not found: {help_dir}"}

        # Order of topics (updated 2025-10-30)
        topic_order = [
            'getting-started.md',           # 5-min intro - start here
            'online-offline-modes.md',      # Critical deployment modes guide
            'workflow.md',                  # Simplified workflow
            'kanban.md',                    # Kanban board features
            'map-combined.md',              # Map + combined view
            'events-management.md',         # Event management
            'training-mode.md',             # Training mode guide
            'check-in-reko.md',             # Check-in + reko merged
            'keyboard-shortcuts.md',        # Keyboard reference
        ]

        # Process each markdown file
        for md_filename in topic_order:
            md_file = help_dir / md_filename

            if not md_file.exists():
                continue

            with open(md_file, 'r', encoding='utf-8') as f:
                md_content = f.read()

            # Convert markdown to HTML
            html_content = markdown.markdown(md_content, extensions=['tables', 'fenced_code'])

            # Simple HTML to ReportLab conversion
            # This is a basic implementation - for production, consider using a proper HTML to PDF library
            lines = md_content.split('\n')

            for line in lines:
                line = line.strip()

                if not line:
                    elements.append(Spacer(1, 0.1*inch))
                    continue

                # Headers
                if line.startswith('# '):
                    elements.append(PageBreak())
                    elements.append(Paragraph(line[2:], heading_style))
                elif line.startswith('## '):
                    elements.append(Paragraph(line[3:], styles['Heading3']))
                elif line.startswith('### '):
                    elements.append(Paragraph(line[4:], styles['Heading4']))
                # Lists
                elif line.startswith('- ') or line.startswith('* '):
                    elements.append(Paragraph(f"• {line[2:]}", styles['Normal']))
                # Numbered lists
                elif len(line) > 2 and line[0].isdigit() and line[1:3] == '. ':
                    elements.append(Paragraph(line, styles['Normal']))
                # Code blocks (skip backticks)
                elif line.startswith('```'):
                    continue
                # Bold text (simplified)
                elif '**' in line:
                    clean_line = line.replace('**', '<b>').replace('**', '</b>')
                    elements.append(Paragraph(clean_line, styles['Normal']))
                # Regular text
                else:
                    # Skip image references for now
                    if not line.startswith('!['):
                        try:
                            elements.append(Paragraph(line, styles['Normal']))
                        except:
                            # Skip problematic lines
                            pass

        # Build PDF
        doc.build(elements)
        buffer.seek(0)

        return StreamingResponse(
            buffer,
            media_type="application/pdf",
            headers={
                "Content-Disposition": "attachment; filename=kprueck-hilfe.pdf",
                "Content-Type": "application/pdf",
            }
        )

    except Exception as e:
        return {"error": f"Failed to generate PDF: {str(e)}"}


@router.get("/topics")
async def get_help_topics():
    """
    Get list of available help topics.
    """
    topics = [
        {"id": "getting-started", "title": "Erste Schritte", "category": "Einführung"},
        {"id": "online-offline-modes", "title": "Online & Offline Modi", "category": "Einführung"},
        {"id": "workflow", "title": "Einsatz-Workflow", "category": "Workflow"},
        {"id": "kanban", "title": "Kanban-Board", "category": "Features"},
        {"id": "map-combined", "title": "Karten & Combined View", "category": "Features"},
        {"id": "events-management", "title": "Ereignis-Verwaltung", "category": "Features"},
        {"id": "training-mode", "title": "Training-Modus", "category": "Features"},
        {"id": "check-in-reko", "title": "Check-In & Reko", "category": "Mobile Features"},
        {"id": "keyboard-shortcuts", "title": "Tastaturkürzel", "category": "Referenz"},
    ]
    return {"topics": topics}
