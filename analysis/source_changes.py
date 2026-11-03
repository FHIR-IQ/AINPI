"""Curated log of changes to the CMS NDH export (and two upstream files) that
affected how AINPI must read its inputs.

`analysis/source_changes.yaml` is written by hand and reviewed by pull request.
This module loads it, validates it, and publishes
`frontend/public/api/v1/source-changes.json`.

The published file carries no generation timestamp: it is a pure function of
the YAML, so a test can assert the committed JSON equals generator output.

Run: python3 analysis/source_changes.py          (write the JSON)
     python3 analysis/source_changes.py --check  (exit 1 if invalid or stale)
"""
from __future__ import annotations

import json
import pathlib
import re
import sys

import yaml

ROOT = pathlib.Path(__file__).resolve().parent.parent
YAML_PATH = ROOT / "analysis" / "source_changes.yaml"
JSON_PATH = ROOT / "frontend" / "public" / "api" / "v1" / "source-changes.json"

KINDS = ("code-system", "identifier", "id-minting", "vocabulary", "file-layout",
         "value-pattern", "upstream-file")
STATUSES = ("active", "resolved")
REQUIRED = ("id", "first_release", "resource", "element", "kind", "before", "after",
            "detected", "impact", "handled_by", "evidence", "status")
OPTIONAL = ("evidence_ref",)
ID_RE = re.compile(r"^sc-\d{4}-\d{2}-\d{2}-[a-z0-9-]+$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
# Entries from this date on must say which fingerprint diff line or dq-results
# key surfaced them. Earlier entries predate those tools.
EVIDENCE_REF_FROM = "2026-11-01"
EVIDENCE_URL_PREFIX = "https://ainpi.dev/"


def load_entries(path=YAML_PATH) -> list[dict]:
    data = yaml.safe_load(pathlib.Path(path).read_text(encoding="utf-8"))
    if not isinstance(data, dict) or not isinstance(data.get("entries"), list):
        raise ValueError(f"{path}: expected a mapping with an 'entries' list")
    return data["entries"]


def _symbol_defined(text: str, symbol: str) -> bool:
    name = re.escape(symbol)
    return bool(re.search(rf"^\s*(?:def|class)\s+{name}\b|^{name}\s*(?::[^=\n]+)?=", text, re.M))


def validate(entries: list[dict]) -> list[str]:
    errors: list[str] = []
    seen: set[str] = set()
    for i, e in enumerate(entries):
        tag = e.get("id", f"#{i}") if isinstance(e, dict) else f"#{i}"
        if not isinstance(e, dict):
            errors.append(f"{tag}: entry is not a mapping")
            continue
        for f in REQUIRED:
            if not isinstance(e.get(f), str) or not e[f].strip():
                errors.append(f"{tag}: missing or empty field '{f}'")
        for f in e:
            if f not in REQUIRED and f not in OPTIONAL:
                errors.append(f"{tag}: unknown field '{f}'")
        eid = e.get("id")
        if isinstance(eid, str):
            if not ID_RE.match(eid):
                errors.append(f"{tag}: id does not match sc-YYYY-MM-DD-<slug>")
            if eid in seen:
                errors.append(f"{tag}: duplicate id")
            seen.add(eid)
        fr = e.get("first_release")
        if isinstance(fr, str):
            if not DATE_RE.match(fr):
                errors.append(f"{tag}: first_release is not YYYY-MM-DD")
            elif isinstance(eid, str) and ID_RE.match(eid) and eid[3:13] != fr:
                errors.append(f"{tag}: id date differs from first_release")
        if e.get("kind") not in KINDS:
            errors.append(f"{tag}: kind must be one of {', '.join(KINDS)}")
        if e.get("status") not in STATUSES:
            errors.append(f"{tag}: status must be active or resolved")
        hb = e.get("handled_by")
        if isinstance(hb, str) and hb.strip():
            path, _, symbol = hb.partition(":")
            target = ROOT / path
            if not target.is_file():
                errors.append(f"{tag}: handled_by file not found: {path}")
            elif symbol:
                if target.suffix != ".py":
                    errors.append(f"{tag}: handled_by symbol given for a non-Python file")
                elif not _symbol_defined(target.read_text(encoding="utf-8"), symbol):
                    errors.append(f"{tag}: handled_by symbol not defined in {path}: {symbol}")
        ev = e.get("evidence")
        if isinstance(ev, str) and ev.strip():
            if not ev.startswith(EVIDENCE_URL_PREFIX) and not (ROOT / ev).is_file():
                errors.append(f"{tag}: evidence is neither an existing repo path nor an "
                              f"{EVIDENCE_URL_PREFIX} URL: {ev}")
        if isinstance(fr, str) and fr >= EVIDENCE_REF_FROM:
            if not (isinstance(e.get("evidence_ref"), str) and e["evidence_ref"].strip()):
                errors.append(f"{tag}: entries from {EVIDENCE_REF_FROM} need an evidence_ref "
                              "(a fingerprint diff line or a dq-results key)")
    return errors


def build_payload(entries: list[dict]) -> dict:
    ordered = sorted(entries, key=lambda e: (e["first_release"], e["id"]))
    return {"schema_version": 1, "entries": ordered}


def render(payload: dict) -> str:
    return json.dumps(payload, indent=2, ensure_ascii=False) + "\n"


def main(argv: list[str]) -> int:
    entries = load_entries()
    errors = validate(entries)
    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1
    text = render(build_payload(entries))
    if "--check" in argv:
        if not JSON_PATH.exists() or JSON_PATH.read_text() != text:
            print(f"{JSON_PATH} is stale; run analysis/source_changes.py", file=sys.stderr)
            return 1
        return 0
    JSON_PATH.write_text(text)
    print(f"wrote {JSON_PATH.relative_to(ROOT)} ({len(entries)} entries)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
