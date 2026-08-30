# Databricks Marketplace listings

Source of truth for the listing copy. Edit here, then paste into the provider
console, so the wording is reviewable and diffable rather than living only in a
web form.

Two listings. The archive comes first because it is the thing nobody else has.
The MCP server comes second because it reaches a different audience through the
same channel.

---

## Provider profile

Created 2026-08-23, id `1391b933-c642-420e-86a6-98c1283a4b57`. It was the one
step with no API: `GET /api/2.1/marketplace-provider/providers` works and `POST`
to the same path returns "No API found", so it was filled in by hand in the
provider console.

### The account cannot publish publicly yet

`provider-listings create` with `visibility: PUBLIC` returns **"Marketplace
private exchange provider cannot perform this operation"**. The same request
with `PRIVATE` succeeds, so this is an account tier and not a malformed request.
Public Marketplace listings need Databricks to approve the provider application.

Until that lands, `--publish --private` puts the listing in a private exchange.
The flag is explicit on purpose: a public publish that quietly degrades to a
private one would report success for a listing nobody can find.

Current state: listing `6cf064b7-1fca-4a8f-addf-03ffd8bfdfd6`, PRIVATE, attached
to the `ainpi-ndh-archive` share, in no exchange, so it reaches nobody yet. When
approval lands, `--publish` flips it to PUBLIC in one update.

| Field | Value |
| --- | --- |
| Provider name | FHIR IQ |
| Organization website | https://fhiriq.com |
| Business email | gene@fhiriq.com |
| Support email | gene@fhiriq.com |
| Terms of service | https://ainpi.dev/terms |
| Privacy policy | https://ainpi.dev/privacy |

Both emails are `gene@fhiriq.com` because that is the address all four published
policy pages already name. A support address that appears nowhere in the terms
it sits beside is a mismatch a reader can see.

### Description (921 of 1000 characters)

FHIR IQ works on healthcare interoperability: HL7 FHIR implementation, provider directory data quality, and federal health data standards.

It maintains AINPI (ainpi.dev), a public-interest audit of the CMS National Provider Directory. AINPI registers each measurement before computing the numbers, publishes the compute scripts, and issues a correction when a source changes underneath a claim.

Listings from this provider are healthcare directory data and the tools to read it. The first is an archive of every published release of the federal provider directory, including the releases CMS no longer serves. It ships as Delta tables partitioned by release, so one query can compare two versions. Later listings cover crosswalks derived from it and an MCP server that answers audit questions for an agent.

The underlying federal files are US government works and carry no copyright. The extraction code is Apache-2.0.

---

## Listing 1: the release archive

**Type:** Tables, from the `ainpi-ndh-archive` share
**Access:** Instantly available. Do not use Request Access. Friction on a free
public-good dataset costs exactly the reach that makes publishing it worthwhile.
**Categories:** `HEALTH`, `PUBLIC_SECTOR`
**Update frequency:** Per NDH release, roughly quarterly

The category values are enum members, enumerated from the 2,076 live consumer
listings rather than guessed. `HEALTH_AND_LIFE_SCIENCES` is not one of them, and
the API drops an unknown category **without an error**: the create returns 200
and the listing comes back carrying only `PUBLIC_SECTOR`. Losing the healthcare
category on a healthcare dataset is the quietest possible way to be invisible to
the audience the listing exists for. The publish script now reads every listing
back and compares it to the spec for exactly this reason.

### Name

CMS National Provider Directory: Release Archive

### Subtitle (113 of 120 characters)

The cap is 120, measured. A 144-character first draft was rejected outright,
which is the good failure; the category drop above is the bad one.

Every release of the federal provider directory, including the ones CMS no
longer serves. Diff them in one query.

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

The description above tells the reader a notebook is included, so `verify_listing`
now fails the publish unless exactly one is attached. `attach_notebook` handles
it, and three of its details were found by probing rather than by reading a doc:

- Marketplace wants an HTML **export**, not the source. `text/html` is the only
  mime type `EMBEDDED_NOTEBOOK` accepts; `application/x-ipynb+json`,
  `text/x-python`, `application/json` and `application/octet-stream` are each
  rejected by name.
- The presigned PUT is signed over `host;x-amz-server-side-encryption`, so the
  upload must send `x-amz-server-side-encryption: AES256` and must **not** add a
  `Content-Type`. Either mistake is a bare 403.
