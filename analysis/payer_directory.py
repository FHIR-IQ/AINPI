"""Classify NDH FHIR REST endpoint addresses as payer provider directories.

H49 first counted a payer directory only when its URL path named itself
(`providerdirectory`, `plan-net`, `pdex`). That is a floor, and FHI-71 showed
how low: the 2026-10-07 release carries Highmark, Independence Blue Cross,
AmeriHealth and Capital BlueCross directories at paths that never say
"directory", plus 144 CMS Medicare Advantage bulk directory files (MPF)
that name a contract ID instead. The published "50 of 111,259" missed
all of them.

An address is now classified by two independent signals, and every address
records which one fired, so the count can be split path-only / host-only /
both:

  path   the URL path labels itself (DIRECTORY_RE, unchanged from H49).
  host   the address sits on a host shown to serve a payer's directory, by
         one of three bases:
           contract  the release's own InsurancePlan resources carry CMS
                     contract IDs (InsurancePlan.alias, H#### / R#### / S####)
                     and the address, or another address on the same host,
                     carries one of those IDs. Derived from the release, not
                     typed in. Shared cloud hosts never inherit it from a
                     neighbour (SHARED_HOST_SUFFIXES).
           curated   KNOWN_PAYER_DIRECTORIES: hosts named in FHI-71 and the
                     H49 control directory, each probed by hand.
           payer-name  PAYER_NAMED_DIRECTORIES: hosts whose domain label equals
                     the name of an organization the 2026-10-07 NDH types
                     `pay`, each probed by hand before being listed.

Why the payer-name match is a reviewed list and not a live rule: run live, it
over-matches. On 2026-10-07 it matched `eproxy.mercycare.org` (MERCY CARE),
`ehrlivefhir.corp.communitycare.com` (COMMUNITY CARE, INC.) and
`proxy.healthpartners.com` (HEALTHPARTNERS, INC.), all provider EHR servers,
and the bare `/r4` bases of payer hosts, which are authenticated patient APIs
(401 to an unauthenticated Practitioner search). A provider's own FHIR server
is not a payer directory because its name resembles a payer's.

The route the issue first proposed, payer organization -> telecom URL or
endpoint -> domain, returns nothing in this release: none of the 997
organizations typed `pay` carries a telecom, an endpoint, an identifier or a
partOf. That is measured, not assumed (see h49_recheck_release.py).

Known limit of host inheritance: a host earns the contract signal from any
one address on it, so a later release that adds a provider's own FHIR base to
that host would classify by host. eppoa.spectrumhealth.org is the live case:
a health system's host that carries Priority Health's MPF files. Every
address on it is directory-shaped today; recheck the inherited-only addresses
(contract on the host, none in the address) each release.

A host signal never classifies an address whose path marks it as something
else (NON_DIRECTORY_RE: patient access, CARIN Blue Button, US Core, pharmacy
benefit). The path signal is the H49 rule exactly, so the path-only count
stays comparable with earlier releases.

What counts as a directory, decided once: a FHIR REST address that serves a
payer's provider directory data without authentication, whether as a
searchable FHIR API or as a CMS MPF bulk index (`index.json` listing NDJSON or
JSON files). Both are directory data; only the first can be searched by NPI,
so `bulk` is reported separately rather than used to exclude.

No BigQuery import here: pytest runs this offline.
"""
from __future__ import annotations

import re
from typing import Iterable, Mapping, Optional

# H49's URL-path self-labelling rule. Unchanged, so the path-only count is the
# figure published before FHI-71.
DIRECTORY_RE = r"providerdirectory|provider-directory|plan-?net|pdex"
PATIENT_ACCESS_RE = r"patientaccess|patient-access"

# A host signal never overrides a path that says the address is something
# other than a directory. ibx.com serves both /provider/ and /patient/.
NON_DIRECTORY_RE = (
    r"patientaccess|patient-access|/patient/|patient360|carin-bb|/uscore|"
    r"pharmacybenefit|formulary|"
    # Authorization and member-facing paths. A host that serves a payer's
    # directory also serves its OAuth and member APIs; inheriting the host
    # signal must not turn a token endpoint into a directory.
    r"/oauth|/token(?:[/?]|$)|/authorize|\.well-known|/smart(?:[/?-]|$)|"
    r"/auth(?:[/?]|$)|/login|/member"
)

