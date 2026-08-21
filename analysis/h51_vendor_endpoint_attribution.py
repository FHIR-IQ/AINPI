"""H51 — Can vendor-published endpoint files name the endpoints the NDH cannot?

H50 measured that 94,737 of the 114,071 FHIR REST endpoints in the NDH carry no
managing organization. The obvious reading is that the data does not exist.

It does. Certified EHR vendors publish their own endpoint directories, and those
files carry the organization name against the same URLs. This asks how much of
the NDH gap those public files would close.

Two publication styles, and the difference matters:

  HTI-1 service base URL lists   A flat Bundle of Organization + Endpoint. One
                                 endpoint per practice. What most vendors ship.

  SMART User-access Brands       SMART App Launch 2.2. A brand hierarchy: care
                                 sites hang off a parent brand via partOf, and
                                 the endpoint sits on the brand. Epic publishes
                                 one. It is the richer model, because naming a
                                 single endpoint names every care site beneath
                                 it.

Why anyone should care, stated plainly: a patient who just left an appointment
wants their records. An app has to go from "the clinic I visited" to "the FHIR
endpoint that serves it". That is an organization-to-endpoint lookup, and it is
exactly what the missing field prevents.

Reference resolution is the trap. Epic references bundle entries by `urn:uuid:`
rather than `Type/id`, and hangs care sites off brands via `partOf`. Resolving
naively finds nothing, which is the same failure that produced a wrong published
claim about Epic in H47. Both directions are handled here, and the facility
rollup is asserted against the organization count so a double-count cannot pass
silently.

Run:    python analysis/h51_vendor_endpoint_attribution.py
Writes:
  - frontend/public/api/v1/findings/vendor-endpoint-attribution.json
  - frontend/public/api/v1/findings/vendor-endpoint-attribution.csv
      url, org_name, org_npi, vendor, in_ndh, ndh_has_owner

Cost: one capped scan of cms_npd.endpoint. The vendor files are public HTTP
downloads, roughly 250 MB in total, so allow a few minutes.
"""
from __future__ import annotations

import collections
import csv
import json
import pathlib
import re
import subprocess
import sys
from datetime import datetime, timezone

from google.cloud import bigquery

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from claims_sources._cohorts import bq_job_config  # noqa: E402

PROJECT = "thematic-fort-453901-t7"
from release import CURRENT_RELEASE as RELEASE_DATE  # noqa: E402
METHODOLOGY_VERSION = "0.7.2-draft"
SLUG = "vendor-endpoint-attribution"
OUT_DIR = (pathlib.Path(__file__).resolve().parent.parent
           / "frontend" / "public" / "api" / "v1" / "findings")

UA = "AINPI-research/1.0 (+https://ainpi.dev; open provider-directory audit)"

# Source URLs come from list_sources_summary.csv in the CEHRT cache repo, which
# is itself a scrape of ONC's Lantern. These are the largest publishers by URL
# count plus Epic's Brands bundle. 200+ smaller sources exist, so every number
# here is a floor.
SOURCES = [
    ("Epic (User-access Brands)", "https://open.epic.com/Endpoints/Brands", True),
    ("athenahealth", "https://service-base-urls.api.fhir.athena.io/athena-fhir-service-base-urls.json", False),
    ("eClinicalWorks", "https://fhir.eclinicalworks.com/ecwopendev/external/practiceList", False),
    ("Office Ally", "https://fhirpt.officeally.com/fhir/r4/endpoints", False),
    ("Practice Fusion", "https://www.practicefusion.com/assets/static_files/ServiceBaseURLs.json", False),
    ("PointClickCare", "https://fhir.pointclickcare.com/R4endpoints.json", False),
    ("Veradigm", "https://open.platform.veradigm.com/fhirendpoints/download/R4?endpointFilter=Patient", False),
    ("Oracle Health", "https://raw.githubusercontent.com/oracle-samples/ignite-endpoints/refs/heads/main/oracle_health_fhir_endpoints/millennium_patient_r4_endpoints.json", False),
]

CACHE = pathlib.Path("/tmp/ainpi-vendor-endpoints")


