"""Re-check every source URL in networks.json and report what needs a person.

Run monthly from `.github/workflows/networks-link-check.yml`. Never writes to
the repo: it prints a report, optionally writes an issue body file, and sets
`needs_attention` and `issue_title` in $GITHUB_OUTPUT.

Probing uses curl, not urllib: Python's TLS stack gives false negatives on
WAF-fronted and TLS-intercepted hosts (same lesson as H26, H46, H51).

Classes: ok (2xx/3xx), blocked (401/403/429: the site refuses a bot, a person
should look), dead (any other 4xx/5xx), unreachable (curl failed, no status).
If every URL is unreachable the check itself is broken (no network, DNS), so
it exits 1 rather than filing an issue that blames every network.

    python3 analysis/networks_link_check.py --issue-body-file /tmp/body.md
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

NETWORKS_JSON = (
    Path(__file__).resolve().parent.parent
    / "frontend" / "public" / "api" / "v1" / "networks.json"
)
STALE_AFTER_DAYS = 180  # same rule as STALE_AFTER_DAYS in frontend/src/lib/networks.ts
USER_AGENT = "AINPI-link-check (+https://ainpi.dev/networks)"
BLOCKED = {401, 403, 429}

Result = tuple[str, "int | None"]


def classify(http_status: int | None, curl_exit: int) -> str:
    if curl_exit != 0 or not http_status:
        return "unreachable"
    if 200 <= http_status < 400:
        return "ok"
    if http_status in BLOCKED:
        return "blocked"
    return "dead"


def check_url(url: str, timeout: int = 20) -> Result:
    """Return (class, http_code). http_code is None when curl got no status."""
    try:
        proc = subprocess.run(
            ["curl", "-sS", "-L", "-o", "/dev/null", "-w", "%{http_code}",
             "--max-time", str(timeout), "-A", USER_AGENT, url],
            capture_output=True, text=True, timeout=timeout + 10,
        )
    except (subprocess.TimeoutExpired, OSError):
        return ("unreachable", None)
    try:
        code = int(proc.stdout.strip() or 0)
    except ValueError:
        code = 0
    return (classify(code, proc.returncode), code or None)


def collect_urls(payload: dict) -> dict[str, list[str]]:
    """Map each distinct URL to the ids (network or route) that cite it."""
    urls: dict[str, list[str]] = {}

    def add(url, owner):
        if isinstance(url, str) and url:
            owners = urls.setdefault(url, [])
            if owner not in owners:
                owners.append(owner)

    for kind, key in (("route", "routes"), ("network", "networks")):
        for item in payload.get(key) or []:
            owner = f"{kind} {item.get('id', '?')}"
            for s in item.get("sources") or []:
                add(s.get("url"), owner)
            if kind == "network":
                add(item.get("website"), owner)
    return urls


def build_report(payload: dict, results: dict[str, Result], as_of: dt.date) -> tuple[bool, str]:
    urls = collect_urls(payload)
    groups: dict[str, list[str]] = {"dead": [], "unreachable": [], "blocked": []}
    for url, owners in urls.items():
        status, code = results.get(url, ("unreachable", None))
        if status not in groups:
            continue
        shown = f"HTTP {code}" if code else "no response"
        for owner in owners:
            groups[status].append(f"- {owner}: {url} ({shown})")

    stale = []
    for n in payload.get("networks") or []:
        try:
            last = dt.date.fromisoformat(str(n.get("last_checked", ""))[:10])
        except ValueError:
            stale.append(f"- network {n.get('id', '?')}: last_checked missing or invalid")
            continue
        age = (as_of - last).days
        if age > STALE_AFTER_DAYS:
            stale.append(f"- network {n.get('id', '?')}: last checked {last.isoformat()} ({age} days ago)")

    sections = [
        ("Dead or moved", groups["dead"]),
        ("Unreachable", groups["unreachable"]),
        ("Check by hand (blocked by the site)", groups["blocked"]),
        (f"Stale entries (last checked more than {STALE_AFTER_DAYS} days ago)", stale),
    ]
    sections = [(h, lines) for h, lines in sections if lines]
    if not sections:
        return False, ""
    parts = [f"Monthly source check, as of {as_of.isoformat()}. Re-verify each item against the source and update `frontend/public/api/v1/networks.json` (sources, `accessed`, `last_checked`).\n"]
    for h, lines in sections:
        parts.append(f"## {h}\n\n" + "\n".join(lines) + "\n")
    return True, "\n".join(parts)


def _set_output(**kv: str) -> None:
    path = os.environ.get("GITHUB_OUTPUT")
    if path:
        with open(path, "a", encoding="utf-8") as f:
            for k, v in kv.items():
                f.write(f"{k}={v}\n")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--networks", type=Path, default=NETWORKS_JSON)
    ap.add_argument("--issue-body-file", type=Path)
    ap.add_argument("--as-of", type=dt.date.fromisoformat, default=None, help="YYYY-MM-DD; default today UTC")
    ap.add_argument("--timeout", type=int, default=20)
    args = ap.parse_args(argv)

    as_of = args.as_of or dt.datetime.now(dt.timezone.utc).date()
    payload = json.loads(args.networks.read_text(encoding="utf-8"))
    urls = sorted(collect_urls(payload))
    title = f"Network sources need re-verification {as_of.strftime('%Y-%m')}"

    with ThreadPoolExecutor(max_workers=4) as ex:
        results = dict(zip(urls, ex.map(lambda u: check_url(u, args.timeout), urls)))

    if urls and all(r[0] == "unreachable" for r in results.values()):
        print(f"All {len(urls)} URLs unreachable: the check itself looks broken "
              "(network or DNS), not the sources. No issue body written.", file=sys.stderr)
        return 1

    needs, body = build_report(payload, results, as_of)
    print(f"Checked {len(urls)} URLs as of {as_of.isoformat()}; needs_attention={str(needs).lower()}")
    if needs:
        print(body)
        if args.issue_body_file:
            args.issue_body_file.write_text(body, encoding="utf-8")
    _set_output(needs_attention=str(needs).lower(), issue_title=title)
    return 0


if __name__ == "__main__":
    sys.exit(main())
