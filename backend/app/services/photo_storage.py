"""Photo storage and processing service for Reko forms."""
import io
import os
import uuid
from pathlib import Path
from typing import Optional

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

    def _validate_file_extension(self, filename: str) -> None:
        """Validate file extension is allowed."""
        ext = Path(filename).suffix.lower()
        if ext not in self.allowed_extensions:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid file type. Allowed: {', '.join(self.allowed_extensions)}"
            )

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
        current_photos: list[str],
    ) -> str:
        """
        Save and compress photo for Reko report.

        Args:
            incident_id: Incident UUID
            file: Uploaded file
            current_photos: List of existing photo filenames

        Returns:
            Filename of saved photo (UUID.jpg)

        Raises:
            HTTPException: If validation fails or processing errors
        """
        # Validate photo count
        if len(current_photos) >= self.max_photos:
            raise HTTPException(
                status_code=400,
                detail=f"Maximum {self.max_photos} photos per report"
            )

        # Validate file extension
        if file.filename:
            self._validate_file_extension(file.filename)

        # Read file content
        content = await file.read()

        # Validate file size
        if len(content) > self.max_size_bytes:
            raise HTTPException(
                status_code=400,
                detail=f"File too large. Maximum size: {settings.max_photo_size_mb}MB"
            )

        # Process image
        try:
            image = Image.open(io.BytesIO(content))
            compressed_data = self._compress_image(image)
        except Exception as e:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid image file: {str(e)}"
            )

        # Generate unique filename (UUID + .jpg)
        filename = f"{uuid.uuid4()}.jpg"

        # Save to disk
        incident_dir = self._get_incident_dir(incident_id)
        file_path = incident_dir / filename

        with open(file_path, "wb") as f:
            f.write(compressed_data)

        return filename

    def get_photo_path(self, incident_id: uuid.UUID, filename: str) -> Optional[Path]:
        """
        Get full path to photo file.

        Args:
            incident_id: Incident UUID
            filename: Photo filename

        Returns:
            Path object if file exists, None otherwise
        """
        file_path = self.photos_dir / str(incident_id) / filename
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
