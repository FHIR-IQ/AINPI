# Roster verification and OAuth for the MCP server (short design)

Approved by Gene 2026-11-22 ("go with roster verification, build it with OAuth"; sign-in option A).

## Intent
A paid MCP product, modelled on what MedReveal sells for rates but on AINPI's own
data: a payer, analytics firm or consultant pastes a list of NPIs and gets, per
NPI, what the public federal sources say, each with its source and date. OAuth
lets a user add `https://ainpi.dev/api/account/mcp` to claude.ai, ChatGPT or
Gemini and sign in, instead of configuring a header.

## Phase 1: verification
- `verify_roster` MCP tool and `POST /api/v1/roster/verify`. Keyed callers only
  (trial, free, partner, enterprise). Batch limit by tier: 25 trial/free, 200
  partner, 500 enterprise. Charged 5 + 2 units per NPI against the key's quota.
- Per NPI: NDH (practitioner or organization record, active flag, active role
  count, linked organizations), NPPES (live registry API: found, status,
  enumeration type, name, primary taxonomy), OIG LEIE (active exclusion, date,
  type), SAM (active exclusion; flagged "needs review" unless the SAM name
  matches NPPES, because of the documented SAM-NPI false-positive history),
  endpoint (organizations reached through NDH roles or the NPI itself, with
  NDH and vendor-file endpoints from the H50/H51 index), a flag list, and each
  source's as-of date.
- Not in v1: Medicare enrollment. data.cms.gov's provider-data API returns 403
  to scripted clients, and only PA is ingested. The result says "not checked".
- One capped BigQuery query per batch (dry-run upper bound 28.8 MB). NPPES
  calls with bounded concurrency, a 5 s timeout and a 6-hour per-NPI cache.
  An NPPES failure reads "not checked", never "not found".
- Suppressed NPIs (removal requests) get the same "no data" result as an NPI
  nothing holds, and are never sent to NPPES.
- Audit log `roster_verifications`: key, surface, NPI count, flagged count,
  outcome, time. Never the NPI list.

## Phase 2: OAuth 2.1 (option A: sign in with an AINPI API key)
- Authorization server on ainpi.dev: RFC 8414 metadata, RFC 7591 dynamic client
  registration (public clients, PKCE S256 required), `/oauth/authorize` page
  where the user pastes their API key, `/api/oauth/token` for the code and
  refresh grants. Access tokens 1 hour, refresh tokens 30 days, rotated. Tokens
  and codes stored as SHA-256 hashes and bound to the API key, so revoking or
  expiring the key ends every token.
- `/api/account/mcp`: the same tools, auth required (401 with RFC 9728
  `WWW-Authenticate` resource metadata). `/api/mcp` stays public and also
  accepts OAuth tokens and API keys.

## Approaches considered
Sign-in: A paste API key (chosen: no accounts, every customer already holds a
key), B email magic link, C third-party identity provider.

## Anti-goals
No NPI lists in logs; no "clean" verdict from missing data; no claim that a
flag is a finding (signals, verify at the primary source).
