# H52 payer affiliation gap: pre-registration and run provenance, 2026-08-16

Pre-registration record for H52 and the provenance for its first run.

H52 asks whether payer provider directories carry the practitioner-to-organization
affiliation the National Provider Directory leaves empty, and how much of it is
new against every federal source already tested.

**Methodology version:** `0.7.2-draft`
**Pre-registered:** 2026-08-16
**First run:** 2026-08-16
**Operator:** Eugene Vestel
**Status:** published, measured against the 2026-05-08 NDH release.
**Reproducibility:** see "Commands" at the end.

## Why this hypothesis

The NDH's largest structural gap is roles, not endpoints. Measured on the
2026-05-08 release: 1,931,044 of 7,196,385 active practitioners (26.8%) carry
any active `PractitionerRole`. With no role there is no organization, and with
no organization there is no endpoint path at any confidence. That caps every
org-routed lookup at 1.93M people regardless of how much endpoint work is done.

The obvious way through is claims data, and it was tested first rather than
assumed. CMS's Doctors and Clinicians National Downloadable File is the right
shape (one row per clinician with enrolment, group and address) and it closes
**2.5%** of the gap. Its 1.6M clinicians overlap almost entirely with
practitioners who already have a role, because both derive from Medicare
enrolment. A second view of the same population does not extend coverage.

Payer directories are a different population. Every payer subject to the CMS
Interoperability and Patient Access rule (CMS-9115-F) must publish a public,
unauthenticated provider directory, and those directories are built from network
contracts rather than Medicare enrolment.

## Pre-registered null hypothesis

A payer FHIR directory adds no organizational affiliation beyond what the NDH
and CMS DAC already publish, so the share of payer-listed practitioners gaining
a net-new affiliation is indistinguishable from zero.

## Denominator

Every practitioner published in the Capital BlueCross public FHIR provider
directory carrying a well-formed, check-digit-valid NPI. Measured against the
whole directory, not a sample. Reported alongside the directory's own
practitioner count so the NPI publication rate stays visible.

## Source

`https://providerdirectory-api.capbluecross.com/r4`, a Da Vinci PDex Plan-Net
FHIR 4.0.1 server, public and unauthenticated, published under CMS-9115-F.
Capital BlueCross was selected because it is the cleanest of the five payers
already verified live by `/api/provider-search` and H26, and because it is a
Pennsylvania payer, where H47 already maps every CMS-listed hospital to its EHR
vendor and endpoint.

## Source-side defects found, and why they change the counts

These are properties of the published data, not of the analysis. Both were
measured, and both silently corrupt a naive harvest.

### 1. `PractitionerRole` ids are not unique

Every logical role is served **twice under the same `id`**. One copy sets
`organization` to Capital Blue Cross itself; the other names the real practice
(HMC/Dept of OB/GYN, Penn Medicine LGHP Geriatrics, Geisinger Lewistown).

Verified on 140 ids sampled across the full page range, page 1 to the last page:
140 of 140 carried exactly one payer-org copy and one real-practice copy, and
none carried only one.

Consequences:

- The reported `Bundle.total` of 2,259,490 double-counts. The directory holds
  roughly **1.13M logical roles**.
- A consumer deduplicating on `id`, which is the obvious thing to do, keeps
  whichever copy arrives first and discards the other. Half the time that discards the
  only useful organization, leaving the payer as the "affiliation".
- FHIR R4 requires a resource id to be unique per resource type on a server, so
  this is a conformance defect rather than a modelling choice, and is worth
  reporting back to the payer.

**This corrects a wrong reading in the first pass of this work**, which
described the roles as two halves of one set, one naming the payer and one
naming a real practice. They are not two halves. They are one set, emitted
twice.

### 2. `_count` is not honoured

The page stride is fixed at 20 distinct resources regardless of the `_count`
requested. `PractitionerRole` returns 40 entries per page, but only 20 distinct
resources, for the reason above. Pagination ends at page 112,975; page 112,976
returns empty.

A harvest sized from `_count` under-fetches without erroring.

### 3. The NPI is marked four different ways, and three defeat a naive parser

