---
title: Privacy policy
version: 0.2.0
last_updated: 2026-04-21
---

# Privacy policy

AINPI is a research project. This privacy policy covers the public website at [ainpi.vercel.app](https://ainpi.vercel.app) and the published API at `/api/v1/*`.

## TL;DR

- No analytics, no cookies, no tracking pixels, no fingerprinting.
- The site collects email + contact info **only** when you explicitly submit a form (Subscribe, Download report).
- Submitted emails are stored in Supabase Postgres (US region) and are used only for the stated purpose. No resale, no sharing with third parties.
- Removal on request — email [gene@fhiriq.com](mailto:gene@fhiriq.com).

## What we collect

**When you browse the site:** nothing. No Google Analytics, no Mixpanel, no Hotjar, no Meta Pixel. The site ships no tracking bundles. Vercel (our hosting provider) logs request metadata as part of standard web-server operation; those logs are retained per [Vercel's privacy policy](https://vercel.com/legal/privacy-policy).

**When you subscribe to updates:** your email address and the timestamp of your submission. Nothing else.

**When you download the full report:** your email address, name (optional), organization (optional), stated use case (optional), and the submission timestamp. This form exists so we can tell who's using AINPI research — the information helps us prioritize and reach back out when major findings land.

**When you file a GitHub issue or open a pull request:** that information is subject to [GitHub's privacy policy](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement), not ours.

## How we use submitted information

- **Subscribe:** we send periodic updates about new findings and methodology changes, via a transactional-email service (TBD — no emails are sent until that service is connected; if you subscribe today your address simply sits in the database until the integration lands).
- **Download report:** we record the capture for our own understanding of who's using the research. We may email you about a major update or a follow-up question once in a while.

We do not sell, trade, or share your email address with any third party outside the transactional-email provider we eventually use to deliver updates.

## Where data is stored

- **Supabase Postgres**, hosted in AWS `us-east-2`. Encrypted at rest and in transit.
- **GitHub** for any information you voluntarily submit as an issue, comment, or PR.

No data is stored on AINPI contributors' personal devices.

## Cookies

None. The site sets no cookies of its own.

Browser-level cookies you may see in DevTools (`__cf_bm` etc.) are set by the CDN layer (Cloudflare / Vercel Edge) for bot mitigation and can be cleared without affecting site functionality.

## Third-party services

| Service | Purpose | Data sent |
|---|---|---|
| Vercel | Hosting + CDN | Request metadata (IP, user-agent, path) |
| Supabase | Email + contact storage | Form submissions only, never browsing data |
| Google BigQuery | Analytics warehouse for audit findings | No user data — only the public CMS NPD + NPPES datasets |
| GitHub | Source hosting, issues, discussions | Your GitHub activity, per GitHub's privacy policy |

No other third parties. No advertising networks. No data brokers.

## Your rights

- **Access:** email us; we'll send you the record we have.
- **Correction:** email us with what to fix.
- **Deletion:** email us; we'll remove the record within 7 days and confirm.
- **Export:** email us; we'll send you your record in JSON.

Contact: [gene@fhiriq.com](mailto:gene@fhiriq.com).

## Children's data

AINPI is a technical research site. We do not knowingly collect personal information from anyone under 16.

## Changes to this policy

This document is versioned in the repository at [`docs/privacy.md`](https://github.com/FHIR-IQ/AINPI/blob/main/docs/privacy.md). Material changes bump the `version` field in the front matter and are announced via the Subscribe list (when that's live).

## Contact

**FHIR IQ**
Eugene Vestel
[gene@fhiriq.com](mailto:gene@fhiriq.com)
