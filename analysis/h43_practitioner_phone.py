"""H43 — Practitioner phone-number reachability.

Can you associate a practitioner in the NDH bulk export with a phone number?
The honest answer is "it depends which FHIR resource you read." A phone can
live in three places, so this check resolves all three and reports both the
union (any path) and the on-record share (Practitioner.telecom alone):

  1. Practitioner.telecom            — directly on the practitioner record
  2. PractitionerRole.telecom        — on the role that ties the practitioner
                                       to an organization
  3. Location.telecom                — on the place the role points at
                                       (PractitionerRole.location -> Location)

Upstream (NPPES) keeps practice phone on the practice location, so we expect
Practitioner.telecom to be sparse and most reachability to come from the
PractitionerRole -> Location traversal. The metric quantifies that gap so a
consumer building "call this provider" knows which resource to actually read.

Run:    python analysis/h43_practitioner_phone.py
Writes: frontend/public/api/v1/findings/practitioner-phone-reachability.json

Cost: one scan each of practitioner, practitioner_role, location (resource
JSON column). Capped at the project default via bq_job_config().
"""
from __future__ import annotations

import json
import pathlib
import subprocess
import sys
from datetime import datetime, timezone

from google.cloud import bigquery

# analysis/ is on sys.path[0] when run as `python analysis/h43_practitioner_phone.py`,
# so claims_sources (a subpackage of analysis/) is importable. Same pattern as
# analysis/landscape.py.
from claims_sources._cohorts import bq_job_config

PROJECT = "thematic-fort-453901-t7"
DATASET = "cms_npd"
RELEASE_DATE = "2026-05-08"
METHODOLOGY_VERSION = "0.7.2-draft"

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = (
    REPO_ROOT
    / "frontend"
    / "public"
    / "api"
    / "v1"
    / "findings"
    / "practitioner-phone-reachability.json"
)

# A telecom entry counts as a phone when its system is "phone". NDH telecom
# arrays also carry fax / email / url / pager / sms systems; we break those
# out separately so the headline isn't inflated by non-voice contact points.
MAIN_SQL = f"""
WITH pract AS (
  SELECT
    _id AS pid,
    UPPER(_state) AS state,
    (SELECT COUNT(1) FROM UNNEST(JSON_QUERY_ARRAY(resource, '$.telecom')) t
       WHERE JSON_VALUE(t, '$.system') = 'phone') > 0 AS has_direct_phone,
    ARRAY_LENGTH(JSON_QUERY_ARRAY(resource, '$.telecom')) > 0 AS has_any_telecom,
    (SELECT COUNT(1) FROM UNNEST(JSON_QUERY_ARRAY(resource, '$.telecom')) t
       WHERE JSON_VALUE(t, '$.system') = 'fax') > 0 AS has_fax,
    (SELECT COUNT(1) FROM UNNEST(JSON_QUERY_ARRAY(resource, '$.telecom')) t
       WHERE JSON_VALUE(t, '$.system') = 'email') > 0 AS has_email,
    (SELECT COUNT(1) FROM UNNEST(JSON_QUERY_ARRAY(resource, '$.telecom')) t
       WHERE JSON_VALUE(t, '$.system') = 'url') > 0 AS has_url
  FROM `{PROJECT}.{DATASET}.practitioner`
  WHERE _active = TRUE
),
role_phone AS (
  SELECT DISTINCT REPLACE(_practitioner_id, 'Practitioner/', '') AS pid
  FROM `{PROJECT}.{DATASET}.practitioner_role`
  WHERE _active = TRUE
    AND _practitioner_id IS NOT NULL
    AND (SELECT COUNT(1) FROM UNNEST(JSON_QUERY_ARRAY(resource, '$.telecom')) t
           WHERE JSON_VALUE(t, '$.system') = 'phone') > 0
),
loc_phone AS (
  SELECT _id AS loc_id
  FROM `{PROJECT}.{DATASET}.location`
  WHERE (SELECT COUNT(1) FROM UNNEST(JSON_QUERY_ARRAY(resource, '$.telecom')) t
           WHERE JSON_VALUE(t, '$.system') = 'phone') > 0
),
role_loc AS (
  -- _location_ids is a pipe-joined list of "Location/<id>" reference strings
  -- (see analysis/fast_ingest_ndh.py extract_practitioner_role).
  SELECT DISTINCT
    REPLACE(pr._practitioner_id, 'Practitioner/', '') AS pid,
    REPLACE(loc_ref, 'Location/', '') AS loc_id
  FROM `{PROJECT}.{DATASET}.practitioner_role` pr,
    UNNEST(SPLIT(pr._location_ids, '|')) AS loc_ref
  WHERE pr._active = TRUE
    AND pr._practitioner_id IS NOT NULL
    AND pr._location_ids IS NOT NULL
    AND loc_ref != ''
),
location_path AS (
  SELECT DISTINCT rl.pid
  FROM role_loc rl
  JOIN loc_phone lp ON lp.loc_id = rl.loc_id
),
direct AS (
  SELECT pid FROM pract WHERE has_direct_phone
),
any_path AS (
  -- Union of the three paths, intersected with active practitioners so the
  -- numerator can never exceed the denominator (dangling refs / inactive
  -- practitioners with active roles are dropped here).
  SELECT DISTINCT a.pid
  FROM (
    SELECT pid FROM direct
    UNION ALL SELECT pid FROM role_phone
    UNION ALL SELECT pid FROM location_path
  ) u
  JOIN pract a ON a.pid = u.pid
)
SELECT
  (SELECT COUNT(*)                 FROM pract)          AS total_active,
  (SELECT COUNTIF(has_direct_phone) FROM pract)         AS direct_phone,
  (SELECT COUNTIF(has_any_telecom)  FROM pract)         AS any_telecom,
  (SELECT COUNTIF(has_fax)          FROM pract)         AS direct_fax,
  (SELECT COUNTIF(has_email)        FROM pract)         AS direct_email,
  (SELECT COUNTIF(has_url)          FROM pract)         AS direct_url,
  (SELECT COUNT(*)                 FROM role_phone)     AS role_phone_raw,
  (SELECT COUNT(*)                 FROM location_path)  AS location_phone_raw,
  (SELECT COUNT(*)                 FROM any_path)       AS any_path_phone
"""


