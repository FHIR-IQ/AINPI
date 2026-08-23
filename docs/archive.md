# The release archive

CMS publishes the National Provider Directory as a bulk FHIR export and serves
only the current version. When a new release lands, the previous one is gone
from the source.

We keep them. The archive is free, and it is meant to stay that way for a
reason worth stating: serving it costs us close to nothing, because recipients
read the files directly rather than through anything we have to run. This page
explains what is in it and how to get it.

## What is in it

| | |
| --- | --- |
| Releases | 2026-05-08, 2026-08-20 |
| Rows | 54,162,643 |
| Tables | Practitioner, PractitionerRole, Organization, OrganizationAffiliation, Location, Endpoint |
| Shape | The untouched FHIR resource JSON, plus flattened columns |
| Partitioned by | `release_date` |

Every row keeps the original resource, so nothing is lost to our parsing. The
flattened columns sit alongside it so ordinary questions do not require JSON
parsing. Both releases run through the same extraction code, which matters more
than it sounds: comparing two releases should not mean comparing two parsers.

## What it is for

Questions that need two releases at once. Here is one, and it is the reason the
archive exists rather than a demonstration invented for it.

Between these two releases CMS added about seven million `PractitionerRole`
records, a rise of 173%. `PractitionerRole` is the record that says where a
clinician works, and without one there is no organization, no address, and no
way for software to reach that clinician. So seven million more of them sounds
like the directory roughly doubling its usefulness.

It did not. The share of active clinicians who have one moved 4.5 points, from
26.9% to 31.4%. The rest of the new records went to people the directory already
described, taking the average covered clinician from about two role records to
nearly five.

Both of those are real improvements and they are different improvements. A
headline record count cannot tell them apart, and neither can a single release.

## One thing to know before you write a diff

Practitioner and Organization ids embed the NPI and are stable across releases.
**Endpoint and Location ids are random UUIDs that CMS regenerates on every
export.** Zero of them survive from one release to the next, so a cross-release
diff joined on `_id` reports total churn that did not happen.

Join Endpoint on `_address` instead, which matches cleanly. For Location there
is no reliable key in these columns: a normalised name-plus-address match
recovers roughly three quarters of rows, and any Location diff should state its
match rate. The table comments carry the same warning, so you meet it before
writing the join rather than after.

## How to get it

**Databricks Marketplace.** Listing coming shortly. It will be free and
instantly available, with a notebook that reproduces the finding above.

**Directly, with no Databricks account.** The archive is served over
OpenSharing, formerly Delta Sharing, which is an open protocol. A credential
file and the `delta-sharing` Python package are enough:

```python
import delta_sharing
df = delta_sharing.load_as_pandas(
    "ainpi.share#ainpi-ndh-archive.ainpi.practitioner", limit=1000
)
```

Ask for a credential at gene@fhiriq.com and say which organization you are, so
usage is attributable to something other than a shared token.

## Licence

The underlying federal files are US government works and are not subject to
copyright. **AINPI claims no rights over them and grants none, because it has
none to grant.** The compilation and the extraction code are Apache-2.0.

Attribution is requested rather than required, and the reason is practical
rather than proprietary. Every number here is tied to a release date and a
methodology version, both of which change. A figure quoted without provenance
cannot be checked against the release it came from. Full terms at
[/data-license](/data-license).

## What this is not

A measurement of a federal file, not a source of truth about any individual
practitioner. Do not make an enrolment, credentialing, payment or network
decision about a named provider from a record here without checking the primary
sources: the NPPES registry, the OIG exclusions list, and SAM.gov. See
[/terms](/terms).

## Contributing

This is a public-good project and the corrections are the most useful thing
anyone sends.

- **A number here disagrees with something you can verify.** That is the most
  valuable message we get. [Open an issue](https://github.com/FHIR-IQ/AINPI/issues).
- **You want a release we do not have.** We started archiving in April 2026.
  Anything earlier is gone from CMS and we cannot recreate it. If you kept one,
  we would like to publish it with your attribution.
- **You are building on this.** Tell us what shape you need. The flattened
  columns exist because someone asked.
- **The compute is open.** Every measurement on this site ships with the script
  that produced it, at [github.com/FHIR-IQ/AINPI](https://github.com/FHIR-IQ/AINPI).
  Reproducing a finding and getting a different answer is a contribution.

## Related

- [Findings](/findings), the measurements this data supports
- [Per-state audit slices](/states), all 50 states and DC
- [Methodology](/methodology), how a finding gets registered before it is computed
- [Data sources](/data-sources), every public dataset this project uses or rejects
- [Developer API](/developer), the stable JSON contract
