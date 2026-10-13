# Health system directory report: how to run it

`analysis/notebooks/health_system_report.py` is a Databricks notebook that
reports what the CMS National Provider Directory says about one health system,
and what changed between two releases. It reads the release archive tables
(the same catalog and schema as `analysis/notebooks/ainpi_archive_quickstart.py`)
and writes nothing. Every intermediate result is a temporary view that ends
with the session.

It is not the notebook attached to the Marketplace listing. The listing carries
exactly one notebook, the quickstart, and `verify_listing` enforces that.

## Before you start

You need the archive installed in a workspace, either from the Marketplace
listing or through the open share. Note the catalog name you gave it.

Import the notebook: in the workspace, choose Import, then upload
`health_system_report.py`. Databricks recognises the
`# Databricks notebook source` header and splits the file into cells.

The name route passes the name as a named SQL parameter, which needs
Databricks Runtime 12.1 or later, or serverless compute.

## Parameters

| Widget | Required | Meaning |
|---|---|---|
| `catalog`, `schema` | yes | Where the archive lives. Defaults: `ainpi_ndh_archive`, `ainpi`. |
| `system_label` | no | Display name printed on the report. |
| `member_org_npis` | one of these two | Comma-separated organization NPIs of the member organizations. Each must be 10 digits, or the notebook stops. |
| `parent_lbn` | one of these two | Used only when `member_org_npis` is empty. A name matched, case-insensitive, against organization names, then extended down the directory's `partOf` hierarchy up to five levels. |
| `release_current`, `release_prior` | yes | Two `release_date` values present in the archive. |
| `roster_npis` | no | Clinician NPIs the system says it employs. Makes the funnel start from that roster. |
| `nucc_csv` | no | Path or URL of the NUCC taxonomy CSV. Without it, section 1 lists raw taxonomy codes instead of professions. |

Prefer the NPI list. The name route is an inference: it can pull in unrelated
organizations with similar names and miss members filed under a different legal
name. The notebook prints the member list it resolved, and that list should be
read before any number below it.

## What it produces

1. Clinicians the directory links to member organizations through an active
   `PractitionerRole`, grouped by NUCC grouping when `nucc_csv` is given.
2. A funnel from a starting population to clinicians whose member organization
   has an `hl7-fhir-rest` endpoint. Without a roster, the starting population
   is every active clinician in the member organizations' states, which is
   context rather than membership.
3. Every FHIR REST web address attached to a member organization, labelled by
   source: the CMS directory's own `managingOrganization`, the vendor-file rows
   of `org_endpoint` (the vendor's claim, not confirmed by CMS), or both.
4. Counts present in each release, added and dropped, for member organizations,
   linked clinicians, clinicians reaching an address, and the addresses
   themselves, plus the list of clinicians added and dropped.
5. A plain list of what the archive cannot answer.

## Rules the notebook follows

- Endpoint and location ids are regenerated every release. Endpoints are
  compared across releases by normalised address, using the same rule as
  `analysis/org_endpoint_table.normalize_url`. Locations are not compared across
  releases at all.
- Only `hl7-fhir-rest` endpoints count as reachable.
- Before reporting, the notebook checks that the member set is not empty and
  that the FHIR REST filter matches something in the release, so a broken input
  stops the run instead of producing zeros.
- `org_endpoint` may hold vendor rows for one release only. The notebook prints
  which releases have them and leaves vendor claims out of the release
  comparison.

## Cost

Compute runs in the workspace that installed the archive. The largest read is
section 1, which parses the `resource` JSON of the current release's
practitioner records to get taxonomy codes. The name route also reads the
organization `resource` column once for both releases. Running with an NPI list
avoids that second read.

## Tests

`analysis/tests/test_health_system_report_notebook.py` parses the notebook
without running it. It checks that every SQL statement reads only tables listed
in `TABLE_COMMENTS` in `analysis/databricks_publish.py` (or temporary views the
notebook creates), that no statement uses endpoint or location `_id` across
more than one release, and that the address normaliser matches the
`org_endpoint` builder. The checkers are also run against SQL they must reject,
including the quickstart's deliberate id-join demonstration.

```bash
python3 -m pytest analysis/tests/test_health_system_report_notebook.py -q
```
