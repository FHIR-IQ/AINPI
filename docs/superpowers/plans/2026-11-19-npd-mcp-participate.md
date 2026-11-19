# NPD MCP Working Group Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `/npd-mcp`: the MCP tool goals for the NPD community plus a no-account sign-up form whose opted-in organizations are listed on the page.

**Architecture:** A pure validator (`parseSignup`) feeds a POST route that rate-limits per IP through the existing `rate_limit_buckets` `bump()`, writes one Prisma row, and fires an admin email. The page is a server component (`revalidate = 600`) that renders a markdown goals doc from `docs/npd-mcp/tool-goals.md` and reads opted-in organization names; the form is a small client component.

**Tech Stack:** Next.js 14 App Router, Prisma (Supabase Postgres), Resend via `lib/admin-email.ts`, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-19-npd-mcp-participate-design.md`

## Global Constraints

- No em dashes in any shipped text; no marketing language.
- Never imply CMS, the NPD team, or any state agency endorsed, produced, or guided this. Disclaimer text: "Independent open-source work by AINPI. Not produced, reviewed, or endorsed by CMS or the NPD team."
- Never publish email, contact name, IP, user agent, use case text or participation choices. Public list = `organization` + `orgType` where `listPublicly = true`, nothing else.
- Design tokens from `tailwind.config.ts` / `globals.css` (`paper`, `ink`, `signal`, `primary.600`, hairlines, 2-3px radii); no default blue-gray, no shadows.
- Production table creation is Gene's step; nothing in this plan runs `db:push` or SQL against Supabase.
- Org type codes (exact): `payer`, `provider`, `vendor`, `app`, `hie`, `government`, `other` with labels "Payer", "Provider or health system", "EHR or directory vendor", "App developer", "HIE or network", "Government", "Other".
- Participation codes (exact): `implement`, `test`, `standards`, `use_case` with labels "Implement the tools", "Test at the connectathon", "Draft or review standards", "Bring a use case".
- Length caps: organization 200, contactName 200, email 254, useCase 2000.

## Review Focus

1. Same person submits twice (refresh, double click): both rows accepted, same success message, no error. Pinned in Task 2.
2. Table not yet created in production: the page still renders with the empty state; POST returns 503 with a plain message, not a stack trace. Pinned in Tasks 2 and 4.
3. Organization name containing HTML or a script tag on the public list: rendered as text. Pinned in Task 4.
4. A row with `listPublicly = false` never reaches the page, including when it is the only row. Pinned in Task 2 (`listPublicParticipants` query filter).
5. Rate-limit table unreachable (`bump` returns null): submission allowed. Pinned in Task 2.

---

### Task 1: Codes and validator

**Files:**
- Create: `frontend/src/data/npd-mcp.ts`
- Create: `frontend/src/lib/npd-mcp-signup.ts`
- Test: `frontend/tests/lib/npd-mcp-signup.test.ts`

**Interfaces:**
- Produces: `ORG_TYPES: readonly {code: OrgType; label: string}[]`, `PARTICIPATION: readonly {code: Participation; label: string}[]`, types `OrgType`, `Participation`.
- Produces: `parseSignup(body: unknown): {ok: true; value: Signup} | {ok: false; error: string}` where `Signup = {organization: string; contactName: string; email: string; orgType: OrgType; participation: Participation[]; useCase: string | null; listPublicly: boolean}`.

- [ ] **Step 1: Write failing tests** in `tests/lib/npd-mcp-signup.test.ts`:
  - `accepts a minimal valid body`: `{organization:'Acme Health', contactName:'Pat', email:'pat@acme.org', orgType:'payer'}` → ok, `participation: []`, `useCase: null`, `listPublicly: false`.
  - `trims and caps text`: organization of 300 chars → value length 200; `useCase` `'  x  '` → `'x'`; whitespace-only `useCase` → `null`.
  - `rejects missing required fields`: each of organization, contactName, email, orgType missing or blank → `ok: false`.
  - `rejects bad email` (`'not-an-email'`) and unknown orgType (`'insurer'`) → `ok: false`.
  - `filters participation to known codes and dedupes`: `['test','test','bogus',7]` → `['test']`.
  - `listPublicly is true only for literal true`: `'true'`, `1` → false; `true` → true.
  - `rejects non-object bodies`: `null`, `[]`, `'x'` → `ok: false`.
- [ ] **Step 2:** `cd frontend && npx vitest run tests/lib/npd-mcp-signup.test.ts` → FAIL (module missing).
- [ ] **Step 3:** Implement both files. Error strings are user-facing and plain ("Please enter your organization's name.").
- [ ] **Step 4:** Same command → PASS.
- [ ] **Step 5:** Commit `npd-mcp: sign-up codes and validator`.

### Task 2: Storage, route, alert

**Files:**
- Modify: `frontend/prisma/schema.prisma` (add model after `HealthcareServiceSurveyResponse`)
- Create: `frontend/prisma/sql/npd_mcp_participants.sql`
- Modify: `frontend/src/lib/admin-email.ts` (add `sendNpdMcpSignupAlert`)
- Create: `frontend/src/lib/npd-mcp-participants.ts`
- Create: `frontend/src/app/api/v1/npd-mcp/participate/route.ts`
- Test: `frontend/tests/api/npd-mcp-participate.test.ts`, `frontend/tests/lib/npd-mcp-participants.test.ts`

**Interfaces:**
- Consumes: `parseSignup` (Task 1); `bump(id, units, ttlMs)` and `clientIp(req)` from `@/lib/rate-limit`.
- Produces: Prisma model `NpdMcpParticipant` mapped to `npd_mcp_participants`: `id String @id @default(uuid())`, `organization String`, `contactName String @map("contact_name")`, `email String`, `orgType String @map("org_type")`, `participation Json`, `useCase String? @map("use_case") @db.Text`, `listPublicly Boolean @default(false) @map("list_publicly")`, `ipAddress String? @map("ip_address")`, `userAgent String? @map("user_agent") @db.Text`, `createdAt DateTime @default(now()) @map("created_at")`, `@@index([listPublicly, createdAt])`.
- Produces: `listPublicParticipants(): Promise<{organization: string; orgType: string}[]>` (where `listPublicly: true`, select only those two fields, order `createdAt asc`, returns `[]` and `console.error`s on any Prisma error).
- Produces: `sendNpdMcpSignupAlert(args: {organization: string; contactName: string; email: string; orgType: string; participation: string[]; useCase: string | null; listPublicly: boolean}): Promise<void>` following `sendSurveyAlert` (skips without `RESEND_API_KEY`, never throws). Subject: `NPD MCP sign-up: <organization>`.
- Produces: `POST /api/v1/npd-mcp/participate` → `200 {ok:true}`; `400 {ok:false,error}`; `429 {ok:false,error:'Too many submissions. Please try again later.'}`; `503 {ok:false,error:'Sign-up is not open yet. Please try again soon.'}` on a Prisma error. `export const dynamic = 'force-dynamic'`.

- [ ] **Step 1: Write failing tests**, mocking `@/lib/prisma`, `@/lib/admin-email`, and `@/lib/rate-limit` (`bump`, `clientIp`) in the style of `tests/api/marketplace-install-webhook.test.ts`:
  - `valid post creates one row and alerts`: `create` called once with `listPublicly:false`, `participation: []`; alert called; 200 `{ok:true}`.
  - `same body twice gives two rows and two 200s` (Review Focus 1).
  - `invalid body returns 400 and writes nothing`.
  - `non-JSON body returns 400`.
  - `per-minute limit`: `bump` resolves 6 → 429, no `create`.
  - `per-day limit`: minute bump 1, day bump 21 → 429.
  - `limiter unreachable`: `bump` resolves null → 200 (Review Focus 5).
  - `prisma error returns 503 with the plain message` (Review Focus 2).
  - `listPublicParticipants filters and selects`: assert `findMany` called with `where: {listPublicly: true}` and `select: {organization: true, orgType: true}`; on rejection returns `[]` (Review Focus 4).
- [ ] **Step 2:** `cd frontend && npx vitest run tests/api/npd-mcp-participate.test.ts tests/lib/npd-mcp-participants.test.ts` → FAIL.
- [ ] **Step 3:** Implement. Limiter keys: `npdmcp:ip:<ip>:m:<minute>` (ttl 120000, max 5) then `npdmcp:ip:<ip>:d:<day>` (ttl 172800000, max 20), checked before parsing so junk counts. Do not add to `ROUTE_COST`; this route touches no paid service. SQL file mirrors the Prisma model, `create table if not exists`, enables RLS, grants nothing to `anon`/`authenticated`/`service_role` (same posture as `npi_suppressions.sql`), and states at the top that Gene runs it in the Supabase SQL editor.
- [ ] **Step 4:** Same command → PASS; `npx prisma validate` → valid; `npx tsc --noEmit` → 0 errors.
- [ ] **Step 5:** Commit `npd-mcp: participants table, sign-up route, admin alert`.

### Task 3: Tool goals document

**Files:**
- Create: `docs/npd-mcp/tool-goals.md`

**Interfaces:**
- Produces: a markdown file with front matter `title: "Open-source MCP tools for the National Provider Directory"`, `version: "0.1-draft"`, `updated: "2026-11-19"`, and these H2 sections in this order, which the page renders: `## What this is`, `## Why MCP tools, not only FHIR APIs`, `## Tool goals`, `## What MCP does not solve`, `## How the group works`.

