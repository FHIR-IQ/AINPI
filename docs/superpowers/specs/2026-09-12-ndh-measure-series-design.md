# The NDH measure series: turning a snapshot audit into a longitudinal record

**Date:** 2026-09-12
**Status:** Design (approved in chat; awaiting implementation plan)
**Owner:** Eugene Vestel
**Related:** `analysis/release_snapshot.py`, `/api/v1/release-deltas.json`, `/api/v1/role-gap-delta.json`, the Delta Sharing archive in `analysis/databricks_publish.py`, the pre-registration catalogue in `frontend/src/data/findings.ts`

## Why this exists

Every number this project publishes describes one CMS export. A finding is
pre-registered, H-numbered, computed against a single release, and finished the
day it ships. That shape cannot answer the question most consumers of directory
data actually have, which is not "how good is the directory" but "is it getting
better, and where".

It also cannot be answered by anyone else. **CMS serves only the current NDH
export and deletes the previous one.** This repository holds 2026-04-09,
2026-05-08 and 2026-08-20. Outside CMS, that archive is the only basis on which
the question can be asked at all, and nothing in the current publication model
uses it. `release-deltas.json` and `role-gap-delta.json` are the whole of it
today, and neither has a page.

This design reorganises publication around the archive: from a snapshot audit to
a longitudinal record.

## What this is

The atom of publication changes from a finding to a **measure**: a named
quantity with a fixed definition and a growing series of points, one per CMS
release.

```
measure:
  slug                practitioner-role-specialty-agreement
  question            Do Practitioner.qualification and PractitionerRole.specialty agree?
  numerator           Practitioner-to-Role pairs whose specialty codes match
  denominator         Practitioner-to-Role pairs where both carry a specialty
  source              NDH bulk export
  definition_version  2
  series:
    - release 2026-05-08  value 0.091    definition_version 1  commit <sha>
    - release 2026-08-20  value 0.99998  definition_version 2  commit <sha>
  breaks:
    - at 2026-08-20, definition_version 1 -> 2
      reason: PractitionerRole.specialty moved from CMS Medicare codes to NUCC,
              so v1 was measuring a lossy crosswalk, not disagreement
      comparable_across_break: false
```

Contrast a measure whose movement over the same two releases is real:

```
measure:
  slug                role-coverage-national
  question            What share of active practitioners carry a PractitionerRole?
  numerator           active practitioners with >= 1 active PractitionerRole
  denominator         active Practitioner resources
  source              NDH bulk export
  definition_version  1
  series:
    - release 2026-05-08  value 0.270  definition_version 1  commit <sha>
    - release 2026-08-20  value 0.314  definition_version 1  commit <sha>
  breaks: []
```

Role coverage reads no specialty code, so the vocabulary change cannot touch it.
Its movement is the directory genuinely improving and belongs on a line. The
agreement measure moved further and must not be drawn as one. Nothing in the two
sets of numbers distinguishes those cases. Only the definition record does.

### How a break is detected

The spec above says "a detected break" and that word is doing more work than it
looks. Nothing in a pipeline notices that 0.091 rising to 0.99998 is an artifact.
It looks like improvement. In the real case a human noticed that a query
returned zero rows for a URL that no longer existed.

Detection therefore has three mechanisms. None is a person remembering.

**`definition_version` is derived, never declared.** It is a hash of the
measure's SQL text. Change the query, the hash changes, the version bumps and a
break is recorded automatically. A hand-maintained version number is a field
somebody forgets, which is the same reasoning that gave `stats.json` a generator
and pinned `CURRENT_RELEASE` in two places tested against each other.

**Positive-control failure forces the code change that bumps the hash.** A
source change breaks a query, the control fails, and the run stops. The query is
fixed, the hash moves, the break is recorded. That closes the loop for every
source change that breaks something.

**A plausibility guard catches the source changes that break nothing.** This is
the case the first two miss and this project has already lived it. Endpoint rows fell 73% between April and May with no query failing and no
control tripping. The cause was de-duplication rather than removal, and only
comparing distinct addresses revealed it. Under unattended publication a 73% collapse
would ship as a real trend. So a move the measure did not expect marks the pair `unreviewed` and renders it
disconnected. No break record is required. `comparable_across_break` therefore
has three states, not two: `true`, `false`, and `unreviewed`.

**The threshold is declared, not derived, and that is not a shortcut.** A guard
computed from a measure's own history cannot work on a series holding two
points. Worse, a derived threshold fires hardest on the findings most worth
publishing. `Organization.partOf` went from 0% to 100% resolvable between May
and August. Any statistical guard rejects that as implausible and it is entirely
real. So each measure declares, at registration, the movement per release it
would consider ordinary. That is the discipline this project already applies to
findings, where a null hypothesis and an expected direction are registered
before the numbers drop, and it works at two points because the prior is stated
rather than inferred.

