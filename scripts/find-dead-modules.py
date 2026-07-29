#!/usr/bin/env python3
"""List tracked TS/TSX modules that no import specifier resolves to.

One pass over every file's imports, not one grep per file — the naive version took over seven
minutes on this repo and this takes about a second.

    python3 scripts/find-dead-modules.py frontend

Run it by hand when the repository starts feeling heavy; it is deliberately NOT a CI job. The
sweep on 2026-07-29 removed 41 files / 5,058 lines, and that much does not reaccumulate
quickly enough to justify a gate that would occasionally be wrong about a new convention.

**It reports candidates, not garbage.** Framework entry points are excluded by name (Next.js
route conventions, vitest/playwright configs, i18n/request.ts), but anything else reached by a
mechanism other than a static import — a string, a generator, a config file — will look dead
and is not. Check before deleting: `grep -rn <stem> app components lib` catches string
references, and `dynamic(() => import(...))` is handled but bears re-checking.

What it CANNOT see: an exported function nobody calls, a prop nobody passes, an unreachable
branch. That is the lint layer's job (`no-unused-vars`), not this one.
"""
import re, subprocess, sys
from pathlib import Path

root = Path(sys.argv[1]).resolve()
alias = sys.argv[2] if len(sys.argv) > 2 else "@/"

files = [root / f for f in subprocess.run(
    ["git", "ls-files", "*.ts", "*.tsx"], cwd=root, capture_output=True, text=True
).stdout.split()]
src = [f for f in files if f.exists()]

# Framework-owned entry points: Next.js / Vite import these, no module does.
CONVENTION = {"page", "layout", "route", "loading", "error", "not-found", "template",
              "middleware", "global-error", "instrumentation", "opengraph-image", "icon",
              "sitemap", "robots", "manifest", "main", "App", "vite-env"}

IMPORT = re.compile(r"""(?:from|import)\s*\(?\s*['"]([^'"]+)['"]""")

imported: set[Path] = set()
for f in src:
    try:
        text = f.read_text(encoding="utf-8")
    except Exception:
        continue
    for spec in IMPORT.findall(text):
        if spec.startswith(alias):
            base = root / spec[len(alias):]
        elif spec.startswith("."):
            base = (f.parent / spec).resolve()
        else:
            continue  # package import
        for cand in (base, base.with_suffix(".ts"), base.with_suffix(".tsx"),
                     base / "index.ts", base / "index.tsx"):
            if cand in set(src):
                imported.add(cand)

dead = []
for f in src:
    rel = f.relative_to(root)
    if f.stem in CONVENTION or ".test." in f.name or ".spec." in f.name:
        continue
    if any(p in ("tests", "test", "e2e") for p in rel.parts):
        continue
    if f.name.endswith(".d.ts"):
        continue
    if f not in imported:
        dead.append((len(f.read_text(encoding="utf-8").splitlines()), rel))

for n, rel in sorted(dead, reverse=True):
    print(f"{n}\t{rel}")
print(f"\n{len(dead)} unreferenced files, {sum(n for n, _ in dead)} lines", file=sys.stderr)
