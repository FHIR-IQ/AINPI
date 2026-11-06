---
title: Health data networks page (use-case-first interoperability guide)
date: 2026-11-06
status: draft, awaiting Gene's approval
---

# Health data networks page

## Intent

ainpi.dev describes providers, organizations and endpoints. It does not describe the networks those records travel over. Most people who work with this data, and almost everyone learning it, cannot say how a record moves between an EHR, a payer, a state HIE and a TEFCA QHIN, or which of those routes fits the job in front of them.

This page is an education resource that answers one question: **"I need to do X; what routes exist for the data, and which of them operate in my state?"** It is organized by use case, not by network, because the reader arrives with a job, not with vocabulary.

Readers (Gene's words): provider data teams; anyone working in payer and provider data; interoperability and analytics teams; and anyone learning how to access US health data on behalf of patients, providers or community organizations. The second group sets the reading level: every term is defined on the page, and nothing assumes the reader knows what an HIE or a QHIN is.

It is not a finding. It carries no H number, is not pre-registered, and is not counted in the findings catalog.

## Goals

1. A reader picks a use case and sees every route the data can take for it, each described the same way.
2. A reader picks a state and sees which networks operate there, with a primary source and a last-checked date for each.
3. A newcomer can read the page top to bottom and come away knowing what an EHR vendor network, a state HIE, a multi-state network, a QHIN, a payer API and a Direct address are, and how they connect.
4. Where ainpi.dev already measures something relevant (endpoints, payer directories), the page links to it, so the network view and the provider-data view meet.
5. The underlying data is reusable: a public JSON file under the stable `/api/v1/` contract.

## Non-goals

- Ranking, scoring or recommending networks. Route cards state facts; the reader chooses.
- Claiming a network reaches every provider in a state. The page says a network operates there, not that coverage is complete.
- Measuring network performance, uptime or participation through any live query against a network.
- Covering every niche network at launch (registries, specialty networks, HIE sub-regions). The data model must allow them later.

## Anti-goals (would make this a failure even if it works)

- **Stale data presented as current.** HIE and QHIN lists change; CLAUDE.md already records that a QHIN count went stale silently on this site. Every entry carries a source and a last-checked date, and the page shows them.
- **Uncited claims.** No entry without a primary-source URL.
- **Counts in prose.** No "N QHINs" sentence anywhere in copy. A count may appear only as a figure computed from the data file at build time, next to its as-of date.
- **Endorsement or attribution.** Nothing implies a network, vendor, state agency or CMS reviewed, sponsored or endorsed the page. No state-agency attribution (standing rule).
- **Advice read as legal guidance.** Route cards name the rule a route runs under; they do not tell the reader they are permitted to use it. A one-line disclaimer says so.

## The page

Route: `/networks` (Gene's call by approval of the proposal; title "Health data networks"). Added to the main nav. Every page shows the WIP banner like the rest of the site.

Layout, top to bottom (use-case-first was chosen by Gene over map-first and flow-first):

1. **Use-case picker.** "I want to…" followed by the seven use cases below as selectable chips. One is selected by default (the first). Selection is reflected in the URL (`?use=<slug>`) so a reader can share a link to one use case.
2. **Routes panel (left on desktop, first on mobile).** One card per route that serves the selected use case. Each card answers, in the same order every time:
   - what the route is, in one plain sentence;
   - who can use it;
   - the rule or agreement it runs under (for example HIPAA treatment, CMS-9115-F, CMS-0057-F, the TEFCA Common Agreement);
   - the standard it uses (FHIR, Direct, IHE document query, HL7 v2 ADT and similar);
   - what it takes to join;
   - a link to ainpi.dev data where the site measures it;
   - source link and last-checked date.
3. **Map (right on desktop, second on mobile).** US map shaded by which routes for the selected use case operate in each state. Overlay toggles by network type: state HIE, multi-state network, QHIN, plus the other types where a use case uses them. Clicking a state opens a panel listing every network in that state (all types, not only the selected use case), with how to reach each, its source and its last-checked date.
4. **Glossary.** Plain-language definitions of HIE, QHIN, TEFCA, Direct, FHIR, IHE, ADT, NDH and endpoint.
5. **Sources and freshness.** Every source the data file cites, the oldest last-checked date on the page, and a link to the JSON.
6. **Disclaimer line.** Educational, not legal advice, not endorsement; verify with the network before relying on it.

### Starter use cases (agreed with Gene)

| Slug | Label |
| --- | --- |
| `treatment-records` | Get a patient's records for treatment |
| `individual-access` | Get my own records (as a patient) |
| `find-endpoint` | Find a provider's endpoint |
| `payer-exchange` | Exchange data with a payer (patient access, provider access, payer-to-payer, prior authorization) |
| `encounter-alerts` | Get admit and discharge alerts |
| `public-health` | Report to public health |
| `community-referral` | Refer someone to a community organization |

`find-endpoint` links to the endpoint findings (H28, H50, H51) and the PA connectivity ledger. `payer-exchange` links to H49 and, once published, H56.

## Network types

| Type key | Meaning |
| --- | --- |
| `state_hie` | An HIE operating within one state, including state-designated HIEs |
| `multi_state` | A network or compact operating across several states (CRISP's multi-state footprint is the example Gene gave) |
| `qhin` | A Qualified Health Information Network designated under TEFCA |
| `vendor_network` | A national exchange framework or network that EHRs connect to (Carequality, CommonWell, vendor-run exchange) |
| `payer_api` | A regulatory API program payers must offer (CMS-9115-F, CMS-0057-F) rather than a single organization |
| `direct` | Direct secure messaging through HISPs |

`payer_api` and `direct` are programs, not organizations. They are national, so they shade every state equally and the map should make that plain rather than imply local variation.

## Data

One curated file, committed in the repo, published at `/api/v1/networks.json` (new path in the stable contract; once published, its shape changes only by adding fields, and a breaking change moves to `/api/v2/`). A TypeScript type for it lives with the other contract types in `frontend/src/lib/api-v1-types.ts`.

Each network entry carries at minimum:

- `id` (stable slug), `name`, `type` (key above);
- `states` (two-letter codes, plus `national: true` for national programs);
- `use_cases` (slugs above) and, per use case, the route description fields listed under the routes panel;
- `how_to_join` (plain text) and `website`;
- `sources`: one or more `{url, title, accessed}`; at least one must be a primary source (the network itself, ASTP/ONC, CMS, a state agency or statute);
- `last_checked` (date).

Data is researched from primary sources: the ASTP/ONC list of designated QHINs, the Sequoia Project (TEFCA RCE) publications, each network's own site, state health agency pages and the federal rules themselves. Secondary directories (for example association member lists) may be used to find candidates but are not cited as the source of a fact unless nothing primary exists, in which case the entry says so.

**Launch coverage (Gene approved):** all 50 states plus DC at a basic level (which networks operate there, type, link, source). Pennsylvania gets full route detail for every use case first, because the PA connectivity ledger already measures that state's endpoint reach. Other states show "route detail pending" where only the basic level exists, matching the `/states` convention.

## Data model decisions (Claude's calls after the builder check)

- **Routes are defined once per use case, networks fill them in.** A route is a kind of path (for `treatment-records`: "your EHR vendor's network", "your state HIE", "TEFCA through a QHIN", "a Direct message"). The route card text (who can use it, rule, standard, how to join) lives on the route, once. Networks attach to routes. The card then lists the networks that carry that route for the reader's selected state, or the national ones. This stops national text repeating 51 times and keeps the JSON contract small. So the file has three top-level arrays: `use_cases`, `routes` (each with `use_case`, `network_types` and the card fields) and `networks`.
- **National networks appear once.** QHINs, vendor networks, `payer_api` and `direct` carry `national: true` and no state list. The state panel shows the state's own networks first, then a fixed "available in every state" section.
- **What the map shades.** Only the state-varying signal: for the selected use case, whether the state has a state HIE route, a multi-state network route, both, or neither. Four categories, each with its own pattern as well as colour, plus a legend line saying national routes apply everywhere. This needs a categorical map component beside `USChoroplethMap`, which is numeric.
- **Depth.** Basic level means the state's networks are listed (name, type, link, source) with no route-specific detail. PA full detail means every network operating in PA is mapped to the routes it carries, across all seven use cases, with route fields verified for PA.
- **Who researches.** Claude researches the entries from primary sources during the build. An entry with no primary source is left out, not published on a secondary source. The omission is recorded in the run doc.
- **Stale status.** Computed at build time from `last_checked` (stale after 180 days), so the data file stays the only source. The monthly link check only opens or appends one GitHub issue (the built-in token with `issues: write`, like `ndh-release-watch.yml`). It writes nothing to the repo.
- **Links to unpublished findings.** A route links to a finding only when `FINDINGS` marks it published. The H56 link appears by itself once H56 publishes.

## Freshness control

A script re-checks every source URL monthly with curl (never urllib, per the project rule). An entry whose `last_checked` is older than the threshold is marked stale on the page rather than silently shown as current; a dead source link opens an issue for a person to re-verify. This is the positive control for the page: a network that vanished must surface as stale, not as a plausible entry. The check runs in GitHub Actions on a schedule, opens or appends one issue when anything goes stale, and never edits the data file itself; a person re-verifies and updates the entry.

## Constraints

- Next.js 14 App Router page, `force-static`. No BigQuery, no paid API, no live calls to networks at request time.
- Use the site's design system (paper/ink/signal palette, serif/sans/mono trio, hairlines, 2-3px radii); no default Tailwind blue-gray, no drop shadows.
- Map ramps colorblind- and greyscale-safe. Categorical overlays must be distinguishable without color alone (pattern, label or legend position).
- D3 loaded via `next/dynamic` so it stays out of SSR, as the existing maps do.
- No competitors of AINPI named; networks and vendors are named only as the subject of a factual entry.
- No em dashes in copy. Copy goes through `slop_lint.py` and the copy-reviewer agent before publishing.
- Works at phone width.
- Dataset JSON-LD optional; if added, follow the Dataset markup rules in CLAUDE.md (description over 50 characters, non-NDH `isBasedOn`, sources in `SOURCE_CATALOG`).

## Decided by Gene

- Use-case-first page shape.
- The seven starter use cases.
- Route card fields as listed.
- Curated JSON under `/api/v1/` with source and last-checked per entry; monthly link check.
- Launch at a basic level for all 51 jurisdictions, full detail for PA first.
- No separate sign-off on the researched entries or use-case mappings. They ship once the gates pass: every entry cited to a primary source, `slop_lint.py` and the copy-reviewer agent on all copy, and the normal QA and `qa-approved` PR flow.

## Left to the builder

- Component structure, file names under `frontend/src/components/`, and whether to extend `USChoroplethMap` or write a categorical map beside it.
- The cron day.
- Default selected use case and default overlay.
- Glossary wording (subject to the copy gates).
- Whether the research of 51 jurisdictions is one task or split by region in the plan.
- The exact JSON field names, within the three-array shape above.
