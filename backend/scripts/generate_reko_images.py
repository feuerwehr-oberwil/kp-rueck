"""Export image generation jobs and import the approved outputs as bundled WebP.

`jobs` prints one JSON line per missing picture: every illustrated text needs one; a
phone-style text (`phone_style_summaries`) needs a phone-style one; a water scene
(`water_scenes`) needs a shallow and a deep one. `import` installs the PNGs a model made
from those lines. A phone-style picture replaces the text's round-1 «plain» pictures.
"""

import argparse
import json
from io import BytesIO
from pathlib import Path
from typing import Literal

from PIL import Image, ImageOps

from app.services.training_photos import (
    SHALLOW_MAX_CM,
    SUMMARY_IMAGE_DIR,
    SummaryImage,
    load_summary_image_manifest,
    summary_image_key,
)
from app.services.training_simulation_data import illustrated_summaries, phone_style_summaries, water_scenes

AS_FOUND_RULE = (
    "Show the scene AS FOUND, before the fire service takes any action. "
    "Use the report for the setting and visible conditions only. "
    "Any action described as needed, possible or planned is still pending and must not appear in the image. "
    "Exclude pumps, hoses, absorbent, barriers, sandbags, ladders and all fire-service crews, equipment and vehicles. "
    "Only show ordinary civilian equipment or materials if the report explicitly says residents or other civilians "
    "already used them themselves, such as a household submersible pump after a resident pumped out a cellar. "
    "Existing fixtures and vehicles directly involved in the incident may be visible. "
)
SAFE_RULE = (
    "Keep the scene unbranded, with no readable text, logos, badges or number plates, and no graphic injury. "
    "If people are essential to the scene, show them from behind or crop all faces out of frame. "
)
# Style B of the 19.11.2026 trial (kp-rueck/2026-11-19-reko-images-r2).
PHONE_PROMPT = (
    "Realistic handheld smartphone photo, taken by the first fire-service scout (Reko) the moment they arrive, "
    "for a fictional Swiss fire-service training report. Standing height, slightly imperfect framing, real "
    "available light for the situation (overcast day, dusk, rain, street lights or a dim cellar lamp), ordinary "
    "phone-camera look, no cinematic grading. Setting: a suburb in Basel-Landschaft, Switzerland – Swiss houses, "
    "streets, kerbs, road markings and cars as they look there. The photographer and their gear stay out of frame. "
    f"{AS_FOUND_RULE}{SAFE_RULE}"
    "{depth}Report context (do not render as text): «{summary}»"
)
DEPTH_HINTS = {
    "shallow": f"The standing water is shallow – a few centimetres, at most {SHALLOW_MAX_CM} cm. ",
    "deep": "The standing water is deep – roughly 30 to 50 cm, well above the ankles. ",
}
MAX_EDGE = 640
MAX_BYTES = 30_000

Depth = Literal["shallow", "deep"]


def _wanted(summary: str) -> list[Depth | None]:
    return ["shallow", "deep"] if summary in water_scenes() else [None]


def _has(entries: list[SummaryImage], depth: Depth | None, phone: bool) -> bool:
    return any(entry.get("depth") == depth and (not phone or entry["style"] == "phone") for entry in entries)


def export_jobs() -> None:
    manifest = load_summary_image_manifest(SUMMARY_IMAGE_DIR)
    phone = phone_style_summaries()
    for summary in sorted(illustrated_summaries()):
        key = summary_image_key(summary)
        entries = [e for e in manifest.get(key, []) if (SUMMARY_IMAGE_DIR / e["file"]).is_file()]
        for depth in _wanted(summary):
            if _has(entries, depth, summary in phone):
                continue
            prompt = PHONE_PROMPT.format(summary=summary, depth=DEPTH_HINTS[depth] if depth else "")
            out = f"{key}-{depth}.png" if depth else f"{key}.png"
            print(json.dumps({"out": out, "key": key, "depth": depth, "prompt": prompt}, ensure_ascii=False))


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
    manifest = dict(load_summary_image_manifest(SUMMARY_IMAGE_DIR))
    current_keys = {summary_image_key(summary) for summary in illustrated_summaries()}
    SUMMARY_IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    for line in jobs.read_text(encoding="utf-8").splitlines():
        job = json.loads(line)
        key, depth = job["key"], job["depth"]
        source = source_dir / job["out"]
        if key not in current_keys or not source.name.startswith(key) or source.suffix != ".png":
            raise ValueError(f"Job {job['out']} does not match a current summary")
        if not source.is_file():
            continue
        filename = f"{source.stem}.webp"
        (SUMMARY_IMAGE_DIR / filename).write_bytes(encode_webp(source))
        entry: SummaryImage = {"file": filename, "prompt": job["prompt"], "scene": "as_found", "style": "phone"}
        if depth:
            entry["depth"] = depth
        # A phone picture replaces the round-1 pictures and an older picture of the same file.
        kept = [e for e in manifest.get(key, []) if e["style"] == "phone" and e["file"] != filename]
        manifest[key] = [*kept, entry]

    used = {entry["file"] for entries in manifest.values() for entry in entries}
    for path in SUMMARY_IMAGE_DIR.glob("*.webp"):
        if path.name not in used:
            path.unlink()
    (SUMMARY_IMAGE_DIR / "manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(f"Manifest covers {len(current_keys & manifest.keys())}/{len(current_keys)} current summaries.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("jobs", help="Write the missing image jobs as JSONL to stdout")
    ingest = commands.add_parser("import", help="Install images generated from a JSONL job file")
    ingest.add_argument("jobs", type=Path)
    ingest.add_argument("source_dir", type=Path)
    args = parser.parse_args()
    if args.command == "jobs":
        export_jobs()
    else:
        import_images(args.jobs, args.source_dir)


if __name__ == "__main__":
    main()
