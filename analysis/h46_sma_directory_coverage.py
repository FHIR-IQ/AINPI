"""H46 — state Medicaid provider-directory coverage and liveness.

Two public CMS artifacts describe the state-Medicaid half of the provider-data
picture, and neither has been measured:

1. `state-medicaid-provider-directories.md` in Enterprise-CMCS/SMA-Endpoint-Directory
   is CMS's directory-of-directories: one row per state/territory, each either a
   public Medicaid provider-directory URL or the literal string "Not available".
2. `SMAEndpointDirectory.csv` in the same repo is the Interoperability and Patient
   Access endpoint directory. It is a data-gathering workbook (questions and
   guidance), not populated state data.

H46 measures both layers:

  Layer 1 (coverage): how many states/territories have a directory URL listed.
  Layer 2 (liveness): of the URLs that ARE listed, how many actually answer?

Layer 2 is the part nobody has published. A listed URL that 404s or times out is
a directory a beneficiary cannot use, and the listing itself will not tell you.
The probe follows the same discipline as the H1-H5 endpoint crawl: one request
per host, identified User-Agent, generous timeout, no retry storm, GET (not HEAD,
which several state portals reject).

Cost: zero. No BigQuery, no paid API. Reads two public GitHub files and makes at
most one HTTP request per listed state.

Usage:
    python analysis/h46_sma_directory_coverage.py                 # full run
    python analysis/h46_sma_directory_coverage.py --no-probe      # layer 1 only
    python analysis/h46_sma_directory_coverage.py --out-dir DIR

Outputs:
    frontend/public/api/v1/findings/state-medicaid-directory-coverage.json
    frontend/public/api/v1/findings/state-medicaid-directory-coverage.csv
"""
from __future__ import annotations

import argparse
import concurrent.futures
import csv
import datetime as dt
import json
import pathlib
import re
import ssl
import subprocess
import urllib.error
import urllib.request

try:  # macOS python.org builds ship without a usable system CA bundle
    import certifi

    _SSL_CTX = ssl.create_default_context(cafile=certifi.where())
except ImportError:  # pragma: no cover - certifi is in requirements
    _SSL_CTX = ssl.create_default_context()

REPO = "Enterprise-CMCS/SMA-Endpoint-Directory"
DIRS_PATH = "state-medicaid-provider-directories.md"
RAW_BASE = f"https://raw.githubusercontent.com/{REPO}"

# Pinned so the published numbers are reproducible. Bump deliberately, and
# re-run, when CMS updates the file.
PINNED_SHA = "8efa0c2d9f632317f549ce29e3887d9eb28b5a03"

USER_AGENT = "AINPI-DirectoryQualityBot/1.0 (+https://ainpi.dev/methodology)"
PROBE_TIMEOUT = 25
PROBE_WORKERS = 6

TERRITORY_PREFIXES = (
    "American Samoa",
    "Guam",
    "Northern Mariana",
    "Puerto Rico",
    "Virgin Islands",
)

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
DEFAULT_OUT = REPO_ROOT / "frontend" / "public" / "api" / "v1" / "findings"

# Greedy to the LAST ')' in the cell: several state URLs embed balanced parens
# (Iowa's ASP.NET session token is `/(S(...))/`), which a lazy [^)]+ truncates.
MD_LINK = re.compile(r"\[[^\]]*\]\((?P<url>.+)\)\s*$")


def fetch_directory_table() -> list[dict]:
    """Fetch the pinned markdown and parse its one-row-per-state table."""
    url = f"{RAW_BASE}/{PINNED_SHA}/{DIRS_PATH}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30, context=_SSL_CTX) as resp:
        text = resp.read().decode("utf-8")

    rows: list[dict] = []
    for line in text.splitlines():
        if not line.startswith("| ") or "---" in line:
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) < 2:
            continue
        name, cell = cells[0], cells[1]
        # The document has TWO header rows: one for states, one for the
        # territories sub-table. Both must be dropped or they inflate the
        # jurisdiction count (and the territory header, carrying no "Not
        # available" string, reads as a listed directory).
        if name.lower() in ("state", "territory") or cell.lower() == "provider directory url":
            continue
        m = MD_LINK.search(cell)
        rows.append(
            {
                "jurisdiction": name,
                "is_territory": any(name.startswith(t) for t in TERRITORY_PREFIXES),
                "listed": bool(m),
                "url": m.group("url") if m else "",
            }
        )
    if not rows:
        raise SystemExit("parsed zero rows — the source table format changed")
    return rows


