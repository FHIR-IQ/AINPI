# Humana, NPD and NPPES: Pennsylvania practice ZIP and phone, 2026-11-23

Plan: `docs/superpowers/plans/2026-11-03-shared-core-and-humana-exhibit.md`, Task 5. Code: `analysis/nppes_monthly.py`, `analysis/xsource_facts.py`, `analysis/payer_sample.py`, `analysis/exhibit_humana_2026_11.py`. Counts only. Per-NPI rows stay under the gitignored `analysis/data/`.

## Question

For a random sample of Pennsylvania practitioners in the CMS National Provider Directory (NPD), does Humana's public provider directory list the same practice ZIP code and phone number as the NPD, and how do both compare with NPPES? This re-runs the 2026-10-28 demonstration with a recorded draw, a stated n, intervals, and the NPD role Location as the comparison point. The demonstration compared Humana with the practitioner's own NPD address, which overstated disagreement (the size of that effect is measured below).

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
- **Stopping rule:** the sampler stops at 300 practitioners Humana lists, or at 1,500 requests, whichever comes first. It ran at 2 requests per second.
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

"Not listed" is not a finding about either directory. Humana lists the practitioners in its own networks, and many PA practitioners are not in one.

## Method

- **Normalization:** values are normalized by `analysis/xsource_norm.py`. ZIP becomes the first five digits. Phone is digits only, with a leading 1 dropped from 11 digits, and exactly 10 digits are required.
- **Matching:** any-to-any per practitioner. Two sources agree on a field when any value in one equals any value in the other. A practitioner with several NPD role Locations agrees when Humana lists any one of them.
- **Intervals:** 95% Wilson score intervals.
- **Comparison point:** the NPD side is the Location each PractitionerRole references (`PractitionerRole.location -> Location.address` for ZIP, `Location.telecom` for phone). The practitioner's own NPD address and telecom are reported separately for contrast.
- **Lineage:** NPD is built from NPPES and PECOS, so NPD matching NPPES is the export copying its upstream, not a second source agreeing. Humana's lineage is unknown. No count here treats a match as proof that a value is correct.
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
| Role Location (the right comparison) | 259 of 300 | 151 of 300 |
| Practitioner's own address or telecom | 113 of 300 | 184 of 300 |

Against the practitioner's own NPD address, ZIP agreement falls from 259 to 113. The 2026-10-28 demonstration's higher disagreement came from this choice of comparison point. Phone moves the other way: Humana's location phone matches the practitioner's own NPD telecom more often than the role Location telecom.

### NPD against NPPES (copy fidelity, not agreement)

ZIP: 226 match, 74 differ. Phone: 137 match, 162 differ, 1 one-sided. NPPES carries one practice location per NPI, so an NPD role Location at a second site reads as differ here without either file being wrong.

### Three-way pattern

These counts cover practitioners where Humana, the NPD role Location and NPPES all carry a value.

| Pattern | ZIP (n = 300) | Phone (n = 299) |
| --- | --- | --- |
| All three match | 168 (56.0%, 50.3 to 61.5%) | 78 (26.1%, 21.4 to 31.4%) |
| Humana differs; NPD and NPPES match each other | 15 (5.0%, 3.1 to 8.1%) | 36 (12.0%, 8.8 to 16.2%) |
| NPD differs; Humana and NPPES match | 13 (4.3%, 2.6 to 7.3%) | 35 (11.7%, 8.5 to 15.8%) |
| NPPES differs; Humana and NPD match | 46 (15.3%, 11.7 to 19.9%) | 45 (15.1%, 11.4 to 19.5%) |
| Two of the three pairs match (several values) | 45 (15.0%, 11.4 to 19.5%) | 28 (9.4%, 6.6 to 13.2%) |
| All three differ | 13 (4.3%, 2.6 to 7.3%) | 77 (25.8%, 21.1 to 31.0%) |

The row where Humana differs and NPD matches NPPES is the pattern a payer would see as "the federal sources agree with each other and not with us". It covers 5.0% of practitioners for ZIP and 12.0% for phone. Because NPD derives from NPPES, that row is one source and its copy, not two independent sources.

## What this cannot show

- **Which value is correct.** Agreement between two directories does not make a value true, and disagreement does not say which side is wrong. Only a contact with the practice can settle that.
- **Any payer but Humana, or any state but PA.**
- **Accuracy by any CMS scoring method.** This is a comparison of public files on stated dates.
- **Change over time.** This is a single draw.

## Release-to-release NPD changes

Not computed in this run. The 2026-08-20 Practitioner and PractitionerRole parquet files were evicted to iCloud and had not downloaded by the time of writing. `analysis/exhibit_humana_2026_11.py --earlier-facts` computes it once `facts.build('2026-08-20', '2026-11', ['PA'])` has run. The definition it uses:

- A practitioner's role-Location ZIP or phone set "changed" when it differs between the two releases.
- A change is counted as an export artifact when every value NPD dropped is still in the current NPPES file.
- This is a lower bound, because NPPES holds one practice location, so a dropped second site can never pass the test.

## Reproduce

```bash
python3 analysis/nppes_monthly.py --announce
python3 analysis/nppes_monthly.py --download --confirm
python3 analysis/nppes_monthly.py --load analysis/data/nppes/NPPES_Data_Dissemination_November_2026_V2.zip
python3 analysis/xsource_facts.py --release 2026-10-07 --nppes-month 2026-11 --states PA
python3 analysis/payer_sample.py humana --release 2026-10-07 --state PA --seed 799405824
python3 analysis/exhibit_humana_2026_11.py \
  --facts analysis/data/xsource/2026-10-07/facts.parquet \
  --sample analysis/data/payer-sample/humana/<date>-seed799405824.parquet
```

Re-running with the same seed draws the same candidates, but Humana's answers can change between runs.
