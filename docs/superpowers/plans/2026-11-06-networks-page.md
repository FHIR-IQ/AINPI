# Health Data Networks Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `/networks`, a use-case-first guide to US health data networks (state HIEs, multi-state networks, QHINs, vendor networks, payer API programs, Direct), backed by a curated, cited `/api/v1/networks.json`.

**Architecture:** One committed JSON file is the only data source, held to a JSON Schema plus invariants in `analysis/validate_contract.py`. Pure TypeScript helpers in `frontend/src/lib/networks.ts` derive everything the page shows (routes per use case, map category per state, staleness) at build time; the page is `force-static`. A monthly GitHub Action re-checks every source URL with curl and opens one issue; it never writes to the repo.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, Tailwind (site tokens), D3 + topojson-client via `next/dynamic`, Vitest, Playwright, Python 3.12 stdlib + `jsonschema` (already used by `validate_contract.py`), pytest.

**Spec:** `docs/superpowers/specs/2026-11-06-networks-interop-design.md`

## Global Constraints

- Route `/networks`, title "Health data networks", `export const dynamic = 'force-static'`, WIP banner like every page.
- No BigQuery, no paid API, no live calls to any network at request or build time.
- Use the design system in `frontend/tailwind.config.ts` / `globals.css` (paper `#faf8f5`, ink `#171310`, signal `#a8321c`, `primary.600` `#08519c`, serif/sans/mono, hairlines, 2-3px radii). No default Tailwind blue-gray, no `rounded-lg`, no drop shadows.
- Map categories distinguishable without colour (pattern + legend); ramps colorblind- and greyscale-safe. D3 loaded with `next/dynamic`.
- Topology from `https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json`, as `USChoroplethMap.tsx` already does.
- No competitors of AINPI named; no state-agency attribution; no endorsement language; no em dashes in any copy.
- No counts in prose. A count may only be computed from the data file at build time and shown beside its as-of date.
- Every network and every route has at least one source with `primary: true`. An entry with no primary source is omitted and the omission recorded in the run doc.
- Stale = `last_checked` more than 180 days before the build date.
- Probing uses curl via `subprocess`, never urllib.
- Seven use-case slugs, exactly: `treatment-records`, `individual-access`, `find-endpoint`, `payer-exchange`, `encounter-alerts`, `public-health`, `community-referral`.
- Six network types, exactly: `state_hie`, `multi_state`, `qhin`, `vendor_network`, `payer_api`, `direct`.
- Jurisdictions: the 50 states plus `DC`. Territories render as out of scope on the map.
- Disclaimer line on the page: educational, not legal advice, not endorsement; verify with the network before relying on it.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Plan-level rulings (not in the spec)

- **Basic-level networks and the map.** A `detail_level: 'basic'` network has no route list, so it cannot say which use cases it serves. For map shading it counts toward any route whose `network_types` includes its type, and the state's cell is marked `verified: false`. The map draws unverified cells with a lighter pattern and the legend says "network operates here; use-case detail pending". A `full` network counts only through its explicit `routes`. Cost if wrong: the map overstates a basic state's coverage for one use case, mitigated by the pattern and legend.
- **No Dataset JSON-LD at launch.** The spec makes it optional; it would need a `SOURCE_CATALOG` entry per network. Add later if Search Console coverage matters.
- **AINPI links** are `{label, href}` or `{label, finding_slug}`. A `finding_slug` link renders only when `FINDINGS` marks that slug `published`.

## Review Focus

1. **A shared link with a bad `?use=` value** (typo, old slug, empty) should open the default use case, not crash or render empty. Test in Task 4.
2. **A state with no state-specific network found** should show the national section and the sentence "No state or multi-state network found in our sources for this state", not a blank panel. Test in Task 2 (`networksInState`) and Task 4.
3. **The 180-day boundary**: exactly 180 days old is not stale, 181 is. Test in Task 2.
4. **A network that operates in a state but serves a different use case** must not shade that state for the selected use case. Test in Task 2 (`stateCategory`).
5. **The link checker on a broken runner network**: if every URL comes back unreachable, the job fails instead of filing an issue that calls every source dead; 401/403/429 is "blocked, check by hand", not dead. Test in Task 5.

---

### Task 1: Data contract, schema, invariants and loader

