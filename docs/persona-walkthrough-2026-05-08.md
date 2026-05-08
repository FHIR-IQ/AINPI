# AINPI persona walkthrough — 2026-05-08

Captured during the post-NDH-refresh QA pass (PRs #53 + #54). Each persona walks the live site through the lens of their own job-to-be-done and surfaces what works, what's confusing, and what's missing. Numbers below were live as of 2026-05-08 21:30 UTC.

Pages exercised in the walkthrough:

`/` (homepage redirects to `/npd`), `/data-quality`, `/findings` (index), `/findings/pii-exposure-ndh`, `/findings/oig-leie-exclusions`, `/findings/duplicate-detection`, `/findings/network-adequacy-gauge`, `/findings/high-risk-cohort`, `/states/va`, `/briefings/va`, `/insights`, `/data-sources`, `/methodology`, `/provider-search` (UI + `POST /api/provider-search`), `/api/npd/search`, `/api/npd/data-quality`, `/api/npd/validation`, `/api/v1/stats.json`, `/reports/2026-05-08-update`.

---

## Persona 1 — CMS employee publishing the NDH bulk export

**Job:** ship a clean monthly bulk file; respond to public quality reports without surprise.

### What works

- **AINPI gives CMS its own external QA layer.** Every finding is a direct probe of a specific CMS-published artifact, with `analysis/h*.py` reproducible from a clean checkout. CMS staff can clone the repo, point it at a pre-publication candidate file, and see the SSN regex / NPI Luhn / dangling-ref counts before a release ships.
- **Schema-break detection.** Two source-side changes in the May release would have silently broken downstream consumers: NPI identifier system URL flipped to `http://terminology.hl7.org/NamingSystem/npi`, and `PractitionerRole.specialty` codes shifted to NUCC taxonomy. Both were caught by AINPI. CMS ought to flag these in release notes; today they ship as a surprise.
- **Privacy posture is responsible.** H27 publishes counts, JSON locations, NPIs, state breakdowns — but never republishes the SSN values. That tone makes it an asset to CMS rather than a liability.
- **Release-to-release deltas are the news.** The 2026-05-08 update report shows Endpoint −73%, Location −61%, OrgAffiliation +147%, total 27.2M → 21.7M. CMS should expect to be asked about that compositional shift on every monthly call.

### What's confusing

- **The OIG LEIE finding's denominator looks like an arithmetic error to a non-expert reader.** Headline says "9,006 of 8,551 actively-excluded LEIE NPIs (105.32%) appear in the 2026-05-08 NDH bulk export." 9,006 > 8,551 because a single LEIE-listed person can appear as both a Practitioner (8,008) and an Organization (998) resource, but the prose surfaces a >100% percent that needs explanation. Recommend adding an inline gloss: "(numerator counts NDH appearances; some excluded individuals appear twice — once as a Practitioner, once as an Organization)."
- **Endpoint URL validity is hidden behind a small KPI.** /data-quality reports "8.4% valid HTTP URLs · 114.1K of 1.4M" tucked next to the validation panel. That is one of the most damning numbers on the site — 91.6% of NDH endpoints don't carry a parseable HTTPS URL — and it deserves a dedicated finding row in the H1–H5 family.

### What CMS would still want

- **A pre-publication scan target.** Right now AINPI only ingests post-publication. Adding a `--candidate` flag to `analysis/fast_ingest_ndh.py` plus a `tests/pre-publication/` directory of regression assertions would let CMS run AINPI as a pre-flight before any public bulk release.
- **A PII regression bisect.** H27 dropped 46 → 41. If the next release goes back up, was it an old record that resurfaced or a new submission slipping through? A diff view of "newly-introduced exposures since last release" would tell CMS exactly which submission step regressed.

---

## Persona 2 — Industry vendor monetizing data + services

**Job:** sell directory cleanup, NPI enrichment, federal-screening, or reconciliation tooling. Needs proof the underlying federal feed has gaps to justify the SKU.

### What works

- **Every finding lands as a sales artifact.** "CMS shipped 41 SSNs in plaintext" + "1.4M Organization NPIs are duplicates" + "8.4% of endpoints have valid URLs" + "8,008 federally-excluded providers still active in NDH" — each is a one-line pitch supported by a citable number. The /findings index reads like a vendor brief built for them.
- **State slices map to procurement reality.** /states/va, /states/pa, /states/oh let a vendor show a state Medicaid agency exactly what's wrong in that state's slice today. The "verify a sample yourself" block on /states/va is an unusually convincing artifact — a row of NPIs each linked to the authoritative NPPES Registry, where the state can confirm the flag in one click.
- **Methodology version + commit SHA on every page.** /methodology v0.6.0-draft + commit SHA stamped on every finding gives vendors something defensible to cite ("AINPI v0.6.0-draft, commit f09c02d, run 2026-05-08") rather than a moving floor.
- **The Insights page lets a vendor demonstrate variance instantly.** Compare-any-organization tool ("UPMC: 891 NPD orgs vs 40 published, +2127% inflation") is a scripted demo a vendor can drive in under 60 seconds with a customer's organization name.

### What's confusing

- **No commercial-use note up front.** /data-sources says "Apache-2.0" in the footer and CITATION.cff exists, but a vendor wants explicit guidance: "OK to embed AINPI numbers in pitches; cite as ABC; don't redistribute the BigQuery dataset." A `/license` or `/use` page with the licensing/citation rules would close that loop.
- **The /downloads picker is hidden.** A vendor would benefit from a single PDF + the Virginia cohort CSV bundle to staple to a state-Medicaid pitch deck. /download exists but isn't surfaced from the homepage as a download CTA.

### What's missing

- **A per-state cohort dashboard, not just three states.** A vendor demoing in Texas / Florida / California / New York wants the same ten state slices that VA / PA / OH have today. The infrastructure (`analysis/state_findings.py <state>`) is generalized; only the seed list needs widening.
- **An RSS/email "what changed since last release" feed at the API level.** Subscribers get an email; programmatic consumers (vendor services, partners) need a JSON delta — `/api/v1/changelog.json`.

---

## Persona 3 — Provider/health-system roster manager

**Job:** keep the rostered-provider list accurate so claims pay and credentialing doesn't fail. Needs to know whether the federal directory says about their providers what their internal system says.

### What works

- **/insights compare-organization tool answers the question directly.** Type your hospital name, see NPD orgs / practitioners / locations / endpoints + variance vs your published numbers. For UPMC the headline is +2127% on org count — that's the duplicate problem the team has been fighting in claims rejections.
- **/findings/duplicate-detection is the single most actionable finding for this persona.** "70.6% of unique Org NPIs map to more than one Organization resource. Downstream consumers assuming one Organization = one real-world entity will be wrong roughly two of three times." That sentence is the rationale for a rostering project.
- **/findings/oig-leie-exclusions and /findings/sam-exclusions tell the persona which of their providers are flagged in federal exclusion databases right now.** Linked LEIE / SAM / NPPES portals means the rostering team can bring receipts to the credentialing committee.

### What's confusing

- **The compare-organization tool only takes a name, not an NPI.** Type "UPMC" returns 891 hits — fine for a demo but if the persona's CFO wants the variance number for a specific Tax ID / NPI, today they can't pin it.
- **State-scoped duplicates rate (40.80% for VA) is more useful than the national rate (13.55%) for a regional system, but the national rate is the one shown on the headline of /findings/duplicate-detection.** Worth surfacing the state column inline.

### What's missing

- **A "where is my system in NDH" landing page.** Health system teams would value `/orgs/<NPI>` showing how the federal directory describes one specific organization (resource list, duplicate count, location list, endpoint list, last-seen timestamp). Today that requires a hand-typed query in /provider-search or /insights.
- **Internal-roster reconciliation is the obvious next product surface.** Today AINPI lets you see how NDH describes your system; it doesn't help you upload your internal roster as a CSV and get back a per-NPI diff. That's the bridge between "audit" and "remediation."

---

## Persona 4 — Provider checking their own data

**Job:** "Does the federal directory have my name, license, address, and specialty right? Is anyone else listed as 'me'?"

### What works

- **/npd → "Check any NPI against the NPD" is an unambiguous CTA.** Hero text is one input field, NPI, big button. The right design for a provider who Googled their own NPI.
- **`GET /api/npd/search?npi=<10-digit>` returns a structured profile.** Family name, given name, gender, active flag, qualifications with NUCC code + display, and the new May `http://terminology.hl7.org/NamingSystem/npi` system URL surfaced. Test pull on NPI 1306378096 returned STILLER, AMY, MS, Developmental Therapist (222Q00000X) cleanly.
- **The site explicitly tells the provider what it does NOT know.** "addresses_json: null" / empty roles list is honest — the May NDH release shrank addresses, and AINPI surfaces that gap rather than hiding it. A provider seeing that knows where to escalate.

### What's confusing

- **The provider has no way to file a correction from the site.** AINPI is read-only by design, but a clear pointer ("To correct your NPI record, go to NPPES at https://nppes.cms.hhs.gov/") would help. Today the site assumes the visitor knows that NPPES is the correction pipe; that's a domain-expert assumption.
- **Two NPI identifier system URLs in production today (the `us-npi` legacy URL still used internally + the new `NamingSystem/npi` URL the May release uses).** A provider seeing both in the cross-source search payload may worry "is one of these wrong?"

### What's missing

- **A "claim this NPI" magic-link flow.** Right now the persona authenticates via JWT, but the workflow is engineered for a developer, not a clinician. The intended user — a provider — would benefit from "enter your NPI, we'll email a verification code to the address NPPES has on file."
- **A historical view per NPI: "your record on April 9 vs your record on May 8"** would close the loop for a provider who fixed something at NPPES recently.

---

## Persona 5 — Payer maintaining a CMS-9115-F provider directory API

**Job:** publish a compliant FHIR Provider Directory (CMS-9115-F / Da Vinci PDex Plan-Net) and avoid showing federally-excluded providers as in-network.

### What works

- **/findings/mco-exposure-va is the persona's nightmare scenario put on a public page.** "2 of 131 federally excluded VA-resident providers appear in at least one of 4 wired payer directories" — with the matched payer named. Cigna's directory team can pull this URL into a Slack thread today and triage 2 specific NPIs.
- **/findings/network-adequacy-gauge maps directly to MA adequacy regulation (42 CFR § 422.116).** L7 unauthenticated-read 90.3% (above 85% ceiling), L5 CapabilityStatement 85.4% (at), L6 SMART well-known 81.6% (below). A payer compliance team gets an empirical adequacy floor in three numbers.
- **Cross-source merged search side-by-sides 6 sources for a single NPI.** A payer data team validating "do all the upstream sources agree on this provider's name + address + specialty before we publish?" can drive that workflow today against ainpi.vercel.app/provider-search.

### What's confusing

- **NDH NPI returned `npi: null` in the cross-source search (now fixed in this PR).** The payer search API was string-matching on the legacy `us-npi` URL, so practitioners pulled from the May NDH had a null NPI in the merged-search response even though the NPI was present in the resource. **This was a real bug found during the persona walkthrough** — patched in `frontend/src/app/api/provider-search/route.ts:pickIdentifier`.
- **Endpoint validity is reported on /data-quality but doesn't surface as a finding URL.** Only 8.4% of NDH endpoints have valid HTTP URLs. That number is more important to a payer ops team than most of the existing findings, but it has no /findings/<slug> page.

### What's missing

- **A per-payer scoreboard.** "Here's how Cigna's directory holds up against H1-H5 endpoint liveness; here's Humana's; here's UHC's." The data is there in `crawler/` outputs; a /payers/<id> page would consolidate it.
- **An "exclusion-cohort sweep" API** — POST a list of NPIs, get back which AINPI-wired payer directories surface each one. Today H26 is hardcoded to the VA cohort; the same kernel run against a payer-supplied list would be the single most-purchased product on the site.

---

## Persona 6 — Startup / digital health enabling provider + endpoint search

**Job:** ship a "find a doctor" / "connect to my provider's EHR" feature on top of a clean, machine-readable, license-clean federal feed.

### What works

- **/api/v1/* contract.** Stable URLs, JSON with `release_date` + `methodology_version` + `commit_sha` + `headline` + `numerator` + `denominator` + `chart` + `notes`. The schema is in `frontend/src/lib/api-v1-types.ts`. A startup can build against this without touching BigQuery.
- **Provider search is multi-source.** /api/provider-search hits 6 backends (NDH BQ + NPPES + Humana + Cigna + UHC + Molina) and returns a normalized payload with per-source response times. A startup that wants a "search across all the official directories at once" feature gets this for free.
- **Apache-2.0 + Citation.cff + open BigQuery dataset structure** mean the legal posture is friendly. A startup can cite without a vendor contract.

### What's confusing

- **`api-v1-types.ts` is in the repo but not surfaced as a developer page.** A startup engineer gets to /api/v1/stats.json and there's no human-facing schema doc — they have to guess the shape or read the GitHub repo. A simple `/api/v1/openapi.json` or `/docs/api` page would 10× the integration speed.
- **Payer search latency is variable.** The NPI 1306378096 cross-source search took 2.5s with 1 of 6 sources slow. A startup on a SaaS bill needs predictable p99; today there's no SLA shown.

### What's missing

- **A /developer page collecting: API contract, rate limits, change log, code samples in 3 languages, NPM/PyPI client packages.** Today the /api/v1 surface exists, but the persona has to assemble its docs from the README + the source.
- **A FHIR Bulk Export of the AINPI-cleaned dataset.** Startups often want to download once and serve fast — today the path is "use BigQuery" or "scrape /api/v1/." A nightly Bulk Data export would close the loop.
- **An OAuth/API-key tier** so a paid startup can hit /api/provider-search without anonymous-rate caps.

---

## Persona 7 — OpenAI / Anthropic, integrating into MCP and Skill tools for end users

**Job:** give an AI assistant a trustworthy, citable, low-latency way to answer "look up Dr. Smith" or "is my provider real and active" inside ChatGPT or Claude.

### What works

- **Stable JSON contract + denominators + null-hypothesis + commit SHA.** This is the rare healthcare data surface where a model can return a provenance-rich answer (`source: AINPI`, `methodology_version: 0.6.0-draft`, `commit_sha: f09c02d`, `release_date: 2026-05-08`) without confabulating. Ideal for grounding.
- **Cross-source search returns per-source attribution.** A model can say: "NDH says X, NPPES says Y, Humana says Z" and surface the disagreement to the user, instead of collapsing them into a single fabricated answer.
- **Findings are pre-registered.** The H1–H27 framing maps cleanly to a discoverable knowledge graph: each finding is a stable URL, with hypothesis IDs, denominators, audience implications, and notes. A model fine-tuned on this style can answer follow-ups (`what's the null hypothesis for H27?`) deterministically.
- **The data-sources page is exactly the kind of metadata document an AI lab wants.** Each upstream source has license, refresh cadence, and an `ainpiStatus` (`ingested` / `out-of-scope` / `considered-rejected`). It is a prompt-engineerable manifest of what the system knows and doesn't.

### What's confusing

- **No MCP server exists yet.** /provider-search is a website + REST endpoint; integrating with ChatGPT or Claude today requires a custom MCP wrapper. The README mentions plans; the site does not advertise an MCP endpoint.
- **The /api/v1 contract shape is FHIR-flavored but not strict FHIR.** A model trained on FHIR schemas may try to call `/Practitioner?identifier=NPI|<value>` instead of `/api/npd/search?npi=<value>`. Worth documenting the mapping explicitly so an LLM tool-use can choose the right endpoint.

### What's missing

- **An MCP server with tools: `lookup_npi(npi)`, `search_providers(family, given, state)`, `cross_source_search(npi)`, `find_payer_directory(insurance_plan)`, `get_finding(slug)`.** All five exist as REST or SQL queries today; wrapping them as an MCP server is the unlock for AI labs.
- **A LICENSE-of-use note specifically for AI training and inference.** Apache-2.0 covers code, but a developer wanting to ship the AINPI numbers inside a Claude Skill or ChatGPT Action wants a single sentence: "Inference-time citation OK, redistribution of the bulk dataset OK with attribution."
- **Robots.txt / AI-bot policy.** Surface what's safe to crawl for retrieval-augmented generation. Today the site is silent on the question.

---

## Cross-persona observations + bugs found during the walkthrough

Captured + fixed during this pass:

1. **Stale "4 of 125 in Cigna" string in `LatestUpdates.tsx`.** Fixed — now says "2 of 131 in Cigna" plus a new May 8 update entry above it.
2. **Stale "all 46" / "46 AINPI flagged" prose in H27 implications (`findings.ts`).** Fixed — now reads as a delta vs the May number.
3. **`docs/methodology/index.md` status banner referenced 2026-04-09 + 46 confirmed exposures.** Fixed — banner now describes both releases with their respective numbers.
4. **VA briefing markdown (`docs/briefings/2026-05-04-virginia-state-medicaid.md`) was completely April-pinned** — practitioner counts, cohort size, Cigna match list. Fixed — every number is now keyed to May 2026-05-08, with April retained inline as a baseline.
5. **`/api/provider-search` `pickIdentifier()` lost NPIs from the May NDH release** because the matcher was string-matching on legacy `http://hl7.org/fhir/sid/us-npi`. Fixed — now matches both URLs and the `type.coding[].code = "NPI"` fallback.

Recommendations not yet acted on (filed as backlog):

- **Add `/findings/endpoint-url-validity`** as a first-class finding (currently buried inside /data-quality KPIs).
- **Re-word H24 headline** to gloss the >100% percentage (`9,006 of 8,551`).
- **Generalize state slices** beyond VA / PA / OH; the script already supports any state code.
- **Publish an MCP server** with the five tools above for AI-lab integration.
- **Add `/developer` and `/license-for-use` pages** so vendors, startups, and AI labs find their answers without spelunking the repo.
- **Per-payer scoreboard** at `/payers/<id>` for payer ops teams.

---

## Test artifacts

- `frontend/e2e/accuracy-2026-05-08.spec.ts` — 24 Playwright assertions covering /api/v1/* JSON contract, state slices, live BQ-backed routes, and page chrome. **24/24 pass on production** as of this commit.
- `frontend/playwright.prod.config.ts` — config for running the spec against ainpi.vercel.app without booting the local dev server.

Run with:

```bash
cd frontend
PLAYWRIGHT_BASE_URL="https://ainpi.vercel.app" \
  npx playwright test --config=playwright.prod.config.ts accuracy-2026-05-08.spec.ts
```
