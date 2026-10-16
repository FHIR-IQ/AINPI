"""Build the "ask the provider directory" Genie space over the release archive.

WHAT THIS IS FOR

The Delta tables in workspace.ainpi hold three NDH releases side by side. They
are easy to query wrong: references are full FHIR strings, multi-valued fields
are pipe-joined into one column with a singular companion that holds only the
first value, and the stable cross-release key differs by resource. A Genie
space that does not know those rules answers plausibly and incorrectly. This
script writes the rules into the space's general instructions and pairs every
sample question with SQL whose answer was checked before the space existed.

    python analysis/databricks_genie.py               # print the spec (default)
    python analysis/databricks_genie.py --json        # print the API payload
    python analysis/databricks_genie.py --create -p ainpi
    python analysis/databricks_genie.py --update <space_id> -p ainpi

--print and --json make no network call. --create and --update call the
`databricks genie` CLI, then read the space back and compare it with what was
sent, because the Databricks APIs have a history here of accepting a field and
silently dropping it (see the Marketplace category enum in CLAUDE.md).

COST

Genie bills at zero on this account (system.billing.usage, CLAUDE.md). Every
question a user asks runs SQL on the existing serverless Small warehouse
(WAREHOUSE_ID in databricks_publish.py, 5-minute auto-stop), so the cost is
warehouse time, about the same as the daily install poll per wake. Creating the
space runs no SQL.

EXPECTED ANSWERS

Each sample carries `expected`, measured on 2026-10-16 and stated with how it
was measured: against the 2026-10-07 BigQuery tables (the same release the
Delta 2026-10-07 partition was loaded from), against the local parquet export
(the exact files uploaded to Databricks), or against org_endpoint_table.build()
on the published CSVs. A reviewer runs each sample question in the space and
compares. The expected answers are not sent to Databricks; the SQL is, both as
an example and as a benchmark answer.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import subprocess
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from databricks_publish import (  # noqa: E402
    CATALOG,
    DERIVED_TABLES,
    SCHEMA,
    TABLES,
    WAREHOUSE_ID,
)
from release import CURRENT_RELEASE  # noqa: E402

TITLE = "Ask the provider directory"
DESCRIPTION = (
    "The CMS National Directory of Healthcare bulk exports (FHIR R4) for "
    "2026-05-08, 2026-08-20 and 2026-10-07, archived by AINPI because CMS "
    "serves only the latest release. Ask about practitioners, organizations, "
    "roles, locations and FHIR endpoints, within a release or between releases. "
    "Research data: verify any number against primary sources before acting on it."
)

ARCHIVE_RELEASES = ("2026-05-08", "2026-08-20", "2026-10-07")
SPACE_TABLES = TABLES + DERIVED_TABLES


def fq(table: str) -> str:
    return f"{CATALOG}.{SCHEMA}.{table}"


# Columns per table, from the BigQuery schemas the parquet was exported from
# plus release_date. Entity matching is turned on only for short categorical
# strings a user would type a value of (a state, a connection type, a vendor);
# it is off for `resource`, ids and reference strings, where it only costs
# indexing and cannot help.
_REF = {"_id", "_practitioner_id", "_org_id", "_managing_org_id",
        "_participating_org_id", "_location_ids", "resource"}
_MATCH = {"_state", "_city", "_connection_type", "_status", "_org_type",
          "_specialty_code", "_specialty_display", "_gender", "release_date",
          "vendor", "source", "org_state", "host"}
TABLE_COLUMNS = {
    "practitioner": ["resource", "_id", "_npi", "_family_name", "_given_name",
                     "_state", "_city", "_postal_code", "_gender", "_active",
                     "_address_line", "_phone", "_telecom", "release_date"],
    "practitioner_role": ["resource", "_id", "_practitioner_id", "_org_id",
                          "_specialty_code", "_specialty_display", "_location_ids",
                          "_active", "_phone", "_telecom", "_specialty_codes",
                          "release_date"],
    "organization": ["resource", "_id", "_npi", "_name", "_state", "_city",
                     "_org_type", "_active", "_address_line", "_phone",
                     "_telecom", "release_date"],
    "organization_affiliation": ["resource", "_id", "_org_id",
                                 "_participating_org_id", "_active", "release_date"],
    "location": ["resource", "_id", "_name", "_state", "_city", "_postal_code",
                 "_status", "_managing_org_id", "_address_line", "_phone",
                 "_telecom", "_position_lat", "_position_lng", "release_date"],
    "endpoint": ["resource", "_id", "_connection_type", "_status", "_address",
                 "_name", "_managing_org_id", "release_date"],
    "org_endpoint": ["base_url", "host", "org_npi", "org_name", "org_state",
                     "vendor", "source", "in_ndh", "ndh_has_owner", "release_date"],
    "org_endpoint_summary": ["org_npi", "org_name", "n_endpoints", "vendors",
                             "sources", "release_date"],
}

# One general instruction block. The API holds it as a list of lines.
INSTRUCTIONS = f"""\
DATA
* These tables are the CMS National Directory of Healthcare (NDH) bulk export, FHIR R4, for three releases: {", ".join(ARCHIVE_RELEASES)}. release_date is a STRING partition column on every table.
* Every release is a complete snapshot, not an increment. Always filter release_date on every table in a query, on both sides of a join. If the user names no release, use '{CURRENT_RELEASE}' and say so in the answer. Never add counts across releases.
* Each NDH table has `resource`, the full FHIR resource as a JSON STRING (read it with get_json_object(resource, '$.path') or resource:path), plus flattened columns whose names start with an underscore. Prefer the flattened columns; use `resource` only for a field they do not carry.
* org_endpoint and org_endpoint_summary are curated by AINPI, not CMS files. Run SELECT DISTINCT release_date on them before assuming a release is present.

