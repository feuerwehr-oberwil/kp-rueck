# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "requests",
#     "Pillow",
# ]
# ///
"""One-off curation script: build the offline training photo pool.

Downloads CC-licensed scene photos from Wikimedia Commons, matched to the
incident types on the board, and writes them (resized, re-encoded, EXIF
stripped) to backend/app/assets/training_photos/<incident_type>/NN.jpg plus
an ATTRIBUTION.md with author/license/source for every image.

Run once at dev time with:  uv run scripts/download-training-photos.py
Never runs at runtime — the app only reads the committed pool.
"""

import io
import re
import sys
import time
from pathlib import Path

import requests
from PIL import Image

API_URL = "https://commons.wikimedia.org/w/api.php"
USER_AGENT = "kp-rueck-training-photo-curation/1.0 (one-off dev script; https://github.com/kp-rueck)"

REPO_ROOT = Path(__file__).resolve().parent.parent
POOL_DIR = REPO_ROOT / "backend" / "app" / "assets" / "training_photos"

TARGET_PER_TYPE = 8  # aim 6-10 per incident type
MAX_PER_TERM = 4  # variety: don't fill a pool from a single search (same-scene series)
MIN_WIDTH = 800  # skip small originals
MAX_EDGE = 1280  # resize longest edge
JPEG_QUALITY = 80

# Incident types (see valid_incident_type in backend/app/models.py) mapped to
# Commons search terms. Types without a pool here reuse a sibling pool at
# runtime (see backend/app/services/training_photos.py):
#   strahlenwehr -> chemiewehr, einsatz_bahnanlagen -> strassenrettung,
#   gerettete_menschen -> strassenrettung, dienstleistungen -> technische_hilfeleistung.
SEARCH_TERMS: dict[str, list[str]] = {
    "brandbekaempfung": [
        "house fire firefighters flames",
        "Wohnungsbrand Feuerwehr Einsatz",
        "building fire smoke firefighters hose",
        "Dachstuhlbrand",
        "car fire firefighters extinguishing",
    ],
    "elementarereignis": [
        "flooded street flooding houses",
        "Hochwasser Feuerwehr",
        "fallen tree blocking road storm",
        "flooded basement pumping",
    ],
    "strassenrettung": [
        "traffic accident firefighters rescue",
        "Verkehrsunfall Feuerwehr",
        "car crash wreckage emergency services",
        "vehicle extrication firefighters",
    ],
    "technische_hilfeleistung": [
        "Sturmschaden Feuerwehr Einsatz",
        "fallen tree car storm damage",
        "storm damage roof house",
        "Technische Hilfeleistung Feuerwehr Einsatz",
    ],
    "oelwehr": [
        "oil spill road street asphalt",
        "Ölspur Feuerwehr",
        "oil boom river spill containment",
        "diesel spill absorbent",
        "oil sheen water surface",
        "oil slick asphalt rainbow",
        "heating oil tank leak",
    ],
    "chemiewehr": [
        "hazmat suit firefighters",
        "Gefahrgut Feuerwehr Einsatz",
        "Dekontamination Feuerwehr",
        "hazmat decontamination exercise",
        "Chemikalienschutzanzug",
        "hazmat response spill",
        "ABC Übung Feuerwehr",
        "chemical spill exercise emergency",
    ],
    "bma_unechte_alarme": [
        "fire alarm control panel building",
        "smoke detector ceiling",
        "Brandmeldeanlage",
    ],
    "diverse_einsaetze": [
        "wasp nest house eaves",
        "hornet nest tree",
        "Wespennest Dach",
        "wasp nest roof attic",
        "Hornissennest",
    ],
    "gerettete_tiere": [
        "firefighters animal rescue",
        "Tierrettung Feuerwehr Einsatz",
        "horse rescue fire brigade",
        # Animal-in-situ scenes: exactly what a Reko crew would photograph
        "cat stuck in a tree",
        "cat high up tree branch",
    ],
}

# Strict license allow-list: CC0, CC BY, CC BY-SA (any version, any port).
# Explicitly NOT accepted: NC/ND variants, plain "Public domain", GFDL-only.
_LICENSE_RE = re.compile(r"^CC(0|(\s|-)BY((\s|-)SA)?)([\s-].*)?$", re.IGNORECASE)
_LICENSE_FORBIDDEN = re.compile(r"\b(NC|ND)\b", re.IGNORECASE)

