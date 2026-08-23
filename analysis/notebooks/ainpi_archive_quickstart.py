# Databricks notebook source
# MAGIC %md
# MAGIC # CMS National Provider Directory: release archive
# MAGIC
# MAGIC CMS publishes the National Provider Directory as a bulk FHIR export and
# MAGIC serves **only the current version**. When a new release lands the previous
# MAGIC one is gone from the source. This archive keeps them.
# MAGIC
# MAGIC That is the whole product. Everything below is a question you cannot ask
# MAGIC CMS directly, because answering it needs two releases at once.
# MAGIC
# MAGIC | | |
# MAGIC |---|---|
# MAGIC | Releases | `2026-05-08`, `2026-08-20` |
# MAGIC | Rows | 54,162,643 |
# MAGIC | Tables | practitioner, practitioner_role, organization, organization_affiliation, location, endpoint |
# MAGIC | Shape | The full FHIR resource JSON, plus flattened `_*` columns |
# MAGIC | Licence | Federal source data is public domain. See ainpi.dev/data-license |
# MAGIC
# MAGIC Each table is partitioned by `release_date`, so comparing two releases is a
# MAGIC `WHERE` clause rather than a download.
# MAGIC
# MAGIC Free, and maintained at [ainpi.dev](https://ainpi.dev), which publishes the
# MAGIC measurements this data supports.

# COMMAND ----------

# Point this at wherever you installed the share.
CATALOG = "ainpi_ndh_archive"
SCHEMA = "ainpi"