JOINS
* Reference columns hold full FHIR reference strings, not bare ids: practitioner_role._practitioner_id is like 'Practitioner/Practitioner-1639539059', _org_id and _managing_org_id like 'Organization/Organization-1043899859'. Join by rebuilding the reference from the target id:
  practitioner_role pr JOIN practitioner p ON pr._practitioner_id = CONCAT('Practitioner/', p._id)
  practitioner_role pr JOIN organization o ON pr._org_id = CONCAT('Organization/', o._id)
  endpoint e JOIN organization o ON e._managing_org_id = CONCAT('Organization/', o._id)
  location l JOIN organization o ON l._managing_org_id = CONCAT('Organization/', o._id)
  organization_affiliation a: a._org_id and a._participating_org_id both join to CONCAT('Organization/', o._id)
* A practitioner reaches an organization only through practitioner_role. There is no organization column on practitioner.
* org_endpoint.org_npi joins to organization._npi (a bare 10-digit NPI), not to _id.

MULTI-VALUED COLUMNS (the most common mistake)
* practitioner_role._specialty_code holds only the FIRST specialty. A role can carry up to 17. Use _specialty_codes, which holds all of them pipe-joined, for any question about a specialty: array_contains(split(_specialty_codes, '[|]'), '207Q00000X'). Filtering on _specialty_code undercounts: in {CURRENT_RELEASE}, 181,504 active roles carry more than one specialty, and family medicine counts 147,264 roles by _specialty_code against 152,325 by _specialty_codes.
* _location_ids is pipe-joined 'Location/Location-<uuid>' references. Split on '[|]' and join each to CONCAT('Location/', l._id).
* _telecom is pipe-joined system:value pairs in source order ('fax:4129148635|phone:4123197866'). _phone is the first entry whose system is phone, not the first entry. _address_line is pipe-joined address lines.
* split() takes a regular expression, so split on '[|]', never on a bare '|'.

COUNTING
* Count practitioners with COUNT(DISTINCT ...), never by counting roles: a covered practitioner has about 3.2 active roles in {CURRENT_RELEASE}.
* Filter practitioner_role._active = true for current roles.
* Specialty codes are NUCC taxonomy codes (for example 207Q00000X family medicine, 207R00000X internal medicine). The 2026-05-08 release still carried CMS Medicare specialty codes such as '14-50' in practitioner_role, so a NUCC filter on that release returns little and is not a finding.
* organization holds more than provider organizations. _org_type = 'prov' is a provider organization. Rows with NULL _org_type are mostly tax-ID records (get_json_object(resource, '$.type[0].text') = 'ein'). 'pay' is a payer. Use _org_type = 'prov' when counting organizations that deliver care, and say which types were counted.
* endpoint mixes two kinds of address. _connection_type = 'hl7-fhir-rest' is a callable FHIR API. 'direct-project' is a Direct secure-messaging address, not an API. Any question about FHIR endpoints or APIs uses the hl7-fhir-rest subset as its denominator.
* practitioner._state is NULL for about 1.17 million practitioners in {CURRENT_RELEASE}. Report them as unknown state rather than dropping them silently.
* location._position_lat and _position_lng are the only geography in the directory.

