# One NPI, up to six Organization records: how orgs multiply in the federal directory

Practitioner records in the CMS National Provider Directory deduplicate
cleanly: 7,441,211 NPIs, zero excess rows. One person, one record.

Organizations are a different story. On the 2026-05-08 release:

- 1,999,118 unique organizational NPIs
- **70.6% of them map to more than one Organization resource**
- 1,413,126 excess Organization rows beyond one-per-NPI
- worst case: six separate Organization records for a single NPI

## What multiplication looks like

The same organizational NPI appears as several Organization resources,
typically with the same name but different addresses, or slight name variants
at the same address. These are not different legal entities. They are the
same organization represented once per practice location, or once per source
system that fed the upstream record.

Normalizing by (name, state, city) instead of NPI shows the same pattern from
the other side: the duplication is structural, not a handful of typos.

## Why it matters

1. **"How many organizations are in the directory?" has two answers that
   differ by 1.4 million.** Resource count says 3.4 million. Unique-NPI count
   says 2.0 million. Any statistic built on the Organization table needs to
   declare which denominator it used.

2. **Joins fan out silently.** A practitioner-to-organization join through
   `PractitionerRole` multiplies wherever the org NPI has several resources.
   Aggregates built without deduplication overcount affiliations, locations,
   and network sizes.

3. **The asymmetry is the finding.** The same pipeline that keeps 7.4 million
   practitioner records perfectly deduplicated produces 70.6% multiplication
   on organizations. That points at how the upstream sources model facilities
   versus people, not at random noise.

## Verify it yourself

This is finding H14/H15 (duplicate detection). The compute script and the
per-release numbers are public, and the raw NDH files are downloadable from
CMS.

- Finding: <https://ainpi.dev/findings/duplicate-detection>
- Compute script: [`analysis/h14_h15_duplicates.py`](https://github.com/FHIR-IQ/AINPI/blob/main/analysis/h14_h15_duplicates.py)
- Source data: <https://directory.cms.gov/> (2026-05-08 release)