MAY, AUG = "2026-05-08", "2026-08-20"
spark.sql(f"USE {CATALOG}.{SCHEMA}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 1. A record count is not coverage
# MAGIC
# MAGIC `PractitionerRole` is the record that says where a clinician works.
# MAGIC Without one there is no organization, so no address, and no way for
# MAGIC software to reach them. It is the directory's binding constraint.
# MAGIC
# MAGIC Between these two releases CMS added about seven million of them. The
# MAGIC obvious reading is that coverage roughly doubled. It did not, and you can
# MAGIC only tell the difference by holding both releases at once.

# COMMAND ----------

display(spark.sql("""
WITH active_prac AS (
  SELECT release_date, COUNT(*) AS practitioners
  FROM practitioner WHERE _active = true GROUP BY release_date
),
roles AS (
  SELECT release_date,
         COUNT(*)                          AS role_records,
         COUNT(DISTINCT _practitioner_id)  AS practitioners_with_a_role
  FROM practitioner_role
  WHERE _active = true AND _practitioner_id IS NOT NULL
  GROUP BY release_date
)
SELECT p.release_date,
       p.practitioners,
       r.role_records,
       r.practitioners_with_a_role,
       ROUND(100.0 * r.practitioners_with_a_role / p.practitioners, 1) AS coverage_pct,
       ROUND(1.0 * r.role_records / r.practitioners_with_a_role, 2)    AS roles_per_covered
FROM active_prac p JOIN roles r USING (release_date)
ORDER BY p.release_date
"""))

# COMMAND ----------

# MAGIC %md
# MAGIC Role records rose **173%**, from 3,952,445 to 10,806,327. Coverage moved
# MAGIC **4.5 points**, from 26.9% to 31.4%.
# MAGIC
# MAGIC The gap is in the last column: the average covered clinician went from about
# MAGIC two role records to nearly five. Most of the new records described people the
# MAGIC directory already described. That is a real improvement, and it is a
# MAGIC different improvement from covering more people. A headline record count
# MAGIC cannot tell the two apart.

# COMMAND ----------

# MAGIC %md
# MAGIC ## 2. The trap: two of these tables re-mint their ids every release
# MAGIC
# MAGIC The natural way to diff two releases is to join on the resource id. That is
# MAGIC valid for `practitioner` and `organization`, whose ids embed the NPI, and it
# MAGIC produces a completely false answer for `endpoint` and `location`, whose ids
# MAGIC are random UUIDs that CMS regenerates on every export.
# MAGIC
# MAGIC Run this before you write that join.

# COMMAND ----------

display(spark.sql(f"""
SELECT 'endpoint (UUID ids)' AS table_name,
       (SELECT COUNT(*) FROM endpoint WHERE release_date = '{MAY}') AS may_rows,
       (SELECT COUNT(*) FROM endpoint WHERE release_date = '{AUG}') AS aug_rows,
       (SELECT COUNT(*) FROM (
          SELECT _id FROM endpoint WHERE release_date = '{MAY}'
          INTERSECT SELECT _id FROM endpoint WHERE release_date = '{AUG}')) AS shared_ids
UNION ALL
SELECT 'practitioner (NPI ids)',
       (SELECT COUNT(*) FROM practitioner WHERE release_date = '{MAY}'),
       (SELECT COUNT(*) FROM practitioner WHERE release_date = '{AUG}'),
       (SELECT COUNT(*) FROM (
          SELECT _id FROM practitioner WHERE release_date = '{MAY}'
          INTERSECT SELECT _id FROM practitioner WHERE release_date = '{AUG}'))
"""))

# COMMAND ----------

# MAGIC %md
# MAGIC Endpoint shares **zero** ids across the two releases. Not nearly zero,
# MAGIC exactly zero, because the id format guarantees it. A churn report built on
# MAGIC that join would say CMS replaced every endpoint in the country, and it would
# MAGIC be measuring id minting.
# MAGIC
# MAGIC Join `endpoint` on `_address` instead. For `location` there is no reliable
# MAGIC key in these columns; a normalised name-plus-address match recovers roughly
# MAGIC three quarters of rows and should be reported with its match rate. The table
# MAGIC comments carry the same warning.

# COMMAND ----------

# MAGIC %md
# MAGIC ## 3. Most of what the directory calls an endpoint is not an API
# MAGIC
# MAGIC Every table carries the untouched FHIR resource in `resource`, so nothing is
# MAGIC lost, plus flattened `_*` columns so ordinary questions do not require JSON
# MAGIC parsing. Both releases are extracted by the same code, so a cross-release
# MAGIC comparison is not comparing two parsers.
# MAGIC
# MAGIC Here is one such question, and the answer is the denominator most people
# MAGIC get wrong.

# COMMAND ----------

display(spark.sql("""
SELECT release_date,
       _connection_type,
       COUNT(*) AS endpoints,
       ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (PARTITION BY release_date), 1)
         AS pct_of_release
FROM endpoint
GROUP BY release_date, _connection_type
ORDER BY release_date, endpoints DESC
"""))

# COMMAND ----------

# MAGIC %md
# MAGIC The Endpoint table holds over a million rows and about nine in ten are
# MAGIC Direct Trust messaging addresses, which a person can send a secure message
# MAGIC to and software cannot call. The subset an integrator can actually GET is
# MAGIC `hl7-fhir-rest`: 114,071 at 2026-05-08 and 110,973 at 2026-08-20.
# MAGIC
# MAGIC If you are building anything that resolves a provider to a callable API,
# MAGIC that smaller number is your denominator. Using the row count overstates
# MAGIC reachability by roughly ten times.

# COMMAND ----------

# MAGIC %md
# MAGIC ## Where this comes from, and what else is there
# MAGIC
# MAGIC [ainpi.dev](https://ainpi.dev) is a public-interest audit of this data. Every
# MAGIC measurement it publishes is pre-registered before the numbers are computed,
# MAGIC the compute scripts are open, and corrections are published when a source
# MAGIC changes underneath a claim.
# MAGIC
# MAGIC - **Findings**: <https://ainpi.dev/findings>
# MAGIC - **Per-state audit slices**, all 50 plus DC: <https://ainpi.dev/states>
# MAGIC - **The methodology**: <https://ainpi.dev/methodology>
# MAGIC - **The API**: <https://ainpi.dev/developer>
# MAGIC - **Licence and attribution**: <https://ainpi.dev/data-license>
# MAGIC
# MAGIC **A word on what this data is not.** It is a measurement of a federal file,
# MAGIC not a source of truth about any individual practitioner. Do not make an
# MAGIC enrolment, credentialing, payment or network decision about a named provider
# MAGIC on the basis of a record here without checking the primary sources: the NPPES
# MAGIC registry, the OIG exclusions list, and SAM.gov.
# MAGIC
# MAGIC **Corrections and contributions are welcome.** If a number here disagrees
# MAGIC with something you can verify, that is worth knowing and we would rather hear
# MAGIC it than not: <https://github.com/FHIR-IQ/AINPI/issues>.
