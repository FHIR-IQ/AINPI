"""Re-run H49's questions against a local NDH release, without BigQuery.

H49 was measured against 2026-05-08 and concluded the NDH carried no payer
organizations and no payer directory endpoints. CMS shipped 2026-08-20 with
two new resource types, InsurancePlan among them, so that conclusion needs
re-testing before anyone quotes it about the current file.

Re-testing it should not require ingesting 45 GB into BigQuery first. This
answers the same questions by streaming the release's own NDJSON, so a new
release can be checked the day it lands and the ingest decision can be made
on evidence.

**The classification rules are imported, never copied.** Payer directory
classification lives in analysis/payer_directory.py (FHI-71) and the payer
host list and control directories in h49_ndh_payer_endpoints.py. A second
copy would drift, and then two AINPI surfaces would disagree about the same
release while both looking authoritative.

Usage:
    python analysis/h49_recheck_release.py --dir /tmp/ndh1007 --release 2026-10-07

Reads 01-Organization, 03-Endpoint and 05-InsurancePlan if present.
Prints a comparison against the published finding. Writes nothing unless
--write is passed: promoting a number into the published finding is a
separate, deliberate step. --write sets the headline, numerator, denominator,
chart, notes, corrections and detail.payer_directory_classification; the rest
of `detail` is re-measured from BigQuery by
`h49_ndh_payer_endpoints.py --refresh-detail`, which the weekly refresh runs
and which reads the contract hosts this script records.
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
    PAYER_HOST_RE,
    merge_payer_pin_watch,
    probe,
)
from payer_directory import (  # noqa: E402
    check_controls,
    classify,
    contract_hosts,
    host_of,
    plan_contracts,
    signal_label,
    summarize,
)
from release_watch import is_payer_typed, payer_pin_summary  # noqa: E402

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
PUBLISHED = (REPO_ROOT / "frontend" / "public" / "api" / "v1" / "findings"
             / "ndh-payer-endpoint-coverage.json")

# Dated corrections to figures this finding published. Written by the
# generator so a correction cannot live only on a deliverable. Each entry
# names the release it corrects; `corrected_count` is re-checked against the
# measurement whenever that release is re-run, and the run refuses if they
# disagree.
CORRECTIONS = [
    {
        "date": "2026-10-16",
        "issue": "FHI-71",
        "release": "2026-10-07",
        "as_published_on": "2026-10-14",
        "as_published_count": 50,
        "corrected_count": 201,
        "corrected_by_signal": {"path_only": 25, "host_only": 151, "both": 25},
        "corrected_bulk_mpf_index": 144,
        "corrected_searchable_api": 57,
        "unclassified_same_batch": 79,
        "what": (
            "The 2026-10-14 finding counted 50 of 111,259 FHIR REST endpoints as "
            "provider-directory addresses. That counted only addresses whose URL "
            "path names a directory, so it was a floor. Classified by the host as "
            "well (CMS contract IDs from the release's own InsurancePlan "
            "resources, and payer directory hosts checked by hand), the "
            "2026-10-07 release carries 201: 25 by path only, 151 by host only, "
            "25 by both. 144 of the 201 are CMS Medicare Advantage bulk directory "
            "files (MPF index.json and similar); 57 are searchable FHIR APIs. "
            "None of the 201 is linked to a payer organization from either side. "
            "The count is still a floor: 79 more addresses in the same CMS batch "
            "match neither signal, and many of them look like payer directories."
        ),
        "since": "2026-10-14 (86c2349), when the 2026-10-07 figure was published",
    },
]


def check_correction(release: str, breakdown: dict, residual: int, linked: int) -> None:
    """Refuse when a re-run of a corrected release disagrees with the
    correction's stated numbers, so the prose cannot drift from the generator."""
    for c in CORRECTIONS:
        if c["release"] != release:
            continue
        measured = {
            "corrected_count": breakdown["total"],
            "corrected_by_signal": breakdown["by_signal"],
            "corrected_bulk_mpf_index": breakdown["bulk_mpf_index"],
            "corrected_searchable_api": breakdown["searchable_api"],
            "unclassified_same_batch": residual,
        }
        bad = {k: (c[k], v) for k, v in measured.items() if c[k] != v}
        if linked:
            bad["linked_to_payer"] = (0, linked)
        if bad:
            raise SystemExit(
                f"refusing: correction {c['issue']} for {release} disagrees with "
                f"this run (stated, measured): {bad}. Fix the classifier or the "
                f"correction, not both silently.")


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


