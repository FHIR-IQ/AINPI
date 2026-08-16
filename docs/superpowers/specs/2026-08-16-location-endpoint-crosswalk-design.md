# Location-to-endpoint crosswalk: scope, QA and test assumptions

Design spec. Status: draft. Numbers below were measured, not assumed; the
sources are named so each can be rechecked.

## The goal, stated as a user action

A patient leaves an appointment and wants their records. An app has to turn
"the clinic I was just in" into "the FHIR endpoint that serves it, and the
credentials flow that fronts it".

That is not a provider search. It is a **place-to-endpoint lookup**, and the
place is usually a specific site, not the parent health system. One organization
routinely operates many sites, and those sites do not all share an endpoint or
even an EHR. A system that answers only at the organization level will send the
app to the wrong server for a large share of real visits.

## What the NDH specification permits

The NDH IG already models this. Verified against the STU1 Location profile:

| Element | Cardinality | Flag |
| --- | --- | --- |
| `Location.endpoint` | 0..* | must-support |
| `Location.partOf` | 0..1 | |
| `Location.managingOrganization` | 0..1 | must-support |

So location-level endpoints and location hierarchy are both in scope for the
specification as written. No IG change is needed to represent what we want.

## What the published data actually contains

Measured on the 2026-05-08 release.

| Resource | Rows | Carries `.endpoint` | Carries `.partOf` |
| --- | ---: | ---: | ---: |
| Location | 1,362,869 | **0** | **0** |
| Organization | 3,414,375 | 87,681 | 148,834 |
| OrganizationAffiliation | 1,086,694 | 0 | n/a |
| PractitionerRole | 7,028,001 | 387,026 | n/a |

**No Location in the NDH carries an endpoint or a parent.** The must-support
element is present in the profile and empty in the data. The place layer, which
is the layer the patient actually experienced, is disconnected from the
connectivity layer.

Endpoint attribution, counting every reference path rather than only
`Endpoint.managingOrganization`:

| Path | FHIR REST endpoints reached |
| --- | ---: |
| `Endpoint.managingOrganization` | 19,334 |
| `Organization.endpoint` | 19,489 |
| `PractitionerRole.endpoint` | 12,663 |
| **Union of all three** | **19,491 of 114,071 (17.1%)** |

The paths overlap almost entirely. Adding the reverse directions moves H50's
16.9% to 17.1%, so the gap H50 reported is real and not an artefact of looking
down only one reference.

## What Epic publishes, and why it is the closest thing to the target

Epic ships a SMART User-access Brands bundle at `open.epic.com/Endpoints/Brands`.
Measured on the 2026-08-16 build:

- 96,190 Organizations and 815 Endpoints, `Bundle.timestamp` refreshed daily
- 1,259 top-level brands, each carrying the endpoint reference
- 94,931 child organizations reaching an endpoint by walking `partOf`
- **every one of the 96,190 carries a postal address**
- 560 carry an NPI

This is the shape the goal requires: many sites, one endpoint, an explicit roll-up.
Naming one endpoint names every site beneath it.

Two structural caveats that decide whether an implementation works at all:

1. Epic references bundle entries by `urn:uuid:`, not `Type/id`. A resolver that
   only understands `Type/id` returns **zero** matches and does not error. This
   already produced one wrong published claim about Epic in H47, and it silently
   broke the first run of H51.
2. Epic models care sites as **Organization** resources with addresses, not as
   **Location** resources. The NDH models places as Location. So the join is not
   like-for-like, and this is the single largest source of design risk below.

Other vendors publish flat HTI-1 service base URL lists: one endpoint per
practice, no hierarchy. Useful for naming, useless for roll-up.

## The gap in one sentence

The specification supports site-level connectivity, the vendors publish enough
to reconstruct most of it, and the federal directory currently carries neither
the site-to-endpoint link nor the owner of 83% of its endpoints.

## Measured baseline: how connected is a provider today?

The end goal is that searching a provider returns their NPI, locations, roles,
organization and a reachable endpoint. Measured on the 2026-05-08 release, the
chain breaks early and badly.

| Step | Practitioners | Share |
| --- | ---: | ---: |
| Active, with an NPI | 7,196,385 | 100% |
| Have any active PractitionerRole | 1,931,044 | 26.8% |
| Role names an organization | 1,931,044 | 100% of those |
| Organization resolves, and has an NPI | 1,931,044 | 100% of those |
| Role names a location | 1,791,382 | 92.8% of those |
| **Organization reaches a FHIR endpoint** | **85,619** | **1.2% of all** |

Two separate problems, and they need separate fixes.