A measure whose prior is wrong flags once, gets reviewed, and the prior is
updated. `partOf` flagging on the release where a known-broken field was fixed
is the guard working, not failing. Publication of the point stays unattended.
Only the line waits.

Three consequences, each load-bearing.

**A measure is never finished, so it never goes stale.** A new point arrives
with each CMS release and requires no editorial work. The content engine is the
CMS release calendar rather than an editorial calendar.

**`definition_version` and `breaks` are the product, not bookkeeping.** This
repository has already shipped the wrong reading of the example above. The 9.1%
figure published for months was measuring a lossy Medicare-to-NUCC crosswalk
rather than real disagreement, and the jump that followed is an artifact of the
source changing vocabulary rather than a directory that fixed itself. A
series that does not model definition breaks will manufacture findings that are
not real, automatically and at scale. Modelling them is also the most citable
thing here, because a break is visible only to someone holding every release.

**Findings become the narrative layer.** H1 through H55 stay exactly as they
are. A finding stops being the artifact and becomes the essay explaining one
measure's history. The pre-registration record is the credibility asset and
nothing in this design touches it.

**The first measures are chosen for break resistance, not for interest.** One breaking source change per release is a rate per *release*, not per
*measure*. Role coverage passed through the August vocabulary change untouched.
Measures built on counts and reference resolution are structurally robust.
Measures keyed to a coded vocabulary are structurally fragile. Version one
favours the robust ones, so the series draws lines rather than accumulating
disconnected points while the machinery is still earning trust.
The fragile measures join later, once the break model has been exercised.

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

**Partitioning introduces a silent-blend hazard, and it lands before the second
release does.** Partition pruning holds only for a query that filters on
`release_date`. None of the twenty-odd `h*.py` scripts filters on it, because
the tables have only ever held one release. The moment a second partition exists
every unfiltered query blends May and August into a published finding. That is
the silent-zero failure inverted: the result is not empty, it is plausible and
wrong.

The fix is a view layer rather than a predicate in every query. Each resource
table gains a companion view, `cms_npd.practitioner_current` and so on, defined
as the base table filtered to `CURRENT_RELEASE`. Existing scripts repoint at the
views and are otherwise untouched. Only the measure pass reads base tables,
because only the measure pass is entitled to see more than one release.

Pruning survives the view, measured rather than assumed. On a two-partition test
table, a column scan cost 20,080,000 bytes unfiltered, 10,200,000 bytes through
the view, and 10,200,000 bytes with the predicate written inline. Wrapping the
view in a subquery changed nothing.

The view layer also makes the guardrail cheap. The anti-pattern rule becomes
"no base resource-table name outside `analysis/measures/`", which is a grep,
rather than a regex trying to pair a `FROM` with a `release_date` predicate
across f-strings and CTEs.

Two things ship alongside it. `fast_ingest_ndh.py` moves from `--replace` on the
table to a partition-scoped replace, so reloading one release cannot destroy
another. And the repoint is verified for free: while only one release is loaded
the view is a no-op, so every published artifact must be byte-identical before
and after. Any diff is a bug caught at zero cost.

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
restatement record. Almost nobody in this space publishes one. It cuts both ways. A visible history of
correcting yourself builds standing with a research audience and can unsettle a
commercial one. It is still worth doing, because the corrections happen whether
or not they are published, and only one of those worlds is honest.

### Preservation, which blocks everything else

The argument for authority rests on holding releases CMS has deleted. The
2026-04-09 export exists in exactly one place: `frontend/data/cms-npd`, 2.3 GB,
gitignored, dropped from the Delta archive in August. No source can supply it
again at any price. A disk failure permanently ends the unreplicable part of
this plan. Reload the April partition into the Delta archive before any other
work in this design begins.

## Public surface

**A page per measure at a stable URL, `/measures/<slug>`.** It carries the
question in one sentence, numerator and denominator in plain words, the declared
prior, and the series as a table. **It also carries the SQL for every
`definition_version`, verbatim.** That is not a developer convenience. The
`definition_version` hash is computed from that text, so publishing it is what
makes a break checkable by someone who is not us: a reader holding the archive
can run the query and get the number back. Reproducibility is the authority
claim, and a measure whose definition is only prose is not reproducible.

