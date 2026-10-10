"""Photo storage and processing service for Reko forms."""

import asyncio
import io
import logging
import os
import shutil
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import NamedTuple

# Optional MIME type detection for enhanced security
try:
    import magic

    HAS_MAGIC = True
except ImportError:
    HAS_MAGIC = False

from fastapi import HTTPException, UploadFile
from PIL import Image

from ..config import get_settings
from ..utils.error_codes import CodedHTTPException, ErrorCode
from ..utils.errors import ErrorMessages

logger = logging.getLogger(__name__)

#: Upload read granularity. Small enough that an oversized body is rejected long before it
#: could matter, large enough not to add syscalls to a normal phone photo.
_UPLOAD_CHUNK_BYTES = 64 * 1024

#: Hard bound on decoded image DIMENSIONS, independent of file size.
#:
#: The byte-size limit alone does not protect memory: PNG/WebP compress uniform data extremely
#: well, so a perfectly legal 5 MB file can declare 40000×40000 pixels and expand to several
#: hundred megabytes the moment PIL decodes it — a "decompression bomb". Pillow has a built-in
#: guard for exactly this, but the default (~178 Mpx) is a warning threshold rather than a
#: refusal, and the code below caps only WIDTH, which is applied after the decode has already
#: happened. 50 Mpx comfortably clears any real camera (a 48 MP phone is ~48 Mpx) while keeping
#: the worst case bounded well under the container's 1 GB.
#:
#: The two checks below compare against THIS constant, never against
#: `Image.MAX_IMAGE_PIXELS`. Pillow's guard is a module-level global that any other import can
#: reassign — including to `None`, which disables it outright — so a security check must not
#: read it back out. (It is also typed `int | None`, which is what surfaced the coupling.)
#: Pillow's copy is kept in step so its own warning fires at the same threshold.
MAX_IMAGE_PIXELS = 50_000_000
Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS

settings = get_settings()

#: Byte cap for a single photo embedded in a PDF export. ReportLab embeds the ORIGINAL
#: file bytes regardless of the drawn size, so an oversized file would balloon the
#: document. The upload pipeline recompresses everything to ≤1920px JPEG, which lands
#: far below this — the cap only catches files that reached the directory some other way.
MAX_EXPORT_PHOTO_BYTES = 10 * 1024 * 1024


class ExportPhoto(NamedTuple):
    """One stored photo resolved for a PDF export.

    ``data`` carries the JPEG bytes when the file was readable; otherwise it is
    ``None`` and ``note`` says why, in the report's language (German). A photo
    problem costs the export one image, never the document.
    """

    source: str  # caption prefix: "Reko" or "Rapport"
    filename: str
    data: bytes | None
    note: str | None
    taken_at: datetime | None  # file mtime = upload time; None when unknown


class PhotoCopyError(Exception):
    """A photo could not be copied to another incident's folder (a merge, R2)."""


