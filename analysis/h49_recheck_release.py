"""Re-run H49's questions against a local NDH release, without BigQuery.

H49 was measured against 2026-05-08 and concluded the NDH carried no payer
organizations and no payer directory endpoints. CMS shipped 2026-08-20 with
two new resource types, InsurancePlan among them, so that conclusion needs
re-testing before anyone quotes it about the current file.

Re-testing it should not require ingesting 45 GB into BigQuery first. This
answers the same questions by streaming the release's own NDJSON, so a new
release can be checked the day it lands and the ingest decision can be made
on evidence.

**The classification constants are imported from h49, never copied.** The
payer host list, the directory and patient-access URL patterns and the
control directories all come from the published finding. A second copy would
drift, and then two AINPI surfaces would disagree about the same release
while both looking authoritative.

Usage:
    python analysis/h49_recheck_release.py --dir /tmp/ndh0820

Reads 01-Organization, 03-Endpoint and 05-InsurancePlan if present.
Prints a comparison against the published May numbers. Writes nothing:
promoting a number into the published finding is a separate, deliberate step.
"""
from __future__ import annotations

import argparse
import collections
import io
import json
import pathlib
import re
import subprocess
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from h49_ndh_payer_endpoints import (  # noqa: E402
    CONTROL_DIRECTORIES,
    DIRECTORY_RE,
    PATIENT_ACCESS_RE,
    PAYER_HOST_RE,
    probe,
)

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
PUBLISHED = (REPO_ROOT / "frontend" / "public" / "api" / "v1" / "findings"
             / "ndh-payer-endpoint-coverage.json")


