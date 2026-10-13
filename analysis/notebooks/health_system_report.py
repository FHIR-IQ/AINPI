# Databricks notebook source
# MAGIC %md
# MAGIC # Health system directory report
# MAGIC
# MAGIC This notebook answers one question about one health system: what does the
# MAGIC CMS National Provider Directory say about it, and what changed between two
# MAGIC releases?
# MAGIC
# MAGIC A health system is not one organization in the directory. It is a set of
# MAGIC member organizations, each with its own NPI. You tell the notebook which
# MAGIC ones, and it reports on the clinicians the directory links to them and on
# MAGIC the web addresses software can use to reach them.
# MAGIC
# MAGIC **How to use it.** Fill in the widgets at the top of the page, then run all
# MAGIC cells.
# MAGIC
# MAGIC | Widget | What to put in it |
# MAGIC |---|---|
# MAGIC | `system_label` | The name to print on the report. Used for display only. |
# MAGIC | `member_org_npis` | Comma-separated organization NPIs of the system's members. Preferred. |
# MAGIC | `parent_lbn` | Used only when `member_org_npis` is empty. A legal business name to match against organization names, case-insensitive. This is a name match, not a corporate record, so check the list it prints. |
# MAGIC | `release_current`, `release_prior` | Two release dates present in the archive, such as `2026-08-20` and `2026-05-08`. |
# MAGIC | `roster_npis` | Optional. The clinician NPIs the system itself says it employs. When given, the funnel uses them as its starting population. |
# MAGIC | `nucc_csv` | Optional. A path or URL to the NUCC taxonomy CSV, used to group clinicians by profession. |
# MAGIC | `catalog`, `schema` | Where you installed the archive share. |
# MAGIC
# MAGIC Nothing here writes to any table. Every query reads the archive and creates
# MAGIC temporary views that disappear when the session ends.

# COMMAND ----------

import re

dbutils.widgets.text("catalog", "ainpi_ndh_archive")
dbutils.widgets.text("schema", "ainpi")
dbutils.widgets.text("system_label", "Example Health System")
dbutils.widgets.text("member_org_npis", "")
dbutils.widgets.text("parent_lbn", "")
dbutils.widgets.text("release_current", "2026-08-20")
dbutils.widgets.text("release_prior", "2026-05-08")
dbutils.widgets.text("roster_npis", "")
dbutils.widgets.text("nucc_csv", "")

CATALOG = dbutils.widgets.get("catalog").strip()
SCHEMA = dbutils.widgets.get("schema").strip()
SYSTEM_LABEL = dbutils.widgets.get("system_label").strip() or "this system"
PARENT_LBN = dbutils.widgets.get("parent_lbn").strip()
CUR = dbutils.widgets.get("release_current").strip()
PRIOR = dbutils.widgets.get("release_prior").strip()
NUCC_CSV = dbutils.widgets.get("nucc_csv").strip()

IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
NPI = re.compile(r"^\d{10}$")


def parse_npis(raw, label):
    """Split a comma/space-separated NPI list. Reject anything malformed.

    A typo that silently drops an NPI shrinks the system without saying so,
    so a malformed value stops the notebook instead.
    """
    vals = [v.strip() for v in re.split(r"[,\s]+", raw or "") if v.strip()]
    bad = [v for v in vals if not NPI.match(v)]
    if bad:
        raise ValueError(f"{label}: not 10-digit NPIs: {bad[:10]}")
    return sorted(set(vals))


for name, val in (("catalog", CATALOG), ("schema", SCHEMA)):
    if not IDENT.match(val):
        raise ValueError(f"{name} must be a plain identifier, got {val!r}")
for name, val in (("release_current", CUR), ("release_prior", PRIOR)):
    if not DATE.match(val):
        raise ValueError(f"{name} must look like YYYY-MM-DD, got {val!r}")
if CUR == PRIOR:
    raise ValueError("release_current and release_prior must differ")