**The role ceiling.** 73% of active practitioners have no active PractitionerRole
at all. With no role there is no organization, so no endpoint path exists at any
confidence. No amount of endpoint work fixes this, and it caps every org-routed
approach at 1,931,044 people. It should be reported as its own finding rather
than buried as a denominator.

**The endpoint gap.** Among practitioners who do have a role, the chain is
otherwise sound: organization resolves 100% of the time and carries an NPI 100%
of the time. Only the endpoint link is missing.

### What the vendor files add

Joining on NPI, where a vendor publishes one alongside the endpoint, is
deterministic rather than inferred:

| | Practitioners |
| --- | ---: |
| Endpoint-reachable today | 85,619 |
| Added by vendor-published NPI | +167,583 |
| **Combined** | **253,202** |

That is roughly a tripling, from 21,668 vendor-published organization NPIs
matching 34,901 NDH organizations. Against the honest denominator of
practitioners who have a role at all, coverage moves from 4.4% to 13.1%.

### Testing the claims-data route against the role gap

Prior art at b.well reached roughly 60-70% completeness across public sources,
partly by inferring provider-to-organization relationships from claims. That is
the obvious way through the 73% role gap, so it was tested rather than assumed.

CMS publishes the Doctors and Clinicians National Downloadable File, which is
exactly the right shape: one row per clinician, enrollment, group and address.
Loaded to `cms_npd.cms_dac_clinician_org`.

- 3,230,874 deduped clinician-org-address rows
- 1,622,454 distinct clinician NPIs
- 83,430 distinct organizations by PAC ID
- 99.4% carry a street address

It does not fill the gap.

| | Practitioners |
| --- | ---: |
| Active in the NDH | 7,196,385 |
| Have an NDH role | 1,931,044 |
| No NDH role | 5,265,341 |
| Present in CMS DAC | 1,617,305 |
| **No NDH role, but present in DAC** | **130,467** |

DAC closes **2.5%** of the role gap. Its 1.6M clinicians overlap almost entirely
with practitioners who already have a role, because both derive from Medicare
enrollment. Adding a second view of the same population does not extend coverage.

**This reframes the denominator, which matters more than the result.** Combining
both sources, 2,061,511 of 7,196,385 active NDH practitioners (28.6%) have any
organizational affiliation from any public source. The remaining 5.1M are
active NPIs with no role in the NDH and no Medicare enrollment record.

Before treating that 5.1M as a gap to close, someone has to establish what it
actually is. An NPI is issued once and effectively never retired, so the tail
plausibly contains retired clinicians, residents, administrative NPIs and people
who never billed Medicare. If most of it is not practising, then completeness
measured against 7.2M is measuring against a denominator that does not exist,
and any percentage quoted against it is misleading in both directions. That
question should be answered before any completeness claim is published.

## Confidence model

Every linkage carries a band, and the band is a statement about method, not a
feeling about quality.

**Green, deterministic.** The vendor publishes an NPI beside the endpoint and
that NPI matches an NDH organization exactly. No inference. Currently 167,583
practitioners. A green link that turns out wrong is a bug, and should be
treated as one.

**Yellow, corroborated.** No published NPI, but normalized organization name and
state agree, and the endpoint host matches the vendor that published the record.
Two independent signals. Publishable with a measured error rate from a hand-checked
sample, never without one.

**Red, single-signal.** Name similarity alone, or host-based vendor inference
alone. Useful for triage and for telling someone where to look. Not publishable
as a directory linkage, and never counted in a headline coverage number.

The bands must be reported separately everywhere. Collapsing them into one
coverage figure is the failure mode that makes a directory look complete while
being wrong in ways nobody can see.

## Scope

**Phase 1. Endpoint attribution (mostly done).** H50 measured the gap, H51
showed 71,857 of the 94,737 unattributed endpoints (76%) are nameable from
public vendor files, 30,366 of them straight to an NPI. Remaining work is
extending from 8 publishers to the 200+ Lantern catalogues.

**Phase 2. Vendor and EHR attribution per endpoint.** Derive the EHR from the
endpoint host, which is reliable because vendors host their tenants on their own
domains, and cross-check against the vendor file that published the URL. Output
is endpoint to vendor with a stated basis.

**Phase 3. Site resolution.** The hard part. Join Epic's 96,190 addressed
organizations, and the equivalents from other vendors, to NDH Locations and
Organizations by normalized address. Produce candidate site-to-endpoint links
with a confidence band. This is inference and must be labelled as such
everywhere it surfaces.

