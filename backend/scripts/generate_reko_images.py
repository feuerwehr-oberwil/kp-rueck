"""Export image generation jobs and import the approved outputs as bundled WebP.

`jobs` prints one JSON line per missing picture: every illustrated text needs
`PICTURES_PER_SCENE` phone shots in different seasons (owner pick 24.11.2026), a water scene
(`water_scenes`) that many shallow and that many deep. A new shot takes the season that
contrasts the text's existing one (`next_season`). `import` installs the PNGs a model made
from those lines. A phone shot replaces the text's round-1 «plain» pictures.
"""

import argparse
import hashlib
import json
from io import BytesIO
from pathlib import Path
from typing import Literal

from PIL import Image, ImageOps

from app.services.training_photos import (
    SHALLOW_MAX_CM,
    SUMMARY_IMAGE_DIR,
    Season,
    SummaryImage,
    load_summary_image_manifest,
    seasons_for,
    summary_image_key,
)
from app.services.training_simulation_data import illustrated_summaries, water_scenes

AS_FOUND_RULE = (
    "Show the scene AS FOUND, before the fire service takes any action. "
    "Use the report for the setting and visible conditions only. "
    "Any action described as needed, possible or planned is still pending and must not appear in the image. "
    "Exclude pumps, hoses, absorbent, barriers, sandbags, ladders and all fire-service crews, equipment and vehicles. "
    "Only show ordinary civilian equipment or materials if the report explicitly says residents or other civilians "
    "already used them themselves, such as a household submersible pump after a resident pumped out a cellar. "
    "Existing fixtures and vehicles directly involved in the incident may be visible. "
    "A cordon by police or residents may be visible only when the report says the area is already cordoned off. "
)
SAFE_RULE = (
    "Keep the scene unbranded, with no readable text, logos, badges or number plates, and no graphic injury. "
    "If people are essential to the scene, show them from behind or crop all faces out of frame. "
)
# Style B of the 19.11.2026 trial (kp-rueck/2026-11-19-reko-images-r2).
PHONE_PROMPT = (
    "Realistic handheld smartphone photo, taken by the first fire-service scout (Reko) the moment they arrive, "
    "for a fictional Swiss fire-service training report. Standing height, slightly imperfect framing, real "
    "available light for the situation and the season, ordinary phone-camera look, no cinematic grading. "
    "Season: {season} – {season_hint}. "
    "Setting: a suburb in Basel-Landschaft, Switzerland – Swiss houses, "
    "streets, kerbs, road markings and cars as they look there. The photographer and their gear stay out of frame. "
    "Show the very place the report names – inside the room when it names one – so its main fact is visible. "
    f"{AS_FOUND_RULE}{SAFE_RULE}"
    "{depth}Report context (do not render as text): «{summary}»"
)
DEPTH_HINTS = {
    "shallow": (
        f"The standing water is shallow – a thin layer on the floor, a few centimetres, at most {SHALLOW_MAX_CM} cm, "
        "visibly below shoe height against walls, doors or objects. "
    ),
    "deep": (
        "The standing water is deep – a clear waterline at roughly knee height (30 to 50 cm) against walls, "
        "doors, steps or objects in the room. "
    ),
}
# Owner note 20.11.2026: storms come in every season, not only in autumn. Owner 24.11.: «also
# snow or in summer».
SEASON_HINTS: dict[Season, str] = {
    "spring": "fresh green leaves, blossom, mild light, maybe a spring shower or snowmelt",
    "summer": "full green trees, bright sun or a summer thunderstorm, people in light clothes",
    "autumn": "coloured or fallen leaves, overcast sky, rain or dusk",
    "winter": "bare trees, snow on roofs, lawns, kerbs and parked cars, cold light or street lamps",
}
# The season a scene's next shot takes after this one (autumn: see `next_season`).
CONTRAST: dict[Season, Season] = {"summer": "winter", "spring": "winter", "winter": "summer"}
# Each scene (text, or text and depth) gets this many phone shots, each in its own season.
PICTURES_PER_SCENE = 2
MAX_EDGE = 640
# Phone shots (rain, grain, dusk) compress worse than the round-1 plain pictures.
MAX_BYTES = 60_000

Depth = Literal["shallow", "deep"]


def _wanted(summary: str) -> list[Depth | None]:
    return ["shallow", "deep"] if summary in water_scenes() else [None]


def _spread(name: str, count: int) -> int:
    """An index below `count` that stays the same for this name and spreads across names."""
    return int(hashlib.sha256(name.encode()).hexdigest(), 16) % count


def next_season(taken: list[Season | None], name: str, allowed: tuple[Season, ...]) -> Season:
    """The season of a scene's next shot, one of `allowed` (`seasons_for`): the contrast to
    the one it has (summer ↔ winter, spring → winter). A shot without a season is an early,
    autumn-looking one: snow or summer next, spread by `name`. A scene with no shot starts
    at a season spread by `name`. A season repeats only when `allowed` has no other."""
    if not taken:
        return allowed[_spread(name, len(allowed))]
    last = taken[-1]
    if last is None or last == "autumn":
        preferred: list[Season] = ["winter", "summer"] if _spread(name, 2) == 0 else ["summer", "winter"]
    else:
        preferred = [CONTRAST[last]]
    fresh = [s for s in allowed if s not in taken] or list(allowed)
    return next((s for s in preferred if s in fresh), fresh[0])


def phone_prompt(summary: str, depth: Depth | None, season: Season) -> str:
    return PHONE_PROMPT.format(
        summary=summary, depth=DEPTH_HINTS[depth] if depth else "", season=season, season_hint=SEASON_HINTS[season]
    )


def export_jobs() -> None:
    manifest = load_summary_image_manifest(SUMMARY_IMAGE_DIR)
    for summary in sorted(illustrated_summaries()):
        key = summary_image_key(summary)
        entries = [
            e for e in manifest.get(key, []) if e["style"] == "phone" and (SUMMARY_IMAGE_DIR / e["file"]).is_file()
        ]
        for depth in _wanted(summary):
            stem = f"{key}-{depth}" if depth else key
            taken = [e.get("season") for e in entries if e.get("depth") == depth]
            while len(taken) < PICTURES_PER_SCENE:
                season = next_season(taken, stem, seasons_for(summary))
                repeat = taken.count(season)
                taken.append(season)
                out = f"{stem}-{season}-{repeat + 1}.png" if repeat else f"{stem}-{season}.png"
                prompt = phone_prompt(summary, depth, season)
                job = {"out": out, "key": key, "depth": depth, "season": season, "prompt": prompt}
                print(json.dumps(job, ensure_ascii=False))


def encode_webp(source: Path) -> bytes:
    with Image.open(source) as raw:
        image = ImageOps.exif_transpose(raw).convert("RGB")
    image.thumbnail((MAX_EDGE, MAX_EDGE), Image.Resampling.LANCZOS)
    for quality in range(60, 9, -5):
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
        if season := job.get("season"):
            entry["season"] = season
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
