# NPD MCP working group: sign-up page and tool goals (short design)

## Intent

The CMS National Provider Directory (NPD) community has a connectathon coming
and a published vision for how directory data should flow (Fred Trotter's
diagram in `ftrotter-gov/CMSPayerEndpointSeed`, `docs/npd-how-did-it-go-api.md`):
discover an entity and its endpoints, validate it, exchange, and report back
"how did it go". Gene wants AINPI to contribute an open-source MCP toolset to
that effort, submitted to CMS, with an FAQ on why MCP tools work better for this
than bare FHIR APIs. The longer aim is AINPI's original vision: one golden
record, one place a provider updates their information, flagged and
disseminated to every organization that holds provider data.

Who this is for: organizations in the NPD Slack (payers, providers, EHR and
directory vendors, app developers, HIEs) that want to implement and test the
tools together, draft standards for the group to review, and validate use cases.

Success: Gene can paste one ainpi.dev link in the NPD Slack, people sign up in
under two minutes without an account, Gene gets each sign-up by email, and the
page shows which organizations have joined (those that opted in).

## Goals

- One page, `/npd-mcp`, that explains the tool goals and takes sign-ups.
- A tool-goals document in `docs/` that can be sent to CMS as is; the page
  renders it, so there is one text.
- Participating organizations listed by name, only with each one's opt-in.

## Non-goals

- Building the new MCP tools (report, update, validate). This page and doc
  recruit the group and state the goals; the tools are a later plan.
- Accounts, logins, or a participant dashboard.
- A public list of people, emails, or anything beyond organization name and type.

## Anti-goals

- Any wording that implies CMS, the NPD team, or any state agency endorses,
  produced, or guided this. It is AINPI's open-source proposal into a community
  process.
- Naming competitors.
- A form so long that a payer ops person abandons it.

## Approaches considered

1. **Page on ainpi.dev with its own form, Supabase table, admin alert (chosen).**
   No account needed, contact details stay private, opted-in names render on
   the page. About a day of work. Follows the existing HealthcareService survey
   pattern (`/payer-healthcare-service-survey`, `HealthcareServiceSurveyResponse`,
   `sendSurveyAlert`).
2. GitHub Discussions or an issue template. No code, public by default, but
   needs a GitHub account (loses most payer and provider people) and cannot hold
   private contact details.
3. Google Form linked from a page. Fast, but data lives off AINPI and the
   participant list would be copied by hand.

Gene handed the how to Claude ("keep it simple but effective and easy to
participate"); option 1 is Claude's call.

## Page content (`/npd-mcp`)

1. **Header.** "Open-source MCP tools for the National Provider Directory".
   One-paragraph lede: what the group is and that anyone can join.
2. **Why MCP, not only FHIR APIs (FAQ, 4 to 6 questions).** Plain-language
   answers, for example: an MCP tool is a described task (find, verify, report)
   rather than a query language the caller must learn; one tool can sit over
   NPD, NPPES, payer directories and exclusion lists; agents and apps can call
   the same tools; FHIR stays the data format underneath. State what MCP does
   not solve (authentication, trust, data quality at the source).
3. **Tool goals, mapped to the NPD flow.**
   - Discover: find an organization or practitioner and its endpoints (flow
     steps 1 to 2). Exists today in part: `lookup_npi`, `lookup_organization`.
   - Validate: check status, for example Medicare enrollment, OIG and SAM
     exclusions, NPI validity (step 5). Exists in part: `check_npi_cohort`.
   - Report: tell the directory how an exchange went, wrapping the proposed
     NPD Endpoint Feedback API (step 7), with an AINPI-hosted sandbox until an
     NPD endpoint exists. New.
   - Update: one place to correct your own record, routed to everyone who
     holds it (the golden-record goal). New; the hardest, and stated as a goal.
   - Each with status: available today / proposed.
4. **Sign up** (form, below).
5. **Who has joined.** Opted-in organization names and types; empty state
   reads "Be the first to sign up."
6. Disclaimer line: independent open-source work; not produced or endorsed
   by CMS.

## Sign-up form

Required: organization name, contact name, email, organization type
(payer, provider or health system, EHR or directory vendor, app developer,
HIE or network, government, other).

Optional, multi-select "How you want to take part": implement the tools,
test at the connectathon, draft or review standards, bring a use case.
Optional free text: the use case you care about (one box). Optional checkbox,
off by default: "List our organization's name on this page."

No account. Same response shown whether or not the email was seen before.

## Data and behaviour

- New Prisma model `NpdMcpParticipant` (`npd_mcp_participants`): id,
  organization, contactName, email, orgType, participation (Json string[]),
  useCase (Text), listPublicly (bool, default false), ipAddress, userAgent,
  createdAt. One row per submission; duplicates are fine (the admin sees them).
- `POST /api/v1/npd-mcp/participate`: validates (allowlisted codes, length
  caps, email shape), rate-limited per IP with the existing `rate_limit_buckets`
  limiter in its own namespace, writes the row, fires a new
  `sendNpdMcpSignupAlert()` to `ADMIN_EMAIL` fire-and-forget.
- `GET` on the same route is not needed; the page is a server component that
  reads opted-in `organization` + `orgType` only, `revalidate` every 10 minutes,
  so a new listing appears without a deploy and the database is read at most
  every 10 minutes.
- Page added to nav (Explore or footer, not a 14th top-level item), sitemap.

## Constraints

- Design system: tokens in `tailwind.config.ts` and `globals.css`, no default
  Tailwind blue-gray, hairlines not shadows.
- No em dashes; run `slop_lint.py` and the copy-reviewer on page and doc text.
- Creating the table in production Supabase is a live cloud write: Gene
  approves it (`npm run db:push` or the SQL), and the page must render (form
  still works only after the table exists) without crashing if the table is
  missing: list shows the empty state and a server log line.
- Never publish email, contact name, or IP.

## Left to the builder

Exact FAQ wording (reviewed before ship), component structure, test layout.
