"""Bundled illustrations and curated scene photos for offline training reports."""

import hashlib
import json
import logging
import random
import uuid
from functools import lru_cache
from io import BytesIO
from pathlib import Path
from typing import NotRequired, TypedDict

from fastapi import UploadFile

from .photo_storage import photo_storage

logger = logging.getLogger(__name__)

# Pool shipped inside the app package: backend/app/assets/training_photos/<type>/NN.jpg
POOL_DIR = Path(__file__).resolve().parent.parent / "assets" / "training_photos"
SUMMARY_IMAGE_DIR = POOL_DIR.with_name("training_reko_images")


class SummaryImage(TypedDict):
    file: str
    prompt: str
    scene: NotRequired[str]


def summary_image_key(summary: str) -> str:
    """Key the illustration by the exact UTF-8 summary wording."""
    return hashlib.sha256(summary.encode("utf-8")).hexdigest()


@lru_cache(maxsize=1)
def load_summary_image_manifest(image_dir: Path) -> dict[str, SummaryImage]:
    try:
        manifest: dict[str, SummaryImage] = json.loads((image_dir / "manifest.json").read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        logger.warning("Skipping training Reko illustration manifest: %s", exc)
        return {}
    return manifest


def pick_summary_image(summary: str) -> Path | None:
    entry = load_summary_image_manifest(SUMMARY_IMAGE_DIR).get(summary_image_key(summary))
    if entry:
        path = SUMMARY_IMAGE_DIR / entry["file"]
        if path.is_file():
            return path
    return None


# Fallback when a type has no (or an emptied) pool of its own: borrow a
# sibling's — mirrors the summary pool fallbacks in training_simulation_data
# (bahnanlagen reads like a rescue scene, strahlenwehr like a hazmat scene).
# A type's own directory always wins when it contains images.
_POOL_ALIASES = {
    "strahlenwehr": "chemiewehr",
    "einsatz_bahnanlagen": "strassenrettung",
    "gerettete_menschen": "strassenrettung",
    "dienstleistungen": "technische_hilfeleistung",
}

# Weighted legacy photo count: ~55% of simulated reports supplement their
# report with a type photo. Rapport can use both picks; Reko takes at most one.
_PHOTO_COUNTS = (0, 1, 2)
_PHOTO_COUNT_WEIGHTS = (45, 35, 20)


def _list_pool_images(type_dir: Path) -> list[Path]:
    try:
        return sorted(p for p in type_dir.glob("*.jpg") if p.is_file())
    except OSError:
        return []


def pick_pool_photos(incident_type: str | None, pool_dir: Path | None = None) -> list[Path]:
    """Pick 0-2 random pool photos matching the incident type.

    Returns ``[]`` when the pool directory or the type's subdirectory is
    missing or empty — brigades may strip the bundled assets, so an absent
    pool must degrade to "no photos", never raise.
    """
    base = pool_dir if pool_dir is not None else POOL_DIR
    type_key = (incident_type or "").lower()
    if not type_key:
        return []

    candidates = _list_pool_images(base / type_key)
    if not candidates and type_key in _POOL_ALIASES:
        candidates = _list_pool_images(base / _POOL_ALIASES[type_key])
    if not candidates:
        return []

    count = random.choices(_PHOTO_COUNTS, weights=_PHOTO_COUNT_WEIGHTS, k=1)[0]
    if count == 0:
        return []
    return random.sample(candidates, k=min(count, len(candidates)))


async def attach_training_photos(
    incident_id: uuid.UUID,
    incident_type: str | None,
    current_photos: list[str] | None = None,
    pool_dir: Path | None = None,
    *,
    summary_text: str | None = None,
) -> list[str]:
    """Copy the wording illustration ALONE, or – when the text has none – at most one type photo.

    A random type photo beside the illustration of what the crew reported would show a
    different scene of the same Einsatz (lead call, Sol review pass 5, S7); the type pool is
    only the fallback.

    Each photo goes through ``PhotoStorageService.save_photo`` — the same code
    path the real upload endpoint uses — so the stored files (UUID.jpg in the
    per-incident dir) and the returned ``photos_json`` entries are
    indistinguishable from real uploads.

    Returns the new filenames to append to ``photos_json``. Degrades to fewer
    or no photos on any per-file failure — the simulation must never break
    because of a missing or unreadable pool image.
    """
    filenames: list[str] = []
    existing = list(current_photos or [])
    matched = pick_summary_image(summary_text) if summary_text else None
    paths = [matched] if matched else pick_pool_photos(incident_type, pool_dir=pool_dir)[:1]
    for path in paths:
        try:
            upload = UploadFile(file=BytesIO(path.read_bytes()), filename=path.name)
            filename = await photo_storage.save_photo(
                incident_id=incident_id,
                file=upload,
                current_photos=existing + filenames,
            )
            filenames.append(filename)
        except Exception as exc:
            logger.warning("Skipping training pool photo %s: %s", path, exc)
    return filenames
