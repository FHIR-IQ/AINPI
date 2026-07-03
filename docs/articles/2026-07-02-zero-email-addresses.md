# The federal provider directory has 2.9 million fax lines and zero email addresses

The CMS National Provider Directory carries a telecom entry for nearly every
active practitioner. Here is the complete breakdown of what kind, measured on
the 2026-05-08 release across 7,196,385 active Practitioner records:

| Telecom system | Practitioners carrying one | Share |
|---|---|---|
| phone | 7,195,270 | 99.98% |
| fax | 2,871,690 | 39.9% |
| email | 0 | 0% |
| url | 0 | 0% |

Not sparse. Not partially populated. Zero email addresses on any of the 7.2
million practitioner records, while fax remains on 2.9 million of them.

## Why this happens

NPPES, the upstream source of roughly 90% of these fields, collects a
contact email during enumeration but does not carry it into the public
dissemination file, so it never reaches the NDH. Fax, a legacy required
field from paper-era workflows, is public. The result is a federal directory
that can route a referral to a fax machine but cannot route one to an inbox.

## Why it matters

1. **Anyone building "contact this provider" gets phone and fax, full stop.**
   If your product assumes email is available somewhere in the record, it is
   not, on any of the three FHIR resources (Practitioner, PractitionerRole,
   Location).

2. **Direct messaging fills part of the gap, but it is not email.** The NDH
   Endpoint table carries 1.25 million Direct Trust HISP addresses. Those are
   clinical-messaging endpoints requiring HISP membership, not addresses a
   patient or an administrative workflow can reach.

3. **The fax number is a data-quality tell.** A directory field that survives
   from a deprecated workflow while the replacement channel stays at zero says
   something about which fields get maintained and which get carried forward
   untouched.

## Verify it yourself

The measurement is part of finding H43 (practitioner phone-number
reachability). The per-system counts are in the finding notes, the compute
script is one capped BigQuery scan, and the raw NDH files are public.

- Finding: <https://ainpi.dev/findings/practitioner-phone-reachability>
- Compute script: [`analysis/h43_practitioner_phone.py`](https://github.com/FHIR-IQ/AINPI/blob/main/analysis/h43_practitioner_phone.py)
- Source data: <https://directory.cms.gov/> (2026-05-08 release)
