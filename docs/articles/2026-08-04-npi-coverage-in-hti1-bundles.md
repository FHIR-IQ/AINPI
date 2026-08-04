# Half the published EHR endpoint directory carries an NPI. That half is one vendor.

Certified EHR vendors publish service-base-URL bundles under the HTI-1 rule:
the organizations they host, and the FHIR endpoints those organizations answer
on. The CMS directory team scrapes them from ONC Lantern and caches the result
publicly, which is the most likely path to filling the National Directory's
empty endpoint layer.

Whether that works depends on one unglamorous question. Can you join a
published organization to a federal record? The join key would be the NPI.

Across the full cache, 191 vendors and 287,916 published organizations:

| | Organizations | Carry a valid NPI | Share |
|---|---:|---:|---:|
| All vendors | 287,916 | 148,757 | 51.7% |
| athenahealth | 139,266 | 139,159 | 99.9% |
| Everyone else | 148,650 | 9,598 | 6.5% |

The headline number is a coin flip. The real distribution is one vendor doing
it thoroughly and most of the rest not doing it at all. **101 of the 191
vendors publish no NPI on any organization**, covering 122,963 organizations
between them.

Epic is the largest single case: 84,865 published organizations, zero NPIs. Its
records are identified by internal UUIDs and an `open.epic.com/brand-identifier`
value. Nine of the sixteen vendors publishing 1,000 organizations or more carry
no NPI at all.

## Why this decides the ingestion method

If you are building the join, NPI-primary with a name fallback sounds like the
obvious design. What the data says is that NPI-primary resolves athenahealth's
footprint and almost nothing else. For 48% of published organizations there is
no identifier to match on, so the fallback is the method.

Name-and-city matching does work, but it degrades honestly rather than
silently. Measuring Pennsylvania's 187 hospitals against this cache, exact
name-and-city matching resolved 114, token overlap inside the same city
resolved another 23, and 50 stayed unmatched. That is 73% coverage with a
quality tier attached to every row, which is a usable result as long as the
tiers are published alongside the counts.

The practical consequence for a directory: an unmatched organization is not
evidence of a missing endpoint. It is evidence that two records could not be
tied together.

## Two publishing shapes, both valid

A second structural difference is worth knowing before writing any traversal.

Vendors publish organizations in one of two shapes. The flat shape gives each
organization its own `Organization.endpoint` reference, and athenahealth,
NextGen, eClinicalWorks, Oracle Health and most others use it, linking all
of theirs. The hierarchical shape puts the endpoint on a brand-level
organization and hangs facilities beneath it with `partOf`.

Epic uses the second shape. All 1,187 of its brand-level records carry an
endpoint. The 83,678 facility records beneath them do not, and reach it by
walking up. Both shapes are valid FHIR.

Software that checks only `Organization.endpoint` on the record it matched will
report "no endpoint" for a hospital whose endpoint is live. We made exactly
that mistake in the first version of our Pennsylvania analysis, published it,
and corrected it. Resolve `partOf` before concluding anything.

## What would fix it

Naming an expected identifier in the submission specification would do more for
directory ingestion than any requirement about endpoint references. The
endpoint data is largely there. What is missing is the key that ties it to a
federal record.

## Method and limits

Counts are file and field counts over the public cache at
`ftrotter-gov/npd_slurp_cehrt_clientfhir_cache`, which mirrors a Lantern-derived
scrape rather than Lantern itself. A valid NPI means a 10-digit value on an
identifier whose system names NPI. Vendor attribution is the publishing host
directory.

One data-quality note found in passing: AdvancedMD's entries carry
`synthetichealth/synthea` identifiers and an NPI literally valued `FI`, which
are synthetic test records rather than real customers. They are counted as
carrying no NPI, which is correct, but their presence in a production bundle is
its own problem.

- Pennsylvania dashboard built on this join:
  <https://ainpi.dev/states/pa/rural-health>
- Related pre-registration (H45), the per-state endpoint coverage gap:
  <https://ainpi.dev/findings/cehrt-endpoint-coverage-gap>

Eugene Vestel, FHIR IQ