COMPARING RELEASES
* practitioner: _id is 'Practitioner-<NPI>' and _npi is the NPI. Both are stable across releases; join on _npi.
* organization: ids are a mix of NPI-based and random ids. Join on _npi, and say that organizations without an NPI (mostly payer, team and government records) are not compared.
* endpoint: join on _address, never on _id. Endpoint ids were regenerated between 2026-05-08 and 2026-08-20 (zero ids in common), so an _id join reports false 100% churn for that pair. Use _address for every pair, including 2026-08-20 to 2026-10-07 where most ids happen to carry over.
* location: there is no reliable cross-release key. Location ids were also regenerated between 2026-05-08 and 2026-08-20, and the name and address fields were re-cased and re-punctuated. Treat any Location comparison as lossy and state the match rate.
* A change in a row count between releases is not by itself a change in the world: CMS de-duplicated, added and removed record types between releases. Report the counts and the method, not a cause.

ORG_ENDPOINT
* org_endpoint has one row per (base_url, org_npi, source). source = 'ndh' is the managing organization the NDH Endpoint itself names. source = 'vendor_file' is a claim taken from files EHR vendors publish; it is not CMS data. A URL both sources name appears once per source, so count DISTINCT base_url for endpoints.
* org_npi is NULL where a vendor file names an organization without an NPI, and some vendor-file NPIs fail the NPI check digit (including the placeholder 1234567890). Exclude org_npi = '1234567890' when ranking organizations.
* org_endpoint_summary.vendors and .sources are arrays; use array_contains().

ANSWERS
* State the release and the denominator with every number. This is a research archive: say that numbers should be checked against the source before any decision.
"""


# ---------------------------------------------------------------------------
# Sample questions. `sql` is Databricks SQL and is sent to the space. `expected`
# and `verified` are for the reviewer and are not sent.
# ---------------------------------------------------------------------------
P = f"{CATALOG}.{SCHEMA}"
SAMPLES = [
    {
        "question": "How many practitioners are in each release?",
        "sql": f"""SELECT release_date, COUNT(*) AS practitioners
FROM {P}.practitioner
GROUP BY release_date
ORDER BY release_date""",
        "expected": "2026-05-08: 7,441,211; 2026-08-20: 7,373,232; 2026-10-07: 7,481,907.",
        "verified": "local parquet export (the files uploaded to Databricks); matches the release snapshot table in CLAUDE.md",
    },
    {
        "question": "In the latest release, how many endpoints are callable FHIR APIs and how many are Direct messaging addresses?",
        "sql": f"""SELECT _connection_type, COUNT(*) AS endpoints
FROM {P}.endpoint
WHERE release_date = '2026-10-07'
GROUP BY _connection_type
ORDER BY endpoints DESC""",
        "expected": "direct-project 1,029,577; hl7-fhir-rest 111,259 (total 1,140,836).",
        "verified": "BigQuery 2026-10-07 and local parquet, both",
    },
    {
        "question": "What share of FHIR API endpoints name an owning organization that exists in the directory?",
        "sql": f"""SELECT
  COUNT(*) AS fhir_endpoints,
  COUNT(e._managing_org_id) AS with_reference,
  COUNT(o._id) AS resolves_to_organization,
  ROUND(100 * COUNT(o._id) / COUNT(*), 1) AS pct_resolves
FROM {P}.endpoint e
LEFT JOIN {P}.organization o
  ON e._managing_org_id = CONCAT('Organization/', o._id)
 AND o.release_date = e.release_date
WHERE e.release_date = '2026-10-07'
  AND e._connection_type = 'hl7-fhir-rest'""",
        "expected": "111,259 FHIR endpoints; 16,353 carry a reference; 16,247 resolve (14.6%).",
        "verified": "BigQuery 2026-10-07; 16,247 also equals the H50 crosswalk row count",
    },
    {
        "question": "What share of practitioners have at least one active practitioner role?",
        "sql": f"""SELECT
  COUNT(DISTINCT p._id) AS practitioners,
  COUNT(DISTINCT pr._practitioner_id) AS with_active_role,
  ROUND(100 * COUNT(DISTINCT pr._practitioner_id) / COUNT(DISTINCT p._id), 1) AS pct
