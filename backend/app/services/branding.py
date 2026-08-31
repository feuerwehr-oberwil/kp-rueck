"""Station branding — the logo that heads the printed exports.

One image per installation, uploaded in Einstellungen → Allgemein and rendered as a
letterhead on the Einsatzrapport. Deliberately **not** a file on disk: the reference
deployment runs the backend from an image with no persistent volume (Railway, and a
recreated compose container), so a logo written next to the code would quietly vanish
on the next deploy and the report would silently lose its letterhead. The settings
table is already the thing that survives a redeploy, so the logo lives there —
base64-encoded PNG, capped hard enough that a Text column is the right size for it.

Everything is normalised to PNG on the way in (:func:`normalize_logo`), which is what
lets the read path stay dumb: whatever a brigade uploads, ReportLab gets a PNG of
known dimensions and the PDF builder never has to guess a format.

SVG is *not* accepted — ReportLab cannot read it and this backend has no rasteriser
(kp-front borrows Kroki's; there is nothing equivalent here). The upload rejects it
with that reason rather than storing something no export could ever draw.
"""

import base64
import binascii
from io import BytesIO
from uuid import UUID

from fastapi import HTTPException, status
from PIL import Image, UnidentifiedImageError
from sqlalchemy.ext.asyncio import AsyncSession

from ..logging_config import get_logger
from .settings import get_setting, update_setting

logger = get_logger(__name__)

#: Settings key holding the base64-encoded PNG. Hidden from ``GET /api/settings``
#: (see ``BLOB_SETTING_KEYS``) — a ~100 KB blob has no business riding along in a
#: dict the frontend re-fetches on every settings visit.
LOGO_SETTING_KEY = "branding.report_logo"

#: Largest upload accepted, before decoding. Generous for a crest scan; small enough
#: that a mistaken 40-megapixel photo is refused rather than resized.
MAX_UPLOAD_BYTES = 5 * 1024 * 1024

#: Hard bound on decoded pixel count, independent of file size — a PNG of uniform
#: colour compresses so well that a legal 2 MB file can declare 30000×30000 and
#: expand to gigabytes the moment PIL decodes it. Same reasoning (and same order of
#: magnitude) as ``photo_storage.MAX_IMAGE_PIXELS``.
MAX_IMAGE_PIXELS = 50_000_000

#: Stored size. The logo is drawn ~45 mm wide at ~200 dpi, so 900 px of width is
#: already more than the PDF can use; storing the original would put megabytes into
#: a settings row for no visible gain.
MAX_STORED_PX = (900, 450)

ALLOWED_CONTENT_TYPES = frozenset({"image/png", "image/jpeg", "image/webp"})

_INVALID_IMAGE = "Ungültiges Bild – erlaubt sind PNG, JPEG oder WebP."
_SVG_UNSUPPORTED = "SVG wird nicht unterstützt – bitte ein PNG, JPEG oder WebP hochladen."
_TOO_LARGE = f"Datei zu gross – maximal {MAX_UPLOAD_BYTES // (1024 * 1024)} MB."


def _looks_like_svg(raw: bytes) -> bool:
    """SVG detection on the raw bytes, so the error can name the actual problem."""
    head = raw[:512].lstrip()
    return head.startswith((b"<?xml", b"<svg")) and b"<svg" in raw[:2048]


def normalize_logo(raw: bytes, content_type: str | None = None) -> bytes:
    """Validate an uploaded image and return it as a bounded PNG.

    Raises :class:`HTTPException` (400/413) with a German message for anything that
    is not a decodable raster image within the limits. SVG is checked before the
    content type so the message names the real problem — "SVG wird nicht unterstützt"
    tells somebody what to do next; "erlaubt sind PNG, JPEG oder WebP" leaves them
    wondering whether their file is broken.
    """
    if not raw:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=_INVALID_IMAGE)
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail=_TOO_LARGE)
    if _looks_like_svg(raw) or (content_type or "").startswith("image/svg"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=_SVG_UNSUPPORTED)
    if content_type and content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Erlaubt sind PNG, JPEG oder WebP.")

    try:
        with Image.open(BytesIO(raw)) as img:
            if img.width * img.height > MAX_IMAGE_PIXELS:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=_INVALID_IMAGE)
            # Transparency is the point for a crest on white paper, so RGBA is kept.
            # Converting yields a new Image rather than the opened ImageFile, so it gets
            # its own name — rebinding `img` is what the type checker objects to.
            normalized = img.convert("RGBA") if img.mode in ("RGBA", "LA", "P") else img.convert("RGB")
            normalized.thumbnail(MAX_STORED_PX, Image.Resampling.LANCZOS)
            out = BytesIO()
            normalized.save(out, "PNG", optimize=True)
    except HTTPException:
        raise
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=_INVALID_IMAGE) from exc

    return out.getvalue()


async def get_report_logo(db: AsyncSession) -> bytes | None:
    """The stored logo as PNG bytes, or ``None`` when the station has not set one.

    Never raises: a settings row that somehow holds unreadable base64 costs the
    report its letterhead, not its existence.
    """
    stored = await get_setting(db, LOGO_SETTING_KEY)
    if not stored:
        return None
    try:
        return base64.b64decode(stored, validate=True)
    except (binascii.Error, ValueError):
        logger.warning("Report-Logo ist nicht dekodierbar — Export wird ohne Logo erstellt.")
        return None


async def store_report_logo(db: AsyncSession, raw: bytes, user_id: UUID | None, content_type: str | None = None) -> int:
    """Normalise and store an uploaded logo. Returns the stored byte size."""
    png = normalize_logo(raw, content_type)
    await update_setting(db, LOGO_SETTING_KEY, base64.b64encode(png).decode("ascii"), user_id)
    return len(png)


async def clear_report_logo(db: AsyncSession, user_id: UUID | None) -> None:
    """Remove the logo (stores an empty value — the key stays a known settings key)."""
    await update_setting(db, LOGO_SETTING_KEY, "", user_id)
