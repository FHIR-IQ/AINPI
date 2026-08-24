"""Create or update the AINPI Databricks Marketplace listings from a spec.

WHY A SCRIPT

Listing copy that lives only in a web form cannot be reviewed, diffed or
re-applied. The wording here is the same wording in docs/marketplace-listings.md,
so a change goes through the same review as code.

THE ONE STEP THIS CANNOT DO

A listing hangs off a provider profile, and the provider profile has no create
API. GET /api/2.1/marketplace-provider/providers works and POST to the same path
returns "No API found", so the profile is console-only: Marketplace provider
console, Profiles, then fill in name, icon, description, website, business and
support email, and the terms and privacy links. It also requires an icon file,
which this repo does not have.

Once the profile exists this script does the rest:

    python analysis/marketplace_publish.py --check     # what is missing
    python analysis/marketplace_publish.py --publish   # create or update
    python analysis/marketplace_publish.py --status
"""
from __future__ import annotations

import argparse
import json
import pathlib
import subprocess
import sys
import tempfile

REPO = pathlib.Path(__file__).resolve().parent.parent
SHARE = "ainpi-ndh-archive"

# Copy is duplicated from docs/marketplace-listings.md on purpose: that file is
# the human-readable source of truth and this is the machine-applied form. A
# test asserts the headline sentences match so they cannot drift apart.
# Measured, not assumed: the API rejects a subtitle over 120 characters. The
# first draft was 144 and the create failed on it.
ARCHIVE_SUBTITLE = (
    "Every release of the federal provider directory, including the ones CMS "
    "no longer serves. Diff them in one query."
)

ARCHIVE_DESCRIPTION = """CMS publishes the National Provider Directory as a bulk FHIR export and serves only the current version. When a new release lands, the previous one is gone from the source. This archive keeps them. That is the entire product, and it is free.

WHAT IS IN IT. Two releases so far, 2026-05-08 and 2026-08-20, 54,162,643 rows across six tables: Practitioner, PractitionerRole, Organization, OrganizationAffiliation, Location and Endpoint. Every row carries the untouched FHIR resource JSON, plus flattened columns so ordinary questions do not require JSON parsing. Both releases are extracted by the same code, so comparing them is not comparing two parsers. Each table is partitioned by release_date, which makes a cross-release comparison a WHERE clause rather than a download.

WHAT IT IS FOR. Questions that need two releases at once. One worked example, included as a notebook: between these two releases CMS added about seven million PractitionerRole records, a 173% rise. The share of clinicians who have one moved 4.5 points, from 26.9% to 31.4%. The rest went to people the directory already described, taking the average covered clinician from two role records to nearly five. That is a real improvement and a different improvement from covering more people, and a headline record count cannot tell them apart.

BEFORE YOU WRITE A DIFF. Practitioner and Organization ids embed the NPI and are stable across releases. Endpoint and Location ids are random UUIDs that CMS regenerates on every export, so joining those two on _id across releases reports 100 percent churn that did not happen. Join Endpoint on _address instead. The table comments carry the same warning and the notebook demonstrates it.

WHERE IT COMES FROM. Maintained by AINPI (ainpi.dev), a public-interest audit of federal provider directory data. Every measurement it publishes is pre-registered before the numbers are computed, the compute scripts are open, and corrections are published when a source changes underneath a claim.

LICENCE. The underlying federal files are US government works and are not subject to copyright. AINPI claims no rights over them and grants none, because it has none to grant. The compilation and the extraction code are Apache-2.0. Attribution is requested rather than required, for a practical reason: a figure quoted without its release date cannot be checked against the release it came from.

NOT A SOURCE OF TRUTH ABOUT ANY INDIVIDUAL. This is a measurement of a federal file. Do not make an enrolment, credentialing, payment or network decision about a named provider from a record here without checking the primary sources: the NPPES registry, the OIG exclusions list, and SAM.gov.

CORRECTIONS WELCOME. If a number here disagrees with something you can verify, we would rather hear it: https://github.com/FHIR-IQ/AINPI/issues"""