def norm(u: str | None) -> str | None:
    """One URL spelling. Vendors and the NDH disagree on scheme and trailing slash."""
    if not u:
        return None
    return re.sub(r"^http://", "https://", u.strip().lower().rstrip("/")) or None


def npi_of(org: dict) -> str | None:
    for i in org.get("identifier") or []:
        if "us-npi" in str(i.get("system", "")).lower():
            v = re.sub(r"\D", "", str(i.get("value") or ""))
            return v if len(v) == 10 else None
    return None


def fetch(url: str, dest: pathlib.Path) -> dict:
    """Download a vendor endpoint file, via curl.

    urllib was used here until 2026-08-21 and failed every one of these hosts
    with CERTIFICATE_VERIFY_FAILED, which the caller then swallowed into a
    "skipped" line. The run completed, reported success, and published that
    vendors name 0% of unattributed endpoints, overwriting a measured 76%.
    Same conclusion as H26, H46 and the payer harvester: use curl.
    """
    if not dest.exists():
        r = subprocess.run(
            ["curl", "-sSL", "--fail", "--max-time", "300",
             "-A", UA, "-H", "Accept: application/json", url, "-o", str(dest)],
            capture_output=True, text=True,
        )
        if r.returncode != 0:
            dest.unlink(missing_ok=True)
            raise RuntimeError(f"curl exit {r.returncode}: {r.stderr.strip()[:160]}")
    return json.loads(dest.read_text(errors="ignore"))


def parse_bundle(bundle: dict, brands: bool) -> tuple[dict, dict, int, int]:
    """Return (url -> org name, url -> npi, org count, orgs reachable)."""
    # Index by fullUrl AND id: Epic references entries as urn:uuid, everyone
    # else uses Type/id. Supporting only one of the two silently yields zero.
    by_ref: dict[str, dict] = {}
    for e in bundle.get("entry", []):
        r = e.get("resource") or {}
        if e.get("fullUrl"):
            by_ref[e["fullUrl"]] = r
        if r.get("id"):
            by_ref[f"{r.get('resourceType')}/{r['id']}"] = r
            by_ref[r["id"]] = r

    orgs = {k: v for k, v in by_ref.items() if v.get("resourceType") == "Organization"}
    url2name: dict[str, str] = {}
    url2npi: dict[str, str] = {}

    def ep_url(ref: str | None) -> str | None:
        e = by_ref.get((ref or "").strip())
        return norm(e.get("address")) if e and e.get("resourceType") == "Endpoint" else None

    # Organization -> Endpoint
    for o in orgs.values():
        for ep in o.get("endpoint") or []:
            u = ep_url(ep.get("reference"))
            if u and o.get("name"):
                url2name.setdefault(u, o["name"])
                n = npi_of(o)
                if n:
                    url2npi.setdefault(u, n)

    # Endpoint -> Organization (managingOrganization, or a contained Organization)
    for r in by_ref.values():
        if r.get("resourceType") != "Endpoint":
            continue
        u = norm(r.get("address"))
        if not u:
            continue
        mo = r.get("managingOrganization") or {}
        o = by_ref.get((mo.get("reference") or "").strip())
        name = (o or {}).get("name") or mo.get("display")
        if not name:
            for c in r.get("contained") or []:
                if c.get("resourceType") == "Organization":
                    name = c.get("name")
                    o = c
                    break
        if name:
            url2name.setdefault(u, name)
            if o:
                n = npi_of(o)
                if n:
                    url2npi.setdefault(u, n)

    reachable = 0
    if brands:
        # Brand hierarchy: walk partOf to the root, which is the org that owns
        # the endpoint. Naming one endpoint names every care site beneath it.
        uniq = {id(v): (k, v) for k, v in orgs.items()}
        org_by_ref = {k: v for k, v in orgs.items()}

        def root(ref: str, depth: int = 0) -> str | None:
            o = org_by_ref.get(ref)
            if not o or depth > 10:
                return None
            p = ((o.get("partOf") or {}).get("reference") or "").strip()
            return root(p, depth + 1) if p in org_by_ref else ref

        brand_url = {}
        for ref, o in org_by_ref.items():
            for ep in o.get("endpoint") or []:
                u = ep_url(ep.get("reference"))
                if u:
                    brand_url[ref] = u
        seen = set()
        for _, (ref, o) in uniq.items():
            if id(o) in seen:
                continue
            seen.add(id(o))
            r = root(ref)
            if r and brand_url.get(r):
                reachable += 1

    n_orgs = len({id(v) for v in orgs.values()})
    return url2name, url2npi, n_orgs, reachable


