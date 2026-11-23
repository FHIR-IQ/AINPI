---
title: Privacy policy
version: 0.6.0
last_updated: 2026-11-22
---

# Privacy policy

AINPI is a research project. This privacy policy covers the public website at [ainpi.dev](https://ainpi.dev) and the published API at `/api/v1/*`.

## TL;DR

- No analytics, no cookies, no tracking pixels, no fingerprinting.
- The site collects email + contact info **only** when you explicitly submit a form (Subscribe, Download report, the NPD MCP working group sign-up, an API trial, an NPI removal request).
- Submitted emails are stored in Supabase Postgres (US region) and are used only for the stated purpose. No resale, no sharing with third parties.
- Removal on request: email [gene@fhiriq.com](mailto:gene@fhiriq.com).
- Providers can have their NPI's page and rows removed from ainpi.dev at [/privacy/remove](/privacy/remove). See [Removal requests](#removal-requests).

## What we collect

**When you browse the site:** nothing. No Google Analytics, no Mixpanel, no Hotjar, no Meta Pixel. The site ships no tracking bundles. Vercel (our hosting provider) logs request metadata as part of standard web-server operation; those logs are retained per [Vercel's privacy policy](https://vercel.com/legal/privacy-policy).

**When you subscribe to updates:** your email address and the timestamp of your submission. Nothing else.

**When you download the full report:** your email address, name (optional), organization (optional), stated use case (optional), and the submission timestamp. This form exists so we can tell who's using AINPI research. The information helps us prioritize and reach back out when major findings land.

**When you join the NPD MCP working group:** your organization's name and type, your name, your email address, how you want to take part, the use case you describe (optional), whether you ticked the box to be listed, the submission timestamp, and the IP address and browser user agent the form was sent from. We keep the IP address and user agent only to spot and block abusive submissions. Only your organization's name and type are ever published, on the [/npd-mcp](/npd-mcp) page, and only if you ticked the box and we have checked the sign-up. We use the rest only to coordinate the group. Each sign-up also sends us an email notification with what you submitted.

**When you start an API trial** ([/trial](/trial)): your organization, your name, your work email, your role and what you want to build (both optional), the submission timestamp, and the IP address and browser user agent the form was sent from (kept only to spot and block abuse). We store the API key only as a hash; the key itself is sent once, to your email. We email you three times at most: the key, one reminder before the trial ends, and one note when it ends. We use the rest to follow up about a plan, and each trial sends us an email notification with what you submitted. We keep the record so that each address gets one trial; ask us to delete it at gene@fhiriq.com.

**When a working-group participant submits an interaction report** (the test sandbox at `/api/v1/interaction-reports`, or the `report_interaction` tool): the report as sent, which API key sent it, and when it arrived. A report is visible only to the organization that sent it, is never published, and is deleted 90 days after it arrives. Reports are meant to describe test exchanges between organizations; do not put patient data in them.

**When you ask for an NPI to be removed:** the NPI, the email address you give for the confirmation, how the request arrived (form, email or by hand), and when it was received, applied and confirmed. We keep this so the NPI stays removed from future releases. It is never published.

**When you file a GitHub issue or open a pull request:** that information is subject to [GitHub's privacy policy](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement), not ours.

## How we use submitted information

- **Subscribe:** we send periodic updates about new findings and methodology
  changes. Resend delivers them. Every message carries a reply-to address, and
  replying with a removal request is enough to unsubscribe.
- **Download report:** we record the capture so we can tell who is using the
  research. We may email you about a major update or a follow-up question.
- **NPD MCP working group:** we contact you about the group's work, such as
  drafts to review and testing sessions. Nothing else.

We do not sell, trade, or share your email address with any third party outside
Resend, which delivers the updates and our own notifications about form
submissions.

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
| Supabase | Email + contact storage | Form submissions only, not browsing data |
| Resend | Delivers subscriber updates, removal confirmations, and notifications to us about form submissions | Your email address and the message; for a notification to us, what you submitted in the form |
| Google BigQuery | Analytics warehouse for audit findings | No user data, only the public CMS NPD + NPPES datasets |
| GitHub | Source hosting, issues, discussions | Your GitHub activity, per GitHub's privacy policy |

No other third parties. No advertising networks. No data brokers.

## Your rights

- **Access:** email us; we'll send you the record we have.
- **Correction:** email us with what to fix.
- **Deletion:** email us; we'll remove the record within 7 days and confirm.
- **Export:** email us; we'll send you your record in JSON.

Contact: [gene@fhiriq.com](mailto:gene@fhiriq.com).

## Removal requests

If you are the provider identified by an individual NPI, or authorized to act
for them, you can ask for that NPI to be removed from ainpi.dev using the form at
[/privacy/remove](/privacy/remove). Every provider page links to it with the NPI
already filled in. Requests are processed automatically, with no manual step:
search stops showing the NPI within minutes, the page and files are updated
within 6 hours, and the whole removal is complete within 7 days at the latest.
Removals stay in effect for every later data release.

The process covers individual providers. If the NPPES registry lists the NPI
as an organization's, nothing is removed and we send an automated reply saying
so: organization records come from public CMS data.

Removal covers, on ainpi.dev:

- the individual page at `/npi/<npi>`, which then returns "not found";
- the NPI's rows in our downloadable files and in the `/api/v1/` files;
- AINPI's search results, including the AI-agent (MCP) tools.

Applying a request does not change published aggregate counts. A removed record
still counts toward every total, and a file that lost rows says how many in a
`suppressed_rows` field, without saying which. When the data is later
regenerated from files that had rows removed, a few derived counts can shift by
a handful of providers.

Removal covers ainpi.dev pages, files and search only, not the CMS source data
or other services. The site's source and data files are published as a public
project on GitHub, and earlier versions of those files remain in the project's
history.

When removal is complete, we send one automated email to the address you gave.
It comes from an unmonitored address and replies are not read. Search engines
drop the old page when they next crawl it.

## Children's data

AINPI is a technical research site. We do not knowingly collect personal information from anyone under 16.

## Changes to this policy

This document is versioned in the repository at [`docs/privacy.md`](https://github.com/FHIR-IQ/AINPI/blob/main/docs/privacy.md). Material changes bump the `version` field in the front matter and are announced via the Subscribe list (when that's live).

## Contact

**FHIR IQ**
Eugene Vestel
[gene@fhiriq.com](mailto:gene@fhiriq.com)