LISTINGS = [
    {
        "key": "archive",
        "name": "CMS National Provider Directory: Release Archive",
        "subtitle": ARCHIVE_SUBTITLE,
        "description": ARCHIVE_DESCRIPTION,
        # Enumerated from the 2,076 live consumer listings, not guessed. The
        # healthcare value is HEALTH. HEALTH_AND_LIFE_SCIENCES is not a member
        # of the enum and the API drops it silently: the create returns 200 and
        # the listing comes back carrying only PUBLIC_SECTOR. For a healthcare
        # dataset that is the one category worth losing least.
        "categories": ["HEALTH", "PUBLIC_SECTOR"],
        "share": SHARE,
        "visibility": "PUBLIC",
        "terms_of_service": "https://ainpi.dev/terms",
        "privacy_policy_link": "https://ainpi.dev/privacy",
        "notebook": "analysis/notebooks/ainpi_archive_quickstart.py",
        "notebook_display_name": "Release archive quickstart",
        # These drive Marketplace faceted search. Ours were all empty, which is
        # not neutral: a consumer filtering to free healthcare data with a
        # notebook does not see a listing that declares none of those things.
        # Measured across the 2,076 live consumer listings, 1,129 leave `cost`
        # unset, so filling it is cheap differentiation rather than table stakes.
        "cost": "FREE",
        "listing_type": "STANDARD",
        "assets": ["ASSET_TYPE_DATA_TABLE", "ASSET_TYPE_NOTEBOOK"],
        "data_source": "CMS National Provider Directory bulk FHIR export (directory.cms.gov)",
        "documentation_link": "https://ainpi.dev/archive",
        "license": "https://ainpi.dev/data-license",
        "geographical_coverage": '["United States"]',
        # CMS has published roughly quarterly. Stated as observed cadence, not
        # as a commitment we control.
        "update_frequency": {"interval": 3, "unit": "MONTHLY"},
    },
]


def sh(args: list[str]) -> tuple[int, str]:
    p = subprocess.run(args, capture_output=True, text=True)
    return p.returncode, (p.stdout or p.stderr)


def provider_id() -> str | None:
    rc, out = sh(["databricks", "api", "get", "/api/2.1/marketplace-provider/providers"])
    if rc != 0:
        return None
    try:
        data = json.loads(out or "{}")
    except json.JSONDecodeError:
        return None
    providers = data.get("providers") or []
    return providers[0].get("id") if providers else None


def do_check() -> bool:
    ok = True
    pid = provider_id()
    if pid:
        print(f"  provider profile: {pid}")
    else:
        ok = False
        print("  provider profile: MISSING. This is the one step with no API.")
        print("    Marketplace provider console > Profiles. Needs an icon file,")
        print("    description, website, business and support email, and the")
        print("    terms and privacy links (both already live on ainpi.dev).")

    # --include-shared-data is required. Without it the response carries only
    # the share's metadata and no objects at all, so a healthy six-table share
    # reads as empty and the preflight blocks a publish that should proceed.
    rc, out = sh(["databricks", "shares", "get", SHARE, "--include-shared-data"])
    shared = len(json.loads(out).get("objects", [])) if rc == 0 else 0
    print(f"  share {SHARE}: {shared} table(s)" if rc == 0 else f"  share {SHARE}: NOT FOUND")
    if rc != 0 or shared != 6:
        ok = False

    for spec in LISTINGS:
        nb = REPO / spec["notebook"]
        print(f"  notebook {spec['notebook']}: {'present' if nb.exists() else 'MISSING'}")
        if not nb.exists():
            ok = False

    # curl, not urllib. Python's TLS stack fails against local interception and
    # WAF-fronted hosts, and it fails as URLError, which reads exactly like the
    # page being down. It reported all three of these unreachable while curl got
    # 200. Same lesson as H26, H46 and the vendor downloads in H51.
    for url in ("https://ainpi.dev/terms", "https://ainpi.dev/privacy",
                "https://ainpi.dev/data-license"):
        rc, out = sh(["curl", "-sS", "-o", "/dev/null", "-w", "%{http_code}",
                      "-L", "--max-time", "20", url])
        code = out.strip() if rc == 0 else f"curl exit {rc}"
        print(f"  {url}: {code}")
        if code != "200":
            ok = False
    return ok


NOTEBOOK_WS_DIR = "/Users/gene@fhiriq.com"