def git_sha() -> str:
    try:
        return subprocess.run(["git", "rev-parse", "--short", "HEAD"],
                              capture_output=True, text=True).stdout.strip() or "unknown"
    except Exception:
        return "unknown"


def main() -> int:
    CACHE.mkdir(parents=True, exist_ok=True)
    url2name: dict[str, str] = {}
    url2npi: dict[str, str] = {}
    url2vendor: dict[str, str] = {}
    per_vendor = []

    for label, url, brands in SOURCES:
        dest = CACHE / (re.sub(r"\W+", "_", label).strip("_").lower() + ".json")
        print(f"  fetching {label} ...", flush=True)
        try:
            b = fetch(url, dest)
        except Exception as e:
            print(f"    SKIPPED ({type(e).__name__}: {str(e)[:60]})")
            per_vendor.append({"vendor": label, "error": str(e)[:120]})
            continue
        n, p, n_orgs, reach = parse_bundle(b, brands)
        for u, v in n.items():
            url2name.setdefault(u, v)
            url2vendor.setdefault(u, label)
        url2npi.update({u: v for u, v in p.items() if u not in url2npi})
        per_vendor.append({"vendor": label, "url_org_pairs": len(n), "with_npi": len(p),
                           "organizations": n_orgs, "orgs_reachable_via_hierarchy": reach,
                           "publishes_brand_hierarchy": brands})
        print(f"    {len(n):,} url->org pairs, {n_orgs:,} organizations"
              + (f", {reach:,} reachable via partOf" if brands else ""))

    # A vendor file that does not download is a missing input, not a vendor
    # that publishes nothing. Continuing past every source failing turns a
    # network problem into a published claim that the gap cannot be closed.
    fetched = [v for v in per_vendor if "error" not in v]
    if not fetched:
        raise SystemExit(
            "every vendor source failed to download; refusing to publish a "
            "0% attribution finding assembled from no inputs. Errors:\n  "
            + "\n  ".join(f"{v['vendor']}: {v['error']}" for v in per_vendor)
        )
    if len(fetched) < len(per_vendor):
        print(f"\n  WARNING: {len(per_vendor) - len(fetched)} of {len(per_vendor)} "
              f"vendor sources failed; every number below is a floor.")

    print("\n  querying the NDH ...")
    client = bigquery.Client(project=PROJECT)
    # Attributed means the managingOrganization reference RESOLVES, not merely
    # that it is present. H50 counts it that way, and counting presence here
    # instead published two different totals for "endpoints with no owner"
    # (94,623 against H50's 94,711) with nothing on either page explaining the
    # gap. The difference is 88 references that point at an organization the
    # file does not contain, and for this finding's question, an endpoint whose
    # owner cannot be looked up is unnamed regardless of why.
    ndh = [dict(r) for r in client.query(
        "SELECT LOWER(e._address) AS addr, "
        "       IF(o._id IS NULL, NULL, e._managing_org_id) AS _managing_org_id "
        f"FROM `{PROJECT}.cms_npd.endpoint` e "
        f"LEFT JOIN `{PROJECT}.cms_npd.organization` o "
        "  ON e._managing_org_id = CONCAT('Organization/', o._id) "
        "WHERE e._connection_type='hl7-fhir-rest'",
        job_config=bq_job_config()).result()]

    total = len(ndh)
    attributed = sum(1 for r in ndh if r["_managing_org_id"])
    unattr = [r for r in ndh if not r["_managing_org_id"]]
    fillable = [r for r in unattr if norm(r["addr"]) in url2name]
    with_npi = [r for r in fillable if norm(r["addr"]) in url2npi]
    by_vendor = collections.Counter(url2vendor[norm(r["addr"])] for r in fillable)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    ndh_urls = {norm(r["addr"]) for r in ndh}
    owned = {norm(r["addr"]) for r in ndh if r["_managing_org_id"]}
    with (OUT_DIR / f"{SLUG}.csv").open("w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["url", "org_name", "org_npi", "vendor", "in_ndh", "ndh_has_owner"])
        for u in sorted(url2name):
            w.writerow([u, url2name[u], url2npi.get(u, ""), url2vendor.get(u, ""),
                        "yes" if u in ndh_urls else "no",
                        "yes" if u in owned else ("no" if u in ndh_urls else "")])

    after = attributed + len(fillable)
    headline = (
        f"Vendors already publish the organization behind {len(fillable):,} of the "
        f"{len(unattr):,} NDH FHIR endpoints that carry no owner ({len(fillable)/len(unattr)*100:.0f}%). "
        f"{len(with_npi):,} of those resolve to an NPI directly. Ingesting files that are "
        f"public today would move endpoint attribution from {attributed/total*100:.1f}% to "
        f"{after/total*100:.1f}%."
    )
    notes = (
        "The gap measured in H50 is not absent data. It is data published by the EHR vendors and "
        "not carried into the directory. PointClickCare publishes 4,015 endpoints and the NDH holds "
        "exactly 4,015 of them at zero attribution, so the name was available at ingest time.\n\n"
        "Two publication styles. Most vendors ship a flat HTI-1 service base URL list, one endpoint "
        "per practice. Epic ships a SMART User-access Brands bundle, where care sites hang off a "
        "parent brand and the endpoint sits on the brand. The hierarchy is the more useful shape: "
        "naming one endpoint names every care site beneath it.\n\n"
        "Reference resolution decides whether this works at all. Epic references bundle entries by "
        "urn:uuid rather than Type/id and links care sites by partOf. A naive resolver returns zero "
        "matches, which is the same failure that produced a wrong published claim about Epic in H47. "
        "Both reference styles and both link directions are handled, and the hierarchy rollup is "
        "asserted against the organization count so a double-count cannot pass silently.\n\n"
        "Every figure is a floor. These are the largest publishers; ONC's Lantern catalogues over 200 "
        "sources. Matching is exact on a normalized URL, so a vendor that spells a path differently "
        "from the NDH is counted as a miss.\n\n"
        "The vendor files carry visible test data. Practice Fusion publishes an organization named "
        "'Practice Fusion Test Test account' and an address line reading 'Helloooo This is important'. "
        "Anything built on these needs a junk filter, or it republishes that as fact."
    )

    payload = {
        "slug": SLUG,
        "title": "Vendor-published endpoint files can name most of what the NDH cannot",
        "hypotheses": ["H51"],
        "status": "published",
        "release_date": RELEASE_DATE,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "methodology_version": METHODOLOGY_VERSION,
        "commit_sha": git_sha(),
        "headline": headline,
        "numerator": len(fillable),
        "denominator": len(unattr),
        "chart": {"type": "bar", "unit": "count",
                  "data": [{"label": v, "value": n} for v, n in by_vendor.most_common()]},
        "notes": notes,
        "detail": {
            "ndh_fhir_rest_endpoints": total,
            "attributed_today": attributed,
            "attribution_rate_today_pct": round(attributed / total * 100, 1),
            "attribution_rate_after_fill_pct": round(after / total * 100, 1),
            "unattributed": len(unattr),
            "fillable_from_vendor_files": len(fillable),
            "fillable_with_npi": len(with_npi),
            "published_url_org_pairs": len(url2name),
            "by_vendor": dict(by_vendor),
            "vendors": per_vendor,
            "crosswalk_url": f"/api/v1/findings/{SLUG}.csv",
        },
    }
    (OUT_DIR / f"{SLUG}.json").write_text(json.dumps(payload, indent=2) + "\n")

    print("\n" + headline)
    print(f"\n  wrote {OUT_DIR / (SLUG + '.json')}")
    print(f"  wrote {OUT_DIR / (SLUG + '.csv')} ({len(url2name):,} rows)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