- The upload URL expires in 900 seconds, so create and upload without pausing.

The new file is uploaded before the old one is deleted, so a failed run leaves
the previous notebook in place rather than leaving the listing with none.
Re-running is idempotent: still exactly one file attached.

---

## How a paid listing works, measured

Marketplace has **no payment rails**. "Paid" is a gate plus a conversation, not a
checkout. Two fields do the work:

- `detail.cost` = `PAID` or `FREE`
- `summary.listingType` = `PERSONALIZED` (Request Access) or `STANDARD`
  (instantly available)

A `PERSONALIZED` listing turns the Request Access button into a personalization
request, which lands in `databricks provider-personalization-requests`. You reply,
contract off-platform, then grant a share. Nothing is charged by Databricks.

Counts across the 2,076 live consumer listings, so this is the convention rather
than an opinion:

| | STANDARD | PERSONALIZED |
| --- | --- | --- |
| `cost: PAID` | 53 | **471** |
| `cost: FREE` | 370 | 53 |
| `cost` unset | 783 | 346 |

Nine in ten paid listings are `PAID` + `PERSONALIZED`. Note also that 1,129 of
2,076 leave `cost` unset entirely, so filling in the facet fields is cheap
differentiation, not table stakes.

Asset types in use: `DATA_TABLE` 1,605, `MEDIA` 187, `GIT_REPO` 125, `MODEL` 97,
`MCP` 73, `NOTEBOOK` 42, `APP` 31. A notebook is a declarable asset type and is
separate from the embedded preview notebook that `attach_notebook` uploads.

### What Datavant does, and what not to copy

Datavant runs ten listings and splits them cleanly. The broad datasets
(Social Determinants of Health, HealthIQ, FinanceIQ, AutoIQ) are `STANDARD`,
instantly available. The curated clinical datasets (Cardiometabolic, RSV, HCM,
IBD) and the platform products (Datavant Connect, Datavant App) are
`PERSONALIZED`. Free-and-open is the front door; the priced work is behind a
conversation. That is the same shape as this project: the archive is free, the
reconciliation work is not.

**Copy the structure, not the voice.** The Cardiometabolic description reads
"Navigating through the complexities of data acquisition for your research
shouldn't be a challenge" and "valuable data without the hassle", with bolded
phrases throughout. That is exactly the register `slop_lint.py` exists to catch,
and it is the opposite of what makes an audit credible. A listing that says a
number and its denominator beats one that says it is research-ready.

Their listings also leave `license` and `documentation_link` empty. We have
`/methodology`, `/data-license` and open compute scripts, so filling those is a
real differentiator that costs nothing.

---

## Listing 3: reconciliation, paid (drafted, not published)

**Type:** `cost: PAID`, `listingType: PERSONALIZED`
**Blocked by:** the same public-provider approval as the others, plus a scope
decision that is not mine to make.

The demand signal is real and specific. A health plan on the subscriber list
asked to compare an internal roster of 500,000 providers and 2,000,000 address
records against the directory to measure accuracy. They can already do the
download for free. What they cannot do for free is decide what counts as a
disagreement.

So the priced unit is **judgment, not bytes**: matching methodology, what a
roster-versus-directory difference means, and which differences are the
directory being wrong rather than the roster.

**The listing must state that the data is free.** A public-interest audit that
appears to paywall its own measurements loses the thing that makes it worth
citing. The free archive listing and this one should reference each other.

Do not write this listing until there is a delivered engagement to describe.
Listing a service that has not been performed is the same defect as a
description promising a notebook that was not attached, and it is harder to
detect from outside.

---

## Listing 2: the MCP server

**Type:** MCP Server (Public Preview)
**Access:** Instantly available
**Product category:** `AI`. Databricks lists MCP servers under AI, not under the
data categories the archive listing uses. Read the listing back after publishing:
an unknown category is dropped silently, which has cost this project once.
**Subject categories:** `HEALTH`, `PUBLIC_SECTOR`

### Name

AINPI Provider Directory Audit (MCP)

### Subtitle (must fit 120 characters)

Ask an agent what the federal provider directory says, and how wrong it is.
No signup to start, no scraping.

### Long description

An MCP server that lets an agent query the AINPI audit of the federal provider
directory directly, instead of scraping a website. Anonymous by default, so it
works with no signup; a bearer token raises the limits when an integration
needs more.

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