def listing_files(lid: str) -> list[dict]:
    rc, out = sh(["databricks", "api", "get",
                  f"/api/2.1/marketplace-provider/files"
                  f"?file_parent.parent_id={lid}&file_parent.file_parent_type=LISTING"])
    if rc != 0:
        return []
    try:
        return json.loads(out or "{}").get("file_infos", []) or []
    except json.JSONDecodeError:
        return []


def attach_notebook(lid: str, spec: dict) -> bool:
    """Export the notebook to HTML and attach it to the listing.

    The listing description says the notebook is included, so it has to be. A
    description that promises a worked example the listing does not carry is
    the one kind of defect this project cannot ship.

    Three things here were found by probing, not by reading:

    - Marketplace wants an HTML *export*, not the source. `text/html` is the
      only mime type EMBEDDED_NOTEBOOK accepts; x-ipynb, text/x-python,
      application/json and octet-stream are each rejected by name.
    - The presigned PUT is signed over `host;x-amz-server-side-encryption`, so
      the upload must send `x-amz-server-side-encryption: AES256` and must not
      add a Content-Type. Either mistake is a 403 with no explanation.
    - The URL expires in 900 seconds, so create and upload without pausing.

    The new file is uploaded before the old one is deleted. The other order
    leaves the listing with no notebook if the upload fails.
    """
    src = REPO / spec["notebook"]
    ws = f"{NOTEBOOK_WS_DIR}/{src.stem}"
    html = pathlib.Path(tempfile.gettempdir()) / f"{src.stem}.html"

    rc, out = sh(["databricks", "workspace", "import", ws, "--file", str(src),
                  "--language", "PYTHON", "--format", "SOURCE", "--overwrite"])
    if rc != 0:
        print(f"    NOTEBOOK import failed: {out[:200]}")
        return False
    html.unlink(missing_ok=True)
    rc, out = sh(["databricks", "workspace", "export", ws, "--format", "HTML",
                  "--file", str(html)])
    if rc != 0 or not html.exists() or html.stat().st_size == 0:
        print(f"    NOTEBOOK export failed: {out[:200]}")
        return False

    before = [f["id"] for f in listing_files(lid)
              if f.get("marketplace_file_type") == "EMBEDDED_NOTEBOOK"]
    rc, out = sh(["databricks", "provider-files", "create", "--json", json.dumps({
        "file_parent": {"parent_id": lid, "file_parent_type": "LISTING"},
        "marketplace_file_type": "EMBEDDED_NOTEBOOK",
        "mime_type": "text/html",
        "display_name": spec["notebook_display_name"],
    })])
    if rc != 0:
        print(f"    NOTEBOOK create failed: {out[:200]}")
        return False
    created = json.loads(out)
    rc, code = sh(["curl", "-sS", "-o", "/dev/null", "-w", "%{http_code}",
                   "-X", "PUT", "-H", "x-amz-server-side-encryption: AES256",
                   "--data-binary", f"@{html}", created["upload_url"]])
    if code.strip() != "200":
        print(f"    NOTEBOOK upload failed: HTTP {code.strip()}")
        sh(["databricks", "provider-files", "delete", created["file_info"]["id"]])
        return False
    for old in before:
        sh(["databricks", "provider-files", "delete", old])
    print(f"    notebook attached: {created['file_info']['id']} "
          f"({html.stat().st_size:,} bytes)")
    return True