- [ ] **Step 1:** Write the doc. Content requirements:
  - What this is: an open working group to implement and test MCP tools over NPD data, draft standards for the group to review, and validate use cases across apps, payers, providers and vendors; the long-term aim is one golden record a provider corrects once, with the change flagged to every organization that holds it.
  - Why MCP (Q&A form, 5 questions max, each answer 2 to 4 sentences): a tool is a described task, not a query language; one tool can span NPD, NPPES, payer directories and exclusion lists; the same tools serve apps and AI agents; FHIR stays the data format underneath; tools can return the evidence and source dates with each answer.
  - Tool goals table: Goal | NPD flow step | Status | Today. Rows: Discover (steps 1-2, "Partly available", `lookup_npi`, `lookup_organization`), Validate (step 5, "Partly available", `check_npi_cohort`), Report how an exchange went (step 7, "Proposed", wraps the proposed NPD Endpoint Feedback API v0.2 with an AINPI sandbox until NPD hosts one), Update once, route to everyone (golden record, "Proposed").
  - Cite Fred's proposal by repository and file path (`ftrotter-gov/CMSPayerEndpointSeed`, `docs/npd-how-did-it-go-api.md`), described as "a proposal shared in the NPD community", with no claim about CMS adoption.
  - What MCP does not solve: authentication and trust between organizations, data quality at the source, and agreement on who may update what.
  - How the group works: sign up on the page; first work is the connectathon; drafts are reviewed in the open on GitHub (`FHIR-IQ/AINPI`); anyone can propose a use case.
  - The disclaimer line from Global Constraints, last.
