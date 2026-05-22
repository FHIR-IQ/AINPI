# Eight years post-exclusion, still billing Medicare $880,000 a year. The data was on data.cms.gov the whole time.

*by Eugene Vestel · 2026-05-22 · cross-posted to Substack and LinkedIn*

---

In June 2015, the Office of Inspector General excluded a physician from all Federal health care programs under Section 1128(a)(1) of the Social Security Act. That's the mandatory exclusion — the one triggered by a conviction for a Medicare or Medicaid-related crime. The exclusion bars the physician from billing, ordering, or receiving payment from Medicare, Medicaid, or any other Federal health care program. The law is 42 USC § 1320a-7(a)(1); the regulation is 42 CFR § 1001.1901. The physician's name has been on the OIG's public exclusions list, with their NPI, every day since.

In calendar year 2023, that physician billed Medicare Part B for approximately $880,000.

The billing detail is public. The exclusion is public. The NPI is active in NPPES. All three primary sources can be checked in roughly three minutes by anyone with a browser. None of this required a FOIA request, an MMIS query, or a vendor relationship. It is sitting on data.cms.gov, in the Medicare Physician & Other Practitioners by Provider and Service file — a 3.06 GB CSV that CMS published in April 2025 and updated for CY 2024 yesterday.

The physician is real and the case is verifiable. I'll name them at the end, with the verification URLs. First the methodology, because the methodology is the point.

---

## What the file says

CMS publishes annual NPI-level Medicare billing detail. The "by Provider and Service" version has one row per (NPI, HCPCS code, place-of-service) combination per service year. For CY 2023 that's 9.66 million rows. Each row tells you what an NPI billed, how many times, and what Medicare paid on average. CMS suppresses any cell with fewer than 11 beneficiaries for privacy, which is the right tradeoff but worth knowing: any number you see in this file is a lower bound on the underlying activity.

What it doesn't tell you is whether the NPI was supposed to be billing.

The OIG runs a separate file — the List of Excluded Individuals/Entities. SAM.gov publishes a third — the Federal exclusions extract. The Federal payment gates are supposed to read both lists before approving an NPI for billing. State Medicaid programs are required to check the OIG LEIE every month per 42 CFR § 455.436. Major Federal contractors built their entire compliance practice on these two lists. They're not obscure.

The join is the audit. Take every active LEIE/SAM exclusion record and ask the Medicare Part B detail file: did this NPI bill anything? Filter strictly to NPIs whose exclusion date was before the service year, so you're not looking at someone who was working legitimately at the time the bills accrued. What's left is the set of (provider, procedure code) pairs where the Federal payment gate failed open.

That's the cross-audit AINPI ships as H40. The script is 300 lines of Python. The audit took 38 seconds to run.

## The 4 candidates, the 1 confirmed case

Across all 50 states, DC, and territories, the cross-audit surfaced four NPIs with strict-post-exclusion Part B billing in CY 2023.

Three of them turned out to be SAM-NPI-join false positives.

This is worth dwelling on because it's the entire methodological point. The cohort builder I use takes the SAM.gov Public Extract and joins it on the NPI field. SAM is a less curated dataset than LEIE — the NPI field is sometimes a clerical artifact, sometimes the right NPI for a different individual, sometimes blank. Three of the four candidates have an NPI that, when you check NPPES, belongs to someone with a different name than the SAM exclusion record. They aren't the excluded party. The audit surfaced them; primary-source verification eliminated them.

The verification took five minutes. Anyone reading this could do it. The URLs were on the line in the CSV that AINPI publishes for every state Medicaid PI office.

One candidate survives verification: NPI 1285673012, Eduardo Siria Miranda, MD, in Laredo, Texas. The OIG LEIE record matches the SAM record. The NPPES record shows the same name and a matching practice address. The NPPES NPI is active and last updated 2025-06-24 — last summer. The exclusion is mandatory under Section 1128(a)(1), dated June 18, 2015, and never reinstated.

In CY 2023 — eight years after the exclusion — Dr. Miranda's NPI billed Medicare Part B for approximately $880,000. The procedure mix is what you'd expect from an oncology practice:

- **J9271 (pembrolizumab)** — 14,205 mg of Keytruda administered. Estimated paid: $610,117.
- **J0897 (denosumab)** — 5,521 mg of Prolia. Estimated paid: $100,703.
- **96413 (chemotherapy administration, IV infusion)** — 318 services.
- **Multiple other infusion and injection codes**, plus office visits and hospital subsequent care.

The full list of 35 HCPCS codes Miranda's NPI billed in CY 2023 is in the per-state CSV at `/api/v1/states/tx/h40-excluded-partb-by-hcpcs.csv` on ainpi.dev. Every row carries a verification URL. None of this is AINPI's claim — it's CMS's data, joined to OIG's data, joined to SAM's data, against AINPI's published per-state cohort. Each component is public.

## Three caveats that make the case stronger, not weaker

**One: cell suppression.** The number is a lower bound. CMS suppresses any (NPI, HCPCS, POS) cell with fewer than 11 beneficiaries. Whatever Miranda's NPI billed below that threshold isn't visible in this file. The actual billing volume is at least $880K; we can't measure how much higher.

**Two: NPI vs natural person.** An NPI is not a person; it is an identifier. The same NPI can be used to bill on behalf of a practice, a hospital, or a group of clinicians. The exclusion attaches to the natural person; the billing attaches to the NPI. There are scenarios — assignment of benefits, locum tenens arrangements, billing under a group NPI — where an excluded provider's services could be billed under a different NPI than their own. The case I'm naming here is the simpler version: Miranda's individual NPI, in active NPPES status, billed under the same NPI that's on the OIG exclusion list. That's the iron-clad pattern. The interesting cousin — excluded providers billing under group NPIs they don't appear on — is a separate audit AINPI has not yet run.

