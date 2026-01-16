"""Tests for photo storage service."""

import io
import uuid

import pytest
from fastapi import HTTPException
from PIL import Image

from app.config import Settings, get_settings
from app.services.photo_storage import PhotoStorageService


@pytest.fixture
def temp_photos_dir(tmp_path):
    """Create a temporary photos directory for testing."""
    photos_dir = tmp_path / "test_photos"
    photos_dir.mkdir()
    return photos_dir


@pytest.fixture
def photo_service(temp_photos_dir, monkeypatch):
    """Create a photo storage service with temporary directory."""
    # Mock settings to use temp directory
    settings = get_settings()
    monkeypatch.setattr(settings, "photos_dir", str(temp_photos_dir))

    service = PhotoStorageService()
    service.photos_dir = temp_photos_dir
    return service


def create_test_image(width=1000, height=1000, format="RGB", mode="JPEG"):
    """Create a test image in memory."""
    img = Image.new(format, (width, height), color="red")
    img_bytes = io.BytesIO()
    img.save(img_bytes, format=mode)
    img_bytes.seek(0)
    return img_bytes


@pytest.fixture
def upload_file_jpg():
    """Create a test JPEG upload file."""
    img_bytes = create_test_image()

    class MockUploadFile:
        def __init__(self, content):
            self.content = content
            self.filename = "test.jpg"

        async def read(self):
            return self.content.read()

    return MockUploadFile(img_bytes)


@pytest.fixture
def upload_file_png():
    """Create a test PNG upload file."""
    img = Image.new("RGBA", (1000, 1000), color=(255, 0, 0, 128))
    img_bytes = io.BytesIO()
    img.save(img_bytes, format="PNG")
    img_bytes.seek(0)

    class MockUploadFile:
        def __init__(self, content):
            self.content = content
            self.filename = "test.png"

        async def read(self):
            return self.content.read()

    return MockUploadFile(img_bytes)