def do_publish(private: bool = False) -> bool:
    pid = provider_id()
    if not pid:
        raise SystemExit("no provider profile; run --check for what to do in the console")
    rc, out = sh(["databricks", "provider-listings", "list"])
    existing = {}
    if rc == 0:
        try:
            for l in json.loads(out or "[]"):
                existing[(l.get("summary") or {}).get("name")] = l.get("id")
        except json.JSONDecodeError:
            pass

    ok = True
    for spec in LISTINGS:
        body = {"listing": {
            "summary": {
                "name": spec["name"],
                "subtitle": spec["subtitle"],
                "provider_id": pid,
                "categories": spec["categories"],
                "listingType": spec.get("listing_type", "STANDARD"),
                "setting": {"visibility": "PRIVATE" if private else spec["visibility"]},
                "share": {"name": spec["share"], "type": "FULL"},
            },
            "detail": {
                "description": spec["description"],
                "terms_of_service": spec["terms_of_service"],
                "privacy_policy_link": spec["privacy_policy_link"],
                **{k: spec[k] for k in (
                    "cost", "assets", "data_source", "documentation_link",
                    "license", "geographical_coverage", "update_frequency",
                ) if k in spec},
            },
        }}
        lid = existing.get(spec["name"])
        if lid:
            rc, out = sh(["databricks", "provider-listings", "update", lid,
                          "--json", json.dumps(body)])
            print(f"  {spec['name']}: {'updated' if rc == 0 else 'UPDATE FAILED ' + out[:200]}")
        else:
            rc, out = sh(["databricks", "provider-listings", "create",
                          "--json", json.dumps(body)])
            print(f"  {spec['name']}: {'created' if rc == 0 else 'CREATE FAILED ' + out[:200]}")
        if rc != 0:
            if "private exchange provider" in out:
                print("    The account is a private-exchange provider. Public")
                print("    Marketplace listings need Databricks to approve the")
                print("    provider application first. Re-run with --private to")
                print("    publish into a private exchange in the meantime.")
            ok = False
            continue
        lid = lid or json.loads(out).get("listing_id")
        if not attach_notebook(lid, spec):
            ok = False
        if not verify_listing(lid, spec):
            ok = False
    # Exit non-zero when any listing failed. Printing FAILED and exiting 0 is
    # how a broken publish gets read as a done one.
    return ok


def verify_listing(lid: str, spec: dict) -> bool:
    """Read the listing back and compare it to what was sent.

    The API accepts an unknown category and drops it without an error, so a
    create that returns 200 is not evidence the listing says what the spec
    says. Whatever the server stored is the only thing a consumer will read.
    """
    rc, out = sh(["databricks", "provider-listings", "get", lid])
    if rc != 0:
        print(f"    VERIFY FAILED: cannot read back {lid}")
        return False
    got = json.loads(out).get("listing", {})
    summary, detail = got.get("summary", {}), got.get("detail", {})
    ok = True
    for label, sent, stored in (
        ("categories", sorted(spec["categories"]), sorted(summary.get("categories") or [])),
        ("subtitle", spec["subtitle"], summary.get("subtitle")),
        ("terms", spec["terms_of_service"], detail.get("terms_of_service")),
        ("privacy", spec["privacy_policy_link"], detail.get("privacy_policy_link")),
        ("cost", spec.get("cost"), detail.get("cost")),
        ("assets", sorted(spec.get("assets") or []), sorted(detail.get("assets") or [])),
        ("docs", spec.get("documentation_link"), detail.get("documentation_link")),
        ("listingType", spec.get("listing_type", "STANDARD"), summary.get("listingType")),
    ):
        if sent is None:
            continue
        if sent != stored:
            print(f"    MISMATCH {label}: sent {sent!r}, stored {stored!r}")
            ok = False
    notebooks = [f for f in listing_files(lid)
                 if f.get("marketplace_file_type") == "EMBEDDED_NOTEBOOK"]
    if len(notebooks) != 1:
        print(f"    MISMATCH notebook: expected 1 attached, found {len(notebooks)}."
              " The description tells the reader one is included.")
        ok = False
    if ok:
        print(f"    verified: {lid}")
    return ok


def do_status() -> None:
    rc, out = sh(["databricks", "provider-listings", "list"])
    if rc != 0:
        print("  could not list listings:", out[:200]); return
    listings = json.loads(out or "[]")
    print(f"  {len(listings)} listing(s)")
    for l in listings:
        s = l.get("summary") or {}
        print(f"    {s.get('name')}  visibility={(s.get('setting') or {}).get('visibility')}"
              f"  share={(s.get('share') or {}).get('name')}")


def main() -> None:
    ap = argparse.ArgumentParser()
    for f in ("check", "publish", "status"):
        ap.add_argument(f"--{f}", action="store_true")
    ap.add_argument("--private", action="store_true",
                    help="publish into a private exchange instead of the public "
                         "Marketplace; never applied automatically, because a "
                         "listing nobody can see is not the thing that was asked for")
    a = ap.parse_args()
    if not any(vars(a).values()):
        ap.print_help(); return
    if a.check:
        sys.exit(0 if do_check() else 1)
    if a.publish:
        if not do_publish(private=a.private):
            sys.exit(1)
    if a.status:
        do_status()


if __name__ == "__main__":
    main()
