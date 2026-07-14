"""Offline photo pool for simulated training Reko reports.

A curated set of CC-licensed scene photos (curated once at dev time via
``scripts/download-training-photos.py``, attribution in
``app/assets/training_photos/ATTRIBUTION.md``) ships inside the backend
package. When the training simulation submits a Reko report, 0-2 pool photos
matching the incident type are pushed through the exact same
``PhotoStorageService`` path real uploads use, so serving, cleanup and
deletion behave identically to real photos. No network access at runtime.
"""

import logging
import random
import uuid
from io import BytesIO
from pathlib import Path

from fastapi import UploadFile

from .photo_storage import photo_storage

logger = logging.getLogger(__name__)

# Pool shipped inside the app package: backend/app/assets/training_photos/<type>/NN.jpg
POOL_DIR = Path(__file__).resolve().parent.parent / "assets" / "training_photos"

# Types without their own curated pool borrow a sibling's — mirrors the summary
# pool fallbacks in training_simulation_data (bahnanlagen reads like a rescue
# scene, strahlenwehr like a hazmat scene, etc.).
_POOL_ALIASES = {
    "strahlenwehr": "chemiewehr",
    "einsatz_bahnanlagen": "strassenrettung",
    "gerettete_menschen": "strassenrettung",
    "dienstleistungen": "technische_hilfeleistung",
}

# Weighted photo count per report: ~55% of simulated Reko reports carry at
# least one photo — matches how often a real crew bothers to attach pictures.
_PHOTO_COUNTS = (0, 1, 2)
_PHOTO_COUNT_WEIGHTS = (45, 35, 20)


def pick_pool_photos(incident_type: str | None, pool_dir: Path | None = None) -> list[Path]:
    """Pick 0-2 random pool photos matching the incident type.

    Returns ``[]`` when the pool directory or the type's subdirectory is
    missing or empty — brigades may strip the bundled assets, so an absent
    pool must degrade to "no photos", never raise.
    """
    base = pool_dir if pool_dir is not None else POOL_DIR
    type_key = (incident_type or "").lower()
    type_key = _POOL_ALIASES.get(type_key, type_key)
    if not type_key:
        return []

    type_dir = base / type_key
    try:
        candidates = sorted(p for p in type_dir.glob("*.jpg") if p.is_file())
    except OSError:
        return []
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
) -> list[str]:
    """Copy 0-2 pool photos into the incident's photo directory.

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
    for path in pick_pool_photos(incident_type, pool_dir=pool_dir):
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
