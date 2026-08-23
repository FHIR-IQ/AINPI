# Databricks Marketplace listings

Source of truth for the listing copy. Edit here, then paste into the provider
console, so the wording is reviewable and diffable rather than living only in a
web form.

Two listings. The archive comes first because it is the thing nobody else has.
The MCP server comes second because it reaches a different audience through the
same channel.

---

## Listing 1: the release archive

**Type:** Tables, from the `ainpi-ndh-archive` share
**Access:** Instantly available. Do not use Request Access. Friction on a free
public-good dataset costs exactly the reach that makes publishing it worthwhile.
**Categories:** Healthcare and Life Sciences; Public Sector
**Update frequency:** Per NDH release, roughly quarterly

### Name

CMS National Provider Directory: Release Archive

### Short description (under 160 characters)

Every published version of the federal provider directory, including the ones
CMS no longer serves. Partitioned by release so you can diff them.

### Long description

CMS publishes the National Provider Directory as a bulk FHIR export and serves
only the current version. When a new release lands, the previous one is gone
from the source. This archive keeps them.

That is the entire product, and it is free.

**What is in it.** Two releases so far, 2026-05-08 and 2026-08-20, 54,162,643
rows across six tables: Practitioner, PractitionerRole, Organization,
OrganizationAffiliation, Location and Endpoint. Every row carries the untouched
FHIR resource JSON, plus flattened columns so ordinary questions do not require
JSON parsing. Both releases are extracted by the same code, so comparing them is
not comparing two parsers. Each table is partitioned by `release_date`, which
makes a cross-release comparison a `WHERE` clause rather than a download.

**What it is for.** Questions that need two releases at once. One worked
example, included as a notebook: between these two releases CMS added about
seven million PractitionerRole records, a 173% rise. The share of clinicians who
have one moved 4.5 points, from 26.9% to 31.4%. The rest went to people the
directory already described, taking the average covered clinician from two role
records to nearly five. That is a real improvement and a different improvement
from covering more people, and a headline record count cannot tell them apart.

**One thing to know before you write a diff.** Practitioner and Organization ids
embed the NPI and are stable across releases. Endpoint and Location ids are
random UUIDs that CMS regenerates on every export, so joining those two on `_id`
across releases reports 100% churn that did not happen. Join Endpoint on
`_address` instead. The table comments carry the same warning, and the notebook
demonstrates it.

**Where it comes from.** Maintained by AINPI (ainpi.dev), a public-interest
audit of federal provider directory data. Every measurement it publishes is
pre-registered before the numbers are computed, the compute scripts are open,
and corrections are published when a source changes underneath a claim. The
archive is a by-product of that work, and giving it away costs nothing.

**Licence.** The underlying federal files are US government works and are not
subject to copyright. AINPI claims no rights over them and grants none, because
it has none to grant. The compilation and the extraction code are Apache-2.0.
Attribution is requested rather than required, and the reason is practical: a
figure quoted without its release date cannot be checked against the release it
came from.

**Not a source of truth about any individual.** This is a measurement of a
federal file. Do not make an enrolment, credentialing, payment or network
decision about a named provider from a record here without checking the primary
sources: the NPPES registry, the OIG exclusions list, and SAM.gov.

**Corrections welcome.** If a number here disagrees with something you can
verify, we would rather hear it: https://github.com/FHIR-IQ/AINPI/issues

### Required URLs

- Terms of service: https://ainpi.dev/terms
- Privacy policy: https://ainpi.dev/privacy
- Licence: https://ainpi.dev/data-license

### Attached notebook

`analysis/notebooks/ainpi_archive_quickstart.py`. It reproduces the coverage
finding, demonstrates the id-stability trap, and links back to the findings.
Consumers evaluate a listing by running its notebook, so this one has to answer
a real question rather than print a schema.

---

## Listing 2: the MCP server

**Type:** MCP Server (Public Preview)
**Access:** Instantly available
**Categories:** Healthcare and Life Sciences; Public Sector

### Name

AINPI Provider Directory Audit (MCP)

### Short description (under 160 characters)

Ask an agent what the federal provider directory says, and how wrong it is.
Five tools over the AINPI audit. No credentials, no scraping.

### Long description

A credential-free MCP server that lets an agent query the AINPI audit of the
federal provider directory directly, instead of scraping a website.

**Tools.** `list_findings` enumerates every published finding.
`get_finding` returns one finding's measured numbers, denominator and chart
data. `get_state_audit` returns a state-scoped slice with sample NPIs and
primary-source verification URLs. `check_npi_cohort` checks whether an NPI
appears in the high-risk cohort. `lookup_npi` resolves a single NPI.

**What it reads.** Only already-public surfaces: the static `/api/v1` JSON
contract and the existing public search route. It adds no new query paths and
nothing here is reachable only through the server.

**Every result carries its caveat, on purpose.** A cohort flag means public
federal databases disagree about a provider, not that anyone did anything wrong.
The SAM.gov extract has a documented false-positive rate: in one worked example
three of four candidates were wrong, caught only by checking the primary
sources. The server returns the verification URLs with the flag so an agent can
check rather than assert.

**Endpoint.** https://ainpi.dev/api/mcp

**Licence.** Apache-2.0. Terms at https://ainpi.dev/terms

---

## Notes for whoever publishes these

Marketplace consumer identity is coarse for open sharing: a single shared
recipient token makes every consumer anonymous, because the audit log can only
attribute to the recipient and there is one. Issue a named recipient per
organization for anyone who asks for direct access. The Marketplace listing
supplies the audience; named recipients supply the list.

Keep Request Access for the paid derived tables, where a conversation is the
point. It is friction, and friction on the free tier is the one mistake that
cannot be undone by fixing the copy.
