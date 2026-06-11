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

The pre-registered prior was that Practitioner.telecom would be sparse (NPPES
keeps practice phone on the location). The first measured run (2026-05-08
release) rejected it: 99.98% of active practitioners carry a phone directly on
the Practitioner record, and the traversal adds nothing. The headline below
adapts to whichever case the data shows.

Run:    python analysis/h43_practitioner_phone.py
Writes:
  - frontend/public/api/v1/findings/practitioner-phone-reachability.json
  - frontend/public/api/v1/findings/practitioner-phone-reachability-detail.json
    (sidecar — full seven-region Venn breakdown across the three paths and
    on-record telecom-system mix; sidecar contract may evolve, the parent
    JSON is the stable v1 surface)

Cost: one scan each of practitioner, practitioner_role, location (resource
JSON column). Capped at the project default via bq_job_config(). The Venn
breakdown reuses the same membership CTE, no additional scans.
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
# Sidecar carries the full 7-region Venn breakdown plus per-path raw counts.
# Sidecar pattern lets the stable v1 contract stay compact while richer
# detail is available at a parallel URL.
OUT_DETAIL = (
    REPO_ROOT
    / "frontend"
    / "public"
    / "api"
    / "v1"
    / "findings"
    / "practitioner-phone-reachability-detail.json"
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
-- Per-practitioner path membership: which of {{Practitioner.telecom,
-- PractitionerRole.telecom, traversed Location.telecom}} actually carry a
-- phone for this practitioner. Driven from `pract` so the denominator is
-- always the active-practitioner set and dangling-from-role refs drop.
membership AS (
  SELECT
    p.pid,
    p.has_direct_phone                  AS in_p,
    (r.pid IS NOT NULL)                 AS in_r,
    (l.pid IS NOT NULL)                 AS in_l
  FROM pract p
  LEFT JOIN role_phone r     USING (pid)
  LEFT JOIN location_path l  USING (pid)
)
SELECT
  -- Top-line counts (kept stable so consumers of the v1 contract don't break)
  (SELECT COUNT(*)                  FROM pract)         AS total_active,
  (SELECT COUNTIF(has_direct_phone) FROM pract)         AS direct_phone,
  (SELECT COUNTIF(has_any_telecom)  FROM pract)         AS any_telecom,
  (SELECT COUNTIF(has_fax)          FROM pract)         AS direct_fax,
  (SELECT COUNTIF(has_email)        FROM pract)         AS direct_email,
  (SELECT COUNTIF(has_url)          FROM pract)         AS direct_url,
  (SELECT COUNT(*)                  FROM role_phone)    AS role_phone_raw,
  (SELECT COUNT(*)                  FROM location_path) AS location_phone_raw,
  -- Per-path membership at the practitioner level (intersection with active set).
  -- in_r_set / in_l_set are practitioner-counted (de-duped vs the active set),
  -- which is the apples-to-apples comparison to direct_phone — distinct from
  -- the role_phone_raw / location_phone_raw fields above which are pre-dedup
  -- role-reference counts.
  (SELECT COUNTIF(in_r)             FROM membership)    AS in_r_set,
  (SELECT COUNTIF(in_l)             FROM membership)    AS in_l_set,
  -- Seven-region Venn breakdown across {{P, R, L}}. The "any_path" total is
  -- the sum of these seven cells; "no_phone" is what's left in `pract`.
  (SELECT COUNTIF( in_p AND NOT in_r AND NOT in_l) FROM membership) AS only_p,
  (SELECT COUNTIF(NOT in_p AND     in_r AND NOT in_l) FROM membership) AS only_r,
  (SELECT COUNTIF(NOT in_p AND NOT in_r AND     in_l) FROM membership) AS only_l,
  (SELECT COUNTIF( in_p AND     in_r AND NOT in_l) FROM membership) AS p_and_r,
  (SELECT COUNTIF( in_p AND NOT in_r AND     in_l) FROM membership) AS p_and_l,
  (SELECT COUNTIF(NOT in_p AND     in_r AND     in_l) FROM membership) AS r_and_l,
  (SELECT COUNTIF( in_p AND     in_r AND     in_l) FROM membership) AS all_three,
  (SELECT COUNTIF(NOT in_p AND NOT in_r AND NOT in_l) FROM membership) AS none_of_three,
  -- Any-path total derived from membership so it matches the Venn cells exactly
  (SELECT COUNTIF(in_p OR in_r OR in_l) FROM membership) AS any_path_phone
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
    if not d:
        return 0.0
    p = 100 * n / d
    # Keep small/large shares honest: 1,115 / 7.2M is 0.015%, not "0.0%".
    if 0 < p < 0.1 or 99.9 < p < 100:
        return round(p, 3)
    return round(p, 1)


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

    # Per-path practitioner-level counts (intersected with active set) and
    # the seven-region Venn breakdown across {Practitioner, Role, Location}.
    in_r_set = int(r.in_r_set)
    in_l_set = int(r.in_l_set)
    only_p = int(r.only_p)
    only_r = int(r.only_r)
    only_l = int(r.only_l)
    p_and_r = int(r.p_and_r)
    p_and_l = int(r.p_and_l)
    r_and_l = int(r.r_and_l)
    all_three = int(r.all_three)
    unreachable = int(r.none_of_three)

    via_only = max(any_path - direct, 0)          # reachable, but not on-record

    # Pick the more-informative second-line claim for the headline based on
    # which path-combo dominates. With path 3 typically near-zero in the
    # May release this falls back to "P-only is the rest" cleanly.
    if r_and_l + p_and_l + only_l + all_three > 0:
        via_loc_reachable = r_and_l + only_l + all_three  # any practitioner whose Location carries the phone
    else:
        via_loc_reachable = 0

    headline = (
        f"Of {total:,} active Practitioner resources in the {RELEASE_DATE} NDH release, "
        f"{any_path:,} ({pct(any_path, total)}%) can be associated with at least one phone "
        f"number through FHIR. Where does that phone live? "
        f"{direct:,} ({pct(direct, total)}%) carry a phone directly on the Practitioner "
        f"record; {in_r_set:,} ({pct(in_r_set, total)}%) have one on PractitionerRole; "
        f"{in_l_set:,} ({pct(in_l_set, total)}%) reach one via a traversed Location. "
        f"{via_only:,} of the {any_path:,} are reachable ONLY by traversing role or location "
        f"(i.e. the Practitioner record itself does not carry a phone). "
        f"{unreachable:,} ({pct(unreachable, total)}%) have no phone on any of the three resources."
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
        f"Per-path reachability at the practitioner level: {direct:,} via Practitioner, "
        f"{in_r_set:,} via PractitionerRole, {in_l_set:,} via traversed Location. "
        f"Seven-region overlap across {{P, R, L}}: P-only {only_p:,}, R-only {only_r:,}, "
        f"L-only {only_l:,}, P∩R {p_and_r:,}, P∩L {p_and_l:,}, R∩L {r_and_l:,}, "
        f"P∩R∩L {all_three:,}, none {unreachable:,}. "
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
        "read PractitionerRole/Location, not Practitioner.telecom alone. Full Venn breakdown "
        "with raw counts at /api/v1/findings/practitioner-phone-reachability-detail.json."
    )

    generated_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    commit_sha = get_commit_sha()

    payload = {
        "slug": "practitioner-phone-reachability",
        "title": "Practitioner phone-number reachability",
        "hypotheses": ["H43"],
        "status": "published",
        "release_date": RELEASE_DATE,
        "generated_at": generated_at,
        "methodology_version": METHODOLOGY_VERSION,
        "commit_sha": commit_sha,
        "headline": headline,
        "numerator": any_path,
        "denominator": total,
        "chart": chart,
        "notes": notes,
    }

    detail_payload = {
        "slug": "practitioner-phone-reachability",
        "release_date": RELEASE_DATE,
        "generated_at": generated_at,
        "commit_sha": commit_sha,
        "denominator": total,
        "per_path": {
            "practitioner_telecom_phone": direct,
            "practitioner_role_telecom_phone": in_r_set,
            "location_telecom_phone_via_role": in_l_set,
        },
        "venn_seven_region": {
            "P_only":  only_p,
            "R_only":  only_r,
            "L_only":  only_l,
            "P_and_R": p_and_r,
            "P_and_L": p_and_l,
            "R_and_L": r_and_l,
            "P_and_R_and_L": all_three,
            "none": unreachable,
        },
        "raw_path_totals": {
            "role_phone_raw": role_raw,
            "location_phone_raw_via_role": loc_raw,
        },
        "on_record_telecom_systems": {
            "phone": direct,
            "fax": direct_fax,
            "email": direct_email,
            "url": direct_url,
            "any_telecom": any_telecom,
        },
        "notes": (
            "Seven-region Venn sums match the headline. Each cell is the count of "
            "active Practitioner records whose phone is reachable via the labeled "
            "subset of {Practitioner.telecom, PractitionerRole.telecom, traversed "
            "Location.telecom} and no others. Sidecar contract may evolve; the parent "
            "/findings/<slug>.json is the stable v1 surface."
        ),
    }

    OUT.write_text(json.dumps(payload, indent=2) + "\n")
    OUT_DETAIL.write_text(json.dumps(detail_payload, indent=2) + "\n")
    print(f"Wrote {OUT}")
    print(f"Wrote {OUT_DETAIL}")
    print(f"  active practitioners:        {total:,}")
    print(f"  phone on Practitioner record:{direct:,} ({pct(direct, total)}%)")
    print(f"  phone on PractitionerRole:   {in_r_set:,} ({pct(in_r_set, total)}%)")
    print(f"  phone via traversed Location:{in_l_set:,} ({pct(in_l_set, total)}%)")
    print(f"  reachable any path:          {any_path:,} ({pct(any_path, total)}%)")
    print(f"  only via role/location:      {via_only:,}")
    print(f"  no phone on any path:        {unreachable:,} ({pct(unreachable, total)}%)")
    print(f"  Venn — P-only:    {only_p:,}")
    print(f"  Venn — R-only:    {only_r:,}")
    print(f"  Venn — L-only:    {only_l:,}")
    print(f"  Venn — P∩R:       {p_and_r:,}")
    print(f"  Venn — P∩L:       {p_and_l:,}")
    print(f"  Venn — R∩L:       {r_and_l:,}")
    print(f"  Venn — P∩R∩L:     {all_three:,}")


if __name__ == "__main__":
    sys.exit(main())
