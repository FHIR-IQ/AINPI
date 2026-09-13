# The NDH measure series: turning a snapshot audit into a longitudinal record

**Date:** 2026-09-12
**Status:** Design (approved in chat; awaiting implementation plan)
**Owner:** Eugene Vestel
**Related:** `analysis/release_snapshot.py`, `/api/v1/release-deltas.json`, `/api/v1/role-gap-delta.json`, the Delta Sharing archive in `analysis/databricks_publish.py`, the pre-registration catalogue in `frontend/src/data/findings.ts`

## Why this exists

Measured on 2026-09-12. Search Console shows 99 clicks and 9,339 impressions
over 28 days, arriving almost entirely on person-name NPI lookups. The site has
22 email subscribers, none added in the last 30 days. It has 12 report
downloads, none since 2026-06-02. Its one API key is deactivated, and its owner
made the last call. External API and MCP traffic is zero.

So the site is indexed, it is read, and nothing downstream of reading happens.

The diagnosis is not distribution. It is that the unit of publication is a
finding: pre-registered, H-numbered, computed against one CMS export, and
finished the day it ships. A finding is a conclusion about a moment. It decays
quietly, it gives no one a reason to return, and it is reproducible by anyone
who downloads the same export.

There is one thing about this project that is not reproducible by anyone.
**CMS serves only the current NDH export and deletes the previous one.** This
repository holds 2026-04-09, 2026-05-08 and 2026-08-20. Nobody outside CMS can
answer whether the national provider directory is getting better or worse
without this archive. That is an irreproducible primary source, and it is
currently the least visible thing on the site.

This design reorganises publication around that asset.

## What this is

The atom of publication changes from a finding to a **measure**: a named
quantity with a fixed definition and a growing series of points, one per CMS
release.

```
measure:
  slug                role-coverage-national
  question            What share of active practitioners carry a PractitionerRole?
  numerator           active practitioners with >= 1 active PractitionerRole
  denominator         active Practitioner resources
  source              NDH bulk export
  definition_version  2
  series:
    - release 2026-05-08  value 0.270  definition_version 1  commit <sha>
    - release 2026-08-20  value 0.314  definition_version 2  commit <sha>
  breaks:
    - at 2026-08-20, definition_version 1 -> 2
      reason: PractitionerRole.specialty moved from CMS Medicare codes to NUCC
      comparable_across_break: false
```

Three consequences, each load-bearing.

**A measure is never finished, so it never goes stale.** A new point arrives
with each CMS release and requires no editorial work. The content engine is the
CMS release calendar rather than anybody's availability. This is the entire
answer to the binding constraint on this project, which is that there are no
hours to spend on it.

**`definition_version` and `breaks` are the product, not bookkeeping.** This
repository has already shipped a wrong trend for exactly this reason. The 9.1%
Practitioner-to-Role agreement figure published for months was measuring a lossy
Medicare-to-NUCC crosswalk rather than real disagreement; once both fields spoke
NUCC the true figure was 99.998%. Plotted naively that is a spectacular
improvement and it is entirely an artifact of the source changing vocabulary. A
series that does not model definition breaks will manufacture findings that are
not real, automatically and at scale. Modelling them is also the most citable
thing here, because a break is visible only to someone holding every release.

**Findings become the narrative layer.** H1 through H55 stay exactly as they
are. A finding stops being the artifact and becomes the essay explaining one
measure's history. The pre-registration record is the credibility asset and
nothing in this design touches it.

The work is mostly reframing rather than new analysis. Roughly 15 to 20 measures
already exist inside `analysis/h*.py` as one-off numbers. The task is extracting
the definitions, pinning them, and giving them a home that accumulates.

## Compute and storage

**Every point must be computed with today's definition, not the definition in
force when that release was current.** Otherwise the series is a scrapbook of
past publications and the breaks mean nothing. The backfill is therefore not a
convenience that fills in history; it is what makes the series a series.