# CMS contract identifiers as they appear in InsurancePlan.alias and in MPF
# URLs: one letter, four digits, not embedded in a longer token.
CONTRACT_ID_RE = re.compile(r"(?<![A-Za-z0-9])([HRS]\d{4})(?![0-9])", re.IGNORECASE)
CONTRACT_ALIAS_RE = re.compile(r"[HRS]\d{4}")

# Shared hosting. A contract ID on one blob or function URL says nothing about
# the next customer on the same host, so these never inherit the signal from a
# neighbouring address; only an address carrying the ID itself classifies.
SHARED_HOST_SUFFIXES = (
    "blob.core.windows.net", "azurewebsites.net", "amazonaws.com",
    "cloudfront.net", "cloudhub.io", "azurehealthcareapis.com",
    "storage.googleapis.com",
    # Vendor platforms that host one payer tenant per path. A contract ID on
    # one tenant's path says nothing about the next tenant on the same host.
    "edifecsfedcloud.com", "cdn.mpulse.com",
)

# Template addresses submitted with the placeholder left unfilled
# (`ppp-cccc-nnn`, `thp-h2256-nnn`). Counted as addresses, flagged, and kept
# out of both the bulk and the API counts.
PLACEHOLDER_RE = r"(?:^|[-/\[])(?:ppp|cccc|nnn)(?:$|[-/\]])"

# QA and UAT hosts: published in the NDH as production addresses.
TEST_HOST_RE = r"qa|uat"

# MPF bulk index shapes, reported separately from searchable APIs.
BULK_RE = (
    r"index\.json|indexfhir\.json|index_fhir\.json|\$export|cms-export|"
    r"bulkpublish|cms-hpms-manifest|cmsreport|cms-report|/mpf/|mpf-provider-directory"
)

# Hosts named in FHI-71 plus the H49 control. Each was probed on 2026-10-16
# with curl: `<address>Practitioner?_count=1`, no credentials, and returned 200
# with a FHIR searchset Bundle. `prefix` limits the host signal to the
# directory path, because the same hosts serve authenticated APIs elsewhere.
# `sample` is an address the classifier must accept; check_controls() raises
# if it does not.
KNOWN_PAYER_DIRECTORIES = (
    {"host": "apicmsqa.hmhs.com", "prefix": "/cms/fhir/v4/providers/",
     "payer": "Highmark",
     "sample": "https://apicmsqa.hmhs.com/cms/fhir/v4/providers/HM/Practitioner",
     "source": "FHI-71; seven plan paths (HM, HMDE, HMNY, HMPAMS, HMWV, HMWVMS, BCBSDE) in the 2026-10-07 NDH"},
    {"host": "eapics.ibx.com", "prefix": "/provider/",
     "payer": "Independence Blue Cross",
     "sample": "https://eapics.ibx.com/provider/v1/fhir",
     "source": "FHI-71; /patient/v1/fhir on the same host is the patient API and is excluded"},
    {"host": "eapics.amerihealth.com", "prefix": "/provider/",
     "payer": "AmeriHealth",
     "sample": "https://eapics.amerihealth.com/provider/v1/fhir",
     "source": "FHI-71; same platform as eapics.ibx.com"},
    {"host": "api.capitalbluecrossfhir.com", "prefix": "/r4/public",
     "payer": "Capital BlueCross",
     "sample": "https://api.capitalbluecrossfhir.com/r4/public-ma/",
     "source": "FHI-71; Medicare Advantage directory, 161,807 practitioners on 2026-10-16"},
    {"host": "providerdirectory-api.capbluecross.com", "prefix": "/r4",
     "payer": "Capital BlueCross",
     "sample": "https://providerdirectory-api.capbluecross.com/r4",
     "source": "H49 control directory (CONTROL_DIRECTORIES); not in the 2026-10-07 NDH"},
)