**Three: the recoupment math is per-claim.** Recoupment letters don't say "this provider was excluded." They say "these specific claims, on these specific dates, for these specific HCPCS codes, totaling this specific dollar amount, were paid in violation of 42 USC § 1320a-7." H40's CSV is shaped for that workflow — per-(NPI, HCPCS, POS) rows. Each row is the unit a state Medicaid PI letter writes against. The Federal recoupment surface is broader than that — the OIG can pursue civil monetary penalties under § 1320a-7a(a)(7), and the DOJ can pursue False Claims Act cases — but the state-side workflow is per-claim.

## What this changes for state Medicaid programs

For state Medicaid CMOs and PI offices, this finding has a specific operational use:

- Pull `https://ainpi.dev/api/v1/states/<your-state>/h40-excluded-partb-by-hcpcs.csv`. It's free and public.
- Filter to `post_exclusion_2023_billing=yes`.
- For each row, click the LEIE and SAM URLs in the row. Verify the name matches the excluded record. If not — three of four times, in this run — it's a SAM-NPI false positive and you skip it.
- For the survivors, run the same NPI against your MMIS for any state Medicaid activity in the same window. If there's overlap, you have a state recoupment candidate on top of the Federal one.

For Texas specifically: any Medicaid activity by NPI 1285673012 between June 18, 2015 and today is recoupment-eligible per § 455.436 and § 1320a-7. I haven't checked Texas MMIS for this NPI — I don't have access. Anyone at Texas HHSC or the Texas Medicaid PI office can.

## What this says about the Federal directory

This is the angle I'm publishing alongside the case-narrative version (which is my next post): the Federal directory itself is the slowest moving part of the system. The OIG list is current. The SAM list is current. CMS Medicare claims are current within the publication lag of about two years. NPPES is current — Miranda's NPI was last updated last summer.

The directory says active. The exclusion list says excluded. The payment gate let the bills through. There is no party in this picture that doesn't know what the others know — the data is all public, all joinable on NPI, all sitting in the same three CMS systems. Closing the audit loop between LEIE, NPPES, and Medicare Part B is mechanical. The script that surfaced this case is 300 lines.

That's not a critique of any individual agency — each of them is doing their part. It's a statement that nobody is currently joining them.

## Methodology and sources

Every claim above is rooted in a public file you can download:

- **Medicare Physician & Other Practitioners by Provider and Service** — CMS, RY2025 (CY 2023 service year), 3.06 GB CSV, [data.cms.gov](https://data.cms.gov/provider-summary-by-type-of-service/medicare-physician-other-practitioners/medicare-physician-other-practitioners-by-provider-and-service). License: public domain (CC0-equivalent).
- **OIG LEIE** — HHS OIG, monthly file, [exclusions.oig.hhs.gov](https://exclusions.oig.hhs.gov/).
- **SAM.gov Public Extract V2** — GSA, monthly file, [sam.gov](https://sam.gov/search/?index=ex).
- **NPPES NPI Registry** — CMS, real-time, [npiregistry.cms.hhs.gov](https://npiregistry.cms.hhs.gov/).

AINPI's compute script for H40: [`analysis/claims_sources/medicare_partb_by_hcpcs.py`](https://github.com/FHIR-IQ/AINPI/blob/main/analysis/claims_sources/medicare_partb_by_hcpcs.py). Apache 2.0, runs in about 40 seconds. Source streamed once, partitioned across all 51 state cohorts in memory.

AINPI's provenance document for this run: `docs/methodology/runs/2026-05-22-h40-h41-h42-baseline.md` in the repo. Captures source SHA-256, schema, sample cases, cross-validation against H30a (the aggregate per-NPI variant), and the SAM-NPI false-positive finding.

The 1-of-4 confirmation rate is itself a public dataset. The other three NPIs and the names they actually belong to in SAM are documented in the provenance doc. Anyone running similar audits on SAM-joined NPI data should plan to budget for a primary-source verification step.

## The longer point

There is a category of Federal health care audit work that doesn't require new data, new infrastructure, or new authority — it requires joining three lists that already exist. The lists exist. The exclusions exist. The Medicare billing data exists. The NPI is the join key. Where the work hasn't happened, it hasn't happened because nobody is yet incentivized to spend two days writing the join.

AINPI exists to demonstrate what the join produces, in public, at zero cost to anyone reading. Today the answer is at least one confirmed strict-post-exclusion Medicare Part B billing case, eight years in, approximately $880,000 in a single calendar year. Tomorrow's answer will include the CY 2024 file, which CMS published yesterday — we'll re-run on that as a separate update.

If you're at a state Medicaid program and want the per-state cross-audit for your jurisdiction, it's already published. If you're a journalist or academic working this surface, the per-NPI CSV with verification URLs is the unit to start from. If you're at CMS or OIG and want to read the script and tell me where the methodology is wrong, the repository is public and the issues page is open.

The case I named is one. The methodology is the point.

---

**Eugene Vestel** · [AINPI](https://ainpi.dev) · [GitHub](https://github.com/FHIR-IQ/AINPI) · gene@fhiriq.com

*AINPI is a research project that audits the CMS National Directory of Healthcare against Federal exclusion lists and Medicare/Medicaid claims data. It is independent, open-source (Apache 2.0), not affiliated with any state agency, and never represented as produced for or guided by any state or Federal agency. Every finding carries primary-source verification URLs because primary-source verification is the only thing that turns a candidate into a case.*
