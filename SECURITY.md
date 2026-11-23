# Security Policy

## Reporting a vulnerability

Email **gene@fhiriq.com** with:

- A description of the vulnerability
- Steps to reproduce
- The version (commit SHA or release tag) you tested against
- Your contact info for follow-up

**Please do not file public GitHub issues for security vulnerabilities.**

## Disclosure SLA

- **Acknowledgement:** within 48 hours
- **Triage + initial assessment:** within 5 business days
- **Fix + coordinated disclosure:** on a timeline proportional to severity, negotiated with the reporter

Credit is given in release notes unless the reporter requests anonymity.

## Scope

In scope:

- The AINPI web app (`ainpi.dev`) and its API routes under `/api/`
- The `FHIR-IQ/AINPI` repository code and build/CI configuration
- Sibling repositories: `FHIR-IQ/ainpi-examples`, `FHIR-IQ/ainpi-probe`
- The endpoint crawler (`ainpi-probe`) and its rate-limiting / robots behavior

Out of scope:

- Upstream CMS, NPPES, or NUCC services — report those to CMS
- Payer directories we probe externally — report those to the payer
- Third-party providers (Vercel, Supabase, Google Cloud) — report via their own disclosure channels

## Data handling

AINPI's data is public: the CMS NPD bulk files and the other public federal and vendor files listed on /data-sources. No AINPI page, API route or MCP tool asks for or returns patient data or PHI. Roster verification takes NPIs, which are public provider identifiers, and its audit log keeps counts only, never the NPIs submitted.

The app stores contact details only where a person gives them to us: newsletter and report-download email addresses, trial and working-group sign-ups (name, email, organization), and NPI removal requests (the requester's email). These are never published. API keys and OAuth tokens are stored as SHA-256 hashes.

If you discover that a commit or deployment has inadvertently leaked non-public data, treat it as a vulnerability and report it via this channel.