def get_commit_sha() -> str:
    try:
        r = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            capture_output=True,
            text=True,
            check=True,
        )
        return r.stdout.strip()
    except Exception:
        return "pending"


def pct(n: int, d: int) -> float:
    return round(100 * n / d, 1) if d else 0.0


def main() -> None:
    client = bigquery.Client(project=PROJECT)
    rows = list(client.query(MAIN_SQL, job_config=bq_job_config()).result())
    r = rows[0]

    total = int(r.total_active)
    direct = int(r.direct_phone)
    any_telecom = int(r.any_telecom)
    direct_fax = int(r.direct_fax)
    direct_email = int(r.direct_email)
    direct_url = int(r.direct_url)
    role_raw = int(r.role_phone_raw)
    loc_raw = int(r.location_phone_raw)
    any_path = int(r.any_path_phone)

    via_only = max(any_path - direct, 0)          # reachable, but not on-record
    unreachable = max(total - any_path, 0)         # no phone on any path

    headline = (
        f"Of {total:,} active Practitioner resources in the {RELEASE_DATE} NDH release, "
        f"{any_path:,} ({pct(any_path, total)}%) can be associated with at least one phone "
        f"number through FHIR — but only {direct:,} ({pct(direct, total)}%) carry a phone on "
        f"the Practitioner record itself. The other {via_only:,} are reachable only by "
        f"traversing PractitionerRole -> Location. {unreachable:,} "
        f"({pct(unreachable, total)}%) have no phone on any of the three resources."
    )

    chart = {
        "type": "bar",
        "unit": "count",
        "data": [
            {"label": "Phone on Practitioner record", "value": direct},
            {"label": "Phone only via role / location", "value": via_only},
            {"label": "No phone on any path", "value": unreachable},
        ],
    }

    notes = (
        "Three resolution paths, evaluated independently then unioned: "
        "(1) Practitioner.telecom (system='phone'); "
        "(2) PractitionerRole.telecom on any active role whose practitioner reference "
        "resolves to this NPI; "
        "(3) Location.telecom on any Location referenced by such a role "
        "(PractitionerRole.location -> Location). The union is intersected with the active "
        "Practitioner set, so the numerator never exceeds the denominator and dangling "
        "references drop out. "
        f"On-record contact points break down as: phone {direct:,}, fax {direct_fax:,}, "
        f"email {direct_email:,}, url {direct_url:,}; {any_telecom:,} active practitioners "
        "carry any telecom entry at all on the Practitioner resource. "
        f"Before de-duplication against the active set, {role_raw:,} practitioner references "
        f"are reachable via a role-level phone and {loc_raw:,} via a location-level phone. "
        "Caveat — the May 2026-05-08 release deduped Location resources sharply (-61% vs "
        "April), which mechanically lowers path-3 reachability relative to the April release; "
        "compare across releases with that in mind. Upstream context: NPPES (the source of "
        "~90% of these fields) keeps practice phone on the practice location, not the "
        "individual, so a sparse Practitioner.telecom is expected and is not itself a data "
        "quality defect — the operational takeaway is that a 'call this provider' feature must "
        "read PractitionerRole/Location, not Practitioner.telecom alone."
    )

    payload = {
        "slug": "practitioner-phone-reachability",
        "title": "Practitioner phone-number reachability",
        "hypotheses": ["H43"],
        "status": "published",
        "release_date": RELEASE_DATE,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "methodology_version": METHODOLOGY_VERSION,
        "commit_sha": get_commit_sha(),
        "headline": headline,
        "numerator": any_path,
        "denominator": total,
        "chart": chart,
        "notes": notes,
    }

    OUT.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"Wrote {OUT}")
    print(f"  active practitioners:        {total:,}")
    print(f"  phone on Practitioner record:{direct:,} ({pct(direct, total)}%)")
    print(f"  reachable any path:          {any_path:,} ({pct(any_path, total)}%)")
    print(f"  only via role/location:      {via_only:,}")
    print(f"  no phone on any path:        {unreachable:,} ({pct(unreachable, total)}%)")


if __name__ == "__main__":
    sys.exit(main())