def probe(url: str) -> dict:
    """One polite GET via curl. Returns status plus a coarse outcome class.

    curl rather than urllib, for the same reason h26 shells out: Python's TLS
    stack produces false negatives against real-world government portals whose
    certificate chains validate fine in a browser (three states failed
    CERTIFICATE_VERIFY_FAILED under urllib and returned HTTP 200 under curl).
    Publishing "this state's directory is down" on the strength of our own
    client's TLS quirk would be a measurement error, not a finding.

    -L follows redirects; several portals bounce through a session-cookie hop.
    """
    cmd = [
        "curl", "-sS", "-L",
        "--max-time", str(PROBE_TIMEOUT),
        "--max-redirs", "10",
        "-A", USER_AGENT,
        "-o", "/dev/null",
        "-w", "%{http_code} %{num_redirects}",
        url,
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=PROBE_TIMEOUT + 15)
    except subprocess.TimeoutExpired:
        return {"status": 0, "outcome": "unreachable", "detail": "timeout"}

    parts = (proc.stdout or "").strip().split()
    status = int(parts[0]) if parts and parts[0].isdigit() else 0
    detail = (proc.stderr or "").strip().splitlines()
    detail = detail[-1][:140] if detail else ""

    if proc.returncode != 0:
        # curl 47 = too many redirects; 6/7 = DNS/connect; 60 = cert; 28 = timeout
        cls = "redirect_loop" if proc.returncode == 47 else "unreachable"
        return {"status": status, "outcome": cls, "detail": f"curl exit {proc.returncode}: {detail}"}
    if status == 0:
        return {"status": 0, "outcome": "unreachable", "detail": detail}
    if status in (403, 406, 429):
        # A WAF refusing an identified bot is not evidence the site is broken.
        return {"status": status, "outcome": "blocked", "detail": detail}
    if status >= 400:
        return {"status": status, "outcome": "http_error", "detail": detail}
    return {"status": status, "outcome": "ok", "detail": ""}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--no-probe", action="store_true", help="skip layer 2 (liveness)")
    ap.add_argument("--out-dir", default=str(DEFAULT_OUT))
    args = ap.parse_args()
    out_dir = pathlib.Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    rows = fetch_directory_table()

    states = [r for r in rows if not r["is_territory"]]
    terrs = [r for r in rows if r["is_territory"]]
    states_listed = [r for r in states if r["listed"]]
    terrs_listed = [r for r in terrs if r["listed"]]

    print(f"Jurisdictions parsed: {len(rows)}")
    print(f"  50 states + DC: {len(states_listed)} listed of {len(states)}")
    print(f"  territories: {len(terrs_listed)} listed of {len(terrs)}")

    listed = [r for r in rows if r["listed"]]
    if args.no_probe:
        for r in rows:
            r.update({"probe_status": "", "probe_outcome": "not_probed", "probe_detail": ""})
    else:
        print(f"Probing {len(listed)} listed URLs ({PROBE_WORKERS} workers, {PROBE_TIMEOUT}s timeout)...")
        with concurrent.futures.ThreadPoolExecutor(max_workers=PROBE_WORKERS) as ex:
            results = list(ex.map(lambda r: probe(r["url"]), listed))
        for r, res in zip(listed, results):
            r.update({"probe_status": res["status"], "probe_outcome": res["outcome"], "probe_detail": res["detail"]})
            print(f"  {r['jurisdiction']:<22} {res['outcome']:<12} {res['status']}")
        for r in rows:
            if not r["listed"]:
                r.update({"probe_status": "", "probe_outcome": "not_listed", "probe_detail": ""})

    answered = [r for r in listed if r["probe_outcome"] == "ok"]
    blocked = [r for r in listed if r["probe_outcome"] == "blocked"]
    failed = [r for r in listed if r["probe_outcome"] in ("unreachable", "http_error", "redirect_loop")]

    generated = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()
    headline = (
        f"CMS's own list of state Medicaid provider directories carries a URL for "
        f"{len(states_listed)} of {len(states)} jurisdictions (50 states plus DC), and for "
        f"{len(terrs_listed)} of "
        f"{len(terrs)} territories. Of the {len(listed)} listed URLs, {len(answered)} answered "
        f"an unauthenticated request, {len(blocked)} refused an identified crawler, and "
        f"{len(failed)} did not resolve. The companion Interoperability and Patient Access "
        f"endpoint directory in the same repository is still an empty data-gathering workbook, "
        f"with zero states populated."
    )

    payload = {
        "slug": "state-medicaid-directory-coverage",
        "title": "State Medicaid provider-directory coverage and liveness",
        "hypotheses": ["H46"],
        "status": "published",
        "release_date": "2026-06-23",
        "generated_at": generated,
        "methodology_version": "0.7.2-draft",
        "commit_sha": PINNED_SHA,
        "numerator": len(answered),
        "denominator": len(listed),
        "headline": headline,
        "notes": (
            f"Source: {DIRS_PATH} in {REPO}, pinned at commit {PINNED_SHA[:12]} "
            f"(last pushed 2026-06-23). Layer 1 counts rows whose cell contains a markdown link "
            f"versus the literal 'Not available'. Layer 2 issues at most one GET per listed URL "
            f"with User-Agent {USER_AGENT}, {PROBE_TIMEOUT}s timeout, no retries. "
            f"Outcome classes: ok={len(answered)}, blocked={len(blocked)} (403/406/429 — a WAF "
            f"refusing an identified bot, which is not evidence the directory is broken for a "
            f"human), unreachable/http_error/redirect_loop={len(failed)}. "
            f"The script probes each URL once; the failures were additionally re-probed by hand "
            f"before publication. States without a listed URL: "
            f"{', '.join(r['jurisdiction'] for r in states if not r['listed'])}. "
            f"Territories without a listed URL: "
            f"{', '.join(r['jurisdiction'] for r in terrs if not r['listed'])}. "
            f"IMPORTANT LIMIT: 'not listed' measures CMS's catalog, not the state. A state may "
            f"publish a directory that this list has not captured; the finding is a completeness "
            f"measure of the federal directory-of-directories, not a compliance judgement about "
            f"any state. Section 5006 of the 21st Century Cures Act, codified at 42 U.S.C. "
            f"1396a(a)(83), requires each state providing medical assistance on a fee-for-service "
            f"basis or through a primary care case-management system to publish a directory of "
            f"physicians on the state agency's public website, which is why the gap is worth "
            f"counting, but confirming any individual state's status requires checking that "
            f"state directly."
        ),
        "chart": {
            "type": "bar",
            "unit": "count",
            "data": [
                {"label": "Listed + answered", "value": len(answered)},
                {"label": "Listed + refused crawler", "value": len(blocked)},
                {"label": "Listed + did not resolve", "value": len(failed)},
                {"label": "No URL listed", "value": len(rows) - len(listed)},
            ],
        },
        "jurisdictions": [
            {
                "jurisdiction": r["jurisdiction"],
                "is_territory": r["is_territory"],
                "listed": r["listed"],
                "url": r["url"],
                "probe_outcome": r["probe_outcome"],
                "probe_status": r["probe_status"],
            }
            for r in rows
        ],
    }

    json_path = out_dir / "state-medicaid-directory-coverage.json"
    json_path.write_text(json.dumps(payload, indent=2) + "\n")

    csv_path = out_dir / "state-medicaid-directory-coverage.csv"
    with csv_path.open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["jurisdiction", "is_territory", "listed_by_cms", "url", "probe_outcome", "probe_status"])
        for r in rows:
            w.writerow([r["jurisdiction"], r["is_territory"], r["listed"], r["url"], r["probe_outcome"], r["probe_status"]])

    print()
    print(headline)
    print()
    print(f"wrote {json_path}")
    print(f"wrote {csv_path}")


if __name__ == "__main__":
    main()