**Files:**
- Modify: `frontend/src/lib/api-v1-types.ts` (append types)
- Modify: `frontend/src/lib/load-api-v1.ts` (add loader)
- Modify: `analysis/contract_schemas.py` (add `NETWORKS_SCHEMA`, register as `"networks"`)
- Modify: `analysis/validate_contract.py` (schema check + `check_networks`)
- Create: `frontend/public/api/v1/networks.json` (skeleton: seven use cases, no routes or networks yet)
- Test: `analysis/tests/test_networks_contract.py`, `frontend/tests/lib/load-networks.test.ts`

**Interfaces:**
- Produces (TS, `api-v1-types.ts`):
  ```ts
  export type NetworkType = 'state_hie' | 'multi_state' | 'qhin' | 'vendor_network' | 'payer_api' | 'direct';
  export type UseCaseSlug = 'treatment-records' | 'individual-access' | 'find-endpoint' | 'payer-exchange' | 'encounter-alerts' | 'public-health' | 'community-referral';
  export interface NetworkSource { url: string; title: string; accessed: string; primary: boolean }
  export interface AinpiLink { label: string; href?: string; finding_slug?: string }
  export interface NetworkUseCase { slug: UseCaseSlug; label: string; summary: string; ainpi_links: AinpiLink[] }
  export interface NetworkRoute { id: string; use_case: UseCaseSlug; title: string; summary: string; who_can_use: string; rule: string; standard: string; how_to_join: string; network_types: NetworkType[]; sources: NetworkSource[]; ainpi_links: AinpiLink[] }
  export interface Network { id: string; name: string; type: NetworkType; national: boolean; states: string[]; detail_level: 'basic' | 'full'; routes: string[]; website: string; how_to_join: string; sources: NetworkSource[]; last_checked: string }
  export interface NetworksPayload { schema_version: 1; generated_at: string; use_cases: NetworkUseCase[]; routes: NetworkRoute[]; networks: Network[]; glossary: { term: string; definition: string }[] }
  ```
- Produces: `loadNetworks(): NetworksPayload | null` in `load-api-v1.ts`, same pattern as `loadStats()`.
- Produces (Python, `validate_contract.py`): `check_networks(payload: dict) -> list[str]` returning one error string per violated invariant.

- [ ] **Step 1: Write failing pytest cases** in `analysis/tests/test_networks_contract.py`, building payloads in-test (no file I/O). One valid minimal payload returns `[]`; each of these returns a non-empty list naming the offending id:
  - `test_network_without_primary_source` (sources all `primary: false`)
  - `test_route_without_primary_source`
  - `test_unknown_route_reference` (network.routes names a missing route id)
  - `test_route_type_mismatch` (a `state_hie` network attached to a route whose `network_types` lacks `state_hie`)
  - `test_national_with_states` and `test_local_without_states`
  - `test_state_code_outside_51` (`"PR"`)
  - `test_last_checked_in_future` and `test_last_checked_not_iso`
  - `test_duplicate_ids` (two networks with one id)
  - `test_use_cases_not_exactly_seven` (missing `community-referral`)
  - `test_basic_network_with_routes` (basic must have `routes == []`)
  - `test_count_in_prose` (any route/use-case/glossary string matching `\b\d+\s+(QHINs?|HIEs?|networks?)\b` is an error)
  - `test_em_dash_in_prose` (any string containing `—`)
- [ ] **Step 2: Run** `python3 -m pytest analysis/tests/test_networks_contract.py -q`. Expected: FAIL, `check_networks` not defined.
- [ ] **Step 3: Implement `check_networks`** and `NETWORKS_SCHEMA` (draft 2020-12, `$id` `https://ainpi.dev/api/v1/schemas/networks.schema.json`, `required: ["schema_version","generated_at","use_cases","routes","networks","glossary"]`, enums for the two type unions). Wire `check(API / "networks.json", "networks")` beside the `source-changes` check and call `check_networks` on it, reporting each string through `rep.error`. Run `python3 analysis/validate_contract.py --write-schemas` so `networks.schema.json` is published.
- [ ] **Step 4: Write the skeleton `networks.json`**: the seven use cases with the labels from the spec table, a one-sentence `summary` each, `ainpi_links` for `find-endpoint` (`/findings/endpoint-url-validity`, `/findings/endpoint-org-linkage`, `/findings/vendor-endpoint-attribution` as `finding_slug`s, `/states/pa/connectivity` as `href`) and `payer-exchange` (`ndh-payer-endpoints`, `payer-seed-coverage` as `finding_slug`s); empty `routes`, `networks`; glossary entries for HIE, QHIN, TEFCA, Direct, FHIR, IHE, ADT, NDH, endpoint.
- [ ] **Step 5: Write `frontend/tests/lib/load-networks.test.ts`**: `loadNetworks()` returns a payload whose `use_cases.map(u => u.slug)` equals the seven slugs in spec order.
- [ ] **Step 6: Run** `python3 -m pytest analysis/tests/test_networks_contract.py -q && python3 analysis/validate_contract.py && cd frontend && npx vitest run tests/lib/load-networks.test.ts`. Expected: all pass, validator exit 0.
- [ ] **Step 7: Commit** "networks: data contract, schema and invariants".