# Best-effort face/person avoidance + junk filters on the file title.
_TITLE_SKIP = re.compile(
    r"portrait|selfie|face|wedding|ceremony|press conference|group photo|posing|"
    r"memorial|funeral|logo|map|diagram|drawing|painting|poster|museum|model|"
    r"protest|boycott|demonstration|parade|helicopter",
    re.IGNORECASE,
)

# Historic archive material (b&w/sepia) reads wrong on a modern Reko report.
_OLD_YEAR = re.compile(r"\b(18\d\d|19[0-7]\d)\b")

# Titles rejected during visual review — re-running the script skips them and
# fills the slot with the next candidate.
EXCLUDE_TITLES: set[str] = {
    # Not incident scenes (spotted in review):
    "File:Weihnachtsstern auf der Hansawiese mit Gebäude von der Feuerwehr 2023-11-24.jpg",
    "File:Weihnachtsstern auf der Hansawiese vor dem Hansa-Gymnasium Stralsund 2023-11-24.jpg",
    "File:Protest against oil company BP and their still leaking oil in the Gulf of Mexico.jpg",
    "File:Miami Beach Lincoln Mall Boycott BP.JPG",
    "File:VF-146 Agusta Westland AW139 Vigili del Fuoco (Italian Firefighters)Malta 24.9.21 (51683255002).jpg",
    "File:Anhänger, Rettungshund, Rettungsdienst Komitat Pest, Tag der Feuerwehr, 2024 Stadtwäldchen.jpg",
    "File:Hornet Nest model at Regional Museum of Natural History, Bhubaneswar.jpg",
    "File:L.S. Hornet Nest at Regional Museum of Natural History, Bhubaneswar.jpg",
    "File:Dragline Basket and Claim Shell Bucket Are Used to Scoop Oil - Laden Debris from Log Boom on the San Juan River, 10-1972.jpg",
    # Second review pass:
    "File:Kyoto's firefighters.jpg",  # crowd of onlookers with visible faces
    "File:Flooding in southern Iran (49389786917).jpg",  # satellite image
    "File:View of houses on Flood Street - geograph.org.uk - 4810138.jpg",  # street name only, no flood
    "File:Traffic accident on the D6 highway, Czech Republic 08.png",  # graphic interior close-up
    "File:Verkehrsunfall auf der Neuen Hamburger Straße (Bundesstraße B 4) (Kiel 35.415).jpg",  # b&w archive
    "File:Feuerwehreinsatz nach Verkehrsunfall.jpg",  # empty winter panorama, no scene
    "File:The Fall Color Will Not Help Asheville After Helene - 4.jpg",  # photographer watermark
    "File:Espie Dods House, side view, following storm damage to roof, 2015.JPG",  # plaza, damage barely visible
    "File:Beseitigung einer Ölspur am Westring, Ecke Eckernförder Straße durch die Feuerwehr (Kiel 54.695).jpg",  # b&w archive
    "File:Ölspur - 10.jpg",  # near-duplicate of Ölspur - 09
    "File:Blue Grass Chemical Agent-Destruction Pilot Plant Standby Diesel Generators (35227778740).jpg",  # plant maintenance, no spill
    "File:GEF-PKL BAB A1 HB-HH AS Dibb 15.01.08-1.jpg",  # embedded caption overlay
    "File:Abrollbehälter-Dekontamination-Zivilpersonen der Feuerwehr Hannover.jpg",  # container side view, no scene
    "File:WLA hmns Red Wasp Nest.jpg",  # museum specimen
    "File:Wasp nest (explored) - Flickr - hedera.baltica.jpg",  # comb macro, reads as honeycomb
    "File:Rescue of storks in Maidan-Lypnenskyi, 2023-08-15 (2).jpg",  # just a hole in metal
    "File:Can Padró 1.jpg",  # fire training, wrong type
    "File:Placa Bombers a Fleming.jpg",  # memorial plaque
    "File:Poble Sec sense vehicles.jpg",  # b&w fire station
    "File:Torre de pràctiques al parc de bombers de la Ciutadella, Barcelona, cap el 1924.jpg",  # 1924 archive
    "File:Company 12 football.jpg",  # firefighters playing football, not a rescue
    "File:Swan Road ^ Swan Road Postbox - geograph.org.uk - 2572167.jpg",  # street called Swan Road, no swan
    "File:Worlingworth, Swan Road - geograph.org.uk - 6474858.jpg",  # street called Swan Road, no swan
    # "Ölspur - NN" is a series of near-identical shots of one warning sign;
    # keep only 02 for variety.
    "File:Ölspur - 01.jpg",
    "File:Ölspur - 03.jpg",
    "File:Ölspur - 04.jpg",
    "File:Ölspur - 05.jpg",
    "File:Ölspur - 06.jpg",
    "File:Ölspur - 07.jpg",
    "File:Ölspur - 08.jpg",
    "File:Ölspur - 09.jpg",
    "File:Ölspur - 10.jpg",
    "File:Ölspur - 11.jpg",
    "File:Flood embankment protecting houses in Silcoates Street - geograph.org.uk - 6727571.jpg",  # empty field
    "File:Gerätewagen Dekontamination Personal -Katastrophenschutz Hessen.jpg",  # parked truck, no scene
    "File:FW Ulm - Dekon-LKW P.jpg",  # parked truck, no scene
    "File:Hoornaar - European hornet (20725124754).jpg",  # photographer watermark
}

