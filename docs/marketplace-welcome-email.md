# Welcome note for archive consumers

**Marketplace installs are welcomed automatically (from 2026-09-19).**
Databricks emails the provider contact on every install; a Gmail filter
forwards that notice to `installs@ainpi.dev`, a Resend inbox in forwarding
mode; Resend posts `email.received` to `/api/v1/marketplace-install`; the
route verifies the signature, parses the notice, records the install once
per address in `marketplace_installs`, and sends the short welcome from
`reports@ainpi.dev` with reply-to gene@fhiriq.com. The copy lives in
`frontend/src/lib/marketplace-install.ts` (`buildInstallWelcome`) and is
pinned by `frontend/tests/lib/marketplace-install.test.ts`, which also
asserts it never names another consumer or mentions pricing. Edit it there.

The automated note is shorter than the one below: why they got it, what the
archive is in two sentences, the two mistakes a first query makes, three
links, and an opt-in subscribe line. It is sent once and says so. Nobody is
added to the subscriber list by installing.

The Gmail filter is the one manual piece: from the Databricks Marketplace
notifier, subject contains "has installed", forward to the Resend
forwarding address for the inbox (Gmail verifies a new forwarding address
with a code, which lands in that inbox). Test by forwarding an old notice.

What follows is the longer hand-sent version, still used for open-sharing
credential requests (Variant B), which carry a one-time activation link and
cannot be automated.

---

## Variant A: Marketplace install

**Subject:** The NDH release archive you installed, and what it is for

Hi {first name},

Thanks for installing the CMS National Provider Directory release archive.
A short note on what it is, since the listing page can only say so much.

CMS publishes the directory as a bulk file and keeps only the newest copy.
When a new release lands, the old one is gone from the source. This archive
keeps them. Two releases so far, 2026-05-08 and 2026-08-20, as six tables:
practitioner, practitioner_role, organization, organization_affiliation,
location and endpoint. Each is partitioned by release_date, so comparing two
releases is a WHERE clause. Every row carries the original FHIR record in the
resource column, plus flattened columns like _npi, _state and _phone for the
questions that do not need JSON parsing. The same code extracted both
releases.

It comes from AINPI (ainpi.dev), a public-interest audit of the directory. We
register each measurement before computing it, publish the scripts, and post
a correction when a source changes under a claim. The archive exists because
the question "is the directory getting better" cannot be answered from one
release, and CMS does not keep the old ones.

Two things before your first query.

Read one release at a time. Filter on release_date. Without it you get both
releases, and practitioner_role alone is 23 million rows across the two.

Endpoint and Location ids are regenerated on every export. If you diff
releases, join endpoint on _address, not _id. Practitioner ids embed the NPI
and are stable.

Where to go next:

- The worked-example notebook is attached to the listing. Its source is at
  github.com/FHIR-IQ/AINPI, analysis/notebooks/ainpi_archive_quickstart.py
- What we have measured so far: ainpi.dev/findings
- One page per state, with citation language: ainpi.dev/states
- The API and the MCP server, both free: ainpi.dev/developer
- How the numbers are made: ainpi.dev/methodology
- Every source we use, with licence terms: ainpi.dev/data-sources

One caution. This is a measurement of a federal file, not a source of truth
about any individual provider. Check NPPES, the OIG exclusion list and
SAM.gov before acting on a named record.

If you find a number that disagrees with something you can verify, we would
rather hear it: github.com/FHIR-IQ/AINPI/issues. And if there is a quantity
you want tracked release over release, say so. We are choosing the first set
now.

Gene Vestel
FHIR IQ

---

## Variant B: open-sharing credential request

**Subject:** Re: {their subject}

Hi {first name},

Yes. Here is a credential set up for {organization}:

{activation_url}

That link works once. It downloads a small file, config.share. Keep it
somewhere safe; it is the whole credential. It expires {expiry date}, and I
will send a fresh one before then.

To read from it:

    pip install delta-sharing

    import delta_sharing
    p = "config.share#ainpi-ndh-archive.ainpi."
    df = delta_sharing.load_as_pandas(p + "practitioner", limit=1000)

{Then the body of Variant A from "CMS publishes the directory" through the
sign-off, unchanged.}

---

## Operator checklist, per send

- [ ] Marketplace install notification or credential request received
- [ ] Variant B only: `databricks recipients create <org> TOKEN --comment
      "<who, when>"`, then `shares update-permissions` with SELECT, then read
      `tokens[].activation_url` from `recipients get`
- [ ] Fill the placeholders; nothing else changes
- [ ] Every link returns 200 today
- [ ] Draft, not send, from gene@fhiriq.com; Gene sends
- [ ] Log the consumer in the private recipient record, never in public copy