**Phase 4. Roll-up.** Reconstruct site to parent to endpoint using `partOf` where
a vendor publishes it and NDH `Organization.partOf` where it does not, so a query
at any level returns the right endpoint.

**Phase 5. Publish.** A crosswalk under `/api/v1`, plus a finding that quantifies
how much of the NDH's site layer can be connected from public data, framed as
feedback to the directory rather than a replacement for it.

## QA plan

Every check below either passes or blocks publication.

**Structural**

1. Reference resolution handles both `urn:uuid:` and `Type/id`. Test: a fixture
   bundle in each style resolves to the same crosswalk.
2. Hierarchy roll-ups are asserted against the source count. A rollup that
   exceeds the organization total is a double-count and fails the run. This
   caught a real error during H51, where an early pass reported 105,562 sites
   against a 96,190 total.
3. `partOf` walks are depth-capped and cycle-safe. Test: a bundle with a
   deliberate cycle terminates rather than recursing.

**Matching**

4. Exact and normalized match rates are reported separately, never merged. If
   normalization is doing the work, the reader must be able to see it.
5. A held-out sample of at least 200 site matches is verified by hand against
   the primary source, and the observed error rate is published with the
   crosswalk. No confidence band ships without a measured error rate behind it.
6. Negative controls: addresses that should not match, such as two clinics at
   the same street number in different states, are asserted not to.

**Data hygiene**

7. Vendor test data is filtered and the filter is reported. Practice Fusion
   publishes an organization named "Practice Fusion Test Test account" and an
   address line reading "Helloooo This is important". Anything unfiltered
   republishes that as fact.
8. Every published row carries provenance: source file, retrieval date and the
   `Bundle.timestamp` where one exists.

**Regression**

9. Cross-checks against already-published findings must reproduce. H51's fill
   rate and H50's attribution rate are recomputed on each run and a divergence
   fails loudly rather than quietly restating a new number.
10. Cost stays capped via `bq_job_config()`, and the published pages stay
    `force-static` with no runtime BigQuery, per the `/npi` cost contract.

## Test assumptions, stated so they can be attacked

These are the beliefs the design rests on. Each is either verified now, or
listed as an assumption that Phase 3 must test before anything is published.

**Verified**

- The NDH publishes no Location endpoints or Location hierarchy (measured: 0 of
  1,362,869 on both).
- Endpoint attribution is 17.1% across every reference path, not just the one
  H50 measured.
- Epic's bundle resolves 96,190 organizations to 764 endpoint URLs through
  `partOf`, and refreshes daily.
- 76% of unattributed endpoints are nameable from eight public vendor files.

**Assumed, and untested**

- That a vendor's published organization corresponds to a real care site rather
  than a billing or tenancy construct. Epic's 96,190 "organizations" may include
  administrative entries that no patient would recognise.
- That address normalization can join vendor organizations to NDH Locations at a
  useful rate. Suite and floor conventions differ, and the NDH's own address
  quality is unmeasured at the Location level.
- That endpoint host reliably implies EHR vendor. White-label and reseller
  arrangements would break this, and we have not looked for them.
- That one site maps to at most one FHIR endpoint. An organization running two
  EHRs across service lines would violate it, and that case is the entire reason
  the user raised this.
- That vendor files and the NDH describe the same point in time. The NDH release
  is pinned at 2026-05-08 and Epic's bundle rebuilt 2026-08-16, so sites opened
  or closed in between will disagree, and that disagreement will look like a
  matching failure.

## Questions I need answered before Phase 3

These change the build materially, so I would rather ask than guess.

1. **Granularity of the deliverable.** Is the target "site to endpoint", which
   requires inference the NDH cannot currently support, or "organization to
   endpoint", which is directly measurable today? The first is more useful and
   much less certain.

2. **Publication posture for inferred links.** Site matching will produce
   probable rather than certain links. Do we publish scored candidates with a
   measured error rate, or hold to exact matches only and report much lower
   coverage? This project's convention has been to publish only what survives
   checking, and Phase 3 cannot fully meet that bar.

3. **Geography.** Pennsylvania first, consistent with the existing rural health
   and payer crosswalk work, or national from the start? Epic's bundle is
   national and the cost difference is small, so the argument for PA-first is
   verification effort rather than compute.

4. **Audience and destination.** Is this a published dataset and finding, a
   feature on the site, or an input to the CMS directory community? The framing
   and the level of caveat differ substantially between the three.

5. **Scope of vendor coverage.** Eight publishers, or the full 200+ in Lantern?
   Eight covers most of the volume; the long tail is where smaller and rural
   practices sit, which matters given the existing rural health work.