# Hosts whose domain label (less a trailing "fhir") equals the name of an
# organization the 2026-10-07 NDH types `pay`, kept only where the directory
# path answered an unauthenticated Practitioner search with 200 on
# 2026-10-16. Rejected on the same review: fhir.eternalhealth.com and
# api-developerportal.healthpartners.com (401), the bare /r4 bases of every
# host below (401: patient APIs), and the provider EHR servers named in the
# module docstring.
PAYER_NAMED_DIRECTORIES = (
    {"host": "api.capitalhealthplanfhir.com", "prefix": "/r4/public",
     "payer": "CAPITAL HEALTH PLAN", "sample": "https://api.capitalhealthplanfhir.com/r4/public-ma/"},
    {"host": "api.communitycarefhir.com", "prefix": "/r4/public",
     "payer": "COMMUNITY CARE, INC. (name match)", "sample": "https://api.communitycarefhir.com/r4/public-prod-ma/"},
    {"host": "api.globalhealthfhir.com", "prefix": "/r4/public",
     "payer": "GLOBALHEALTH, INC.", "sample": "https://api.globalhealthfhir.com/r4/public/Practitioner"},
    {"host": "api.hamaspikfhir.com", "prefix": "/r4/public",
     "payer": "HAMASPIK, INC.", "sample": "https://api.hamaspikfhir.com/r4/public/"},
    {"host": "api.mmmhealthcarefhir.com", "prefix": "/r4/public",
     "payer": "MMM HEALTHCARE, LLC", "sample": "https://api.mmmhealthcarefhir.com/r4/public-ma/Practitioner"},
    {"host": "api.vivahealthfhir.com", "prefix": "/r4/public",
     "payer": "VIVA HEALTH, INC.", "sample": "https://api.vivahealthfhir.com/r4/public/Practitioner"},
    {"host": "fhir.elderservehealth.org", "prefix": "/fhir",
     "payer": "ELDERSERVE HEALTH, INC.", "sample": "https://fhir.elderservehealth.org/fhir/metadata"},
    {"host": "fhir.nativeadvantage.com", "prefix": "/",
     "payer": "NATIVE ADVANTAGE, INC.", "sample": "https://fhir.nativeadvantage.com/fhir"},
    {"host": "providerfhirapi.healthpartnersplans.com", "prefix": "",
     "payer": "HEALTH PARTNERS PLANS, INC.", "sample": "https://providerfhirapi.healthpartnersplans.com"},
)

# Addresses the classifier must reject. Each is a payer-owned or payer-named
# host serving something other than a public directory.
KNOWN_NOT_DIRECTORIES = (
    # UPMC Health Plan's FHIR base, carried on the provider-typed record
    # Organization-1740164938. FHI-71 listed it as a missed directory; on
    # 2026-10-16 its CapabilityStatement answered but /Practitioner returned
    # 401, so it is the authenticated member API. Its public directory is the
    # Group/Providerdirectory/$export path, already path-classified.
    "https://apis.upmchp.com/FHIR/R4/",
    "https://eapics.ibx.com/patient/v1/fhir/",
    "https://api.capitalhealthplanfhir.com/r4",
    "https://eproxy.mercycare.org/oauth2/STEINDLER/api/FHIR/R4",
    "https://proxy.healthpartners.com/FHIRProxy/api/FHIR/R4/",
)

_DIRECTORY = re.compile(DIRECTORY_RE)
_PATIENT = re.compile(PATIENT_ACCESS_RE)
_NON_DIRECTORY = re.compile(NON_DIRECTORY_RE)
_BULK = re.compile(BULK_RE)
_PLACEHOLDER = re.compile(PLACEHOLDER_RE)
_TEST_HOST = re.compile(TEST_HOST_RE)


class ClassifierControlFailed(RuntimeError):
    """A known payer directory did not classify, or a known non-directory did."""


def host_of(address: str) -> str:
    m = re.match(r"^\s*[a-z][a-z0-9+.-]*://([^/:?#]+)", (address or "").lower())
    return m.group(1).rstrip(".") if m else ""


