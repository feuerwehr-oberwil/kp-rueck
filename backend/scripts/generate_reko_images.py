"""Export image generation jobs and import the approved outputs as bundled WebP."""

import argparse
import json
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageOps

from app.services.training_photos import SUMMARY_IMAGE_DIR, load_summary_image_manifest, summary_image_key
from app.services.training_simulation_data import _SUMMARIES

AS_FOUND_INTENT = "Show the scene AS FOUND"
AS_FOUND_RULE = (
    f"{AS_FOUND_INTENT}, before the fire service takes any action. "
    "Use the report for the setting and visible conditions only. "
    "Any action described as needed, possible or planned is still pending and must not appear in the image. "
    "Exclude pumps, hoses, absorbent, barriers, sandbags, ladders and all fire-service crews, equipment and vehicles. "
    "Only show ordinary civilian equipment or materials if the report explicitly says residents or other civilians "
    "already used them themselves, such as a household submersible pump after a resident pumped out a cellar. "
    "Existing fixtures and vehicles directly involved in the incident may be visible. "
)
PROMPT = (
    "Plain realistic-looking illustrative scene photograph for a fictional Swiss fire-service training report. "
    "Natural subdued light and colours, straightforward eye-level framing. "
    f"{AS_FOUND_RULE}"
    "Keep the scene unbranded, with no readable text, logos, or graphic injury. "
    "If people are essential to the scene, show them from behind or crop all faces out of frame. "
    "Report context (do not render as text): «{summary}»"
)
MAX_EDGE = 640
MAX_BYTES = 30_000


def export_jobs(include_existing: bool, pool: str | None) -> None:
    manifest = load_summary_image_manifest(SUMMARY_IMAGE_DIR)
    summaries = sorted(
        set(_SUMMARIES[pool]) if pool else {summary for texts in _SUMMARIES.values() for summary in texts}
    )
    for summary in summaries:
        key = summary_image_key(summary)
        entry = manifest.get(key)
        if not include_existing and entry and (SUMMARY_IMAGE_DIR / entry["file"]).is_file():
            continue
        prompt = entry["prompt"] if entry and AS_FOUND_INTENT in entry["prompt"] else PROMPT.format(summary=summary)
        print(json.dumps({"out": f"{key}.png", "prompt": prompt}, ensure_ascii=False))


def encode_webp(source: Path) -> bytes:
    with Image.open(source) as raw:
        image = ImageOps.exif_transpose(raw).convert("RGB")
    image.thumbnail((MAX_EDGE, MAX_EDGE), Image.Resampling.LANCZOS)
    for quality in range(85, 9, -5):
        buffer = BytesIO()
        image.save(buffer, "WEBP", quality=quality, method=6)
        if buffer.tell() <= MAX_BYTES:
            return buffer.getvalue()
    raise ValueError(f"Could not encode {source} within {MAX_BYTES} bytes")


def import_images(jobs: Path, source_dir: Path) -> None:
    manifest = load_summary_image_manifest(SUMMARY_IMAGE_DIR).copy()
    current_keys = {summary_image_key(summary) for pool in _SUMMARIES.values() for summary in pool}
    SUMMARY_IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    for line in jobs.read_text(encoding="utf-8").splitlines():
        job = json.loads(line)
        source = source_dir / job["out"]
        key = source.stem
        if key not in current_keys or source.name != job["out"] or source.suffix != ".png":
            raise ValueError(f"Job {job['out']} does not match a current summary")
        if source.is_file():
            filename = f"{key}.webp"
            (SUMMARY_IMAGE_DIR / filename).write_bytes(encode_webp(source))
            manifest[key] = {"file": filename, "prompt": job["prompt"], "scene": "as_found"}

    (SUMMARY_IMAGE_DIR / "manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(f"Manifest covers {len(current_keys & manifest.keys())}/{len(current_keys)} current summaries.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    export = commands.add_parser("jobs", help="Write missing image jobs as JSONL to stdout")
    export.add_argument("--all", action="store_true", help="Include existing images as regeneration jobs")
    export.add_argument("--pool", choices=_SUMMARIES, help="Limit jobs to this summary pool")
    ingest = commands.add_parser("import", help="Install images generated from a JSONL job file")
    ingest.add_argument("jobs", type=Path)
    ingest.add_argument("source_dir", type=Path)
    args = parser.parse_args()
    if args.command == "jobs":
        export_jobs(args.all, args.pool)
    else:
        import_images(args.jobs, args.source_dir)


if __name__ == "__main__":
    main()
