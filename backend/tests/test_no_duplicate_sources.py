"""No two tracked source files may be byte-identical.

Three byte-identical pairs turned up in one review pass on 2026-07-29:

- ``frontend/hooks/use-toast.ts`` and ``frontend/components/ui/use-toast.ts``
- ``frontend/hooks/use-mobile.ts`` and ``frontend/components/ui/use-mobile.tsx``
- (in kp-front) two ``EmptyState`` components

None of them was somebody copying a file on purpose. They are the shape shadcn's generator
produces — it writes hooks to a conventional location, and a later `add` writes the same hook
somewhere else. The result is two files that drift apart, one of which is imported and one of
which is not, and the unused one still gets read, edited and trusted by whoever finds it first.

That is what makes this worth a test rather than a cleanup: the duplicate is created silently
by a tool, so it will happen again, and the cost is somebody debugging the copy that is not
running. The dead-code sweep finds the unused half eventually; this finds it immediately.

**When this fails**, do not just delete one side. Work out which one is imported (that is the
real file), point any stragglers at it, and delete the other. If both are genuinely wanted —
which has not happened yet — add the pair to ``ALLOWED_DUPLICATES`` with the reason.
"""

import hashlib
import shutil
import subprocess
from collections import defaultdict
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent.parent

# Extensions worth comparing. Deliberately not images, fonts or fixtures: identical assets are
# normal and harmless, identical CODE is the thing that misleads a reader.
SOURCE_SUFFIXES = {".py", ".ts", ".tsx", ".js", ".mjs", ".css", ".sh"}

# Paths whose duplication is deliberate. Empty on purpose — add entries WITH a reason.
ALLOWED_DUPLICATES: set[frozenset[str]] = set()

# Files small enough that identical content says nothing (a one-line re-export, an empty
# __init__.py). Below this, matching bytes are coincidence rather than a copy.
MIN_BYTES = 200


def _tracked_sources() -> list[Path]:
    # The list of files comes from git so that node_modules, .venv and build output are
    # excluded by construction rather than by a prune list that would rot. The development
    # container has no git binary; CI does, which is where this needs to run.
    git = shutil.which("git")
    if git is None:
        pytest.skip("needs the git binary to enumerate tracked files (present in CI)")
    # Absolute path, not "git": ruff's S607 is right that resolving it off PATH inside a test
    # runner is avoidable, and shutil.which has already given us the real location.
    out = subprocess.run(  # noqa: S603 — argv is shutil.which() plus literals, no input reaches it
        [git, "ls-files", "-z"], cwd=REPO, capture_output=True, check=True
    ).stdout
    paths = [REPO / p.decode() for p in out.split(b"\0") if p]
    return [p for p in paths if p.suffix in SOURCE_SUFFIXES and p.exists() and p.stat().st_size >= MIN_BYTES]


def test_no_two_source_files_are_byte_identical():
    by_hash: dict[str, list[str]] = defaultdict(list)
    for path in _tracked_sources():
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        by_hash[digest].append(str(path.relative_to(REPO)))

    duplicates = [
        sorted(group) for group in by_hash.values() if len(group) > 1 and frozenset(group) not in ALLOWED_DUPLICATES
    ]

    assert not duplicates, "byte-identical source files (one of them is probably dead):\n" + "\n".join(
        "  " + "  ==  ".join(group) for group in duplicates
    )
