#!/usr/bin/env python3
"""Verify the MCP server Marketplace listing says what the spec says.

**The MCP listing cannot be created by script, and this file does not pretend
otherwise.** Databricks documents MCP listing creation as a Provider Console
flow, and the MCP-specific fields (authentication type, host, port, base path,
tag) have no representation in the Marketplace API: read any of the 76 live
pure-MCP listings and the detail block carries the same keys as a dataset
listing and nothing else. So `marketplace_publish.py` owns the archive listing,
which the API can create, and this owns the check for the one it cannot.

What it does:

1. Reads the listing back, because an accepted write is not evidence. Compares
   categories, assets, cost, listing type and the policy links to the spec.
2. Rejects any category outside the enum. `AI` is the *product category* in the
   console picker and is NOT a member of the API `categories` enum; sending it
   there is dropped silently, which is how this project lost a category once.
3. Probes the endpoint the listing advertises, because a listing pointing at a
   dead host is worse than no listing. Anonymous access must work, since the
   copy promises it, and the tier headers must come back.
4. Says plainly which fields it could not check rather than reporting a pass
   that covers less than the reader assumes.

Usage:
    python3 analysis/verify_mcp_listing.py
    python3 analysis/verify_mcp_listing.py --name "AINPI Provider Directory MCP"
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys

LISTING_NAME = "AINPI Provider Directory Audit (MCP)"

# The advertised endpoint. These are the values typed into the console form,
# repeated here so the probe tests what a consumer would actually be handed.
MCP_HOST = "ainpi.dev"
MCP_PORT = 443
MCP_BASE_PATH = "/api/mcp"

SPEC = {
    # Subject categories, which is the API field. Not the console's product
    # category, which is AI and lives somewhere this API does not expose.
    "categories": ["HEALTH", "PUBLIC_SECTOR"],
    "assets": ["ASSET_TYPE_MCP"],
    "cost": "FREE",
    "listing_type": "STANDARD",
    "terms_of_service": "https://ainpi.dev/terms",
    "privacy_policy_link": "https://ainpi.dev/privacy",
    "documentation_link": "https://ainpi.dev/developer",
}

# Enumerated from the live consumer catalogue on 2026-09-06, not guessed.
# Regenerate with:
#   databricks consumer-listings list -o json | jq -r '.[].summary.categories[]' | sort -u
VALID_CATEGORIES = {
    "ADVERTISING_AND_MARKETING", "CLIMATE_AND_ENVIRONMENT", "COMMERCE",
    "DEMOGRAPHICS", "ECONOMICS", "EDUCATION", "ENERGY", "FINANCIAL", "GAMING",
    "GEOSPATIAL", "HEALTH", "LOOKUP_TABLES", "MANUFACTURING", "MEDIA",
    "OPEN_SOURCE", "OTHER", "PUBLIC_SECTOR", "RETAIL", "SCIENCE_AND_RESEARCH",
    "SECURITY", "SPORTS", "TRANSPORTATION_AND_LOGISTICS", "TRAVEL_AND_TOURISM",
}

# Fields the console asks for and the API will not give back. Listing them is
# the point: a check that silently covers less than the reader assumes is the
# same defect as a listing that promises a notebook it does not carry.
CONSOLE_ONLY = [
    "authentication type (Bearer Token)",
    f"host ({MCP_HOST})",
    f"port ({MCP_PORT})",
    f"base path ({MCP_BASE_PATH})",
    "tag",
]


def sh(args: list[str]) -> tuple[int, str]:
    p = subprocess.run(args, capture_output=True, text=True)
    return p.returncode, (p.stdout or p.stderr)


def curl(args: list[str]) -> tuple[int, str]:
    """curl, not urllib. Python's TLS stack has produced false negatives against
    WAF-fronted hosts and under local TLS interception in H26, H46 and H51."""
    return sh(["curl", "-sS", "--max-time", "30", *args])


def find_listing(name: str) -> dict | None:
    rc, out = sh(["databricks", "provider-listings", "list", "-o", "json"])
    if rc != 0:
        print(f"  cannot list listings: {out.strip()[:200]}")
        return None
    for l in json.loads(out or "[]"):
        if (l.get("summary") or {}).get("name") == name:
            return l
    return None


def check_listing(listing: dict) -> list[str]:
    """Compare the stored listing to the spec. Returns failures."""
    fails: list[str] = []
    summary = listing.get("summary") or {}
    detail = listing.get("detail") or {}

    stored_cats = sorted(summary.get("categories") or [])
    unknown = [c for c in stored_cats if c not in VALID_CATEGORIES]
    if unknown:
        fails.append(f"categories not in the enum, so silently dropped: {unknown}")
    if stored_cats != sorted(SPEC["categories"]):
        fails.append(f"categories: want {sorted(SPEC['categories'])}, stored {stored_cats}")

    for label, want, got in (
        ("assets", sorted(SPEC["assets"]), sorted(detail.get("assets") or [])),
        ("cost", SPEC["cost"], detail.get("cost")),
        ("listingType", SPEC["listing_type"], summary.get("listingType")),
        ("terms", SPEC["terms_of_service"], detail.get("terms_of_service")),
        ("privacy", SPEC["privacy_policy_link"], detail.get("privacy_policy_link")),
        ("docs", SPEC["documentation_link"], detail.get("documentation_link")),
    ):
        if want != got:
            fails.append(f"{label}: want {want!r}, stored {got!r}")

    visibility = (summary.get("setting") or {}).get("visibility")
    if visibility != "PUBLIC":
        fails.append(f"visibility is {visibility!r}; a private listing has no audience")
    return fails


def check_endpoint() -> list[str]:
    """The listing points at a live server, so prove the server is live.

    Anonymous access has to work because the listing copy says it does. If that
    ever stops being true the copy is wrong, not the check.
    """
    fails: list[str] = []
    url = f"https://{MCP_HOST}{MCP_BASE_PATH}"
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
    rc, out = curl([
        "-D", "-", "-o", "/dev/null",
        "-X", "POST", url,
        "-H", "Content-Type: application/json",
        "-H", "Accept: application/json, text/event-stream",
        "--data", body,
    ])
    if rc != 0:
        return [f"endpoint {url} unreachable: {out.strip()[:200]}"]

    head = out.lower()
    status = next((l for l in out.splitlines() if l.startswith("HTTP/")), "")
    if " 200" not in status and " 202" not in status:
        fails.append(f"endpoint {url} answered {status.strip() or 'nothing'} anonymously; "
                     "the listing says no signup is needed to start")
    if "x-ratelimit-tier" not in head:
        fails.append("no x-ratelimit-tier header, so a consumer cannot tell which "
                     "tier answered them")
    return fails


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--name", default=LISTING_NAME, help="listing name to verify")
    args = ap.parse_args()

    print(f"Verifying MCP listing: {args.name}\n")

    fails: list[str] = []
    listing = find_listing(args.name)
    if listing is None:
        print("  NOT FOUND. Create it in the Provider Console first:")
        print("    Marketplace > Provider console > Listings > Create listing")
        print("    Listing type MCP Server, product category AI.")
        print(f"    Host {MCP_HOST}, port {MCP_PORT}, base path {MCP_BASE_PATH},")
        print("    authentication type Bearer Token.")
        print("    Copy lives in docs/marketplace-listings.md as Listing 2.")
        return 1

    lid = listing.get("id")
    print(f"  found: {lid}")
    fails += check_listing(listing)
    fails += check_endpoint()

    print("\n  not checkable through the API, confirm by eye in the console:")
    for f in CONSOLE_ONLY:
        print(f"    - {f}")

    if fails:
        print(f"\n  {len(fails)} problem(s):")
        for f in fails:
            print(f"    FAIL {f}")
        return 1
    print("\n  Every API-visible field matches the spec and the endpoint answers "
          "anonymously.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