class PhotoStorageService:
    """Service for managing Reko form photo uploads."""

    def __init__(self) -> None:
        """Initialize photo storage service."""
        self.photos_dir = Path(settings.photos_dir)
        self.max_size_bytes = settings.max_photo_size_mb * 1024 * 1024
        self.max_photos = settings.max_photos_per_report
        self.allowed_extensions = settings.allowed_photo_extensions

        # Compression settings
        self.max_width = 1920  # Max image width in pixels
        self.quality = 85  # JPEG quality (1-100)
        self.output_format = "JPEG"  # Convert all images to JPEG

    def _inside_photos_dir(self, *parts: str) -> Path:
        """Join ``parts`` under photos_dir and refuse anything that resolves outside it.

        Written as realpath + prefix check on purpose: it is the containment test CodeQL's
        path-injection query recognises, so the analysis sees the same guard a reader does
        (a ``Path.resolve().is_relative_to()`` check was equally correct, but invisible to it
        and kept eight alerts open). The trailing separator stops ``/photos-evil`` from
        passing as ``/photos``.
        """
        base = os.path.realpath(self.photos_dir)
        full = os.path.realpath(os.path.join(base, *parts))
        if not full.startswith(base + os.sep):
            raise HTTPException(status_code=400, detail="Path traversal detected")
        return Path(full)

    def _get_incident_dir(self, incident_id: uuid.UUID) -> Path:
        """Get photo directory for incident (creates if needed)."""
        incident_dir = self._inside_photos_dir(str(incident_id))
        incident_dir.mkdir(parents=True, exist_ok=True)
        return incident_dir

    def _validate_file_type(self, content: bytes, filename: str | None = None) -> None:
        """
        Validate file type using both extension and MIME type magic bytes.

        Security: Prevents malicious files disguised with fake extensions.
        """
        # Check extension if filename provided
        if filename:
            ext = Path(filename).suffix.lower()
            if ext not in self.allowed_extensions:
                raise CodedHTTPException(
                    400,
                    ErrorCode.PHOTO_INVALID_EXTENSION,
                    f"Invalid file extension. Allowed: {', '.join(self.allowed_extensions)}",
                    # The configured list, not a hard-coded one: the sentence names what
                    # this station actually accepts («JPG, JPEG, PNG, WEBP»).
                    params={"allowed": ", ".join(e.lstrip(".").upper() for e in self.allowed_extensions)},
                )

        # Check actual file content using magic bytes if available
        if HAS_MAGIC:
            # Only the magic call is guarded. It used to be the whole block, including the
            # raise — and since HTTPException IS an Exception, the `except` swallowed the
            # very rejection this check exists to make: no file was ever turned away here.
            try:
                mime = magic.from_buffer(content, mime=True)
            except Exception:  # libmagic missing/unhappy → fall back to the PIL check below
                mime = None

            allowed_mimes = {
                "image/jpeg",
                "image/jpg",
                "image/png",
                "image/webp",
                "application/octet-stream",  # Some browsers send this for images
            }
            if mime and mime not in allowed_mimes:
                raise CodedHTTPException(
                    400,
                    ErrorCode.PHOTO_INVALID_TYPE,
                    f"Invalid file type detected: {mime}. Only image files are allowed.",
                )

        # Validate PIL can open the file (don't use verify() — it's overly strict
        # and rejects images that PIL can otherwise process fine, e.g. some HEIC
        # conversions). The actual processing in save_photo() catches truly broken files.
        try:
            img = Image.open(io.BytesIO(content))
        except Image.DecompressionBombError as e:
            # Pillow's own guard, raised at open() beyond 2x MAX_IMAGE_PIXELS. "Too large" is
            # actionable; the generic "corrupted image" below would send the operator looking
            # for a fault in their camera.
            logger.warning("Rejected decompression bomb at open: %s", e)
            raise CodedHTTPException(413, ErrorCode.PHOTO_TOO_MANY_PIXELS, "Bild zu gross (Pixelmasse).") from None
        except Exception:
            raise CodedHTTPException(400, ErrorCode.PHOTO_INVALID, "Invalid or corrupted image file") from None

        # Dimensions BEFORE the decode below. `Image.open` only parses the header, so this is
        # the last cheap moment: `img.load()` allocates the full bitmap, and a file that is
        # small on disk can be enormous in memory — 20000x20000 is ~1.6 GB against a 1 GB
        # container limit. Pillow's own guard does not cover the 1x-2x band (it merely warns
        # and decodes anyway), which is precisely the range that fits in a legal-looking file.
        pixels = img.size[0] * img.size[1]
        if pixels > MAX_IMAGE_PIXELS:
            logger.warning("Rejected oversized image: %dx%d", img.size[0], img.size[1])
            raise CodedHTTPException(
                413, ErrorCode.PHOTO_TOO_MANY_PIXELS, f"Bild zu gross ({img.size[0]}×{img.size[1]} Pixel)."
            )

        try:
            img.load()  # Force decode to confirm it's a real image
        except Exception:
            raise CodedHTTPException(400, ErrorCode.PHOTO_INVALID, "Invalid or corrupted image file") from None

    def _sanitize_filename(self, filename: str) -> str:
        """
        Sanitize filename to prevent security issues.

        Returns a safe UUID-based filename.
        """
        # Always generate a new safe filename regardless of input
        # This prevents any path traversal or malicious filename attempts
        return f"{uuid.uuid4()}.jpg"

    def _scan_for_malware(self, content: bytes) -> None:
        """
        Hook for virus/malware scanning.

        Currently a placeholder - integrate with ClamAV or similar in production.
        """
        # TODO: Integrate with virus scanning service in production
        # Example: pyclamd.scan_stream(content)

    def _compress_image(self, image: Image.Image) -> bytes:
        """
        Compress and resize image.

        Converts to RGB, resizes if needed, and compresses to JPEG.

        Args:
            image: PIL Image object

        Returns:
            Compressed image bytes
        """
        # Convert to RGB (handles RGBA, grayscale, etc.)
        if image.mode in ("RGBA", "LA", "P"):
            # Create white background for transparency
            background = Image.new("RGB", image.size, (255, 255, 255))
            if image.mode == "P":
                image = image.convert("RGBA")
            background.paste(image, mask=image.split()[-1] if image.mode in ("RGBA", "LA") else None)
            image = background
        elif image.mode != "RGB":
            image = image.convert("RGB")

        # Resize if too large (maintain aspect ratio)
        if image.width > self.max_width:
            ratio = self.max_width / image.width
            new_height = int(image.height * ratio)
            image = image.resize((self.max_width, new_height), Image.Resampling.LANCZOS)

        # Compress to JPEG
        output = io.BytesIO()
        image.save(output, format=self.output_format, quality=self.quality, optimize=True)
        return output.getvalue()

    async def save_photo(
        self,
        incident_id: uuid.UUID,
        file: UploadFile,
        current_photos: list[str] | None,
    ) -> str:
        """
        Save and compress photo for Reko report.

        Args:
            incident_id: Incident UUID
            file: Uploaded file
            current_photos: List of existing photo filenames (or None if empty)

        Returns:
            Filename of saved photo (UUID.jpg)

        Raises:
            HTTPException: If validation fails or processing errors
        """
        # Validate photo count
        photo_count = len(current_photos) if current_photos else 0
        if photo_count >= self.max_photos:
            raise CodedHTTPException(
                400,
                ErrorCode.PHOTO_LIMIT,
                f"Maximum {self.max_photos} photos per report",
                params={"max": self.max_photos},
            )

        # Read in chunks and stop as soon as the limit is exceeded — 413 Payload Too Large is
        # the semantic match per RFC 9110.
        #
        # This used to be a single `await file.read()` followed by a length check, which meant
        # the limit was enforced only AFTER the entire body was already in memory: a 500 MB
        # upload was faithfully buffered in full and then politely rejected. Against the 1 GB
        # container limit that is an OOM, and an OOM takes the board down for everyone, not
        # just the uploader.
        chunks: list[bytes] = []
        total = 0
        while True:
            chunk = await file.read(_UPLOAD_CHUNK_BYTES)
            if not chunk:
                break
            total += len(chunk)
            if total > self.max_size_bytes:
                raise CodedHTTPException(
                    413,
                    ErrorCode.PHOTO_TOO_LARGE,
                    f"File too large. Maximum size: {settings.max_photo_size_mb}MB",
                    params={"max_mb": settings.max_photo_size_mb},
                )
            chunks.append(chunk)
        content = b"".join(chunks)

        # Generate safe, unique filename (always use UUID to prevent attacks)
        filename = self._sanitize_filename(file.filename or "photo.jpg")
        incident_dir = self._get_incident_dir(incident_id)
        file_path = incident_dir / filename

        # PIL decode/resize/encode of a multi-MB phone photo blocks the event
        # loop for seconds — freezing every operator request and WebSocket
        # ping. Run validation + compression + disk write in a worker thread
        # (same pattern as the PDF report). HTTPExceptions raised inside the
        # thread propagate normally.
        return await asyncio.to_thread(self._process_and_store, content, file.filename, file_path, filename)

    def _process_and_store(self, content: bytes, original_filename: str | None, file_path: Path, filename: str) -> str:
        """Blocking part of save_photo — must run off the event loop."""
        # Validate file type (extension + MIME type)
        self._validate_file_type(content, original_filename)

        # Scan for malware (placeholder for production integration)
        self._scan_for_malware(content)

        # Process image
        try:
            image = Image.open(io.BytesIO(content))
            # `Image.open` only parses the header, so the declared dimensions are known here
            # BEFORE any pixel data is decoded. Checking now is what makes the bomb cheap to
            # refuse; Pillow's own MAX_IMAGE_PIXELS only *warns* between 1× and 2× the limit,
            # and by the time it raises, the allocation has been attempted.
            pixels = image.size[0] * image.size[1]
            if pixels > MAX_IMAGE_PIXELS:
                logger.warning("Rejected oversized image: %dx%d", image.size[0], image.size[1])
                raise CodedHTTPException(
                    413, ErrorCode.PHOTO_TOO_MANY_PIXELS, f"Bild zu gross ({image.size[0]}×{image.size[1]} Pixel)."
                )
            compressed_data = self._compress_image(image)
        except HTTPException:
            raise  # our own 413 — must not be reclassified as a malformed file below
        except Image.DecompressionBombError as e:
            # Pillow's own guard, which fires at >2x MAX_IMAGE_PIXELS during open(). Same
            # situation as the explicit check above, so it gets the same answer: "too large"
            # is actionable, "corrupted file" would send the operator looking for a problem
            # with their camera. The explicit check still earns its place — between 1x and 2x
            # Pillow only warns and decodes anyway.
            logger.warning("Rejected decompression bomb: %s", e)
            raise CodedHTTPException(413, ErrorCode.PHOTO_TOO_MANY_PIXELS, "Bild zu gross (Pixelmasse).") from e
        except Exception as e:
            logger.warning("Failed to process image: %s", e)
            raise CodedHTTPException(400, ErrorCode.PHOTO_INVALID, ErrorMessages.INVALID_FILE) from e

        with open(file_path, "wb") as f:
            f.write(compressed_data)

        return filename

    def copy_photos(self, from_incident_id: uuid.UUID, to_incident_id: uuid.UUID, filenames: list[str]) -> int:
        """Copy photo files from one incident's directory to another's (a merge, R2).

        COPY, never move: the database half of a merge can still roll back, and a
        photo that exists twice costs a few hundred KB while one that exists
        nowhere costs the record. Files already there are left alone; a missing
        source is skipped (and logged) — the row keeps its filename either way.
        Returns how many files were copied. A file that could not be written
        raises ``PhotoCopyError`` — the merge then rolls back rather than leaving
        a report whose photos exist only on the hidden card (R2 review).
        """
        copied = 0
        for name in filenames:
            if not isinstance(name, str) or not name:
                continue
            try:
                source = self._inside_photos_dir(str(from_incident_id), name)
                if not source.is_file():
                    logger.warning("Photo %s of incident %s missing; not copied", name, from_incident_id)
                    continue
                target_dir = self._get_incident_dir(to_incident_id)
                target = self._inside_photos_dir(str(to_incident_id), name)
                if target.exists():
                    continue
                shutil.copy2(source, target_dir / target.name)
                copied += 1
            except (OSError, HTTPException) as exc:
                logger.exception("Could not copy photo %s from %s to %s", name, from_incident_id, to_incident_id)
                raise PhotoCopyError(name) from exc
        return copied

    def get_photo_path(self, incident_id: uuid.UUID, filename: str) -> Path | None:
        """
        Get full path to photo file with path traversal protection.

        SECURITY: Validates filename to prevent directory traversal attacks.

        Args:
            incident_id: Incident UUID
            filename: Photo filename

        Returns:
            Path object if file exists, None otherwise

        Raises:
            HTTPException: If filename contains path traversal sequences
        """
        import re

        # Validate filename doesn't contain path traversal sequences
        if "/" in filename or "\\" in filename or ".." in filename:
            raise HTTPException(status_code=400, detail="Invalid filename: path traversal sequences not allowed")

        # Ensure filename matches expected pattern (UUID.jpg)
        if not re.match(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$", filename):
            raise HTTPException(status_code=400, detail="Invalid filename format: must be UUID.jpg")

        # Ensure the resolved path is within photos_dir (prevents traversal)
        file_path = self._inside_photos_dir(str(incident_id), filename)

        return file_path if file_path.exists() else None

    def load_export_photo(self, incident_id: uuid.UUID, filename: str, source: str) -> ExportPhoto:
        """Resolve one stored photo for a PDF export (blocking — run off the event loop).

        Never raises: a missing, unreadable or oversized file comes back as an
        :class:`ExportPhoto` whose ``note`` explains the gap, so the exports can
        print a small line instead of failing.
        """
        try:
            path = self.get_photo_path(incident_id, filename)
        except HTTPException:
            # A filename that fails the UUID.jpg / traversal checks cannot be a stored
            # photo of ours — for an export that is the same situation as a missing file.
            path = None
        if path is None:
            return ExportPhoto(source, filename, None, f"Foto fehlt: {filename}", None)
        try:
            stat = path.stat()
            if stat.st_size > MAX_EXPORT_PHOTO_BYTES:
                return ExportPhoto(source, filename, None, f"Foto zu gross für Export: {filename}", None)
            taken_at = datetime.fromtimestamp(stat.st_mtime, tz=UTC)
            return ExportPhoto(source, filename, path.read_bytes(), None, taken_at)
        except OSError:
            return ExportPhoto(source, filename, None, f"Foto fehlt: {filename}", None)

    def delete_photo(self, incident_id: uuid.UUID, filename: str) -> bool:
        """
        Delete photo file from disk.

        Args:
            incident_id: Incident UUID
            filename: Photo filename

        Returns:
            True if deleted, False if file didn't exist
        """
        file_path = self.get_photo_path(incident_id, filename)

        if file_path is not None:
            file_path.unlink()

            # Clean up empty incident directory
            incident_dir = file_path.parent
            if incident_dir.is_dir() and not any(incident_dir.iterdir()):
                incident_dir.rmdir()

            return True

        return False


# Singleton instance
photo_storage = PhotoStorageService()