def _ref_id(ref_obj) -> str:
    return (((ref_obj or {}).get("reference")) or "").split("/")[-1]


def _norm_name(name: str) -> str:
    n = re.sub(r"\b(inc|llc|co|corp|corporation|company)\b\.?", "", (name or "").lower())
    return re.sub(r"[^a-z0-9]", "", n)


def control_presence(controls, classified_rows) -> list[dict]:
    """Per control directory: is its own base URL in the index, and is any
    directory address of the same payer in the index under another host?

    The two are different statements. On 2026-10-07 the Capital BlueCross
    control URL was absent while the same payer's Medicare Advantage directory
    was present at api.capitalbluecrossfhir.com; reporting only the first
    read as "the payer's directory is not indexed", which was false.
    """
    out = []
    for c in controls:
        base_host = host_of(c["base"])
        same_payer = sorted({r["address"] for r in classified_rows
                             if r["payer"] == c["payer"] and r["hostname"] != base_host})
        out.append({
            "payer": c["payer"],
            "base": c["base"],
            "base_present_in_ndh": any(r["hostname"] == base_host for r in classified_rows),
            "same_payer_directories_in_ndh": same_payer,
        })
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", required=True)
    ap.add_argument("--release", default=None,
                    help="release date of the files, e.g. 2026-10-07")
    ap.add_argument("--write", action="store_true",
                    help="update the published H49 finding JSON with these numbers")
    args = ap.parse_args()
    d = pathlib.Path(args.dir)
    payer_host = re.compile(PAYER_HOST_RE)

    # ---- InsurancePlan: the new resource, and the payer organizations ----
    plan_resources = []
    payer_org_ids: set[str] = set()
    plan_endpoint_refs: dict[str, list[str]] = collections.defaultdict(list)
    ip = d / "05-InsurancePlan.ndjson.zst"
    if ip.exists():
        for r in stream(ip):
            plan_resources.append({"ownedBy": r.get("ownedBy"), "alias": r.get("alias")})
            for key in ("ownedBy", "administeredBy"):
                oid = _ref_id(r.get(key))
                if oid:
                    payer_org_ids.add(oid)
            for e in r.get("endpoint") or []:
                plan_endpoint_refs[_ref_id(e)].append(r.get("id"))
    plans = len(plan_resources)
    contracts = plan_contracts(plan_resources)
    print(f"InsurancePlan            {plans:,} plans, "
          f"{len(payer_org_ids):,} distinct owning/administering organizations, "
          f"{len(contracts):,} contract IDs")
    # Positive control: the curated directories classify, the known
    # non-directories do not, and plans present means contracts were read.
    check_controls(contracts, plans_present=plans > 0)

    # ---- Endpoint: classify FHIR REST URLs ----
    rest_rows = []
    total = 0
    ep = d / "03-Endpoint.ndjson.zst"
    if ep.exists():
        for r in stream(ep):
            total += 1
            ct = ((r.get("connectionType") or {}).get("code") or "").lower()
            if ct != "hl7-fhir-rest":
                continue
            rest_rows.append({"id": r.get("id"), "address": r.get("address") or "",
                              "name": r.get("name"),
                              "managing_org": _ref_id(r.get("managingOrganization"))})
    rest = len(rest_rows)
    hosts_with_contracts = contract_hosts((r["address"] for r in rest_rows), contracts)
    kinds = collections.Counter()
    payer_hosts: set[str] = set()
    classified = []
    for r in rest_rows:
        c = classify(r["address"], contracts, hosts_with_contracts)
        kinds[c["url_kind"]] += 1
        if payer_host.search(r["address"].lower()):
            payer_hosts.add(host_of(r["address"]))
        if c["directory"]:
            owner = contracts.get(c["contracts"][0]) if c["contracts"] else None
            classified.append({**r, **c, "hostname": host_of(r["address"]),
                               "signal": signal_label(c), "owner_org": owner})
    breakdown = summarize(classified)
    directories = breakdown["total"]
    print(f"Endpoint                 {total:,} total, {rest:,} FHIR REST")
    for k in ("provider-directory", "patient-access", "unlabelled"):
        print(f"   {k:22s} {kinds[k]:>9,}")
    print(f"   directory by signal    {breakdown['by_signal']}")
    print(f"   host signal by basis   {breakdown['host_signal_by_basis']}")
    print(f"   bulk MPF / searchable  {breakdown['bulk_mpf_index']} / {breakdown['searchable_api']}")
    print(f"   payer-operated hosts   {len(payer_hosts):>9,}")
    # Residual: the CMS-collected batch arrives named "FHIR API" with no
    # managingOrganization. It is not used to classify (a load artifact, not a
    # meaning), but what it leaves unclassified shows how far this is a floor.
    fhir_api = [r for r in rest_rows if r["name"] == "FHIR API"]
    classified_ids = {r["id"] for r in classified}
    residual = sorted(r["address"] for r in fhir_api if r["id"] not in classified_ids)
    print(f"   'FHIR API'-named rows  {len(fhir_api)}, unclassified {len(residual)}")

    # ---- Organization: type codings, payer orgs, and linkage ----
    org = d / "01-Organization.ndjson.zst"
    type_codes = collections.Counter()
    payer_typed = []
    payer_names: dict[str, str] = {}
    referencing: dict[str, list[str]] = collections.defaultdict(list)
    endpoint_holders = []
    rest_ids = {r["id"] for r in rest_rows}
    owner_ids = {r["owner_org"] for r in classified if r["owner_org"]}
    owner_names: dict[str, str] = {}
    orgs = 0
    if org.exists():
        for r in stream(org):
            orgs += 1
            if r.get("id") in owner_ids:
                owner_names[r["id"]] = r.get("name")
            if is_payer_typed(r):
                payer_typed.append(r)
                payer_names[_norm_name(r.get("name"))] = r.get("name")
            for t in r.get("type") or []:
                for c in t.get("coding") or []:
                    type_codes[c.get("code")] += 1
            eps = [_ref_id(e) for e in r.get("endpoint") or []]
            for eid in eps:
                if eid in classified_ids:
                    referencing[eid].append(r["id"])
            rest_eps = [e for e in eps if e in rest_ids]
            if rest_eps:
                endpoint_holders.append((r["id"], r.get("name"), rest_eps))
    print(f"\nOrganization             {orgs:,} records")
    print("   type codings:")
    for c, n in type_codes.most_common(8):
        print(f"     {str(c):24s} {n:>10,}")

    for r in classified:
        r["owner_name"] = owner_names.get(r["owner_org"]) if r["owner_org"] else None
    payer_ids = {r.get("id") for r in payer_typed}
    payer_typed_n = len(payer_typed)
    payer_typed_with_ep = sum(1 for r in payer_typed if r.get("endpoint"))
    payer_typed_with_telecom = sum(1 for r in payer_typed if r.get("telecom"))
    # Linkage, both sides, for every classified address.
    via_managing = sorted(r["address"] for r in classified
                          if r["managing_org"] and r["managing_org"] in payer_ids)
    via_payer_org = sorted(r["address"] for r in classified
                           if any(o in payer_ids for o in referencing.get(r["id"], [])))
    via_plan = sorted(r["address"] for r in classified if plan_endpoint_refs.get(r["id"]))
    linked_any_org = sorted(r["address"] for r in classified
                            if r["managing_org"] or referencing.get(r["id"]))
    dirs_to_payer = len(set(via_managing) | set(via_payer_org) | set(via_plan))
    # Provider-typed records carrying a payer's name and an endpoint (the UPMC
    # Health Plan case). Reported, never used to classify.
    by_id = {r["id"]: r for r in rest_rows}
    twins = []
    for oid, name, eps in endpoint_holders:
        if oid in payer_ids or _norm_name(name) not in payer_names:
            continue
        for eid in eps:
            twins.append({"organization": oid, "name": name,
                          "address": by_id[eid]["address"],
                          "classified_directory": eid in classified_ids})
    twins.sort(key=lambda t: (t["name"] or "", t["address"]))
    linkage = {
        "payer_typed_orgs": payer_typed_n,
        "payer_typed_orgs_with_endpoint": payer_typed_with_ep,
        "payer_typed_orgs_with_telecom": payer_typed_with_telecom,
        "directories_managed_by_payer_org": len(via_managing),
        "directories_referenced_by_payer_org": len(via_payer_org),
        "directories_referenced_by_insurance_plan": len(via_plan),
        "directories_linked_to_any_org": len(linked_any_org),
        "directories_linked_to_any_org_addresses": linked_any_org,
        "provider_typed_records_with_payer_name_and_endpoint": twins,
    }
    print(f"\nPayer-typed orgs {payer_typed_n:,}; with endpoint {payer_typed_with_ep}, "
          f"with telecom {payer_typed_with_telecom}")
    print(f"Directories linked to a payer: managingOrganization {len(via_managing)}, "
          f"payer Organization.endpoint {len(via_payer_org)}, "
          f"InsurancePlan.endpoint {len(via_plan)}; linked to any org {len(linked_any_org)}")
    for t in twins:
        print(f"   twin {(t['name'] or '')[:40]:42s} {t['address']} "
              f"directory={t['classified_directory']}")

    pin = payer_pin_summary(payer_typed) if org.exists() else None
    if pin is not None:
        print(f"\nPayer PIN watch: {pin['payer_orgs']} payer-typed orgs, "
              f"{pin['payer_orgs_with_any_identifier']} with any identifier, "
              f"{pin['payer_orgs_with_payerid']} with PAYERID "
              f"(control_passed={pin['control_passed']})")

    # ---- Control: is a live, mandated payer directory in the index? ----
    print("\nControl probe:")
    presence = control_presence(CONTROL_DIRECTORIES, classified)
    control_results = []
    for c, pr in zip(CONTROL_DIRECTORIES, presence):
        code, size = probe(c["base"] + c["probe"])
        control_results.append({**pr, "http_status": code, "bytes": size})
        print(f"   {c['payer']:22s} live={code} bytes={size} "
              f"base_present={pr['base_present_in_ndh']} "
              f"same_payer_elsewhere={len(pr['same_payer_directories_in_ndh'])}")

    if PUBLISHED.exists():
        pub = json.loads(PUBLISHED.read_text())
        print(f"\nPublished H49 ({pub.get('release_date')}): numerator {pub.get('numerator')}")
        print(f"   {(pub.get('headline') or '')[:300]}")

    if args.release:
        check_correction(args.release, breakdown, len(residual), dirs_to_payer)

    if args.write:
        if not args.release:
            raise SystemExit("--write needs --release, so the finding states "
                             "which file it measured")
        import datetime as dt
        pub = json.loads(PUBLISHED.read_text()) if PUBLISHED.exists() else {}
        bs = breakdown["by_signal"]
        split = (f"{bs['path_only'] + bs['both']:,} by URL path and "
                 f"{bs['host_only']:,} only by host")
        if dirs_to_payer == 0:
            link_clause = "none of them attached to a payer organization"
        else:
            link_clause = f"{dirs_to_payer:,} of them attached to a payer organization"
        control_clauses = []
        for cr in control_results:
            if cr["base_present_in_ndh"]:
                control_clauses.append(f"the {cr['payer']} control directory is in the index")
            elif cr["same_payer_directories_in_ndh"]:
                control_clauses.append(
                    f"the {cr['payer']} control directory URL is not in the index, "
                    f"though another {cr['payer']} directory address is")
            else:
                control_clauses.append(
                    f"the live {cr['payer']} CMS-9115-F directory is absent from the index")
        # No history in the template: it is reused every release, so it states
        # what this file holds, never what changed since an earlier one.
        headline = (
            f"The {args.release} release names {payer_typed_n:,} payer "
            f"organizations and {plans:,} health plans, and "
            f"{payer_typed_with_ep:,} of those organizations carry an endpoint. "
            f"{directories:,} of {rest:,} FHIR REST endpoints are payer "
            f"provider-directory addresses ({split}), {link_clause}; "
            + "; ".join(control_clauses) + "."
        )
        type_sentence = (
            f"{payer_typed_n:,} organizations carry the payer type (pay); "
            f"{payer_typed_with_ep:,} of them carry an endpoint and "
            f"{payer_typed_with_telecom:,} a telecom entry, so no payer directory "
            "can be found from the payer organization record itself."
            if payer_typed_n else
            "No organization carries the payer type (pay).")
        notes_parts = [
            f"Re-measured against the {args.release} release by streaming the "
            "published NDJSON directly, not through BigQuery. Classification rules "
            "are imported from analysis/payer_directory.py rather than copied, so "
            "this cannot drift from the finding it updates. " + type_sentence,
            f"A FHIR REST address counts as a payer provider directory on either of "
            f"two signals. Path: the URL names a directory (providerdirectory, "
            f"provider-directory, plan-net, pdex). Host: the address sits on a host "
            f"that serves a payer's directory, shown either by a CMS contract ID "
            f"that the release's own InsurancePlan resources carry "
            f"({len(contracts):,} contract IDs, found on {len(hosts_with_contracts):,} "
            f"hosts), or by a hand-checked list of payer directory hosts. Of the "
            f"{directories:,}: {bs['path_only']:,} path only, {bs['host_only']:,} host "
            f"only, {bs['both']:,} both. {breakdown['bulk_mpf_index']:,} are CMS "
            f"Medicare Advantage bulk directory files (MPF index.json and similar) "
            f"and {breakdown['searchable_api']:,} are searchable FHIR APIs. A host "
            f"signal never overrides a path that marks a patient-access or other "
            f"non-directory API.",
            f"The count is a floor. {len(fhir_api):,} FHIR REST endpoints in this "
            f"release share the name 'FHIR API' and carry no managingOrganization, "
            f"which marks one CMS collection batch; {len(residual):,} of them match "
            f"neither signal, and many of those look like payer directories. Payer "
            f"name matching is not used to classify: it matches provider EHR "
            f"servers whose names resemble payers'.",
            ("Linkage, both sides: "
             f"{len(via_managing):,} directory addresses name a payer organization "
             f"as managingOrganization, {len(via_payer_org):,} are listed in a payer "
             f"organization's endpoint list, and {len(via_plan):,} in an "
             f"InsurancePlan's. {len(linked_any_org):,} are linked to any "
             "organization at all. "
             + (f"{len(twins):,} endpoint links run from provider-typed records "
                "that carry a payer's exact name; they are listed in "
                "detail.payer_directory_classification.linkage and are mostly "
                "authenticated member APIs or EHR servers, not directories."
                if twins else "")),
            " ".join(
                (f"The control directory {cr['payer']} ({cr['base']}) answered "
                 f"{cr['http_status']} to an unauthenticated request and "
                 + ("is in the index." if cr["base_present_in_ndh"] else
                    "is not in the index at that address"
                    + (f"; the same payer's directory is, at "
                       f"{', '.join(cr['same_payer_directories_in_ndh'])}."
                       if cr["same_payer_directories_in_ndh"] else
                       ", which separates 'nothing to index' from 'not indexed yet'.")))
                for cr in control_results),
        ]
        for c in CORRECTIONS:
            notes_parts.append(f"Correction ({c['date']}, {c['issue']}): {c['what']}")
        notes_parts.append("Reproduce with analysis/h49_recheck_release.py --dir "
                           "<release dir> --release <date>.")
        classification = {
            "release_date": args.release,
            "rule": "path OR host; see analysis/payer_directory.py",
            **breakdown,
            "contract_ids_in_addresses": {
                cid: contracts[cid] for cid in sorted(
                    {i for r in classified for i in r["contracts"]}
                    | {i for ids in hosts_with_contracts.values() for i in ids})},
            "contract_hosts": hosts_with_contracts,
            "fhir_api_named_rows": len(fhir_api),
            "fhir_api_named_unclassified": residual,
            "addresses": [
                {k: r[k] for k in ("address", "hostname", "signal", "basis", "payer",
                                   "owner_org", "owner_name", "contracts", "bulk",
                                   "managing_org")}
                for r in sorted(classified, key=lambda r: r["address"].lower())],
            "linkage": linkage,
            "controls": control_results,
        }
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
                    {"label": "Payer organizations (type pay)", "value": payer_typed_n},
                    {"label": "Health plans (InsurancePlan)", "value": plans},
                    {"label": "Payer orgs carrying an endpoint", "value": payer_typed_with_ep},
                    {"label": "Provider-directory endpoints", "value": directories},
                ],
            },
            "notes": "\n\n".join(p.strip() for p in notes_parts if p.strip()),
            "corrections": CORRECTIONS,
        })
        detail = pub.get("detail") if isinstance(pub.get("detail"), dict) else {}
        detail["payer_directory_classification"] = classification
        pub["detail"] = detail
        if pin is not None:
            pin["release_date"] = args.release
            pub = merge_payer_pin_watch(pub, pin)
        PUBLISHED.write_text(json.dumps(pub, indent=2) + "\n")
        print(f"\nWrote {PUBLISHED}")
        print(f"   {headline}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
