"""Photo storage and processing service for Reko forms."""
import io
import os
import uuid
from pathlib import Path
from typing import Optional

# Optional MIME type detection for enhanced security
try:
    import magic
    HAS_MAGIC = True
except ImportError:
    HAS_MAGIC = False

from PIL import Image
from fastapi import HTTPException, UploadFile

from ..config import get_settings

settings = get_settings()


class PhotoStorageService:
    """Service for managing Reko form photo uploads."""

    def __init__(self):
        """Initialize photo storage service."""
        self.photos_dir = Path(settings.photos_dir)
        self.max_size_bytes = settings.max_photo_size_mb * 1024 * 1024
        self.max_photos = settings.max_photos_per_report
        self.allowed_extensions = settings.allowed_photo_extensions

        # Compression settings
        self.max_width = 1920  # Max image width in pixels
        self.quality = 85  # JPEG quality (1-100)
        self.output_format = "JPEG"  # Convert all images to JPEG

    def _get_incident_dir(self, incident_id: uuid.UUID) -> Path:
        """Get photo directory for incident (creates if needed)."""
        incident_dir = self.photos_dir / str(incident_id)
        incident_dir.mkdir(parents=True, exist_ok=True)
        return incident_dir

    def _validate_file_type(self, content: bytes, filename: Optional[str] = None) -> None:
        """
        Validate file type using both extension and MIME type magic bytes.

        Security: Prevents malicious files disguised with fake extensions.
        """
        # Check extension if filename provided
        if filename:
            ext = Path(filename).suffix.lower()
            if ext not in self.allowed_extensions:
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid file extension. Allowed: {', '.join(self.allowed_extensions)}"
                )

        # Check actual file content using magic bytes if available
        if HAS_MAGIC:
            try:
                mime = magic.from_buffer(content, mime=True)
                allowed_mimes = {
                    'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
                    'application/octet-stream'  # Some browsers send this for images
                }

                if mime and mime not in allowed_mimes:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Invalid file type detected: {mime}. Only image files are allowed."
                    )
            except Exception:
                # Fall back to PIL validation if magic fails
                pass

        # Always validate with PIL as final check
        try:
            img = Image.open(io.BytesIO(content))
            img.verify()  # Verify it's a valid image
        except Exception:
            raise HTTPException(
                status_code=400,
                detail="Invalid or corrupted image file"
            )

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
        pass

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
        current_photos: Optional[list[str]],
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
            raise HTTPException(
                status_code=400,
                detail=f"Maximum {self.max_photos} photos per report"
            )

        # Read file content first (needed for all validations)
        content = await file.read()

        # Validate file size
        if len(content) > self.max_size_bytes:
            raise HTTPException(
                status_code=400,
                detail=f"File too large. Maximum size: {settings.max_photo_size_mb}MB"
            )

        # Validate file type (extension + MIME type)
        self._validate_file_type(content, file.filename)

        # Scan for malware (placeholder for production integration)
        self._scan_for_malware(content)

        # Process image
        try:
            image = Image.open(io.BytesIO(content))
            compressed_data = self._compress_image(image)
        except Exception as e:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid image file: {str(e)}"
            )

        # Generate safe, unique filename (always use UUID to prevent attacks)
        filename = self._sanitize_filename(file.filename or "photo.jpg")

        # Save to disk
        incident_dir = self._get_incident_dir(incident_id)
        file_path = incident_dir / filename

        with open(file_path, "wb") as f:
            f.write(compressed_data)

        return filename

    def get_photo_path(self, incident_id: uuid.UUID, filename: str) -> Optional[Path]:
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
            raise HTTPException(
                status_code=400,
                detail="Invalid filename: path traversal sequences not allowed"
            )

        # Ensure filename matches expected pattern (UUID.jpg)
        if not re.match(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$', filename):
            raise HTTPException(
                status_code=400,
                detail="Invalid filename format: must be UUID.jpg"
            )

        file_path = self.photos_dir / str(incident_id) / filename

        # Ensure resolved path is within photos_dir (prevents traversal)
        try:
            if not file_path.resolve().is_relative_to(self.photos_dir.resolve()):
                raise HTTPException(
                    status_code=400,
                    detail="Path traversal detected"
                )
        except ValueError:
            # is_relative_to() raises ValueError if paths are on different drives
            raise HTTPException(
                status_code=400,
                detail="Invalid path"
            )

        return file_path if file_path.exists() else None

    def delete_photo(self, incident_id: uuid.UUID, filename: str) -> bool:
        """
        Delete photo file from disk.

        Args:
            incident_id: Incident UUID
            filename: Photo filename

        Returns:
            True if deleted, False if file didn't exist
        """
        file_path = self.photos_dir / str(incident_id) / filename

        if file_path.exists():
            file_path.unlink()

            # Clean up empty incident directory
            incident_dir = file_path.parent
            if incident_dir.is_dir() and not any(incident_dir.iterdir()):
                incident_dir.rmdir()

            return True

        return False


# Singleton instance
photo_storage = PhotoStorageService()
