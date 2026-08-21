---
versions:
  - version: '0.7.2-draft'
    date: '2026-06-09'
    summary: 'H43 (practitioner phone-number reachability) published — resolves practitioner → phone across three FHIR paths (Practitioner.telecom, PractitionerRole.telecom, referenced Location.telecom). Result rejected the pre-registered prior: 99.98% of active practitioners carry a phone directly on the Practitioner record; the traversal adds nothing.'
  - version: '0.7.1-draft'
    date: '2026-06-05'
    summary: 'Provider data landscape (Karpathy-style treemap, 548 cells, 6 audit dimensions) becomes the homepage at /; choropleth moves to /map. REAL Health Providers Act audit framework published at /real-health-providers. Endpoint-liveness denominator clarification (host-level not practitioner-level).'
  - version: '0.7.0-draft'
    date: '2026-05-18'
    summary: 'PECOS-as-authoritative workstream (H37-H39) shipped; all-states claims-side cross-audit (H29-H36) covers 50 states + DC + PR; map-first homepage and CMO-facing per-state surface.'
  - version: '0.6.1-draft'
    date: '2026-05-14'
    summary: 'Strict post-exclusion attribution propagated through H29 / H30a / H30b / H32; H35 Stage B PPEF cross-walk fixed the structural null.'
  - version: '0.6.0-draft'
    date: '2026-05-08'
    summary: 'May NDH release ingested; first release-to-release deltas published.'
---

# Methodology version log

This file maps each historical methodology version to a release date and a one-line summary. The findings hub at `/findings` reads the frontmatter to surface methodology bumps as entries in the unified timeline.

Each entry is a contract: the corresponding `docs/methodology/index.md` content reflects that version's state at the date listed. Bump the top entry whenever `docs/methodology/index.md`'s `version` frontmatter changes.

---
version: 0.7.3-draft
date: 2026-08-21
summary: >-
  Re-baselined every published finding against the 2026-08-20 NDH release, and
  hardened three checks that had been failing to zero without erroring.
changes:
  - Reloaded the warehouse from the 2026-08-20 bulk export and re-ran every
    BigQuery-derived finding. Twelve findings had been sitting at 2026-05-08
    while the tables underneath them held August data.
  - Introduced analysis/release.py and frontend/src/lib/release.ts as the
    single source of the pinned release. Fourteen scripts and six site
    surfaces had the date as a literal.
  - H10-H13, corrected. The provider-taxonomy code system URL moved to
    http://hl7.org/fhir/us/ndh/ValueSet/HealthcareIndividualTaxonomyVS, a
    ValueSet canonical in a field FHIR defines as a CodeSystem canonical, and
    PractitionerRole.specialty moved from CMS Medicare specialty codes to NUCC
    taxonomy codes. Matching the old literals reported 0% specialty validity.
    Corrected, both fields validate above 99.8% and agree with each other on
    5,275,554 of 5,275,635 Practitioner-to-Role pairs, against 9.1% when the
    comparison had to cross code systems through the Medicare crosswalk.
  - H14/H15 decomposed by record type. 72.6% of the organization NPI
    multiplicity is one provider record paired with one ein tax record under
    the same NPI. Thirteen of 2,202,028 org NPIs are duplicated with no ein
    row involved.
  - H23 high-risk cohort now refuses to score not_in_nppes while the NPPES
    reference snapshot predates the release. The snapshot stops at 2026-02-07;
    scoring it put 245,374 NPIs in the high bucket, and eight sampled at
    random were all active providers enumerated after the snapshot. Those rows
    are bucketed needs-review.
  - State slices draw their verification samples from the OIG LEIE rather than
    from NPPES absence, for the same reason. All 51 regenerated.
  - H27 reports zero SSN exposures with a positive control, having confirmed
    the qualification array the exposures sat in is still present and still
    read. 46 (2026-04-09), 41 (2026-05-08), 0 (2026-08-20).
  - H51 switched from urllib to curl after every vendor download failed on TLS
    and the script published a 0% attribution finding, and now refuses to
    publish when it fetched nothing. It also counts resolvable references
    rather than present ones, so it and H50 agree on 94,711.
  - stats.json gained a generator (analysis/build_stats.py). It had drifted to
    claiming 21,693,735 resources, 12 published findings and methodology
    0.6.0-draft.
  - Byte caps added to five scripts that queried BigQuery uncapped, including
    the 51-state pass.