session = requests.Session()
session.headers["User-Agent"] = USER_AGENT


def _clean_html(value: str) -> str:
    """Strip tags/whitespace from an extmetadata HTML value."""
    text = re.sub(r"<[^>]+>", "", value)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:120] if text else "unknown"


def _license_ok(short_name: str) -> bool:
    if _LICENSE_FORBIDDEN.search(short_name):
        return False
    return bool(_LICENSE_RE.match(short_name.strip()))


def search_candidates(term: str, limit: int = 40) -> list[dict]:
    """Commons file-namespace search with imageinfo + extmetadata."""
    params = {
        "action": "query",
        "format": "json",
        "generator": "search",
        "gsrsearch": term,
        "gsrnamespace": 6,  # File:
        "gsrlimit": limit,
        "prop": "imageinfo",
        "iiprop": "url|size|mime|extmetadata",
        "iiurlwidth": 1600,
    }
    resp = session.get(API_URL, params=params, timeout=30)
    resp.raise_for_status()
    pages = resp.json().get("query", {}).get("pages", {})
    # Preserve search relevance order
    return [p for p in sorted(pages.values(), key=lambda p: p.get("index", 999))]


def evaluate(page: dict) -> dict | None:
    """Return a candidate record if the page passes all filters, else None."""
    title = page.get("title", "")
    if title in EXCLUDE_TITLES or _TITLE_SKIP.search(title) or _OLD_YEAR.search(title):
        return None
    infos = page.get("imageinfo") or []
    if not infos:
        return None
    info = infos[0]
    if info.get("mime") not in ("image/jpeg", "image/png", "image/webp"):
        return None
    if (info.get("width") or 0) < MIN_WIDTH:
        return None
    meta = info.get("extmetadata") or {}
    license_short = _clean_html(meta.get("LicenseShortName", {}).get("value", ""))
    if not _license_ok(license_short):
        return None
    return {
        "title": title,
        "author": _clean_html(meta.get("Artist", {}).get("value", "unknown")),
        "license": license_short,
        "source_url": info.get("descriptionurl") or info.get("descriptionshorturl") or "",
        # thumburl is a pre-scaled 1600px derivative — enough for our 1280px
        # target and far smaller than multi-MB originals.
        "download_url": info.get("thumburl") or info.get("url"),
    }


def download_and_process(url: str) -> bytes | None:
    """Download, resize longest edge to MAX_EDGE, re-encode JPEG (strips EXIF)."""
    try:
        resp = None
        for attempt in range(4):
            resp = session.get(url, timeout=60)
            if resp.status_code == 429:  # rate limited: back off and retry
                wait = 10 * (attempt + 1)
                print(f"    ~ 429 rate limited, waiting {wait}s")
                time.sleep(wait)
                continue
            break
        resp.raise_for_status()
        img = Image.open(io.BytesIO(resp.content))
        img.load()
    except Exception as exc:
        print(f"    ! download/decode failed: {exc}")
        return None

    if img.mode in ("RGBA", "LA", "P"):
        background = Image.new("RGB", img.size, (255, 255, 255))
        if img.mode == "P":
            img = img.convert("RGBA")
        background.paste(img, mask=img.split()[-1] if img.mode in ("RGBA", "LA") else None)
        img = background
    elif img.mode != "RGB":
        img = img.convert("RGB")

    longest = max(img.size)
    if longest > MAX_EDGE:
        scale = MAX_EDGE / longest
        img = img.resize((round(img.width * scale), round(img.height * scale)), Image.Resampling.LANCZOS)

    out = io.BytesIO()
    # Saving a fresh PIL image without exif kwarg strips all EXIF metadata.
    img.save(out, format="JPEG", quality=JPEG_QUALITY, optimize=True)
    return out.getvalue()


