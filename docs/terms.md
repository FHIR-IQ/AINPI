# Terms of use

Last updated 2026-08-23.

These terms cover ainpi.dev, the JSON and CSV files under `/api/v1/`, the
search and lookup APIs, the MCP server, and any AINPI dataset published
through a data marketplace or a Delta Sharing recipient.

If you do not accept these terms, do not use the service.

## What this is

AINPI is a public-interest research project that audits federal healthcare
provider directory data. It measures published government files and reports
what it finds, with the compute scripts open so anyone can reproduce or
contradict the result.

It is a measurement of a dataset. It is not a provider directory, a
credentialing service, a clearinghouse, or a source of truth about any
individual practitioner or organization.

## Verify before you act

Every AINPI signal is a data-quality flag derived from cross-checking public
federal databases. A flag means the sources disagree. It does not mean a
provider has done anything wrong.

This matters concretely. AINPI has published a documented false-positive rate
in one of its own signals. The SAM.gov extract sometimes carries an NPI that
does not belong to the named excluded party. In one worked example, three of
four candidates turned out to be false positives, and only a check against the
primary sources caught them. Every affected record ships with the verification
URLs.

**Never decide anything about a named provider on an AINPI record alone.** That
covers enrollment, payment, credentialing, employment, network and referral
decisions. Check the primary sources first: the NPPES registry, the OIG
exclusions list, and SAM.gov. If an AINPI record and a primary source disagree,
the primary source is right, and we would like to hear about it.

## No warranty

The service is provided as is, without warranty of any kind, express or
implied, including fitness for a particular purpose. AINPI does not warrant
that the data is accurate, current or complete. Upstream sources change
without notice, and some of them have changed in ways that silently broke
measurements; where that has happened it is recorded in the methodology.

To the maximum extent permitted by law, AINPI and FHIR IQ are not liable for
any loss arising from use of the service or reliance on its output.

## Acceptable use

You may read, query, download, redistribute and build on AINPI data under the
terms on the [data licence](/data-license) page. You may not:

- present AINPI output as an official government record, or as a determination
  about any individual;
- use it to harass, defame or make an adverse determination about a named
  provider without independent verification;
- attempt to re-identify any individual beyond what the public source files
  already disclose;
- circumvent rate limits, or issue automated traffic at a volume that degrades
  the service for others.

Rate limits apply to every metered route and are published on the
[developer page](/developer). Static files under `/api/v1/` are served from a
CDN and are not rate limited. Exceeding a limit returns HTTP 429; sustained
abuse may result in a block.

## Personal data

The underlying federal files are public and contain business contact
information about providers. AINPI publishes counts, locations and identifiers
drawn from those files, and deliberately does not republish sensitive values it
finds in them. When a scan detected Social Security numbers in the federal
export, the finding reported the count, the field they sat in and the affected
states, and did not publish the numbers themselves.

If you are a provider and believe a record about you is wrong, the fix belongs
upstream at NPPES, because that is where the data comes from. Write to
gene@fhiriq.com and we will tell you which source produced the record.

See the [privacy policy](/privacy) for what the site collects about you, which
is nothing unless you submit a form.

## Paid tiers

Where an AINPI dataset or service is offered on paid terms, those terms are set
out in the applicable order form or marketplace listing and take precedence over
this page where the two conflict. Nothing here obliges AINPI to keep any free
tier available indefinitely, though the release archive of federal public-use
files is intended to stay free.

## Changes

These terms may change. Material changes will be noted here with a new date at
the top, and the full history is in the git repository.

## Contact

gene@fhiriq.com