FROM {P}.practitioner p
LEFT JOIN {P}.practitioner_role pr
  ON pr._practitioner_id = CONCAT('Practitioner/', p._id)
 AND pr.release_date = p.release_date
 AND pr._active = true
WHERE p.release_date = '2026-10-07'""",
        "expected": "7,481,907 practitioners; 2,430,258 with an active role (32.5%).",
        "verified": "BigQuery 2026-10-07",
    },
    {
        "question": "What share of Pennsylvania practitioners have an active practitioner role?",
        "sql": f"""SELECT
  COUNT(DISTINCT p._id) AS practitioners,
  COUNT(DISTINCT pr._practitioner_id) AS with_active_role,
  ROUND(100 * COUNT(DISTINCT pr._practitioner_id) / COUNT(DISTINCT p._id), 1) AS pct
FROM {P}.practitioner p
LEFT JOIN {P}.practitioner_role pr
  ON pr._practitioner_id = CONCAT('Practitioner/', p._id)
 AND pr.release_date = p.release_date
 AND pr._active = true
WHERE p.release_date = '2026-10-07'
  AND p._state = 'PA'""",
        "expected": "227,917 practitioners; 100,379 with an active role (44.0%), matching the published PA connectivity ledger.",
        "verified": "BigQuery 2026-10-07",
    },
    {
        "question": "How many active practitioner roles include family medicine as a specialty?",
        "sql": f"""SELECT
  COUNT(*) AS family_medicine_roles
FROM {P}.practitioner_role
WHERE release_date = '2026-10-07'
  AND _active = true
  AND array_contains(split(_specialty_codes, '[|]'), '207Q00000X')""",
        "expected": "152,325. A wrong answer of 147,264 means Genie filtered _specialty_code (first specialty only).",
        "verified": "BigQuery 2026-10-07",
    },
    {
        "question": "How many active practitioner roles list more than one specialty?",
        "sql": f"""SELECT
  COUNT(*) AS active_roles,
  COUNT_IF(size(split(_specialty_codes, '[|]')) > 1) AS multi_specialty_roles
FROM {P}.practitioner_role
WHERE release_date = '2026-10-07'
  AND _active = true""",
        "expected": "181,504 of 7,708,681 active roles.",
        "verified": "BigQuery 2026-10-07",
    },
    {
        "question": "How many organizations are provider organizations, and how many are tax-ID records or other types?",
        "sql": f"""SELECT
  COALESCE(_org_type, get_json_object(resource, '$.type[0].text')) AS org_type,
  COUNT(*) AS organizations
FROM {P}.organization
WHERE release_date = '2026-10-07'
GROUP BY 1
ORDER BY organizations DESC""",
        "expected": "prov 1,976,702; ein 79,721; pay 997; team 639; ntwk 356; govt 65; no type 20 (total 2,058,500).",
        "verified": "BigQuery 2026-10-07",
    },
    {
        "question": "Which Pennsylvania organizations have the most practitioners attached through active roles?",
        "sql": f"""SELECT
  o._npi,
  o._name,
  COUNT(DISTINCT pr._practitioner_id) AS practitioners
FROM {P}.practitioner_role pr
JOIN {P}.organization o
  ON pr._org_id = CONCAT('Organization/', o._id)
 AND o.release_date = pr.release_date
WHERE pr.release_date = '2026-10-07'
  AND pr._active = true
  AND o._state = 'PA'
GROUP BY o._npi, o._name
ORDER BY practitioners DESC
LIMIT 5""",
        "expected": ("1285692699 UNIVERSITY OF PITTSBURGH PHYSICIANS 8,191; 1619935004 "
                     "UNIVERSITY OF PITTSBURGH PHYSICIANS 7,210; 1871981985 COBIUS "
                     "HEALTHCARE SOLUTIONS 5,596; 1558313023 GEISINGER CLINIC 5,368; "
                     "1366493868 GEISINGER CLINIC 4,354."),
        "verified": "BigQuery 2026-10-07",
    },
    {
        "question": "How many FHIR API endpoint addresses published on 2026-08-20 are still published on 2026-10-07?",
        "sql": f"""WITH aug AS (
  SELECT DISTINCT _address FROM {P}.endpoint
  WHERE release_date = '2026-08-20' AND _connection_type = 'hl7-fhir-rest'
), oct AS (
  SELECT DISTINCT _address FROM {P}.endpoint
  WHERE release_date = '2026-10-07' AND _connection_type = 'hl7-fhir-rest'
)
SELECT
  (SELECT COUNT(*) FROM aug) AS aug_addresses,
  (SELECT COUNT(*) FROM oct) AS oct_addresses,
  (SELECT COUNT(*) FROM aug JOIN oct USING (_address)) AS in_both""",
        "expected": "110,964 in August; 111,249 in October; 110,941 in both (99.98% of August).",
        "verified": "local parquet export",
    },
    {
        "question": "Which EHR vendors are named for the most organizations?",
        "sql": f"""SELECT vendor, COUNT(DISTINCT org_npi) AS organizations