**Compute stays in BigQuery.** Every measure definition already exists there as
SQL, the byte caps are wired through `bq_job_config()` and
`DEFAULT_MAX_BYTES_BILLED`, and `.github/workflows/anti-patterns.yml` enforces
them. Moving computation to Databricks would mean rewriting every definition. It
would also mean paying for a serverless warehouse on each run, now that the
trial credit has expired. Databricks stays the distribution surface for the archive, not the
compute for it.

**The BigQuery tables gain a `release_date` partition and stop being a
snapshot.** Today `fast_ingest_ndh.py` loads with `--replace`, so the warehouse
holds exactly one release. Partitioning removes that, and partition pruning
means a single-release measure query scans what it scans today. Storage for
multiple releases is on the order of one to two dollars a month.

A simplification falls out: once loading a new export no longer destroys the
previous one, `analysis/release_snapshot.py` becomes redundant. Its entire
purpose is rescuing a few numbers ahead of an irreversible `--replace`.

**The series starts at 2026-05-08 and runs forward.** The 2026-04-09 export
stays an archive artifact rather than a published point, which makes the
backfill one release instead of two. The May and August exports were written by
an older extractor and carry three to five fewer flattened columns than the
current tables, so the backfill re-exports them with the current extractor
rather than padding with NULLs. Every flattened column derives from the stored
`resource` JSON, which all releases carry, so a re-export back-fills real
values. A NULL meaning "not extracted at the time" is the same ambiguity the
map work keeps `null` and `0.0` apart for.

**Recomputation will produce restatements, and they get published.** Recomputing
May with today's definitions will differ from what May published. Publish both,
as-published and as-recomputed, with the reason for each difference. That is a
restatement record. Almost nobody in this space publishes one.

### Preservation, which blocks everything else

The argument for authority rests on holding releases CMS has deleted. The
2026-04-09 export exists in exactly one place: `frontend/data/cms-npd`, 2.3 GB,
gitignored, dropped from the Delta archive in August. No source can supply it
again at any price. A disk failure permanently ends the unreplicable part of
this plan. Reload the April partition into the Delta archive before any other
work in this design begins.

## Public surface

**A page per measure at a stable URL, `/measures/<slug>`.** It carries the
question in one sentence, numerator and denominator in plain words, and the
series as a small table and small chart. Breaks appear inline rather than
footnoted. So does the restatement record, wherever a recomputed value differs
from the published one. An index at `/measures` lists every measure with its
latest value and direction.
Findings link to the measures they narrate and measures link back.

Visual treatment follows the state pages, which are the only surface currently
earning clicks at useful positions. No new charts framework.

**The machine surface joins the existing contract.** `/api/v1/measures.json` and
`/api/v1/measures/<slug>.json`, plus CSV, registered in `manifest.json`. The
loaders and the static-contract conventions already exist. The MCP server and
the Delta Sharing archive both become materially more useful the moment there is
a series to ask about rather than a snapshot to look up.

**Citation is a mechanism, not a hope.** Being cited requires a stable
identifier, a pinned version, and a form that pastes into a document. Each
measure page carries a copy-paste citation pinned to a release, and each
release's complete measure set is deposited to Zenodo, which mints a DOI, is
free, is operated by CERN, and exposes an API the release workflow can call
unattended. Regulators, standards bodies and health-services researchers cite
DOIs by default and cite URLs reluctantly. A URL is not evidence that the source
said what the citation claims. A DOI per release also means the record survives
ainpi.dev, which is the April preservation argument again.

Dataset structured data extends to measures through the existing
`SOURCE_CATALOG` path in `frontend/src/components/JsonLd.tsx`, so Google Dataset
Search picks them up the way it already picks up findings. The rules there are unchanged and easy to get wrong. Descriptions run over 50
characters. `citation` points at `/methodology` and never holds the denominator.
`isBasedOn` is overridden for any non-NDH source. Every nested `Dataset` node
carries description, creator and license.

## Operations and failure modes

