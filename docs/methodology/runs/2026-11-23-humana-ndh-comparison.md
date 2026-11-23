# Humana, NPD and NPPES: Pennsylvania practice ZIP and phone, 2026-11-23

Plan: `docs/superpowers/plans/2026-11-03-shared-core-and-humana-exhibit.md`, Task 5. Code: `analysis/nppes_monthly.py`, `analysis/xsource_facts.py`, `analysis/payer_sample.py`, `analysis/exhibit_humana_2026_11.py`. Counts only. Per-NPI rows stay under the gitignored `analysis/data/`.

## Question

For a random sample of Pennsylvania practitioners in the CMS National Provider Directory (NPD), does Humana's public provider directory list the same practice ZIP code and phone number as the NPD, and how do both compare with NPPES? This re-runs the 2026-10-28 demonstration with a recorded draw, a stated n, intervals, and the NPD role Location as the comparison point. The demonstration compared Humana with the practitioner's own NPD address, which overstated ZIP disagreement (the size of that effect is measured below).

## Inputs and as-of dates

| Source | As of | What was read |
| --- | --- | --- |
| NPD | 2026-10-07 release | Local parquet export of Practitioner, PractitionerRole and Location |
| NPPES | 2026-11-02 | `NPPES_Data_Dissemination_November_2026_V2.zip` (1,130,479,129 bytes, downloaded 2026-11-23, size matched the server's Content-Length). 9,891,116 rows. Newest enumeration date 2026-11-02, so the 45-day freshness control passed |
| Humana | 2026-11-23 | Public FHIR provider directory, `Practitioner?identifier=<NPI>`, then `PractitionerRole?practitioner=...&_include=PractitionerRole:location`. No credentials. Terms read the same day: `docs/sources/payer-terms/humana-2026-11-23.md` |

The three sources are 47 days apart at most. A practitioner who moved inside that window can read as a disagreement.

## Scope and draw

- **Scope:** NPD practitioners that are active and hold an active PractitionerRole at a Location in PA: 106,845 practitioners. The facts table for this scope has 2,936,671 rows.
- **Draw:** candidates are ordered by sha256(seed:NPI). The seed is 799405824, drawn at run time and recorded in the gitignored output.
- **Suppression:** NPIs in force on the AINPI removal list were removed before any request. One was in force; it matches the one row recorded in committed payloads.
- **Stopping rule:** the sampler stops at 300 practitioners Humana lists, or at 1,500 requests, whichever comes first. It made at most 2 requests per second.
- **Pilot excluded:** a 30-request pilot (seed 705637801) ran first to check the parser. One listed result was fetched by hand and its ZIPs matched the parsed values. The pilot is not part of the sample.

| | Count |
| --- | --- |
| Practitioners queried | 999 |
| Listed by Humana | 300 (30.0%, 95% CI 27.3 to 32.9%) |
| Not listed | 699 |
| Lookup failed | 0 |
| Search truncated (excluded) | 0 |
| Roles referencing Locations Humana did not return | 0 |
| Requests | 1,339 |
| Stopped because | 300 listed reached |

"Not listed" is not a finding about either directory. A practitioner Humana does not list may simply be outside its networks; this run did not test that.

## Method

- **Normalization:** values are normalized by `analysis/xsource_norm.py`. ZIP becomes the first five digits. Phone is digits only, with a leading 1 dropped from 11 digits, and exactly 10 digits are required.
- **Matching:** any-to-any per practitioner. Two sources agree on a field when any value in one equals any value in the other. A practitioner with several NPD role Locations agrees when Humana lists any one of them.
- **Intervals:** 95% Wilson score intervals.
- **Comparison point:** the NPD side is the Location each PractitionerRole references (`PractitionerRole.location -> Location.address` for ZIP, `Location.telecom` for phone). The practitioner's own NPD address and telecom are reported separately for contrast.
- **Lineage:** NPD draws on NPPES, so NPD matching NPPES may be the export copying its upstream rather than a second source agreeing. Humana's lineage is unknown. No count here treats a match as proof that a value is correct.
- **Taxonomy:** not compared. The sample reads no payer specialty.

## Results (n = 300 practitioners listed by Humana)

### Humana against the NPD role Location

| Field | Agree | Disagree | Humana only or NPD only | Agree share (95% CI) |
| --- | --- | --- | --- | --- |
| Practice ZIP | 259 | 41 | 0 | 86.3% (82.0 to 89.8%) |
| Practice phone | 151 | 148 | 1 | 50.5% of 299 (44.9 to 56.1%) |

### The comparison point matters

| NPD element compared with Humana | ZIP agree | Phone agree |
| --- | --- | --- |
| Role Location (the comparison used here) | 259 of 300 | 151 of 299 |
| Practitioner's own address or telecom | 113 of 300 | 184 of 300 |

Against the practitioner's own NPD address, ZIP agreement falls from 259 to 113. This choice of comparison point is enough to produce higher ZIP disagreement like the 2026-10-28 demonstration's; that run also differed in its draw and n. Phone moves the other way: Humana's location phone matches the practitioner's own NPD telecom more often than the role Location telecom.

### NPD against NPPES (copy fidelity, not agreement)

ZIP: 226 match, 74 differ. Phone: 137 match, 162 differ, 1 one-sided. The NPPES main file, as loaded here, carries one practice location per NPI, so an NPD role Location at a second site reads as differ here without either file being wrong.

### Three-way pattern

These counts cover practitioners where Humana, the NPD role Location and NPPES all carry a value.

| Pattern | ZIP (n = 300) | Phone (n = 299) |
| --- | --- | --- |
| All three match | 168 (56.0%, 50.3 to 61.5%) | 78 (26.1%, 21.4 to 31.3%) |
| Humana differs; NPD and NPPES match each other | 15 (5.0%, 3.1 to 8.1%) | 36 (12.0%, 8.8 to 16.2%) |
| NPD differs; Humana and NPPES match | 13 (4.3%, 2.5 to 7.3%) | 35 (11.7%, 8.5 to 15.8%) |
| NPPES differs; Humana and NPD match | 46 (15.3%, 11.7 to 19.8%) | 45 (15.1%, 11.4 to 19.5%) |
| Two of the three pairs match (several values) | 45 (15.0%, 11.4 to 19.5%) | 28 (9.4%, 6.6 to 13.2%) |
| All three differ | 13 (4.3%, 2.5 to 7.3%) | 77 (25.8%, 21.1 to 31.0%) |

In the row where Humana differs and NPD matches NPPES, the two federal files agree with each other and not with the payer. It covers 5.0% of practitioners for ZIP and 12.0% for phone. Where NPD's value derives from NPPES, that row is one source and its copy, not two independent sources.

## What this cannot show

- **Which value is correct.** Agreement between two directories does not make a value true, and disagreement does not say which side is wrong. Only a contact with the practice can settle that.
- **Any payer but Humana, or any state but PA.**
- **Accuracy by any CMS scoring method.** This is a comparison of public files on stated dates.
- **Change over time.** The Humana comparison is a single draw.

## Release-to-release NPD changes, 2026-08-20 to 2026-10-07

This section covers all in-scope PA practitioners, not the Humana sample. 101,016 were in scope in both releases, 8,105 in August only and 5,829 in October only. The NPPES side is the November 2026 file in both cases. The August facts table has 3,328,682 rows for 109,121 practitioners.

**Definitions:**

- **Changed:** a practitioner's set of normalized role-Location values differs between the two releases.
- **Export artifact:** every value the NPD dropped is still in the current NPPES main file.

| Role Location field | Changed | Values dropped, all still in NPPES | Share of changes passing the artifact test |
| --- | --- | --- | --- |
| ZIP | 25,776 (25.5%, 25.2 to 25.8%) | 659 | 2.6% (2.4 to 2.8%) |
| Phone | 76,269 (75.5%, 75.2 to 75.8%) | 764 | 1.0% (0.9 to 1.1%) |

Breakdown of the changes:

- **ZIP:** 15,298 practitioners only gained values; 9,819 dropped a value that NPPES does not hold.
- **Phone:** 16,066 only gained values; 59,439 dropped a value that NPPES does not hold.

**This test cannot tell export churn from real change.**

- The NPD role-Location sets average about 5 ZIPs and 10 phones per practitioner in both releases. The NPPES main file holds one practice location.
- A dropped second site can therefore never pass the test, so the artifact share is a floor that sits close to zero by construction.
- The test neither supports nor refutes the earlier reading that release-to-release NPD changes are mostly the export changing.

What the counts do show:

- Most practitioners' role-Location phone sets differ after seven weeks, and a quarter of their ZIP sets do.
- The 2026-10-07 release removed many second and third PractitionerRole records, and a removed role takes its Location with it.

A consumer should not read a release-to-release difference in these fields as the provider having moved. A better test needs an upstream that lists every practice location: the NPPES secondary practice location file, or PECOS practice addresses.

## Reproduce

```bash
python3 analysis/nppes_monthly.py --announce
python3 analysis/nppes_monthly.py --download --confirm
python3 analysis/nppes_monthly.py --load analysis/data/nppes/NPPES_Data_Dissemination_November_2026_V2.zip
python3 analysis/xsource_facts.py --release 2026-10-07 --nppes-month 2026-11 --states PA
python3 analysis/xsource_facts.py --release 2026-08-20 --nppes-month 2026-11 --states PA
python3 analysis/payer_sample.py humana --release 2026-10-07 --state PA --seed 799405824
python3 analysis/exhibit_humana_2026_11.py \
  --facts analysis/data/xsource/2026-10-07/facts.parquet \
  --sample analysis/data/payer-sample/humana/2026-11-23-seed799405824.parquet \
  --earlier-facts analysis/data/xsource/2026-08-20/facts.parquet
```

Re-running with the same seed draws the same candidates, but Humana's answers can change between runs.