FROM {P}.org_endpoint
WHERE release_date = '2026-10-07'
  AND org_npi IS NOT NULL
  AND vendor IS NOT NULL
GROUP BY vendor
ORDER BY organizations DESC
LIMIT 5""",
        "expected": ("athenahealth 20,943; Practice Fusion 2,434; Oracle Health 1,299; "
                     "Epic (User-access Brands) 367; Veradigm 173. Only if the 2026-10-07 "
                     "partition of org_endpoint is loaded from the current CSVs."),
        "verified": "org_endpoint_table.build() on the published H50/H51 CSVs at release 2026-10-07",
    },
    {
        "question": "How many organizations have an endpoint that only the EHR vendor files name, and not the NDH?",
        "sql": f"""SELECT
  COUNT(*) AS organizations,
  COUNT_IF(array_contains(sources, 'vendor_file') AND NOT array_contains(sources, 'ndh')) AS vendor_file_only,
  COUNT_IF(array_contains(sources, 'ndh') AND NOT array_contains(sources, 'vendor_file')) AS ndh_only,
  COUNT_IF(array_contains(sources, 'ndh') AND array_contains(sources, 'vendor_file')) AS both_sources
FROM {P}.org_endpoint_summary
WHERE release_date = '2026-10-07'""",
        "expected": ("32,455 organizations: 16,527 vendor files only, 9,897 NDH only, 6,031 both. "
                     "Same partition caveat as the vendor question."),
        "verified": "org_endpoint_table.build_summary() on the published CSVs at release 2026-10-07",
    },
]


def _id(kind: str, text: str) -> str:
    """Deterministic 32-hex id, so a re-run produces the same payload."""
    return hashlib.md5(f"{kind}:{text}".encode()).hexdigest()


def _lines(text: str) -> list[str]:
    """The API stores text as a list of lines, each but the last ending in \\n."""
    return text.splitlines(keepends=True)


def build_space_spec() -> dict:
    """Everything the space is made of, plus the reviewer's expected answers.

    Pure: no network, no CLI, no environment.
    """
    return {
        "title": TITLE,
        "description": DESCRIPTION,
        "warehouse_id": WAREHOUSE_ID,
        "tables": [fq(t) for t in SPACE_TABLES],
        "instructions": INSTRUCTIONS,
        "samples": [dict(s) for s in SAMPLES],
    }


def serialize_space(spec: dict) -> dict:
    """The `serialized_space` object, version 2.

    Shape copied from a get-space export of a Databricks-authored space on this
    workspace (2026-10-16): config.sample_questions, data_sources.tables,
    instructions.text_instructions + example_question_sqls, benchmarks.questions.
    Ids are 32 lowercase hex; lists are sorted by id and tables by identifier.
    """
    tables = []
    for ident in sorted(spec["tables"]):
        cols = TABLE_COLUMNS[ident.rsplit(".", 1)[1]]
        configs = []
        for c in sorted(cols):
            cfg = {"column_name": c, "enable_format_assistance": c != "resource"}
            if c in _MATCH and c not in _REF:
                cfg["enable_entity_matching"] = True
            configs.append(cfg)
        tables.append({"identifier": ident, "column_configs": configs})

    samples = spec["samples"]
    return {
        "version": 2,
        "config": {"sample_questions": sorted(
            ({"id": _id("q", s["question"]), "question": [s["question"]]} for s in samples),
            key=lambda d: d["id"])},
        "data_sources": {"tables": tables},
        "instructions": {
            "text_instructions": [{"id": _id("t", "general"),
                                   "content": _lines(spec["instructions"])}],
            "example_question_sqls": sorted(
                ({"id": _id("x", s["question"]), "question": [s["question"]],
                  "sql": _lines(s["sql"])} for s in samples),
                key=lambda d: d["id"]),
        },
        "benchmarks": {"questions": sorted(
            ({"id": _id("b", s["question"]), "question": [s["question"]],
              "answer": [{"format": "SQL", "content": _lines(s["sql"])}]} for s in samples),
            key=lambda d: d["id"])},
    }


def render(spec: dict) -> str:
    out = [f"# {spec['title']}", "", spec["description"], "",
           f"warehouse: {spec['warehouse_id']}", "tables:"]
    out += [f"  {t}" for t in spec["tables"]]
    out += ["", "## General instructions", "", spec["instructions"], "## Sample questions", ""]
    for i, s in enumerate(spec["samples"], 1):
        out += [f"{i}. {s['question']}", "", s["sql"], "",
                f"   expected: {s['expected']}", f"   verified: {s['verified']}", ""]
    return "\n".join(out)


# ---------------------------------------------------------------------------
# Network side. Nothing below runs on --print or --json.
# ---------------------------------------------------------------------------
def _cli(args: list[str], profile: str | None) -> dict:
    cmd = ["databricks", *args, "-o", "json"] + (["-p", profile] if profile else [])
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit(f"{' '.join(cmd[:3])} failed:\n{r.stderr.strip()[:600]}")
    return json.loads(r.stdout or "{}")


def verify_space(space_id: str, sent: dict, profile: str | None) -> list[str]:
    """Read the space back and list every way it differs from what was sent.

    An accepted write is not evidence the space holds it.
    """
    got = _cli(["genie", "get-space", space_id, "--include-serialized-space"], profile)
    back = json.loads(got.get("serialized_space") or "{}")
    problems = []
    want_t = [t["identifier"] for t in sent["data_sources"]["tables"]]
    got_t = sorted(t["identifier"] for t in back.get("data_sources", {}).get("tables", []))
    if got_t != want_t:
        problems.append(f"tables: sent {want_t}, got {got_t}")
    for path in (("config", "sample_questions"),
                 ("instructions", "example_question_sqls"),
                 ("instructions", "text_instructions"),
                 ("benchmarks", "questions")):
        n_sent = len(sent[path[0]][path[1]])
        n_got = len(back.get(path[0], {}).get(path[1], []))
        if n_got != n_sent:
            problems.append(f"{'.'.join(path)}: sent {n_sent}, got {n_got}")
    text = "".join(sum((t.get("content", []) for t in
                        back.get("instructions", {}).get("text_instructions", [])), []))
    if "_specialty_codes" not in text or "_address" not in text:
        problems.append("general instructions came back without the join rules")
    return problems


def create(profile: str | None) -> None:
    spec = build_space_spec()
    payload = serialize_space(spec)
    r = _cli(["genie", "create-space", spec["warehouse_id"], json.dumps(payload),
              "--title", spec["title"], "--description", spec["description"]], profile)
    space_id = r.get("space_id")
    if not space_id:
        raise SystemExit(f"create-space returned no space_id: {r}")
    print(f"created space {space_id}")
    _report(space_id, payload, profile)


def update(space_id: str, profile: str | None) -> None:
    spec = build_space_spec()
    payload = serialize_space(spec)
    _cli(["genie", "update-space", space_id, "--serialized-space", json.dumps(payload),
          "--title", spec["title"], "--description", spec["description"],
          "--warehouse-id", spec["warehouse_id"]], profile)
    print(f"updated space {space_id}")
    _report(space_id, payload, profile)


def _report(space_id: str, payload: dict, profile: str | None) -> None:
    problems = verify_space(space_id, payload, profile)
    if problems:
        print("READ-BACK MISMATCH; the space does not hold what was sent:")
        for p in problems:
            print(f"  - {p}")
        raise SystemExit(1)
    print("read-back matches: tables, instructions, sample questions, examples, benchmarks")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--print", action="store_true", help="print the spec (default)")
    g.add_argument("--json", action="store_true", help="print the serialized_space payload")
    g.add_argument("--create", action="store_true", help="create the space (network)")
    g.add_argument("--update", metavar="SPACE_ID", help="replace an existing space (network)")
    ap.add_argument("-p", "--profile", help="~/.databrickscfg profile (workspace profile is `ainpi`)")
    a = ap.parse_args()
    if a.create:
        create(a.profile)
    elif a.update:
        update(a.update, a.profile)
    elif a.json:
        print(json.dumps(serialize_space(build_space_spec()), indent=2))
    else:
        print(render(build_space_spec()))


if __name__ == "__main__":
    main()