def path_of(address: str) -> str:
    m = re.match(r"^\s*[a-z][a-z0-9+.-]*://[^/?#]+([^?#]*)", (address or "").lower())
    return m.group(1) if m else ""


def plan_contracts(insurance_plans: Iterable[Mapping]) -> dict[str, str]:
    """Contract ID -> owning organization id, from InsurancePlan resources."""
    out: dict[str, str] = {}
    for r in insurance_plans:
        owner = ((r.get("ownedBy") or {}).get("reference") or "").split("/")[-1]
        for a in r.get("alias") or []:
            if isinstance(a, str) and CONTRACT_ALIAS_RE.fullmatch(a.strip().upper()):
                out.setdefault(a.strip().upper(), owner)
    return out


def contract_ids(address: str, contracts: Mapping[str, str]) -> list[str]:
    """Contract IDs in `address` that the release's InsurancePlans carry."""
    return sorted({m.upper() for m in CONTRACT_ID_RE.findall(address or "")
                   if m.upper() in contracts})


def _shared(host: str) -> bool:
    return any(host == s or host.endswith("." + s) for s in SHARED_HOST_SUFFIXES)


def contract_hosts(addresses: Iterable[str], contracts: Mapping[str, str]) -> dict[str, list[str]]:
    """Host -> contract IDs seen on it, for hosts that may lend the signal to
    neighbouring addresses. Shared cloud hosts are left out."""
    out: dict[str, set] = {}
    for a in addresses:
        ids = contract_ids(a, contracts)
        h = host_of(a)
        if ids and h and not _shared(h):
            out.setdefault(h, set()).update(ids)
    return {h: sorted(v) for h, v in sorted(out.items())}


def _listed(address: str, entries) -> Optional[dict]:
    h, p = host_of(address), path_of(address)
    for e in entries:
        if h == e["host"] and p.startswith(e["prefix"].lower()):
            return e
    return None


def classify(address: str, contracts: Mapping[str, str] = None,
             hosts_with_contracts: Mapping[str, list] = None) -> dict:
    """Signals for one FHIR REST address.

    Returns {"directory", "path", "host", "basis", "payer", "bulk",
    "contracts", "url_kind"}. `url_kind` keeps H49's three buckets
    (provider-directory / patient-access / unlabelled), now with
    provider-directory meaning either signal.
    """
    contracts = contracts or {}
    hosts_with_contracts = hosts_with_contracts or {}
    low = (address or "").strip().lower()
    path_sig = bool(_DIRECTORY.search(low))
    basis: list[str] = []
    payer = None
    own_ids = contract_ids(address, contracts)
    inherited: list[str] = []
    if own_ids:
        basis.append("contract")
    elif host_of(address) in hosts_with_contracts:
        basis.append("contract")
        inherited = list(hosts_with_contracts[host_of(address)])
    cur = _listed(address, KNOWN_PAYER_DIRECTORIES)
    if cur:
        basis.append("curated")
        payer = cur["payer"]
    named = _listed(address, PAYER_NAMED_DIRECTORIES)
    if named:
        basis.append("payer-name")
        payer = payer or named["payer"]
    host_sig = bool(basis) and not _NON_DIRECTORY.search(low)
    if not host_sig:
        basis = []
        inherited = []
    directory = path_sig or host_sig
    placeholder = directory and bool(_PLACEHOLDER.search(path_of(address)))
    bulk = (directory and not placeholder
            and bool(CONTRACT_ID_RE.search(path_of(address)) or _BULK.search(low)))
    shape = (None if not directory else "placeholder" if placeholder
             else "bulk" if bulk else "api")
    if directory:
        kind = "provider-directory"
    elif _PATIENT.search(low):
        kind = "patient-access"
    else:
        kind = "unlabelled"
    return {
        "directory": directory,
        "path": path_sig,
        "host": host_sig,
        "basis": basis,
        "payer": payer,
        "contracts": own_ids,
        # Contract IDs the host lent this address when it carries none itself.
        "inherited_from": inherited,
        "placeholder": placeholder,
        "bulk": bulk,
        "shape": shape,
        "test_host": bool(_TEST_HOST.search(host_of(address).split(".")[0])),
        "url_kind": kind,
    }