A chart appears once a measure has four points. Two points plotted is a line
drawn through a delta, which overstates what is known. Breaks and `unreviewed` gaps appear inline rather
than footnoted, and so does the restatement record wherever a recomputed value
differs from the published one. An index at `/measures` lists every measure with its
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
measure page carries a copy-paste citation pinned to a **deposit version, not a
release**. A restatement changes an old release's recomputed value, so a
citation naming only the release would quietly stop meaning what it meant. The
measure set is deposited to
Zenodo, which is free, is operated by CERN, and exposes an API the release
workflow can call unattended. Deposits are versioned: a concept DOI identifies
the series and a version DOI identifies one pipeline run. That distinction is
required rather than tidy, because a restatement changes an old release's
recomputed value, so deposits do not map one-to-one onto CMS releases. Researchers, standards bodies and regulatory commenters cite DOIs by default,
because a URL is not evidence that the source said what the citation claims.
This is a narrower audience than "everyone who might cite us"; a vendor white
paper will cite a URL whatever we do. The deposit is worth it anyway for
permanence, since it means the record survives ainpi.dev. That is the April
preservation argument again.

**Dataset markup moves to measures rather than staying on findings.** Two pages
carrying `Dataset` markup for the same quantity compete in search and in Dataset
Search, and the finding is the worse of the two to promote because it describes
one release. So a measure page becomes the `Dataset`, the finding narrating it
becomes an `Article` pointing at it, and the canonical is explicit.
`sitemap-findings.xml` exists so the Dataset-bearing subset reports separately
from the ten thousand per-NPI URLs, so it covers measures once measures are the
Dataset pages.

The cost contract governing every other static route governs these.
`/measures` and `/measures/<slug>` are `force-static` with
`generateStaticParams` and no runtime BigQuery, and their `.nft.json` must not
reference `public/api/v1/findings/**` or `public/api/v1/states/**`, or the
lambda bundle takes the 345 MB tree with it.

The rest of the structured data extends through the existing `SOURCE_CATALOG`
path in `frontend/src/components/JsonLd.tsx`. The rules there are unchanged and easy to get wrong. Descriptions run over 50
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

Two failure modes, both of which this project has already lived through in
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

Running cost: one to two dollars a month of BigQuery storage, a few dollars per
release for the measure pass, no Databricks compute on this path. The one-time
backfill is larger and mostly not billed: re-exporting 2026-05-08 with the
current extractor is hours of local compute over a 2.1 GB compressed release,
followed by an ordinary load.

## Order of work

1. Reload the 2026-04-09 partition into the Delta archive. Preservation blocks
   the rest.
2. Build the `_current` views, repoint every existing script at them, verify
   byte-identical outputs, and add the anti-pattern rule. All of this lands
   before a second partition exists.
3. Partition the BigQuery tables by `release_date`, move `fast_ingest_ndh.py` to
   a partition-scoped replace, then re-export and backfill 2026-05-08 with the
   current extractor.
4. Build the measure pass and the first six to eight measures, each with a
   positive control and a pinned definition.
5. Ship `/measures`, the JSON and CSV contract, the citation block and the
   Zenodo deposit.
6. Add an optional entity dimension so a measure can be computed per
   organization as well as nationally.

## Non-goals

- No paywall, no login, no metering. The static-backed surface stays free.
- No new charting framework or dashboard.
- No individual-level scoring beyond what `/npi/` already publishes. The four
  preconditions governing that surface are unchanged by this design.
- No editorial claim about whether CMS is performing well. Measures state what
  moved; they do not grade the publisher.

## Open questions

- Which six measures ship first. The proposed set, chosen for break resistance
  and for being computable against both archived releases: role coverage,
  endpoint-to-organization attribution, FHIR REST endpoint count, organization
  `partOf` resolvability, practitioner phone reachability, and SSN exposure
  remediation. The last already carries a positive control, and its history runs
  46 exposures in April to 41 in May to 0 in August. That is the clearest worked
  example of something the archive can show and a single release cannot.
  Federal-exclusion overlap is deliberately absent: it moves on the monthly OIG
  file rather than on a release, per the axis question below.
- **A measure needs a declared time axis and version one ducks the question.**
  NDH-derived quantities move per release. Exclusion-derived ones do not: the
  OIG LEIE file is monthly, SAM changes continuously, and the H26 payer probe
  hits live endpoints. Those belong on a date axis and cannot share a chart with a release axis.
  Version one excludes them rather than inventing a dual-axis rendering.
- Whether the 2026-04-09 export is promoted from archive artifact to published
  point. The re-export cost is identical to May's and it turns two points into three
  on day one. The complication is the April endpoint duplication, which is
  exactly the kind of artifact the break model exists to handle.
- Whether measures and findings share one URL namespace long-term or stay
  separate as designed here.