| Publisher | Where the NPI marker lives |
|---|---|
| NDH before 2026-05-08, most vendor files | `identifier.system = http://hl7.org/fhir/sid/us-npi` |
| NDH from 2026-05-08 | `identifier.system = http://terminology.hl7.org/NamingSystem/npi` |
| Capital BlueCross `Practitioner` | `identifier.type.coding[].system` + `code = "NPI"`; `identifier.system` is absent |
| Capital BlueCross `Organization` | no coded marker at all; only `assigner.display = "CMS"` |

Every one of these failures returns an empty list rather than raising, so
nothing downstream notices. The first Capital BlueCross pass read 2,000
practitioners and reported zero NPIs, and the extractor looked correct.

The organization case cannot be solved by "any 10-digit value": the same
organizations carry NCPDP identifiers that are also 10 digits, and 3 of 59
sampled NCPDP values passed the NPI check digit. The assigner check is what
excludes those; the check digit is what excludes malformed CMS values. Both are
required, the fallback is opt-in, and coded versus inferred counts are published
separately.

This is now handled in `analysis/fhir_identifiers.py` with 47 tests covering all
four shapes, the negative controls, and 15 malformed inputs.

## Method

1. Harvest the whole directory with `analysis/harvest_payer_directory.py`
   (curl-based, resumable, part-file output, failed pages recorded).
2. Extract NPIs with the four-way matcher; require a valid check digit.
3. Load the NPI set into BigQuery as a table. A query parameter array cannot
   carry 60k values, and autodetect reads NPIs as integers, so the schema is
   explicitly `npi:STRING`.
4. Join against `cms_npd.practitioner` (active), `cms_npd.practitioner_role`
   and `cms_npd.cms_dac_clinician_org` in one capped query.
5. Fetch `PractitionerRole` for the gap cohort only, by `practitioner=`, to
   build the crosswalk.

### Why the role fetch is targeted rather than a full sweep

A full `PractitionerRole` sweep is 112,975 pages, about 20 hours at the observed
sustained rate. The rows carrying new information are those for practitioners
the NDH has no affiliation for, roughly a quarter of the directory, so roles are
fetched by `practitioner=` for that cohort: about 25,000 requests instead of
113,000.

The trade is stated wherever the output is used: the published crosswalk has
role coverage for the gap cohort, not for the whole directory.

### Rate limits and politeness

Throughput was measured before committing to a long run, not guessed: 24
requests at 1, 4, 8 and 12 concurrent workers gave 1.05, 3.11, 3.63 and 4.25
req/s at 0.95s, 1.24s, 1.89s and 2.21s mean latency. Throughput saturates near
8 workers while latency keeps climbing, so 8 is the default. Sustained rate over
a long run settles near 1.2 pages/s.

## Robustness check

"The NDH gives no affiliation" is defined on **active** roles, which is the
definition that matters to a directory consumer: an inactive role is not a
usable affiliation. The more conservative test counts roles of any status, and
the result survives it. Both numbers are published in the finding payload.

## Limitations

- Capital BlueCross is regional to central Pennsylvania. This is not a statewide
  or national measurement, and the net-new share will differ for other payers.
  Highmark and Independence Blue Cross cover the rest of the state and neither
  published a discoverable FHIR base URL when probed.
- Network participation is not a treating relationship. A payer listing means
  the provider is contracted, which is the affiliation a directory should carry,
  but it is not evidence of care delivered at that organization.
- CMS DAC covers Medicare-enrolled clinicians only. "Net-new" means absent from
  the NDH and from CMS DAC, not absent from every source that exists.
- Payer directories carry their own accuracy problems and are not treated as
  ground truth here. The claim is that they carry an edge the NDH does not, not
  that the edge is correct.

## Commands

```bash
# 1. Harvest the directory (resumable; writes to the gitignored analysis/data/)
python3 analysis/harvest_payer_directory.py --payer capital-bluecross \
    --resource Practitioner Organization --workers 8 --resume

# 2. Measure the gap and write the finding + crosswalk
python3 analysis/h52_payer_affiliation_gap.py --payer capital-bluecross

# 3. Roles for the gap cohort only, for the crosswalk
python3 analysis/harvest_payer_directory.py --payer capital-bluecross \
    --roles-for-ids analysis/data/payer/capital-bluecross/gap-practitioner-ids.txt \
    --workers 8 --resume

# Tests
python3 -m pytest analysis/tests/
```
