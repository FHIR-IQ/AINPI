---
versions:
  - version: '0.7.2-draft'
    date: '2026-06-09'
    summary: 'H43 (practitioner phone-number reachability) pre-registered — resolves practitioner → phone across three FHIR paths (Practitioner.telecom, PractitionerRole.telecom, referenced Location.telecom) and reports the any-path union vs the on-record share. Compute script ships; live fill-rates land on the next weekly-refresh.'
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