class TestPhotoStorageService:
    """Test photo storage service functionality."""

    def test_init(self, photo_service, temp_photos_dir):
        """Test service initialization."""
        assert photo_service.photos_dir == temp_photos_dir
        assert photo_service.max_size_bytes == 10 * 1024 * 1024  # 10MB
        assert photo_service.max_photos == 20
        assert photo_service.max_width == 1920
        assert photo_service.quality == 85
        assert photo_service.output_format == "JPEG"

    def test_get_incident_dir_creates_directory(self, photo_service, temp_photos_dir):
        """Test that incident directory is created if it doesn't exist."""
        incident_id = uuid.uuid4()
        incident_dir = photo_service._get_incident_dir(incident_id)

        expected_dir = temp_photos_dir / str(incident_id)
        assert incident_dir == expected_dir
        assert incident_dir.exists()
        assert incident_dir.is_dir()

    def test_get_incident_dir_existing_directory(self, photo_service, temp_photos_dir):
        """Test that existing incident directory is returned."""
        incident_id = uuid.uuid4()
        expected_dir = temp_photos_dir / str(incident_id)
        expected_dir.mkdir()

        incident_dir = photo_service._get_incident_dir(incident_id)
        assert incident_dir == expected_dir

    def test_validate_file_extension_valid(self, photo_service):
        """Test validation of valid file extensions."""
        for ext in [".jpg", ".jpeg", ".png", ".webp"]:
            photo_service._validate_file_extension(f"test{ext}")
            photo_service._validate_file_extension(f"TEST{ext.upper()}")  # Case insensitive

    def test_validate_file_extension_invalid(self, photo_service):
        """Test validation of invalid file extensions."""
        with pytest.raises(HTTPException) as exc_info:
            photo_service._validate_file_extension("test.gif")

        assert exc_info.value.status_code == 400
        assert "Invalid file type" in exc_info.value.detail

    def test_compress_image_rgb(self, photo_service):
        """Test image compression for RGB images."""
        img = Image.new("RGB", (2000, 1500), color="blue")
        compressed = photo_service._compress_image(img)

        # Verify compressed image
        compressed_img = Image.open(io.BytesIO(compressed))
        assert compressed_img.mode == "RGB"
        assert compressed_img.width == photo_service.max_width  # Resized to max_width
        assert compressed_img.height == int(1500 * (1920 / 2000))  # Aspect ratio preserved
        assert compressed_img.format == "JPEG"

    def test_compress_image_rgba_transparency(self, photo_service):
        """Test image compression for RGBA images with transparency."""
        img = Image.new("RGBA", (1000, 1000), color=(255, 0, 0, 128))
        compressed = photo_service._compress_image(img)

        # Verify converted to RGB with white background
        compressed_img = Image.open(io.BytesIO(compressed))
        assert compressed_img.mode == "RGB"
        assert compressed_img.format == "JPEG"

    def test_compress_image_grayscale(self, photo_service):
        """Test image compression for grayscale images."""
        img = Image.new("L", (1000, 1000), color=128)
        compressed = photo_service._compress_image(img)

        # Verify converted to RGB
        compressed_img = Image.open(io.BytesIO(compressed))
        assert compressed_img.mode == "RGB"
        assert compressed_img.format == "JPEG"

    def test_compress_image_no_resize_needed(self, photo_service):
        """Test compression when image is already smaller than max width."""
        img = Image.new("RGB", (800, 600), color="green")
        compressed = photo_service._compress_image(img)

        # Verify no resize occurred
        compressed_img = Image.open(io.BytesIO(compressed))
        assert compressed_img.width == 800
        assert compressed_img.height == 600

    @pytest.mark.asyncio
    async def test_save_photo_success(self, photo_service, upload_file_jpg, temp_photos_dir):
        """Test successful photo save."""
        incident_id = uuid.uuid4()
        current_photos = []

        filename = await photo_service.save_photo(incident_id, upload_file_jpg, current_photos)

        # Verify filename format (UUID.jpg)
        assert filename.endswith(".jpg")
        assert len(filename) == 40  # 36 chars UUID + 4 chars ".jpg"

        # Verify file exists
        incident_dir = temp_photos_dir / str(incident_id)
        file_path = incident_dir / filename
        assert file_path.exists()

        # Verify file is a valid JPEG
        img = Image.open(file_path)
        assert img.format == "JPEG"

    @pytest.mark.asyncio
    async def test_save_photo_png_converted_to_jpeg(self, photo_service, upload_file_png, temp_photos_dir):
        """Test that PNG is converted to JPEG."""
        incident_id = uuid.uuid4()
        current_photos = []

        filename = await photo_service.save_photo(incident_id, upload_file_png, current_photos)

        # Verify saved as JPEG
        assert filename.endswith(".jpg")

        incident_dir = temp_photos_dir / str(incident_id)
        file_path = incident_dir / filename
        img = Image.open(file_path)
        assert img.format == "JPEG"

    @pytest.mark.asyncio
    async def test_save_photo_max_photos_exceeded(self, photo_service, upload_file_jpg):
        """Test error when maximum photos per report is exceeded."""
        incident_id = uuid.uuid4()
        current_photos = [f"{uuid.uuid4()}.jpg" for _ in range(20)]

        with pytest.raises(HTTPException) as exc_info:
            await photo_service.save_photo(incident_id, upload_file_jpg, current_photos)

        assert exc_info.value.status_code == 400
        assert "Maximum" in exc_info.value.detail
        assert "20 photos" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_save_photo_invalid_extension(self, photo_service):
        """Test error with invalid file extension."""
        incident_id = uuid.uuid4()

        class MockUploadFile:
            filename = "test.gif"

            async def read(self):
                return b"fake data"

        with pytest.raises(HTTPException) as exc_info:
            await photo_service.save_photo(incident_id, MockUploadFile(), [])

        assert exc_info.value.status_code == 400
        assert "Invalid file type" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_save_photo_file_too_large(self, photo_service):
        """Test error when file size exceeds maximum."""
        incident_id = uuid.uuid4()

        # Create file larger than 10MB
        large_content = b"x" * (11 * 1024 * 1024)

        class MockUploadFile:
            filename = "test.jpg"

            async def read(self):
                return large_content

        with pytest.raises(HTTPException) as exc_info:
            await photo_service.save_photo(incident_id, MockUploadFile(), [])

        assert exc_info.value.status_code == 400
        assert "too large" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_save_photo_invalid_image(self, photo_service):
        """Test error with invalid image data."""
        incident_id = uuid.uuid4()

        class MockUploadFile:
            filename = "test.jpg"

            async def read(self):
                return b"not an image"

        with pytest.raises(HTTPException) as exc_info:
            await photo_service.save_photo(incident_id, MockUploadFile(), [])

        assert exc_info.value.status_code == 400
        assert "Invalid image" in exc_info.value.detail

    def test_get_photo_path_exists(self, photo_service, temp_photos_dir):
        """Test getting path to existing photo."""
        incident_id = uuid.uuid4()
        filename = "test.jpg"

        # Create photo file
        incident_dir = temp_photos_dir / str(incident_id)
        incident_dir.mkdir()
        file_path = incident_dir / filename
        file_path.write_bytes(b"fake photo data")

        # Get path
        result = photo_service.get_photo_path(incident_id, filename)
        assert result == file_path
        assert result.exists()

    def test_get_photo_path_not_exists(self, photo_service):
        """Test getting path to non-existent photo."""
        incident_id = uuid.uuid4()
        filename = "nonexistent.jpg"

        result = photo_service.get_photo_path(incident_id, filename)
        assert result is None

    def test_delete_photo_success(self, photo_service, temp_photos_dir):
        """Test successful photo deletion."""
        incident_id = uuid.uuid4()
        filename = "test.jpg"

        # Create photo file
        incident_dir = temp_photos_dir / str(incident_id)
        incident_dir.mkdir()
        file_path = incident_dir / filename
        file_path.write_bytes(b"fake photo data")

        # Delete photo
        result = photo_service.delete_photo(incident_id, filename)
        assert result is True
        assert not file_path.exists()

    def test_delete_photo_cleans_up_empty_directory(self, photo_service, temp_photos_dir):
        """Test that empty incident directory is removed after deleting last photo."""
        incident_id = uuid.uuid4()
        filename = "test.jpg"

        # Create photo file
        incident_dir = temp_photos_dir / str(incident_id)
        incident_dir.mkdir()
        file_path = incident_dir / filename
        file_path.write_bytes(b"fake photo data")

        # Delete photo
        photo_service.delete_photo(incident_id, filename)

        # Verify directory was removed
        assert not incident_dir.exists()

    def test_delete_photo_keeps_directory_with_other_files(self, photo_service, temp_photos_dir):
        """Test that incident directory is kept when other photos exist."""
        incident_id = uuid.uuid4()

        # Create multiple photos
        incident_dir = temp_photos_dir / str(incident_id)
        incident_dir.mkdir()

        file1 = incident_dir / "photo1.jpg"
        file2 = incident_dir / "photo2.jpg"
        file1.write_bytes(b"photo 1")
        file2.write_bytes(b"photo 2")

        # Delete one photo
        photo_service.delete_photo(incident_id, "photo1.jpg")

        # Verify directory still exists
        assert incident_dir.exists()
        assert not file1.exists()
        assert file2.exists()

    def test_delete_photo_not_exists(self, photo_service):
        """Test deleting non-existent photo."""
        incident_id = uuid.uuid4()
        filename = "nonexistent.jpg"

        result = photo_service.delete_photo(incident_id, filename)
        assert result is False


class TestPhotoStorageConfiguration:
    """Test photo storage configuration in different environments."""

    def test_default_photos_dir(self):
        """Test default photos directory configuration."""
        settings = Settings()
        assert settings.photos_dir == "data/photos"

    def test_custom_photos_dir(self, monkeypatch):
        """Test custom photos directory from environment."""
        monkeypatch.setenv("PHOTOS_DIR", "/mnt/data/photos")
        settings = Settings()
        assert settings.photos_dir == "/mnt/data/photos"

    def test_production_detection(self, monkeypatch):
        """Test production mode detection on Railway."""
        monkeypatch.setenv("RAILWAY_ENVIRONMENT", "production")
        settings = Settings()
        assert settings.is_production is True

    def test_non_production(self, monkeypatch):
        """Test non-production mode detection."""
        monkeypatch.delenv("RAILWAY_ENVIRONMENT", raising=False)
        settings = Settings()
        assert settings.is_production is False