### Task 2: Derivation helpers

**Files:**
- Create: `frontend/src/lib/networks.ts`
- Test: `frontend/tests/lib/networks.test.ts`

**Interfaces:**
- Consumes: types and `loadNetworks` from Task 1; `FINDINGS` from `frontend/src/data/findings.ts`.
- Produces:
  ```ts
  export const JURISDICTIONS: readonly string[]            // 50 states + 'DC', sorted
  export const DEFAULT_USE_CASE: UseCaseSlug                // 'treatment-records'
  export const STALE_AFTER_DAYS = 180
  export type StateCategory = 'none' | 'state_hie' | 'multi_state' | 'both'
  export function parseUseCase(raw: string | string[] | undefined): UseCaseSlug
  export function isStale(lastChecked: string, asOf: Date): boolean
  export function routesFor(p: NetworksPayload, useCase: UseCaseSlug): NetworkRoute[]
  export function networksForRoute(p: NetworksPayload, routeId: string, state: string | null): Network[]
  export interface Overlays { state_hie: boolean; multi_state: boolean }
  export function stateCategory(p: NetworksPayload, useCase: UseCaseSlug, state: string, overlays?: Overlays): { category: StateCategory; verified: boolean }   // overlays default both true
  export function networksInState(p: NetworksPayload, state: string): { local: Network[]; national: Network[] }
  export function resolveAinpiLink(link: AinpiLink): { label: string; href: string } | null
  export function oldestCheck(p: NetworksPayload): string | null
  ```