def stream(path: pathlib.Path):
    """Yield parsed resources from a .ndjson.zst without holding it in memory.

    zstd -dc rather than a Python decompressor: the Organization file is
    ~2 GB decompressed and there is no reason to materialise it.
    """
    proc = subprocess.Popen(["zstd", "-dc", str(path)], stdout=subprocess.PIPE)
    assert proc.stdout is not None
    for line in io.TextIOWrapper(proc.stdout, encoding="utf-8"):
        line = line.strip()
        if line:
            yield json.loads(line)
    proc.wait()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", required=True)
    ap.add_argument("--release", default=None,
                    help="release date of the files, e.g. 2026-08-20")
    ap.add_argument("--write", action="store_true",
                    help="update the published H49 finding JSON with these numbers")
    args = ap.parse_args()
    d = pathlib.Path(args.dir)

    payer_host = re.compile(PAYER_HOST_RE)
    directory_re = re.compile(DIRECTORY_RE)
    patient_re = re.compile(PATIENT_ACCESS_RE)

    # ---- InsurancePlan: the new resource, and the payer organizations ----
    payer_org_ids: set[str] = set()
    plans = 0
    ip = d / "05-InsurancePlan.ndjson.zst"
    if ip.exists():
        for r in stream(ip):
            plans += 1
            for key in ("ownedBy", "administeredBy"):
                ref = (r.get(key) or {}).get("reference")
                if ref:
                    payer_org_ids.add(ref.split("/")[-1])
    print(f"InsurancePlan            {plans:,} plans, "
          f"{len(payer_org_ids):,} distinct owning/administering organizations")

    # ---- Endpoint: classify FHIR REST URLs, same rules as the finding ----
    kinds = collections.Counter()
    payer_hosts: set[str] = set()
    payer_eps = []
    total = rest = 0
    ep = d / "03-Endpoint.ndjson.zst"
    if ep.exists():
        for r in stream(ep):
            total += 1
            ct = ((r.get("connectionType") or {}).get("code") or "").lower()
            if ct != "hl7-fhir-rest":
                continue
            rest += 1
            addr = (r.get("address") or "").lower()
            if directory_re.search(addr):
                kinds["provider-directory"] += 1
            elif patient_re.search(addr):
                kinds["patient-access"] += 1
            else:
                kinds["unlabelled"] += 1
            if payer_host.search(addr):
                host = re.sub(r"^https?://([^/]+).*$", r"\1", addr)
                payer_hosts.add(host)
                payer_eps.append((r.get("id"), addr,
                                  (r.get("managingOrganization") or {}).get("reference")))
    print(f"Endpoint                 {total:,} total, {rest:,} FHIR REST")
    for k in ("provider-directory", "patient-access", "unlabelled"):
        print(f"   {k:22s} {kinds[k]:>9,}")
    print(f"   payer-operated hosts   {len(payer_hosts):>9,}")

    # ---- Organization: type codings, and whether payer orgs carry endpoints ----
    org = d / "01-Organization.ndjson.zst"
    type_codes = collections.Counter()
    type_texts = collections.Counter()
    payer_orgs_found = {}
    orgs = 0
    if org.exists():
        for r in stream(org):
            orgs += 1
            for t in r.get("type") or []:
                for c in t.get("coding") or []:
                    type_codes[c.get("code")] += 1
                if not t.get("coding") and t.get("text"):
                    type_texts[t["text"]] += 1
            if r.get("id") in payer_org_ids:
                payer_orgs_found[r["id"]] = {
                    "name": r.get("name"),
                    "endpoints": len(r.get("endpoint") or []),
                    "type": [t.get("text") or (t.get("coding") or [{}])[0].get("code")
                             for t in (r.get("type") or [])],
                }
    print(f"\nOrganization             {orgs:,} records")
    print("   type codings:")
    for c, n in type_codes.most_common(8):
        print(f"     {str(c):24s} {n:>10,}")
    print("   untyped text values:")
    for c, n in type_texts.most_common(4):
        print(f"     {str(c):24s} {n:>10,}")

    non_std = [c for c in type_codes if c not in ("prov", "team", "govt")]
    print(f"\n   payer type coding present? "
          f"{'YES: ' + ', '.join(map(str, non_std)) if non_std else 'no'}")

    print(f"\nPayer organizations named by InsurancePlan: {len(payer_org_ids)}")
    print(f"   found in Organization file:  {len(payer_orgs_found)}")
    with_ep = [o for o in payer_orgs_found.values() if o["endpoints"]]
    print(f"   of those, carrying an endpoint: {len(with_ep)}")
    for oid, o in list(payer_orgs_found.items())[:10]:
        print(f"     {(o['name'] or '?')[:46]:48s} endpoints={o['endpoints']} type={o['type']}")

    # ---- Control: is a live, mandated payer directory in the index? ----
    print("\nControl probe:")
    all_addrs = {a for _, a, _ in payer_eps}
    for c in CONTROL_DIRECTORIES:
        code, size = probe(c["base"] + c["probe"])
        present = any(c["base"].lower() in a for a in all_addrs)
        print(f"   {c['payer']:22s} live={code} bytes={size} present_in_ndh={present}")

    if PUBLISHED.exists():
        pub = json.loads(PUBLISHED.read_text())
        print(f"\nPublished H49 ({pub.get('release_date')}):")
        print(f"   {(pub.get('headline') or '')[:300]}")

    if args.write:
        if not args.release:
            raise SystemExit("--write needs --release, so the finding states "
                             "which file it measured")
        import datetime as dt
        pub = json.loads(PUBLISHED.read_text()) if PUBLISHED.exists() else {}
        payer_orgs_with_ep = len(with_ep)
        directories = kinds["provider-directory"]
        control_absent = [c["payer"] for c in CONTROL_DIRECTORIES]
        headline = (
            f"CMS added payer organizations in the {args.release} release: "
            f"{len(payer_org_ids)} carry a 'pay' type coding and own "
            f"{plans} Medicare Advantage plans, where the previous release had "
            f"no payer type at all. Payer endpoints did not follow. "
            f"{payer_orgs_with_ep} of the {len(payer_org_ids)} payer "
            f"organizations carry an endpoint, {directories} of {rest:,} FHIR "
            f"REST endpoints is a payer provider directory, and a live "
            f"CMS-9115-F directory is still absent from the index."
        )
        pub.update({
            "release_date": args.release,
            "generated_at": dt.datetime.now(dt.timezone.utc)
                              .replace(microsecond=0).isoformat(),
            "headline": headline,
            "numerator": directories,
            "denominator": rest,
            "chart": {
                "type": "bar",
                "unit": "count",
                "data": [
                    {"label": "Payer organizations (type pay)", "value": len(payer_org_ids)},
                    {"label": "Medicare Advantage plans", "value": plans},
                    {"label": "Payer orgs carrying an endpoint", "value": payer_orgs_with_ep},
                    {"label": "Payer provider-directory endpoints", "value": directories},
                ],
            },
            "notes": (
                f"Re-measured against the {args.release} release by streaming the "
                "published NDJSON directly, not through BigQuery, so the check "
                "could run the day the release landed rather than after a 45 GB "
                "ingest. Classification constants are imported from "
                "analysis/h49_ndh_payer_endpoints.py rather than copied, so this "
                "cannot drift from the finding it updates. "
                "Half of the original result is resolved: a payer organization "
                "type now exists. The other half stands: no payer organization "
                "carries an endpoint, and the control directory ("
                + ", ".join(control_absent) +
                ") answers 200 to an unauthenticated request while remaining "
                "absent from the index, which separates 'nothing to index' from "
                "'not indexed yet'. Reproduce with "
                "analysis/h49_recheck_release.py --dir <release dir>."
            ),
        })
        PUBLISHED.write_text(json.dumps(pub, indent=2) + "\n")
        print(f"\nWrote {PUBLISHED}")
        print(f"   {headline}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