The pipeline is release-triggered. `manifest.json` at directory.cms.gov carries
`generated_at`, which the weekly job already fetches, so detection is a
comparison against `CURRENT_RELEASE`. On detection: load the new partition, run
the measure pass, diff against the prior point, deposit to Zenodo, regenerate
the manifest, publish.

**Publication is unattended. Comparability is not.** A new point always
publishes. A detected break sets `comparable_across_break: false` by default and
the series renders as two disconnected segments with the break marked, never as
a continuous line. Reviewing a break later is an upgrade, deciding that a number
is comparable, rather than a gate deciding that it may exist. An unreviewed break leaves the series conservative instead of wrong. That is
the correct failure direction, and it removes the last part of this design that
needed anyone's attention.

Three failure modes, all of which this project has already lived through in
another form.

**Silent zero.** A source changes, the query matches nothing, and the empty
result renders as a plausible measurement. Three landed in a single day on
2026-08-21. The existing rule applies with more force to a series than to a finding. A zero
in a series does not look like an error, it looks like a collapse. Every measure
carries a positive control proving its container field is still present. A
measure that cannot prove it fails the run rather than publishing a point.

**Schema drift on every release.** Three releases have produced three breaking
changes. The NPI identifier system URL moved. The manifest keys were renamed.
The taxonomy system URL became a ValueSet canonical in a field FHIR defines as a
CodeSystem canonical. The base rate is one per release. The pipeline should
expect to fail on a new export and treat a clean run as the surprise.

**Positioning drift.** A quarterly series of what did and did not improve is
structurally a scorecard on a CMS product, and the working relationship with the
NDH team and the community call is an asset worth more than any single finding.
The discipline is to measure and let the number talk, never to editorialise
about whether CMS is doing well. That posture is also what makes the series
usable by CMS rather than defensive against it.

Running cost: one to two dollars a month of BigQuery storage, a few dollars per
release for the measure pass, no Databricks compute on this path.

## What the existing surfaces become

**The organization scoreboard is a measure with an entity dimension**, not a
separate product. `endpoint-reach` computed per EHR vendor, per health system
and per payer over the same release axis. An organization cites a score, or argues with it, because the score moved
rather than because it exists. A vendor that improved between releases has a
reason to point at the source. A one-off ranking gives it none. Entity-dimensioned measures cover organizations
only, never individuals, which keeps the existing boundary intact.

**The catalogue listings stop being a shelf.** The Databricks Marketplace listing currently offers a copy of a file CMS gives
away. That is most of why it has no pull, independent of the visibility
problem. The same listing offering
the only multi-release archive with a versioned quality series over it is a
different proposition, and it is what the listing copy should say. Same for
HuggingFace and the MCP registries. That work is republishing against a
different description once there is something behind it.

## Order of work

1. Reload the 2026-04-09 partition into the Delta archive. Preservation blocks
   the rest.
2. Partition the BigQuery tables by `release_date`; re-export and backfill
   2026-05-08 with the current extractor.
3. Build the measure pass and the first six to eight measures, each with a
   positive control and a pinned definition.
4. Ship `/measures`, the JSON and CSV contract, the citation block and the
   Zenodo deposit.
5. Re-cut the Databricks, HuggingFace and MCP registry listings against the
   series.
6. Add the entity dimension for the organization scoreboard.

## Non-goals

- No paywall, no login, no metering. The static-backed surface stays free.
- No new charting framework or dashboard.
- No individual-level scoring beyond what `/npi/` already publishes. The four
  preconditions governing that surface are unchanged by this design.
- No advisory offer, outreach sequence or anything else that consumes hours.
  A design that needs meetings fails the constraint that produced it.
- No editorial claim about CMS performance.

## Open questions

- Which six to eight measures ship first. The candidates with the cleanest
  definitions and the most external interest are role coverage, endpoint
  attribution, FHIR REST endpoint count, organization `partOf` resolvability,
  practitioner phone reachability, and federal-exclusion overlap.
- Whether the 2026-04-09 export is eventually promoted from archive artifact to
  published point once the pipeline is proven.
- Whether measures and findings share one URL namespace long-term or stay
  separate as designed here.