- [ ] **Step 2:** `python3 ~/.claude/skills/anti-slop-writing/scripts/slop_lint.py docs/npd-mcp/tool-goals.md` → score at or below 1.2; fix flagged spans that are real.
- [ ] **Step 3:** `grep -c '—' docs/npd-mcp/tool-goals.md` → `0`.
- [ ] **Step 4:** Commit `npd-mcp: tool goals document`.

### Task 4: The page

**Files:**
- Create: `frontend/src/app/npd-mcp/page.tsx` (server)
- Create: `frontend/src/app/npd-mcp/SignupForm.tsx` (client)
- Test: `frontend/tests/app/npd-mcp-page.test.tsx`, `frontend/tests/components/npd-mcp-signup-form.test.tsx`

**Interfaces:**
- Consumes: `loadMarkdown` from `@/lib/load-markdown` and `MarkdownPage` rendering conventions; `listPublicParticipants()` (Task 2); `ORG_TYPES`, `PARTICIPATION` (Task 1).
- Produces: route `/npd-mcp` with `export const revalidate = 600`, metadata title "NPD MCP working group", description over 50 characters.

- [ ] **Step 1: Write failing tests:**
  - Page (mock `listPublicParticipants`): renders the doc title as the h1; renders "Who has joined"; with `[]` shows "Be the first to sign up."; with `[{organization:'<script>alert(1)</script>', orgType:'payer'}]` shows that literal text and no `script` element (Review Focus 3); maps `orgType` code to its label ("Payer"); renders the disclaimer.
  - Form: required fields marked `required`; submitting posts JSON to `/api/v1/npd-mcp/participate` with `listPublicly:false` when the box is unticked; on `{ok:true}` shows "Thanks. You're on the list." and disables the button; on `{ok:false,error}` shows the error text; the button is disabled while the request is in flight (double-click sends one request).
- [ ] **Step 2:** `cd frontend && npx vitest run tests/app/npd-mcp-page.test.tsx tests/components/npd-mcp-signup-form.test.tsx` → FAIL.
- [ ] **Step 3:** Implement. Layout: doc content (via the markdown renderer used by `MarkdownPage`) in a `.measure` column; then an `id="join"` section with the form; then "Who has joined" as a simple list of `organization` with the type label in muted text. Add a "Join the working group" link near the top that jumps to `#join`. Labels are visible `<label>` elements; the checkbox reads "List our organization's name on this page". Below the checkbox, small text: "We use your contact details only to coordinate this group. See our privacy policy." linking `/privacy`.
- [ ] **Step 4:** Same command → PASS.
- [ ] **Step 5:** Commit `npd-mcp: page and sign-up form`.

### Task 5: Wiring and docs

**Files:**
- Modify: `frontend/src/components/Footer.tsx` (Explore list, after "Healthcare Service Survey": `NPD MCP working group` → `/npd-mcp`)
- Modify: `frontend/src/app/sitemap.ts` (add `/npd-mcp`)
- Modify: `frontend/src/app/developer/page.tsx` (one sentence near the MCP section linking `/npd-mcp`)
- Modify: `CLAUDE.md` (Pages bullet for `/npd-mcp`; API Routes row for `POST /api/v1/npd-mcp/participate`; note that `prisma/sql/npd_mcp_participants.sql` creates the table)
- Create: `frontend/e2e/npd-mcp.spec.ts`

- [ ] **Step 1:** Write `e2e/npd-mcp.spec.ts`: loads `/npd-mcp`, h1 visible, `#join` form visible, no horizontal scroll at 375px (same check as `e2e/networks.spec.ts`).
- [ ] **Step 2:** Make the wiring edits.
- [ ] **Step 3:** `cd frontend && npm run lint && npx tsc --noEmit && npx vitest run` → all pass; `npx playwright test e2e/npd-mcp.spec.ts` → pass; `bash ../.github/scripts/scan-anti-patterns.sh origin/main` → passed.
- [ ] **Step 4:** Copy review: dispatch the `copy-reviewer` agent on `docs/npd-mcp/tool-goals.md` and the page/form strings; apply its edits.
- [ ] **Step 5:** Commit `npd-mcp: footer, sitemap, developer link, docs, e2e`.