def curate_type(incident_type: str, terms: list[str]) -> list[dict]:
    """Download up to TARGET_PER_TYPE images for one incident type."""
    type_dir = POOL_DIR / incident_type
    type_dir.mkdir(parents=True, exist_ok=True)
    # Fresh run: replace previous pool for this type
    for old in type_dir.glob("*.jpg"):
        old.unlink()

    records: list[dict] = []
    seen_titles: set[str] = set()
    for term in terms:
        if len(records) >= TARGET_PER_TYPE:
            break
        print(f"  searching: {term!r}")
        try:
            pages = search_candidates(term)
        except Exception as exc:
            print(f"    ! search failed: {exc}")
            continue
        taken_for_term = 0
        for page in pages:
            if len(records) >= TARGET_PER_TYPE or taken_for_term >= MAX_PER_TERM:
                break
            candidate = evaluate(page)
            if not candidate or candidate["title"] in seen_titles:
                continue
            seen_titles.add(candidate["title"])
            data = download_and_process(candidate["download_url"])
            time.sleep(1.0)  # be polite to Commons
            if not data:
                continue
            filename = f"{len(records) + 1:02d}.jpg"
            (type_dir / filename).write_bytes(data)
            candidate["filename"] = filename
            records.append(candidate)
            taken_for_term += 1
            print(f"    + {filename}  {candidate['license']:<14} {candidate['title']}")
    return records


def write_attribution(all_records: dict[str, list[dict]]) -> None:
    lines = [
        "# Training Photo Pool — Attribution",
        "",
        "Scene photos for simulated training Reko reports, curated from",
        "[Wikimedia Commons](https://commons.wikimedia.org/) via",
        "`scripts/download-training-photos.py`. All images are CC0, CC BY or",
        "CC BY-SA licensed; they were resized (longest edge 1280 px),",
        "re-encoded (JPEG q80) and stripped of EXIF metadata.",
        "",
    ]
    for incident_type, records in all_records.items():
        lines.append(f"## {incident_type}")
        lines.append("")
        lines.append("| File | Author | License | Source |")
        lines.append("|------|--------|---------|--------|")
        for r in records:
            author = r["author"].replace("|", "\\|")
            title = r["title"].replace("|", "\\|")
            lines.append(f"| {r['filename']} | {author} | {r['license']} | [{title}]({r['source_url']}) |")
        lines.append("")
    (POOL_DIR / "ATTRIBUTION.md").write_text("\n".join(lines), encoding="utf-8")


def _load_existing_records() -> dict[str, list[dict]]:
    """Parse ATTRIBUTION.md back into records so partial re-runs (a subset of
    types passed on the CLI) keep the attribution of untouched types."""
    attribution = POOL_DIR / "ATTRIBUTION.md"
    records: dict[str, list[dict]] = {}
    if not attribution.exists():
        return records
    current: list[dict] | None = None
    for line in attribution.read_text(encoding="utf-8").splitlines():
        if line.startswith("## "):
            current = records.setdefault(line[3:].strip(), [])
        elif current is not None and line.startswith("| ") and line.endswith(" |") and ".jpg" in line:
            cells = [c.strip() for c in line.strip("|").split("|")]
            if len(cells) == 4:
                m = re.match(r"\[(.*)\]\((.*)\)", cells[3])
                current.append(
                    {
                        "filename": cells[0],
                        "author": cells[1],
                        "license": cells[2],
                        "title": m.group(1) if m else cells[3],
                        "source_url": m.group(2) if m else "",
                    }
                )
    return records


def main() -> int:
    POOL_DIR.mkdir(parents=True, exist_ok=True)
    only_types = set(sys.argv[1:])  # optional: re-curate just these types
    unknown = only_types - set(SEARCH_TERMS)
    if unknown:
        print(f"Unknown incident types: {', '.join(sorted(unknown))}")
        return 1

    all_records = _load_existing_records()
    total_bytes = 0
    for incident_type, terms in SEARCH_TERMS.items():
        if only_types and incident_type not in only_types:
            continue
        print(f"\n=== {incident_type} ===")
        records = curate_type(incident_type, terms)
        all_records[incident_type] = records
        size = sum(f.stat().st_size for f in (POOL_DIR / incident_type).glob("*.jpg"))
        total_bytes += size
        print(f"  -> {len(records)} images, {size / 1024:.0f} KiB")
        if len(records) < 6:
            print(f"  ! WARNING: only {len(records)} images (target 6-10)")

    write_attribution(all_records)
    print(f"\nTotal pool size: {total_bytes / (1024 * 1024):.1f} MiB")
    print(f"Attribution written to {POOL_DIR / 'ATTRIBUTION.md'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