ORG_NPIS = parse_npis(dbutils.widgets.get("member_org_npis"), "member_org_npis")
ROSTER_NPIS = parse_npis(dbutils.widgets.get("roster_npis"), "roster_npis")
if not ORG_NPIS and not PARENT_LBN:
    raise ValueError("Give member_org_npis, or parent_lbn if you have no NPI list.")
MATCH_MODE = "npi" if ORG_NPIS else "name"
# A % or _ in the name would act as a LIKE wildcard and widen the member set.
LBN_LIKE = PARENT_LBN.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")

spark.sql(f"USE {CATALOG}.{SCHEMA}")

releases = {r[0] for r in spark.sql("""
SELECT DISTINCT release_date FROM practitioner
""").collect()}
missing = [r for r in (CUR, PRIOR) if r not in releases]
if missing:
    raise ValueError(f"Release(s) {missing} are not in this archive. Present: {sorted(releases)}")

print(f"Report for {SYSTEM_LABEL}: {PRIOR} -> {CUR}")
print(f"Member organizations matched by {'NPI list' if MATCH_MODE == 'npi' else 'name'}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Which organizations count as the system
# MAGIC
# MAGIC With an NPI list, the members are exactly the organizations carrying those
# MAGIC NPIs. With a name, the notebook takes every organization whose name contains
# MAGIC the text you gave, then adds the organizations the directory lists as part of
# MAGIC those (the FHIR `partOf` field), up to five levels down. That second route is
# MAGIC an inference from names. Read the list it prints before trusting anything
# MAGIC below it.
# MAGIC
# MAGIC The organization table also holds tax-ID (`ein`) records, about half of it
# MAGIC in the 2026-08-20 release, and these can share a name or an NPI with a
# MAGIC provider organization. Both routes can pick them up, so check `org_type` in
# MAGIC the list. Section 4 counts member organizations by distinct NPI, so a
# MAGIC provider record and a tax record with the same NPI count once.

# COMMAND ----------

from pyspark.sql import Row

spark.createDataFrame([Row(npi=n) for n in ORG_NPIS] or [Row(npi="0000000000")]) \
    .createOrReplaceTempView("input_org_npis")

if MATCH_MODE == "npi":
    members = spark.sql(f"""
    SELECT o.release_date, o._id AS org_id, o._npi AS org_npi, o._name AS org_name,
           o._org_type AS org_type, o._state AS org_state, 'npi list' AS matched_by
    FROM organization o
    JOIN input_org_npis i ON o._npi = i.npi
    WHERE o.release_date IN ('{CUR}', '{PRIOR}')
    """)
else:
    # Read the organization table once: the name matches plus every record
    # that names a parent. The hierarchy walk below then runs on this cached
    # slice instead of re-reading the table at each level.
    spark.sql(f"""
    SELECT o.release_date, o._id AS org_id, o._npi AS org_npi, o._name AS org_name,
           o._org_type AS org_type, o._state AS org_state,
           get_json_object(o.resource, '$.partOf.reference') AS partof_ref,
           upper(o._name) LIKE concat('%', upper(:lbn), '%') ESCAPE '\\\\' AS name_match
    FROM organization o
    WHERE o.release_date IN ('{CUR}', '{PRIOR}')
      AND (upper(o._name) LIKE concat('%', upper(:lbn), '%') ESCAPE '\\\\'
           OR get_json_object(o.resource, '$.partOf.reference') IS NOT NULL)
    """, args={"lbn": LBN_LIKE}).cache().createOrReplaceTempView("org_slim")
    members = spark.sql("""
    SELECT release_date, org_id, org_npi, org_name, org_type, org_state,
           'name match' AS matched_by
    FROM org_slim WHERE name_match
    """)
    members.createOrReplaceTempView("member_frontier")
    MAX_DEPTH = 5
    for depth in range(1, MAX_DEPTH + 1):
        children = spark.sql("""
        SELECT c.release_date, c.org_id, c.org_npi, c.org_name, c.org_type, c.org_state,
               'part of a name match' AS matched_by
        FROM org_slim c
        JOIN member_frontier f
          ON c.release_date = f.release_date
         AND c.partof_ref = concat('Organization/', f.org_id)
        """)
        new = children.join(members.select("release_date", "org_id"),
                            ["release_date", "org_id"], "left_anti").dropDuplicates(["release_date", "org_id"])
        if new.count() == 0:
            break
        members = members.unionByName(new)
        new.createOrReplaceTempView("member_frontier")
    else:
        # The loop ran out of depth while still finding members, so the list is
        # cut short. Say so rather than let a truncated set pass as complete.
        print(f"partOf hierarchy still had new members at depth {MAX_DEPTH}; "
              "the member list may be incomplete.")

members = members.dropDuplicates(["release_date", "org_id"]).cache()
members.createOrReplaceTempView("member_orgs")

# Positive control: an empty member set would make every number below a
# plausible-looking zero.
n_cur = members.filter(f"release_date = '{CUR}'").count()
if n_cur == 0:
    raise RuntimeError(f"No member organizations found in {CUR}. Check the NPIs or the name.")

if MATCH_MODE == "npi":
    found = {r[0] for r in members.filter(f"release_date = '{CUR}'").select("org_npi").collect()}
    not_found = [n for n in ORG_NPIS if n not in found]
    if not_found:
        print(f"{len(not_found)} supplied NPI(s) are not in the {CUR} directory: {not_found}")

display(spark.sql("""
SELECT release_date, matched_by, org_npi, org_name, org_type, org_state
FROM member_orgs
ORDER BY release_date DESC, matched_by, org_name
"""))

# COMMAND ----------

# Roles that link a clinician to a member organization, per release. Both
# practitioner_role and organization ids are stable across releases, and every
# join here is also pinned to one release_date.
spark.sql(f"""
SELECT pr.release_date, pr._practitioner_id AS practitioner_ref, m.org_id, m.org_npi
FROM practitioner_role pr
JOIN member_orgs m
  ON pr.release_date = m.release_date
 AND pr._org_id = concat('Organization/', m.org_id)
WHERE pr._active = true
  AND pr._practitioner_id IS NOT NULL
  AND pr.release_date IN ('{CUR}', '{PRIOR}')
""").cache().createOrReplaceTempView("system_roles")

spark.sql(f"""
SELECT DISTINCT p.release_date, p._id AS practitioner_id, p._npi AS npi, p.resource
FROM practitioner p
JOIN system_roles s
  ON p.release_date = s.release_date
 AND concat('Practitioner/', p._id) = s.practitioner_ref
WHERE p.release_date = '{CUR}'
""").cache().createOrReplaceTempView("system_clinicians")

display(spark.sql("""
SELECT release_date,
       COUNT(DISTINCT org_id)           AS member_orgs_with_a_clinician,
       COUNT(*)                         AS role_records,
       COUNT(DISTINCT practitioner_ref) AS clinicians
FROM system_roles
GROUP BY release_date
ORDER BY release_date
"""))

# COMMAND ----------

# MAGIC %md
# MAGIC ## 1. Clinicians the directory links to the system, by profession
# MAGIC
# MAGIC A clinician counts here when the directory carries an active
# MAGIC `PractitionerRole` record naming one of the member organizations. That record
# MAGIC is the directory's only statement of where someone works. A clinician the
# MAGIC system employs who has no such record is invisible to this count, which is
# MAGIC the subject of the next section.
# MAGIC
# MAGIC Profession comes from the taxonomy codes on each clinician's own record
# MAGIC (`Practitioner.qualification`). Those codes use the NUCC provider taxonomy
# MAGIC in both releases. The archive does not include the NUCC code list itself, so
# MAGIC the grouping into professions needs the `nucc_csv` widget. Without it, the
# MAGIC table lists raw codes instead.
# MAGIC
# MAGIC A clinician with codes in two professions counts once in each, so the rows
# MAGIC add up to more than the total. Codes that are not NUCC-shaped (licence
# MAGIC numbers, other code systems) are counted as "not a taxonomy code" rather than
# MAGIC dropped.

# COMMAND ----------

QUAL_SCHEMA = ("struct<qualification:array<struct<code:struct<coding:"
               "array<struct<system:string,code:string,display:string>>>>>>")

spark.sql(f"""
SELECT release_date, practitioner_id, npi, code,
       code RLIKE '^[0-9]{{3}}[0-9A-Z]{{6}}X$' AS is_taxonomy_code
FROM (
  SELECT release_date, practitioner_id, npi,
         explode_outer(array_distinct(flatten(filter(
           transform(from_json(resource, '{QUAL_SCHEMA}').qualification,
                     q -> transform(q.code.coding, c -> c.code)),
           a -> a IS NOT NULL)))) AS code
  FROM system_clinicians
) t
""").cache().createOrReplaceTempView("clinician_codes")

HAVE_NUCC = False
if NUCC_CSV:
    import pandas as pd
    if NUCC_CSV.lower().startswith(("http://", "https://")):
        nucc_pdf = pd.read_csv(NUCC_CSV, dtype=str, encoding="latin-1")
        nucc_df = spark.createDataFrame(nucc_pdf.fillna(""))
    else:
        # NUCC definitions contain quoted commas and line breaks.
        nucc_df = (spark.read.option("header", True).option("multiLine", True)
                   .option("escape", '"').csv(NUCC_CSV))
    if not {"Code", "Grouping", "Classification"} <= set(nucc_df.columns) or nucc_df.count() < 500:
        # Positive control: a wrong file would make every clinician "unknown".
        raise RuntimeError("nucc_csv does not look like the NUCC taxonomy CSV "
                           "(needs Code, Grouping, Classification and 500+ rows).")
    nucc_df.selectExpr("trim(Code) AS code", "Grouping AS grouping",
                       "Classification AS classification") \
        .createOrReplaceTempView("nucc")
    HAVE_NUCC = True

if HAVE_NUCC:
    by_profession = spark.sql(f"""
    SELECT CASE WHEN c.code IS NULL THEN '(no code on record)'
                WHEN NOT c.is_taxonomy_code THEN '(not a taxonomy code)'
                WHEN n.grouping IS NULL THEN '(code not in this NUCC release)'
                ELSE n.grouping END AS profession,
           COUNT(DISTINCT c.practitioner_id) AS clinicians
    FROM clinician_codes c
    LEFT JOIN nucc n ON c.code = n.code
    WHERE c.release_date = '{CUR}'
    GROUP BY 1
    ORDER BY clinicians DESC
    """)
else:
    print("No nucc_csv given: listing raw taxonomy codes. Grouping by profession needs the NUCC list.")
    by_profession = spark.sql(f"""
    SELECT CASE WHEN code IS NULL THEN '(no code on record)'
                WHEN NOT is_taxonomy_code THEN '(not a taxonomy code)'
                ELSE code END AS taxonomy_code,
           COUNT(DISTINCT practitioner_id) AS clinicians
    FROM clinician_codes
    WHERE release_date = '{CUR}'
    GROUP BY 1
    ORDER BY clinicians DESC
    """)

total, with_code = spark.sql(f"""
SELECT COUNT(DISTINCT practitioner_id), COUNT(DISTINCT IF(code IS NOT NULL, practitioner_id, NULL))
FROM clinician_codes WHERE release_date = '{CUR}'
""").first()
# Positive control: if the qualification schema above stops matching the
# records, every clinician lands in "(no code on record)" and reads as a finding.
if total > 0 and with_code == 0:
    raise RuntimeError("No clinician has any qualification code; the qualification "
                       "parse no longer matches the records.")
print(f"{total:,} distinct clinicians linked to a member organization in {CUR}")
display(by_profession)

# COMMAND ----------

# MAGIC %md
# MAGIC ## 2. From clinician to a web address software can reach
# MAGIC
# MAGIC Software that wants to exchange data with a clinician's practice needs a
# MAGIC FHIR endpoint: a web address for data exchange that answers standard health
# MAGIC data requests. The directory gets you there in three steps, and each step
# MAGIC loses people.
# MAGIC
# MAGIC 1. The clinician has any active role record at all.
# MAGIC 2. One of those roles names a member organization.
# MAGIC 3. That organization has such a web address. The first count uses only
# MAGIC    addresses the CMS directory itself assigns to the organization. The second
# MAGIC    also counts addresses that EHR vendors attribute to it in their own
# MAGIC    published files.
# MAGIC
# MAGIC Only addresses of type `hl7-fhir-rest` count. Most endpoint records in the
# MAGIC directory are secure-messaging addresses that a person can write to and
# MAGIC software cannot call.
# MAGIC
# MAGIC **The starting population matters.** If you gave `roster_npis`, the funnel
# MAGIC starts from your roster, and the drop at step 2 is the share of your own
# MAGIC clinicians the directory does not connect to you. Without a roster, the
# MAGIC directory cannot list the system's clinicians who lack a role record, so the
# MAGIC funnel starts from every active clinician whose address is in a state where a
# MAGIC member organization sits. That top row is context, not membership.

# COMMAND ----------

# Endpoints attached to member organizations, per release.
#   ndh          the Endpoint's own managingOrganization in the CMS directory
#   vendor_file  the curated org_endpoint table's vendor rows: what an EHR
#                vendor's public file claims, not confirmed by CMS
# Endpoint ids are regenerated every release, so nothing here touches
# endpoint._id. The cross-release key is the address.
def norm_url(url):
    """Same rule as analysis/org_endpoint_table.normalize_url, so NDH addresses
    and org_endpoint.base_url compare like for like."""
    from urllib.parse import urlsplit, urlunsplit
    if url is None:
        return None
    url = str(url).strip()
    if not url:
        return None
    s = urlsplit(url)
    return urlunsplit((s.scheme.lower(), s.netloc.lower(), s.path.rstrip("/"),
                       s.query, s.fragment))


spark.udf.register("norm_url", norm_url)

# Positive control: the FHIR REST filter must match something release-wide,
# or a zero below would mean the filter broke, not that the system has none.
fhir_rest_cur = spark.sql(f"""
SELECT COUNT(*) FROM endpoint
WHERE release_date = '{CUR}' AND _connection_type = 'hl7-fhir-rest'
""").first()[0]
if fhir_rest_cur == 0:
    raise RuntimeError(f"No hl7-fhir-rest endpoints at all in {CUR}; the connection type changed.")

vendor_releases = sorted(r[0] for r in spark.sql("""
SELECT DISTINCT release_date FROM org_endpoint
""").collect())
print(f"Vendor-file attribution is available for: {vendor_releases}")
for r in (CUR, PRIOR):
    if r not in vendor_releases:
        print(f"  {r}: no vendor-file rows in this archive, so vendor claims are not counted for it.")

spark.sql(f"""
SELECT m.release_date, m.org_id, m.org_npi, m.org_name,
       norm_url(e._address) AS base_url,
       'ndh' AS source, CAST(NULL AS STRING) AS vendor
FROM endpoint e
JOIN member_orgs m
  ON e.release_date = m.release_date
 AND e._managing_org_id = concat('Organization/', m.org_id)
WHERE e.release_date IN ('{CUR}', '{PRIOR}')
  AND e._connection_type = 'hl7-fhir-rest'
  AND e._address IS NOT NULL
UNION ALL
SELECT m.release_date, m.org_id, m.org_npi, m.org_name,
       oe.base_url, 'vendor_file' AS source, oe.vendor
FROM org_endpoint oe
JOIN member_orgs m
  ON oe.release_date = m.release_date
 AND oe.org_npi = m.org_npi
WHERE oe.source = 'vendor_file'
  AND oe.release_date IN ('{CUR}', '{PRIOR}')
""").dropDuplicates().cache().createOrReplaceTempView("member_endpoints")

spark.sql("""
SELECT s.release_date, s.practitioner_ref,
       MAX(CASE WHEN me.source = 'ndh' THEN 1 ELSE 0 END) = 1 AS reaches_ndh,
       MAX(CASE WHEN me.source IS NOT NULL THEN 1 ELSE 0 END) = 1 AS reaches_any
FROM system_roles s
LEFT JOIN member_endpoints me
  ON s.release_date = me.release_date AND s.org_id = me.org_id
GROUP BY s.release_date, s.practitioner_ref
""").cache().createOrReplaceTempView("clinician_reach")

if ROSTER_NPIS:
    spark.createDataFrame([Row(npi=n) for n in ROSTER_NPIS]).createOrReplaceTempView("roster")
    population_label = f"clinicians on the supplied roster ({len(ROSTER_NPIS):,} NPIs)"
    spark.sql(f"""
    SELECT p._id AS practitioner_id
    FROM practitioner p
    JOIN roster r ON p._npi = r.npi
    WHERE p.release_date = '{CUR}'
    """).createOrReplaceTempView("population")
    not_in_directory = len(ROSTER_NPIS) - spark.table("population").count()
    print(f"{not_in_directory:,} roster NPI(s) have no Practitioner record in {CUR}.")
else:
    population_label = "active clinicians in the member organizations' states (context, not membership)"
    spark.sql(f"""
    SELECT p._id AS practitioner_id
    FROM practitioner p
    WHERE p.release_date = '{CUR}'
      AND p._active = true
      AND p._state IN (SELECT DISTINCT org_state FROM member_orgs
                       WHERE release_date = '{CUR}' AND org_state IS NOT NULL)
    """).createOrReplaceTempView("population")

display(spark.sql(f"""
WITH any_role AS (
  SELECT DISTINCT _practitioner_id AS practitioner_ref
  FROM practitioner_role
  WHERE release_date = '{CUR}' AND _active = true AND _practitioner_id IS NOT NULL
),
pop AS (
  SELECT concat('Practitioner/', practitioner_id) AS practitioner_ref FROM population
),
staged AS (
  SELECT p.practitioner_ref,
         a.practitioner_ref IS NOT NULL      AS has_role,
         r.practitioner_ref IS NOT NULL      AS at_member,
         COALESCE(r.reaches_ndh, false)      AS reaches_ndh,
         COALESCE(r.reaches_any, false)      AS reaches_any
  FROM pop p
  LEFT JOIN any_role a ON p.practitioner_ref = a.practitioner_ref
  LEFT JOIN clinician_reach r
    ON r.release_date = '{CUR}' AND p.practitioner_ref = r.practitioner_ref
)
SELECT stage, clinicians,
       ROUND(100.0 * clinicians / FIRST_VALUE(clinicians) OVER (ORDER BY step), 1) AS pct_of_start
FROM (
  SELECT 0 AS step, 'Starting population' AS stage, COUNT(*) AS clinicians FROM staged
  UNION ALL SELECT 1, 'Has any active role record', COUNT_IF(has_role) FROM staged
  UNION ALL SELECT 2, 'Role names a member organization', COUNT_IF(at_member) FROM staged
  UNION ALL SELECT 3, 'Member org has a FHIR web address (CMS directory)', COUNT_IF(reaches_ndh) FROM staged
  UNION ALL SELECT 4, 'Member org has a FHIR web address (CMS or vendor claim)', COUNT_IF(reaches_any) FROM staged
) f
ORDER BY step
"""))
print(f"Starting population: {population_label}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 3. The web addresses found, where each came from, and how far to trust it
# MAGIC
# MAGIC One row per address per member organization. A system rarely has a single
# MAGIC address: different members often run different software, so this lists them
# MAGIC all rather than choosing one.
# MAGIC
# MAGIC - **CMS directory**: the directory's own endpoint record names the
# MAGIC   organization as its owner.
# MAGIC - **Vendor claim**: an EHR vendor's public file attributes the address to the
# MAGIC   organization's NPI. CMS has not confirmed it.
# MAGIC - **Both**: the two sources agree.
# MAGIC
# MAGIC An organization the directory names by text alone, without an NPI, cannot be
# MAGIC matched to vendor claims, because those are keyed by NPI.

# COMMAND ----------

display(spark.sql(f"""
SELECT org_name, org_npi, base_url,
       CASE WHEN array_contains(sources, 'ndh') AND array_contains(sources, 'vendor_file')
              THEN 'Both: CMS directory and vendor claim agree'
            WHEN array_contains(sources, 'ndh')
              THEN 'CMS directory'
            ELSE 'Vendor claim only (not confirmed by CMS)' END AS source_and_confidence,
       vendor
FROM (
  SELECT org_name, org_npi, base_url,
         sort_array(collect_set(source)) AS sources,
         max(vendor) AS vendor
  FROM member_endpoints
  WHERE release_date = '{CUR}'
  GROUP BY org_name, org_npi, base_url
) t
ORDER BY source_and_confidence, org_name, base_url
"""))

# COMMAND ----------

# MAGIC %md
# MAGIC ## 4. What changed between the two releases
# MAGIC
# MAGIC Each comparison uses a key that means the same thing in both releases.
# MAGIC Organizations are matched by NPI, or by record id when the record carries
# MAGIC no NPI, and clinicians by their record id, which embeds the NPI. Some
# MAGIC organization record ids change between releases, so for a member without an
# MAGIC NPI an "added" and "dropped" pair can be the same organization. Web addresses are matched by the address itself, never by the
# MAGIC record id, because CMS assigns endpoint records new ids every release and an
# MAGIC id match would report that every address changed.
# MAGIC
# MAGIC Vendor claims are left out of this comparison entirely. The archive may
# MAGIC carry them for one release only, and a change in what the vendor files cover
# MAGIC should not show up as a change in the directory.

# COMMAND ----------

display(spark.sql(f"""
WITH org_sets AS (
  SELECT COALESCE(org_npi, org_id) AS k, release_date FROM member_orgs
),
clin_sets AS (
  SELECT practitioner_ref AS k, release_date FROM system_roles
),
reach_sets AS (
  SELECT practitioner_ref AS k, release_date FROM clinician_reach WHERE reaches_ndh
),
addr_sets AS (
  SELECT base_url AS k, release_date FROM member_endpoints WHERE source = 'ndh'
),
all_sets AS (
  SELECT 'Member organizations' AS measure, 1 AS ord, k, release_date FROM org_sets
  UNION ALL SELECT 'Clinicians linked to a member organization', 2, k, release_date FROM clin_sets
  UNION ALL SELECT 'Clinicians reaching a FHIR web address (CMS directory)', 3, k, release_date FROM reach_sets
  UNION ALL SELECT 'FHIR web addresses at member orgs (CMS directory)', 4, k, release_date FROM addr_sets
),
per_key AS (
  SELECT measure, ord, k,
         MAX(CASE WHEN release_date = '{PRIOR}' THEN 1 ELSE 0 END) AS in_prior,
         MAX(CASE WHEN release_date = '{CUR}' THEN 1 ELSE 0 END) AS in_cur
  FROM all_sets GROUP BY measure, ord, k
)
SELECT measure,
       SUM(in_prior)                                   AS in_prior_release,
       SUM(in_cur)                                     AS in_current_release,
       SUM(CASE WHEN in_prior = 1 AND in_cur = 1 THEN 1 ELSE 0 END) AS in_both,
       SUM(CASE WHEN in_prior = 0 AND in_cur = 1 THEN 1 ELSE 0 END) AS added,
       SUM(CASE WHEN in_prior = 1 AND in_cur = 0 THEN 1 ELSE 0 END) AS dropped
FROM per_key
GROUP BY measure, ord
ORDER BY ord
"""))

# COMMAND ----------

# MAGIC %md
# MAGIC A clinician in the "dropped" column did not necessarily leave the system.
# MAGIC The directory may have removed or re-pointed their role record. The table
# MAGIC below lists who moved, so you can check a sample against your own roster.

# COMMAND ----------

display(spark.sql(f"""
WITH p AS (SELECT DISTINCT practitioner_ref FROM system_roles WHERE release_date = '{PRIOR}'),
     c AS (SELECT DISTINCT practitioner_ref FROM system_roles WHERE release_date = '{CUR}')
SELECT CASE WHEN p.practitioner_ref IS NULL THEN 'added' ELSE 'dropped' END AS change,
       regexp_extract(COALESCE(p.practitioner_ref, c.practitioner_ref), '([0-9]{{10}})$', 1) AS npi_from_record_id
FROM p FULL OUTER JOIN c ON p.practitioner_ref = c.practitioner_ref
WHERE p.practitioner_ref IS NULL OR c.practitioner_ref IS NULL
ORDER BY change, npi_from_record_id
"""))

# COMMAND ----------

# MAGIC %md
# MAGIC ## 5. What we could not determine
# MAGIC
# MAGIC These are limits of the archive and of this method. Each one can make a
# MAGIC number above wrong in a specific direction, so they belong next to the
# MAGIC numbers rather than in a footnote.
# MAGIC
# MAGIC - **Who the system actually employs.** The directory records where a
# MAGIC   clinician works only through a role record. Without a roster, a clinician
# MAGIC   with no role record at a member organization does not appear anywhere in
# MAGIC   this report. Counts in sections 1 and 4 are counts of what the directory
# MAGIC   says, not of the workforce.
# MAGIC - **Locations across releases.** Location records get new ids every release
# MAGIC   and have no reliable matching key in the archive. A name-and-address match
# MAGIC   recovers roughly three quarters of them after cleanup. This report
# MAGIC   therefore does not compare sites between releases at all.
# MAGIC - **Corporate structure.** The archive does not include the NPPES registry,
# MAGIC   so it cannot use the registry's parent-organization link. A name match is
# MAGIC   an inference and can both include unrelated organizations with similar
# MAGIC   names and miss members filed under a different legal name. The NPPES
# MAGIC   snapshot this project uses elsewhere also lags the directory by months, so
# MAGIC   providers enrolled recently can look absent from it.
# MAGIC - **The `partOf` hierarchy.** In releases before 2026-08-20 it pointed at
# MAGIC   parent records CMS did not publish. A name-based member list for an
# MAGIC   earlier release is therefore smaller for reasons unrelated to the system.
# MAGIC - **Vendor claims.** Vendor-file attributions come from public files the EHR
# MAGIC   vendors publish. CMS has not confirmed them, and the archive may carry them
# MAGIC   for only one release.
# MAGIC - **Profession.** Grouping needs the NUCC list from outside the archive. A
# MAGIC   clinician's record does not mark which of several taxonomy codes is
# MAGIC   primary, so this report counts each.
# MAGIC - **A web address is not a working connection.** This report shows that an
# MAGIC   address is listed. It does not test that the address answers.
# MAGIC
# MAGIC This report measures a federal file. Do not make an enrolment,
# MAGIC credentialing, payment or network decision about a named clinician from it
# MAGIC without checking the primary sources: the NPPES registry, the OIG exclusions
# MAGIC list, and SAM.gov.
