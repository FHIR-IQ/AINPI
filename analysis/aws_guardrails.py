"""AWS cost guardrails: check what exists, create what is missing, verify the write.

WHY THIS EXISTS

This project already runs a hard-cap architecture on GCP and Databricks. AWS was
outside it because nothing in AINPI touches AWS directly: no SDK, no boto3, no
credentials. If that changes, the controls should be enforced the same way the
others are rather than remembered once.

THE MISTAKE THIS IS BUILT TO AVOID

A budget that is scoped to part of your spend shows green while the spend that
matters goes unwatched. That already happened on Databricks in this project: a
budget named "AINPI" filtered to the `genie` product tag, alerting on a slice
nobody was using. So `--check` fails a budget that carries a CostFilter, and
says why, rather than counting it.

WHAT IT CANNOT DO

Nothing here creates credentials, and nothing here can enable Cost Explorer.
Both are console actions. Cost Explorer also backfills for up to 24 hours after
you enable it, so the anomaly-detection checks report "unavailable" rather than
"missing" until it is ready. Those are different states and conflating them is
how a guardrail gets reported as present when it is not.

    python3 analysis/aws_guardrails.py --check
    python3 analysis/aws_guardrails.py --apply --email you@example.com
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys

BUDGET_NAME = "account-wide-spend"
MONITOR_NAME = "account-wide-anomalies"
# Credits-only accounts should bill nothing. A low actual threshold catches the
# first real dollar; the forecast threshold catches a leak that would not reach
# the monthly figure until the month is nearly over.
ACTUAL_USD = "1"
FORECAST_USD = "10"


def aws(*args: str) -> tuple[int, str]:
    if not shutil.which("aws"):
        return 127, "aws CLI not installed"
    p = subprocess.run(["aws", *args], capture_output=True, text=True)
    return p.returncode, (p.stdout or p.stderr).strip()


def account_id() -> str | None:
    rc, out = aws("sts", "get-caller-identity", "--output", "json")
    if rc != 0:
        return None
    try:
        return json.loads(out)["Account"]
    except (json.JSONDecodeError, KeyError):
        return None


def check(acct: str) -> bool:
    ok = True

    rc, out = aws("iam", "get-account-summary", "--output", "json")
    if rc == 0:
        m = json.loads(out).get("SummaryMap", {})
        mfa = m.get("AccountMFAEnabled", 0) == 1
        keys = m.get("AccountAccessKeysPresent", 0)
        print(f"  [{'ok  ' if mfa else 'FAIL'}] root MFA{'':16} "
              f"{'enabled' if mfa else 'NOT enabled: anyone with the root password owns the account'}")
        # Root access keys cannot be scoped and cannot be partially revoked.
        print(f"  [{'ok  ' if keys == 0 else 'FAIL'}] no root access keys     "
              f"{'none' if keys == 0 else f'{keys} present; root keys cannot be scoped'}")
        ok = ok and mfa and keys == 0
    else:
        print("  [?   ] IAM summary            cannot read (permissions)")

    rc, out = aws("budgets", "describe-budgets", "--account-id", acct, "--output", "json")
    if rc == 0:
        buds = json.loads(out or "{}").get("Budgets", [])
        unfiltered = [b for b in buds if not b.get("CostFilters")]
        filtered = len(buds) - len(unfiltered)
        good = bool(unfiltered)
        note = f"{len(unfiltered)} covering all spend"
        if filtered:
            note += f"; {filtered} scoped to a filter and NOT counted"
        print(f"  [{'ok  ' if good else 'FAIL'}] budget{'':18} {note if buds else 'none'}")
        ok = ok and good
    else:
        print("  [?   ] budget                 cannot read (permissions)")

    rc, out = aws("ce", "get-anomaly-monitors", "--output", "json")
    if rc == 0:
        mons = json.loads(out or "{}").get("AnomalyMonitors", [])
        print(f"  [{'ok  ' if mons else 'FAIL'}] anomaly detection      "
              f"{len(mons)} monitor(s)" if mons else
              "  [FAIL] anomaly detection      none; a slow leak never trips a monthly budget")
        ok = ok and bool(mons)
    else:
        # Not the same as missing. Cost Explorer is console-enabled and backfills.
        print("  [?   ] anomaly detection      unavailable; enable Cost Explorer, then wait up to 24h")

    rc, out = aws("freetier", "get-free-tier-usage", "--output", "json")
    if rc == 0:
        n = len(json.loads(out or "{}").get("freeTierUsages", []))
        print(f"  [ok  ] free tier usage        readable, {n} tracked service(s)")
    else:
        print("  [?   ] free tier usage        not readable on this account/plan")

    return ok


def apply(acct: str, email: str) -> bool:
    ok = True
    rc, out = aws("budgets", "describe-budgets", "--account-id", acct, "--output", "json")
    names = {b["BudgetName"] for b in json.loads(out or "{}").get("Budgets", [])} if rc == 0 else set()

    if BUDGET_NAME in names:
        print(f"  budget {BUDGET_NAME}: already present")
    else:
        budget = {
            "BudgetName": BUDGET_NAME,
            "BudgetLimit": {"Amount": FORECAST_USD, "Unit": "USD"},
            "TimeUnit": "MONTHLY",
            "BudgetType": "COST",
            # No CostFilters on purpose. See the module docstring.
        }
        subs = [{"SubscriptionType": "EMAIL", "Address": email}]
        notes = [
            {"Notification": {"NotificationType": "ACTUAL", "ComparisonOperator": "GREATER_THAN",
                              "Threshold": float(ACTUAL_USD) / float(FORECAST_USD) * 100,
                              "ThresholdType": "PERCENTAGE"}, "Subscribers": subs},
            {"Notification": {"NotificationType": "FORECASTED", "ComparisonOperator": "GREATER_THAN",
                              "Threshold": 100.0, "ThresholdType": "PERCENTAGE"}, "Subscribers": subs},
        ]
        rc, out = aws("budgets", "create-budget", "--account-id", acct,
                      "--budget", json.dumps(budget),
                      "--notifications-with-subscribers", json.dumps(notes))
        print(f"  budget {BUDGET_NAME}: {'created' if rc == 0 else 'FAILED ' + out[:200]}")
        ok = ok and rc == 0

    rc, out = aws("ce", "get-anomaly-monitors", "--output", "json")
    if rc != 0:
        print("  anomaly monitor: skipped, Cost Explorer not enabled yet")
    else:
        mons = json.loads(out or "{}").get("AnomalyMonitors", [])
        if mons:
            print(f"  anomaly monitor: already present ({len(mons)})")
        else:
            mon = {"MonitorName": MONITOR_NAME, "MonitorType": "DIMENSIONAL",
                   "MonitorDimension": "SERVICE"}
            rc, out = aws("ce", "create-anomaly-monitor", "--anomaly-monitor", json.dumps(mon))
            print(f"  anomaly monitor: {'created' if rc == 0 else 'FAILED ' + out[:200]}")
            ok = ok and rc == 0

    # An accepted write is not evidence the control exists. Read it back.
    print("\n  verifying:")
    return check(acct) and ok


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--email")
    a = ap.parse_args()
    if not (a.check or a.apply):
        ap.print_help(); return

    if not shutil.which("aws"):
        sys.exit("aws CLI not installed: brew install awscli")
    acct = account_id()
    if not acct:
        sys.exit("no AWS credentials. Nothing here can create them; see the console steps "
                 "in the AWS section of CLAUDE.md.")
    print(f"AWS account {acct}\n")

    if a.apply:
        if not a.email:
            sys.exit("--apply needs --email for the budget notification")
        sys.exit(0 if apply(acct, a.email) else 1)
    sys.exit(0 if check(acct) else 1)


if __name__ == "__main__":
    main()
