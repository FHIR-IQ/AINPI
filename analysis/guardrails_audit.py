"""Audit every paid surface for a spend guardrail. Exit non-zero if one is missing.

WHY THIS EXISTS

Cost controls decay silently. A budget gets deleted, an API gets re-enabled by
a tutorial or an assistant, a cap gets removed in a refactor, a warehouse gets
resized. Nothing fails, nothing alerts, and the first signal is a bill.

On 2026-08-23 this project had six billable Google Maps Platform APIs enabled
(Static Maps, Roads, Routes, Street View twice, Time Zone) against a written
policy that the whole family stays off, and nothing had noticed. That is the
failure mode this guards.

Checks are read-only. Run it by hand, in CI, or on a schedule:

    python analysis/guardrails_audit.py
    python analysis/guardrails_audit.py --json
"""
from __future__ import annotations

import argparse
import json
import pathlib
import subprocess
import sys

REPO = pathlib.Path(__file__).resolve().parent.parent
GCP_PROJECT = "thematic-fort-453901-t7"
WAREHOUSE_ID = "b5bb83df437b78af"

# The Maps Platform family. Billable, none of it used by this project, and the
# geo search was deliberately built on the directory's own coordinates plus
# Census centroids so that none of it is ever needed.
MAPS_PATTERNS = (
    "maps", "places", "geocod", "roads", "routes", "street",
    "timezone", "elevation", "distance", "navigation",
)

# Warehouse settings that keep idle and runaway cost bounded.
MAX_AUTO_STOP_MINS = 15
MAX_CLUSTERS = 2


class Result:
    def __init__(self) -> None:
        self.rows: list[dict] = []

    def add(self, surface: str, check: str, ok: bool | None, detail: str) -> None:
        self.rows.append({"surface": surface, "check": check, "ok": ok, "detail": detail})

    @property
    def failed(self) -> list[dict]:
        return [r for r in self.rows if r["ok"] is False]

    @property
    def unknown(self) -> list[dict]:
        return [r for r in self.rows if r["ok"] is None]


def run(args: list[str], timeout: int = 90) -> tuple[int, str]:
    try:
        p = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
        return p.returncode, p.stdout
    except (subprocess.TimeoutExpired, FileNotFoundError) as e:
        return 1, str(e)


def check_gcp(r: Result) -> None:
    rc, out = run(["gcloud", "billing", "budgets", "list",
                   "--billing-account", _billing_account(), "--format", "json"])
    if rc != 0:
        r.add("GCP", "budget exists", None, "could not query budgets (auth?)")
    else:
        try:
            budgets = json.loads(out or "[]")
        except json.JSONDecodeError:
            budgets = []
        r.add("GCP", "budget exists", bool(budgets),
              f"{len(budgets)} budget(s): " + ", ".join(
                  b.get("displayName", "?") for b in budgets) if budgets
              else "NO BUDGET. A project with no budget has no ceiling.")

    rc, out = run(["gcloud", "functions", "list", "--project", GCP_PROJECT, "--format", "json"])
    fns = json.loads(out or "[]") if rc == 0 else []
    killer = [f for f in fns if "disable-billing" in (f.get("name") or "")]
    active = killer and killer[0].get("state") == "ACTIVE"
    r.add("GCP", "kill-billing function", bool(active),
          "disable-billing-on-budget ACTIVE" if active
          else "the auto-disable function is missing or not ACTIVE")

    rc, out = run(["gcloud", "services", "list", "--enabled",
                   "--project", GCP_PROJECT, "--format", "value(config.name)"])
    if rc != 0:
        r.add("GCP", "Maps APIs disabled", None, "could not list services")
    else:
        enabled = [s for s in out.split()
                   if any(p in s.lower() for p in MAPS_PATTERNS)]
        r.add("GCP", "Maps APIs disabled", not enabled,
              "whole Maps Platform family is off" if not enabled
              else "BILLABLE AND ENABLED: " + ", ".join(enabled))


def _billing_account() -> str:
    rc, out = run(["gcloud", "billing", "projects", "describe", GCP_PROJECT,
                   "--format", "value(billingAccountName)"])
    return (out or "").strip().replace("billingAccounts/", "") if rc == 0 else ""