def signal_label(c: dict) -> Optional[str]:
    if c["path"] and c["host"]:
        return "both"
    if c["path"]:
        return "path_only"
    if c["host"]:
        return "host_only"
    return None


def summarize(classified: Iterable[dict]) -> dict:
    """Breakdown of classified addresses by signal, host basis and shape."""
    rows = [c for c in classified if c["directory"]]
    by_signal = {"path_only": 0, "host_only": 0, "both": 0}
    by_basis = {"contract": 0, "curated": 0, "payer-name": 0}
    for c in rows:
        by_signal[signal_label(c)] += 1
        for b in c["basis"]:
            by_basis[b] += 1
    shapes = {"bulk": 0, "api": 0, "placeholder": 0}
    for c in rows:
        shapes[c["shape"]] += 1
    return {
        "total": len(rows),
        "by_signal": by_signal,
        "host_signal_by_basis": by_basis,
        "bulk_mpf_index": shapes["bulk"],
        # FHIR API base addresses by URL shape. Whether each answers is a
        # separate, dated probe (probe_target / answered).
        "fhir_api_base": shapes["api"],
        "placeholder_template": shapes["placeholder"],
        "inherited_only": sum(1 for c in rows if c.get("inherited_from")),
        "on_qa_or_uat_host": sum(1 for c in rows if c.get("test_host")),
    }


_RESOURCE_TAIL = re.compile(r"/(practitioner|practitionerrole|organization|location|"
                            r"healthcareservice|insuranceplan|endpoint)$", re.IGNORECASE)


def probe_target(address: str, shape: str) -> str:
    """The URL a probe fetches for one classified address.

    A bulk index is fetched as published. A FHIR API is asked for one
    Practitioner with no credentials: a resource-type address or one that
    already carries a query is used as is, `/metadata` is swapped for a
    Practitioner search, and a bare base gets `/Practitioner?_count=1`.
    """
    a = (address or "").strip()
    if shape != "api":
        return a
    if "?" in a:
        base, _, query = a.partition("?")
        if base.rstrip("/").lower().endswith("/metadata"):
            return base.rstrip("/")[: -len("/metadata")] + "/Practitioner?_count=1"
        return a
    b = a.rstrip("/")
    if b.lower().endswith("/metadata"):
        return b[: -len("/metadata")] + "/Practitioner?_count=1"
    if _RESOURCE_TAIL.search(b):
        return b + "?_count=1"
    return b + "/Practitioner?_count=1"


def answered(status: int, body: bytes, shape: str) -> bool:
    """True when an unauthenticated probe got directory data back: HTTP 200
    and a JSON body that is a FHIR Bundle (API) or names provider files or a
    FHIR resource (bulk index)."""
    if status != 200 or not body:
        return False
    try:
        import json
        doc = json.loads(body.decode("utf-8-sig", "replace"))
    except ValueError:
        return False
    if not isinstance(doc, dict):
        return False
    if shape == "api":
        return doc.get("resourceType") == "Bundle"
    return bool(doc.get("resourceType") or doc.get("provider_urls")
                or any(k.endswith("_urls") for k in doc))


def check_controls(contracts: Mapping[str, str] = None, *, plans_present: bool = False) -> None:
    """Raise unless every known directory classifies and every known
    non-directory does not. With plans present, also raise when no contract ID
    could be read: that would silently switch the contract signal off."""
    failures = []
    for e in KNOWN_PAYER_DIRECTORIES + PAYER_NAMED_DIRECTORIES:
        c = classify(e["sample"], contracts)
        if not (c["directory"] and c["host"]):
            failures.append(f"known payer directory did not classify: {e['sample']}")
    for a in KNOWN_NOT_DIRECTORIES:
        if classify(a, contracts)["directory"]:
            failures.append(f"known non-directory classified as a directory: {a}")
    if plans_present and not contracts:
        failures.append("InsurancePlan resources are present but no contract ID "
                        "was read from InsurancePlan.alias")
    if failures:
        raise ClassifierControlFailed("; ".join(failures))
