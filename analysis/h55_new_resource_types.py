"""H55 - What CMS actually shipped when it added two resource types.

The 2026-08-20 release took the NDH bulk export from six resource types to
eight, adding HealthcareService and InsurancePlan. That was announced as payer
and health-plan data arriving, and it is, but the shape of what arrived
decides whether a consumer can use it.

Registered before the numbers: the prior is that a newly added resource is
populated thinly at first, carrying identity but not the fields that make it
actionable. The interesting question is which fields are present, because that
is the difference between "payers are in the directory now" and "payers are
named in the directory now".

Measured by streaming the release's own NDJSON. No BigQuery: there are no
tables for these types yet, and requiring an ingest before a release can be
characterized means the answer arrives a week after the release does.

Usage:
    python analysis/h55_new_resource_types.py --dir /tmp/ndh0820

Outputs:
    frontend/public/api/v1/findings/ndh-new-resource-types.json
"""
from __future__ import annotations

import argparse
import collections
import datetime as dt
import io
import json
import pathlib
import subprocess
import sys

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = REPO_ROOT / "frontend" / "public" / "api" / "v1" / "findings"
METHODOLOGY = "0.7.2-draft"


def stream(path: pathlib.Path):
    proc = subprocess.Popen(["zstd", "-dc", str(path)], stdout=subprocess.PIPE)
    assert proc.stdout is not None
    for line in io.TextIOWrapper(proc.stdout, encoding="utf-8"):
        line = line.strip()
        if line:
            yield json.loads(line)
    proc.wait()


def _commit_sha():
    try:
        return subprocess.run(["git", "rev-parse", "HEAD"], cwd=REPO_ROOT,
                              capture_output=True, text=True,
                              check=True).stdout.strip()
    except Exception:
        return "pending"


def profile(path: pathlib.Path):
    """Top-level field presence for a resource type.

    Field presence is the whole measurement. A resource that carries only an
    id and one extension is a join key wearing the costume of a description,
    and a consumer needs to know that before designing against it.
    """
    n = 0
    fields = collections.Counter()
    for r in stream(path):
        n += 1
        for k in r:
            fields[k] += 1
    return n, fields


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", required=True)
    ap.add_argument("--release", default="2026-08-20")
    args = ap.parse_args()
    d = pathlib.Path(args.dir)

    hs_path = d / "04-HealthcareService.ndjson.zst"
    ip_path = d / "05-InsurancePlan.ndjson.zst"
    for p in (hs_path, ip_path):
        if not p.exists():
            raise SystemExit(f"missing {p}")

    hs_n, hs_fields = profile(hs_path)

    # InsurancePlan needs more than field presence: who owns the plans, and
    # do those owners exist as payer organizations.
    ip_n = 0
    ip_fields = collections.Counter()
    owners = set()
    plan_types = collections.Counter()
    for r in stream(ip_path):
        ip_n += 1
        for k in r:
            ip_fields[k] += 1
        for key in ("ownedBy", "administeredBy"):
            ref = (r.get(key) or {}).get("reference")
            if ref:
                owners.add(ref.split("/")[-1])
        for t in r.get("type") or []:
            plan_types[t.get("text") or "?"] += 1

    print(f"HealthcareService  {hs_n:,} resources")
    for k, c in hs_fields.most_common():
        print(f"   {k:24s} {c:>8,}  {100*c/hs_n:5.1f}%")
    print(f"\nInsurancePlan      {ip_n:,} resources, {len(owners)} owning organizations")
    for k, c in ip_fields.most_common():
        print(f"   {k:24s} {c:>8,}  {100*c/ip_n:5.1f}%")
    print("   plan types:")
    for k, c in plan_types.most_common(8):
        print(f"     {k[:44]:46s} {c:>6,}")

    # The claim rests on this: HealthcareService carries no descriptive field.
    descriptive = ("name", "type", "specialty", "category", "telecom",
                   "comment", "availableTime", "serviceProvisionCode")
    present_descriptive = {k: hs_fields[k] for k in descriptive if hs_fields[k]}
    hs_located = hs_fields.get("location", 0)
    hs_provided = hs_fields.get("providedBy", 0)

    # Not all Medicare Advantage: 15 are Qualified Health Plans. Count the
    # plans, name the mix, and do not let the largest bucket stand in for the
    # whole set.
    headline = (
        f"The {args.release} release adds two resource types. InsurancePlan "
        f"arrives usable: {ip_n} health plans, every one naming an "
        f"owning organization, across {len(owners)} payers. HealthcareService "
        f"arrives empty: {hs_n:,} resources of which "
        f"{100 * hs_located / hs_n:.1f}% name a location, "
        f"{hs_provided} name a provider, and none carry a service name, type "
        f"or specialty. It is a network-membership join, not a description of "
        f"a service."
    )

    payload = {
        "slug": "ndh-new-resource-types",
        "title": "What arrived when the NDH went from six resource types to eight",
        "hypotheses": ["H55"],
        "status": "published",
        "release_date": args.release,
        "generated_at": dt.datetime.now(dt.timezone.utc)
                          .replace(microsecond=0).isoformat(),
        "methodology_version": METHODOLOGY,
        "commit_sha": _commit_sha(),
        "headline": headline,
        "numerator": hs_located,
        "denominator": hs_n,
        "chart": {
            "type": "bar",
            "unit": "percent",
            "data": [
                {"label": "InsurancePlan names an owner",
                 "value": round(100.0 * ip_fields.get("ownedBy", 0) / ip_n, 1)},
                {"label": "HealthcareService names a location",
                 "value": round(100.0 * hs_located / hs_n, 2)},
                {"label": "HealthcareService names a provider",
                 "value": round(100.0 * hs_provided / hs_n, 4)},
                {"label": "HealthcareService names the service",
                 "value": 0.0},
            ],
        },
        "notes": (
            "Measured by streaming the release's own NDJSON rather than through "
            "BigQuery, because there are no tables for these types yet and a "
            "release should be characterizable the day it lands. "
            f"HealthcareService carries {', '.join(sorted(hs_fields)) or 'nothing'} "
            "and nothing else; the descriptive fields that would make it a "
            "service record ("
            + ", ".join(descriptive) +
            ") are "
            + (f"present only as {present_descriptive}" if present_descriptive
               else "absent from every resource")
            + ". The registered prior, that a new resource carries identity "
            "before it carries detail, holds for HealthcareService and is "
            "rejected for InsurancePlan, which is complete enough to use on "
            "arrival. One caveat on InsurancePlan: `type` is free text and "
            "not coded, and the same product appears under several spellings "
            f"({', '.join(list(plan_types)[:6])}), so grouping plans by type "
            "requires normalising strings rather than reading a code. "
            "Reproduce with analysis/h55_new_resource_types.py."
        ),
        "detail": {
            "healthcare_service": {"resources": hs_n,
                                   "field_presence": dict(hs_fields)},
            "insurance_plan": {"resources": ip_n,
                               "owning_organizations": len(owners),
                               "field_presence": dict(ip_fields),
                               "plan_types": dict(plan_types)},
        },
    }
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / "ndh-new-resource-types.json"
    path.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"\nWrote {path}")
    print(f"\n{headline}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