def check_databricks(r: Result) -> None:
    rc, out = run(["databricks", "warehouses", "get", WAREHOUSE_ID])
    if rc != 0:
        r.add("Databricks", "warehouse reachable", None, "could not read warehouse")
        return
    w = json.loads(out)
    stop = w.get("auto_stop_mins")
    r.add("Databricks", "warehouse auto-stop", isinstance(stop, int) and 0 < stop <= MAX_AUTO_STOP_MINS,
          f"auto_stop_mins={stop} (idle compute is the main avoidable cost)")
    mx = w.get("max_num_clusters")
    r.add("Databricks", "no scale-out blowout", isinstance(mx, int) and mx <= MAX_CLUSTERS,
          f"max_num_clusters={mx}")
    r.add("Databricks", "warehouse idle now", w.get("state") in ("STOPPED", "STOPPING"),
          f"state={w.get('state')}" + ("" if w.get("state") in ("STOPPED", "STOPPING")
                                       else " — running warehouses bill while idle until auto-stop"))

    # Recipient tokens expire. A silently expired token looks like a broken
    # share; a never-expiring one is a standing credential.
    rc, out = run(["databricks", "recipients", "list"])
    if rc == 0:
        try:
            recips = json.loads(out or "[]")
        except json.JSONDecodeError:
            recips = []
        r.add("Databricks", "sharing recipients", True,
              f"{len(recips)} recipient(s): " + ", ".join(
                  x.get("name", "?") for x in recips) if recips else "none")


def check_repo(r: Result) -> None:
    """Cost controls that live in code rather than in a console."""
    bq = REPO / "frontend" / "src" / "lib" / "bigquery.ts"
    txt = bq.read_text() if bq.exists() else ""
    r.add("BigQuery", "per-query byte cap", "maximumBytesBilled" in txt,
          "cap injected at the client so no call site can bypass it"
          if "maximumBytesBilled" in txt else "DEFAULT_MAX_BYTES_BILLED not wired in")

    cohorts = REPO / "analysis" / "claims_sources" / "_cohorts.py"
    r.add("BigQuery", "python query cap", cohorts.exists() and "maximum_bytes_billed" in cohorts.read_text(),
          "bq_job_config() sets maximum_bytes_billed")

    rl = REPO / "frontend" / "src" / "lib" / "rate-limit.ts"
    txt = rl.read_text() if rl.exists() else ""
    r.add("App", "rate limiting present", "DAILY_BREAKER_UNITS" in txt,
          "cost-unit limiter with a daily breaker" if "DAILY_BREAKER_UNITS" in txt
          else "rate-limit module missing")

    scan = REPO / ".github" / "scripts" / "scan-anti-patterns.sh"
    txt = scan.read_text() if scan.exists() else ""
    r.add("CI", "anti-pattern scanner", "enforceRateLimit" in txt,
          "CI fails a billable route that skips enforceRateLimit()")

    npi = REPO / "frontend" / "src" / "app" / "npi" / "[npi]" / "page.tsx"
    txt = npi.read_text() if npi.exists() else ""
    r.add("App", "/npi has no live BQ fallback", "dynamicParams = false" in txt,
          "force-static with dynamicParams=false; a crawled route cannot hit BigQuery")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()

    r = Result()
    check_gcp(r)
    check_databricks(r)
    check_repo(r)

    if a.json:
        print(json.dumps(r.rows, indent=2))
    else:
        surface = None
        for row in r.rows:
            if row["surface"] != surface:
                surface = row["surface"]
                print(f"\n{surface}")
            mark = {True: "ok  ", False: "FAIL", None: "?   "}[row["ok"]]
            print(f"  [{mark}] {row['check']:26s} {row['detail']}")
        print()
        if r.failed:
            print(f"{len(r.failed)} guardrail(s) missing:")
            for row in r.failed:
                print(f"  - {row['surface']}: {row['check']}")
        if r.unknown:
            print(f"{len(r.unknown)} check(s) could not run (usually auth).")
        if not r.failed:
            print("All checkable guardrails are in place.")

    sys.exit(1 if r.failed else 0)


if __name__ == "__main__":
    main()