- [ ] **Step 1: Write failing tests** with an in-test fixture payload (two routes for `treatment-records`, one for `public-health`; a full PA state HIE attached only to the public-health route; a basic NJ state HIE; a multi-state network in MD and DC attached to the treatment route; a national QHIN):
  - `parseUseCase('public-health') === 'public-health'`; `parseUseCase('bogus')`, `parseUseCase(undefined)`, `parseUseCase('')`, `parseUseCase(['a','b'])` all `=== 'treatment-records'`.
  - `isStale('2026-05-10', new Date('2026-11-06'))` false (180 days); `isStale('2026-05-09', new Date('2026-11-06'))` true (181).
  - `stateCategory(p,'treatment-records','PA')` → `{category:'none', verified:true}` (PA's HIE serves public health only).
  - `stateCategory(p,'public-health','PA')` → `{category:'state_hie', verified:true}`.
  - `stateCategory(p,'treatment-records','NJ')` → `{category:'state_hie', verified:false}` (basic).
  - `stateCategory(p,'treatment-records','MD')` → `{category:'multi_state', verified:true}`.
  - National networks never change `stateCategory`.
  - With a fixture state holding both types, `stateCategory(..., {state_hie:false, multi_state:true})` → `multi_state`; both overlays off → `none`.
  - `networksInState(p,'WY')` → `{local: [], national: [qhin]}`.
  - `networksForRoute(p, treatmentRouteId, 'MD')` contains the multi-state network and the QHIN when the QHIN is attached; `networksForRoute(p, id, null)` returns national ones only.
  - `resolveAinpiLink({label:'x', finding_slug:'<a published slug from FINDINGS>'})` returns `{href:'/findings/<slug>'}`; with `'payer-seed-coverage'` (unpublished on main) returns `null`; `{label, href:'/states/pa/connectivity'}` passes through.
  - `JURISDICTIONS.length === 51` and includes `'DC'`, excludes `'PR'`.
- [ ] **Step 2: Run** `cd frontend && npx vitest run tests/lib/networks.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** per the signatures and the basic-level ruling above. Day arithmetic in UTC on `YYYY-MM-DD`; stale when `> STALE_AFTER_DAYS`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** "networks: derivation helpers".

### Task 3: Categorical state map

**Files:**
- Create: `frontend/src/components/charts/NetworkStateMap.tsx`
- Create: `frontend/src/components/charts/network-map-style.ts`
- Test: `frontend/tests/components/network-map-style.test.ts`

**Interfaces:**
- Consumes: `StateCategory`, `JURISDICTIONS` from Task 2.
- Produces:
  ```ts
  // network-map-style.ts
  export interface CellStyle { fill: string; patternId: string | null; label: string }
  export function cellStyle(code: string, cell: { category: StateCategory; verified: boolean } | undefined): CellStyle
  export const LEGEND: { key: string; label: string; style: CellStyle }[]
  // NetworkStateMap.tsx (default export)
  export interface NetworkStateMapProps { cells: Record<string, { category: StateCategory; verified: boolean }>; selectedState: string | null; onStateClick: (code: string) => void; title: string }
  ```

- [ ] **Step 1: Write failing tests** for `cellStyle`: the four categories return four distinct `patternId`s (`none` may be `null`) and four distinct fills; `verified:false` returns a different `patternId` from the verified style of the same category; a code outside `JURISDICTIONS` (`'PR'`) returns the out-of-scope style whose `label` is `"Not covered"`; every fill passes a greyscale check (luminance of the four category fills pairwise differs by at least 0.08). `LEGEND` has an entry whose label is exactly "Network operates here; use-case detail pending" and one stating national routes apply everywhere.
- [ ] **Step 2: Run** `cd frontend && npx vitest run tests/components/network-map-style.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `network-map-style.ts` from site tokens (paper, ink tints, `primary.600`, a warm second hue; no red-green pairing), with SVG pattern definitions exported as data so the component renders `<defs>` from them. Implement `NetworkStateMap.tsx` by adapting the fetch, projection and FIPS table from `USChoroplethMap.tsx` (copy the FIPS map into `network-map-style.ts` rather than importing a non-exported constant); keyboard-focusable state paths with `aria-label` "<State>: <label>"; stroke widths fixed; legend below the map.
- [ ] **Step 4: Run** the test again and `npx tsc --noEmit -p .`. Expected: PASS, no type errors.
- [ ] **Step 5: Commit** "networks: categorical state map".

### Task 4: The `/networks` page

**Files:**
- Create: `frontend/src/app/networks/page.tsx` (server component)
- Create: `frontend/src/app/networks/networks-client.tsx` (client: picker, routes panel, map, state panel)
- Modify: `frontend/src/components/Navbar.tsx` (add `{ href: '/networks', label: 'Networks' }` after Explore, lucide `Network` icon)
- Modify: `frontend/src/components/Footer.tsx` (link beside Primer)
- Modify: `frontend/src/app/sitemap.ts` (add `/networks`, priority 0.8)
- Modify: `analysis/build_manifest.py` (add `{"path": "/api/v1/networks.json", "summary": "Health data networks, routes by use case, sources"}` to the paths list)
- Test: `frontend/tests/app/networks-page.test.tsx`, `frontend/e2e/networks.spec.ts`

**Interfaces:**
- Consumes: `loadNetworks` (Task 1), every Task 2 helper, `NetworkStateMap` (Task 3, via `next/dynamic` with `ssr:false`).
- Page reads `searchParams.use` only on the client (`useSearchParams`), so the route stays `force-static`; the server passes the whole payload and the build date (`new Date().toISOString().slice(0,10)`) as props.

- [ ] **Step 1: Write failing component tests** (Vitest + Testing Library, render the client with a fixture payload):
  - With no `use` param the `treatment-records` chip has `aria-pressed="true"`; with `?use=bogus` the same.
  - Clicking `public-health` updates the URL to `?use=public-health` (router `replace`, no scroll) and the routes panel lists only that use case's routes.
  - Each route card shows, in order, headings "Who can use it", "Rule", "Standard", "How to join", then sources with accessed date.
  - Two overlay toggles, "State HIE" and "Multi-state network", both on by default; turning one off re-shades the map through `stateCategory`'s `overlays` argument.
  - Selecting `WY` in the fixture (no local networks) shows "No state or multi-state network found in our sources for this state" and the national list.
  - A network with `last_checked` older than 180 days relative to the build date shows a "Needs re-check" badge.
  - An unpublished `finding_slug` link is absent from the DOM.
  - The disclaimer line is present: "Educational resource, not legal advice and not an endorsement. Confirm details with the network before relying on them."
  - No text node contains `—`.
- [ ] **Step 2: Run** `cd frontend && npx vitest run tests/app/networks-page.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the page in this order: `metadata` (title "Health data networks", description over 50 characters, OG url `https://ainpi.dev/networks`), `Navbar`, WIP banner, eyebrow + h1 + one-paragraph lede, use-case chips, two-column grid (routes left, map right; stacked below `md`), state panel opening under the map on click (local networks, then "Available in every state"), glossary, "Sources and freshness" (every distinct source URL, `oldestCheck`, link to `/api/v1/networks.json`), disclaimer. Wrap the client in `<Suspense>` as Next 14 requires for `useSearchParams` in a static page.
- [ ] **Step 4: Write `frontend/e2e/networks.spec.ts`**: page loads, chip click changes URL, map SVG renders at least 51 state paths, clicking PA opens a panel with heading "Pennsylvania", viewport 375px has no horizontal scroll (`document.documentElement.scrollWidth <= 375`).
- [ ] **Step 5: Run** `npx vitest run tests/app/networks-page.test.tsx && npm run lint && npx playwright test e2e/networks.spec.ts && python3 ../analysis/build_manifest.py && python3 ../analysis/validate_contract.py`. Expected: all pass.
- [ ] **Step 6: Commit** "networks: /networks page, nav, sitemap, manifest".

### Task 5: Monthly source link check

**Files:**
- Create: `analysis/networks_link_check.py`
- Create: `.github/workflows/networks-link-check.yml`
- Test: `analysis/tests/test_networks_link_check.py`

**Interfaces:**
- Produces:
  ```python
  def classify(http_status: int | None, curl_exit: int) -> str      # 'ok' | 'blocked' | 'dead' | 'unreachable'
  def check_url(url: str, timeout: int = 20) -> tuple[str, int | None]   # curl -sS -L -o /dev/null -w '%{http_code}' -A 'AINPI-link-check'
  def build_report(payload: dict, results: dict[str, tuple[str, int | None]], as_of: date) -> tuple[bool, str]   # (needs_attention, markdown issue body)
  def main(argv: list[str] | None = None) -> int
  ```
  CLI: `python3 analysis/networks_link_check.py --issue-body-file PATH`; writes `needs_attention=true|false` to `$GITHUB_OUTPUT` when set.

- [ ] **Step 1: Write failing tests**: `classify(200,0)=='ok'`, `classify(301,0)=='ok'`, `classify(403,0)=='blocked'`, `classify(401,0)=='blocked'`, `classify(429,0)=='blocked'`, `classify(404,0)=='dead'`, `classify(410,0)=='dead'`, `classify(503,0)=='dead'`, `classify(None,28)=='unreachable'`, `classify(0,6)=='unreachable'`. `build_report` with one dead URL returns `(True, body)` where body names the network id and URL; with one network whose `last_checked` is 181 days old returns `(True, ...)` naming it as stale; with only `blocked` results returns `(True, ...)` listing them under "Check by hand"; all ok returns `(False, ...)`. `main` with `check_url` monkeypatched to return `unreachable` for every URL exits 1 and writes no issue body file.
- [ ] **Step 2: Run** `python3 -m pytest analysis/tests/test_networks_link_check.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement**, deduplicating URLs before checking, 4 concurrent curls at most, stdlib only.
- [ ] **Step 4: Write the workflow** by copying the shape of `ndh-release-watch.yml`: `on: schedule: cron "37 10 3 * *"` + `workflow_dispatch`; `permissions: contents: read, issues: write`; check step; issue step only when `needs_attention == 'true'`, title `Network sources need re-verification YYYY-MM`, skipped if an open issue already has that title (same `gh issue list --search` guard as the release watch). No commits, no other side effects.
- [ ] **Step 5: Run** the tests and `python3 analysis/networks_link_check.py --issue-body-file /tmp/x.md` against the skeleton (no URLs yet: exits 0, `needs_attention=false`; with zero URLs the all-unreachable rule must not fire). Add a test for that zero-URL case first.
- [ ] **Step 6: Commit** "networks: monthly source link check".

### Task 6: Research national routes and networks

**Files:**
- Modify: `frontend/public/api/v1/networks.json`
- Create: `docs/methodology/runs/2026-11-06-networks-research.md`

Research from primary sources only (Global Constraints). Fill:
- **Routes** for all seven use cases. Starting set per use case (adjust only with a source): `treatment-records`: vendor network / framework, state HIE, TEFCA via a QHIN, Direct message. `individual-access`: provider patient-access API (ONC certification criterion 170.315(g)(10)), payer Patient Access API (CMS-9115-F), TEFCA Individual Access Services. `find-endpoint`: the NDH (CMS National Provider Directory), EHR vendor endpoint lists, payer provider-directory APIs, Direct address directories. `payer-exchange`: Patient Access, Provider Access, Payer-to-Payer and Prior Authorization APIs (CMS-0057-F; state the compliance dates from the rule text). `encounter-alerts`: state HIE event notification, Medicare Conditions of Participation e-notification (CMS-9115-F). `public-health`: state HIE, direct reporting to state public health agencies including electronic case reporting, TEFCA public health purpose. `community-referral`: state HIE or community information exchange where a source shows one, Direct message.
- **National networks**: every currently designated QHIN (from the ASTP/ONC or Sequoia RCE list, read on the day), Carequality, CommonWell, DirectTrust (as `direct`), and the payer API programs as `payer_api` entries whose `website` is the CMS rule page.
- Every entry: `sources` with `accessed` = the day read, `last_checked` = same day.

- [ ] **Step 1:** Research and write the entries. Fetch pages with curl or WebFetch; record each URL read.
- [ ] **Step 2:** Write the run doc: sources read and when, every candidate omitted and why, and every fact that a source stated ambiguously.
- [ ] **Step 3: Run** `python3 analysis/validate_contract.py && python3 -m pytest analysis/tests/test_networks_contract.py -q && python3 analysis/networks_link_check.py --issue-body-file /tmp/nl.md`. Expected: validator 0 errors; link check reports no `dead` (any `blocked` listed in the run doc as checked by hand).
- [ ] **Step 4: Commit** "networks: national routes and networks with sources".

### Task 7: Research the 51 jurisdictions; full detail for PA

**Files:**
- Modify: `frontend/public/api/v1/networks.json`
- Modify: `docs/methodology/runs/2026-11-06-networks-research.md`

- [ ] **Step 1:** For each of the 50 states and DC, find the state HIE(s) and any multi-state network operating there, from the network's own site or the state health agency. Each becomes `detail_level: 'basic'`, `routes: []`. A state where no network can be sourced gets no entry; list it in the run doc. Multi-state networks are one entry with all their states.
- [ ] **Step 2:** Pennsylvania: set every network operating in PA to `detail_level: 'full'` and attach the routes each one carries across the seven use cases, citing the source for each attachment in that network's `sources`. Check the PA connectivity ledger page (`/states/pa/connectivity`) and link it from PA-relevant routes where it applies.
- [ ] **Step 3: Run** the Task 6 Step 3 command plus `cd frontend && npx vitest run tests/lib/networks.test.ts tests/lib/load-networks.test.ts`. Expected: pass; the run doc lists every omitted state.
- [ ] **Step 4: Commit** "networks: state and multi-state networks, PA full detail".

### Task 8: Copy gates, docs, final verification

**Files:**
- Modify: `frontend/public/api/v1/networks.json` and page copy (edits from the gates only)
- Modify: `CLAUDE.md` (one `/networks` bullet under Pages; one row in the `/api/v1` contract table; one line for `networks-link-check.yml` in the CI table)

- [ ] **Step 1:** Extract all prose (page copy + every string in `networks.json`) to a scratch markdown file and run `python3 ~/.claude/skills/anti-slop-writing/scripts/slop_lint.py <file>`; fix flagged spans that are real problems.
- [ ] **Step 2:** Dispatch the `copy-reviewer` agent on the page file and `networks.json`, with the instruction that every factual claim must match its cited source and no count appears in prose. Apply its edits.
- [ ] **Step 3:** Update `CLAUDE.md` as listed.
- [ ] **Step 4: Run** `cd frontend && npm run lint && npm run test && npx playwright test e2e/networks.spec.ts && cd .. && python3 -m pytest analysis/tests/ -q && python3 analysis/validate_contract.py && python3 analysis/build_manifest.py`. Expected: all pass, manifest lists `/api/v1/networks.json`.
- [ ] **Step 5:** `cd frontend && npm run build` and confirm `/networks` is listed as static (○) in the route table.
- [ ] **Step 6: Commit** "networks: copy review, docs".
