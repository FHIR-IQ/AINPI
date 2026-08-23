# Data licence and attribution

Last updated 2026-08-23.

AINPI publishes three different things, and they are not under the same terms.
This page says which is which, because a data consumer needs to know before
they build on it.

## The federal source data: public domain

The underlying files come from the US government: the CMS National Provider
Directory bulk export, NPPES, PECOS enrollment files, the OIG List of Excluded
Individuals and Entities, the SAM.gov exclusions extract, CMS Provider Data
Catalog files, USDA ERS county codes and US Census geography.

Works of the United States government are not subject to copyright protection
in the United States. **AINPI claims no rights over that source data and grants
none, because it has none to grant.** You do not need permission from AINPI to
use it, and nothing on this page restricts what you may do with the federal
files themselves.

Each source carries its own terms of use at the publisher. Where a source is
not a US government work, the [data sources page](/data-sources) names it and
links its terms.

## The AINPI code: Apache-2.0

Every ingestion, analysis and site script is released under the Apache License
2.0. The full text is in the repository. Fork it, run it, change it, sell what
you build with it.

## The AINPI compilation and findings: Apache-2.0, attribution requested

The derived layer is the part that took work: the flattened tables, the
release archive, the cross-source crosswalks, the per-state audit slices and
the finding payloads under `/api/v1/`. That work is joining federal files to
each other and to vendor files, and reconciling the result.

It is published under the same Apache-2.0 terms as the code, which permits
commercial use, redistribution and modification.

Attribution is requested rather than required by that licence, and we ask for
it anyway:

> Source: AINPI (ainpi.dev), derived from CMS National Provider Directory
> public use files.

If you redistribute a modified version, please say that you changed it, so a
reader can tell your numbers from ours.

## What attribution is for

It is not credit for its own sake. Every number here is tied to a release date
and a methodology version, both of which change. A figure quoted with no
provenance cannot be checked against the release it came from, and this project
has already had to correct itself when an upstream source changed shape
underneath a published claim. Naming the source and the release is what makes
the correction reachable.

Cite the release, not just the site:

> AINPI, "The role gap is a Medicare-billing gap", NDH release 2026-08-20,
> methodology 0.7.2-draft. https://ainpi.dev/findings/role-gap-composition

## The release archive

CMS serves only the current version of its bulk export. AINPI keeps the earlier
ones and republishes them unchanged apart from format conversion, plus a
`release_date` column identifying which release each row came from.

The archive is federal public-domain data. It is free, and it is intended to
stay free.

**One thing to know before you diff two releases.** Practitioner and
Organization ids embed an NPI and are stable across releases. Endpoint and
Location ids are random UUIDs that CMS regenerates on every export, so joining
those two on `_id` across releases reports 100% churn that did not happen. Join
endpoint on its address instead. The table comments carry the same warning.

## No warranty

Nothing here is a warranty of accuracy, currency or completeness. See the
[terms of use](/terms), particularly the section on verifying against primary
sources before acting on any record about a named provider.

## Questions

gene@fhiriq.com
