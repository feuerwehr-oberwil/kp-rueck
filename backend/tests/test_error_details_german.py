"""API error details are German – no English sentence reaches the operator's toast.

`frontend/lib/api/http.ts` shows a response's `detail` verbatim when it carries no
`code`, so an English literal in an `HTTPException` / `CodedHTTPException` is an
English toast in a German app. This walks every such raise under `app/` and fails
on English stop-words in the literal (f-strings included). Machine codes such as
`session_refresh_required` are single tokens and pass.
"""

import ast
import re
from pathlib import Path

APP = Path(__file__).resolve().parents[1] / "app"

# Words that do not occur in German copy; «in», «per», «Token» etc. are left out on purpose.
ENGLISH = re.compile(
    r"\b(not|found|already|must|only|invalid|failed|error|is|are|the|this|can|cannot|unknown|"
    r"required|missing|configured|disabled|unreachable|exists|between|should|does|please|no|"
    r"of|for|with|to|and|or|too|detected|photos)\b",
    re.IGNORECASE,
)


def _literal_texts(node: ast.expr) -> list[str]:
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return [node.value]
    if isinstance(node, ast.JoinedStr):
        return ["".join(v.value if isinstance(v, ast.Constant) else "{}" for v in node.values)]
    if isinstance(node, ast.BinOp):
        return _literal_texts(node.left) + _literal_texts(node.right)
    return []


def _details(call: ast.Call) -> list[ast.expr]:
    name = getattr(call.func, "id", None) or getattr(call.func, "attr", None)
    if name not in ("HTTPException", "CodedHTTPException"):
        return []
    found = [kw.value for kw in call.keywords if kw.arg == "detail"]
    position = 2 if name == "CodedHTTPException" else 1  # (status, code, detail) / (status, detail)
    if len(call.args) > position:
        found.append(call.args[position])
    return found


def test_no_english_error_details():
    offenders = []
    for path in sorted(APP.rglob("*.py")):
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if not isinstance(node, ast.Call):
                continue
            for detail in _details(node):
                offenders += [
                    f"{path.relative_to(APP.parent)}:{node.lineno}: {text!r}"
                    for text in _literal_texts(detail)
                    if ENGLISH.search(text)
                ]
    assert not offenders, "English error details (use ErrorMessages or German):\n" + "\n".join(offenders)
