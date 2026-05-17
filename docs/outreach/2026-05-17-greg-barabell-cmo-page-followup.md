# Email draft — to Greg Barabell (VA DMAS CMO) re: CMO-facing pages

**To:** greg.barabell@dmas.virginia.gov
**Subject:** AINPI — the CMO-facing version you asked for, plus the SC file

---

Greg —

Thanks for the pushback on the May 14 update; you were right that the long version wouldn't survive a CMO listserve forward. I built the shorter, less-technical version you suggested.

Two URLs you can forward as-is. Each one stands on its own — no setup, no login, no procurement, no acronym overhead beyond NPI. The hero of each page is the actionable count and the CSV.

**Virginia:**
https://ainpi.dev/for-state-medicaid/va
(125 federally-excluded providers still listed in the federal directory, with primary-source verification URLs on every row for your PI staff.)

**South Carolina:**
https://ainpi.dev/for-state-medicaid/sc
(33 providers. Same file shape, same workflow, ready for the SC CMO whenever you're ready to forward.)

The page itself runs about a minute of CMO reading time, then hands the technical detail off behind a "for your technical team" disclosure that links to the deeper briefing, methodology, and per-state JSON. The lede is the count and the CSV; methodology lives below the scroll for the staff who pick this up after a forward.

Three structural notes for the listserve send if useful:

- I deliberately anchored every page to the 2026-04-23 SMD letter and the May 23 response deadline. Element 2 ("public-facing data or reporting") is the part AINPI most directly supplies; a new cross-audit band on each page also gives the CMO citation-ready ammunition for Element 4 ("other comprehensive measures").
- The four-database framing (NPPES + OIG LEIE + SAM.gov + SSA-DMF) is on the page so the CMO can see we cover three of the four out of the box.
- Each row in the CSV carries one-click verification URLs to LEIE, SAM, and the NPPES Registry, so nothing in AINPI has to be taken on faith — every flag is independently checkable in 30 seconds.

The new cross-audit band on each page summarizes what we found beyond the directory itself — translated to plain English for the CMO audience:

- **The federal payment gate is mostly doing its job.** 0 of the 125 VA cohort received Medicaid, Medicare Part B, or Medicare Part D payment strictly after their exclusion took effect. Worth citing in your SMD response as evidence the federal-program payment side is mostly holding once exclusions are processed.
- **Directory hygiene is the persistent problem.** 99.99984% of material Medicare Part B billers are present in the federal directory. Coverage is excellent; currency is where the failures live (deactivated-still-listed, excluded-still-listed). This is exactly what the SMD letter is reaching for.
- **3 of 1,495 VA-state NPPES-deactivated NPIs still show billing activity** — closed identifiers for the MMIS reconciliation queue.
- **17 candidate-demographic matches between VA-state facility owners and the OIG LEIE list** — SNF, hospice, HHA, hospital owners with name + state matches. Needs human verification at the LEIE portal before action; not a fraud determination.
- **6 of 10 VA-cohort Medicare Part D prescribers wrote opioid prescriptions** (full-window). Feeds directly into the DEA Opioid Coordination queue.
- **198 of 8,619 federally-excluded providers nationally received industry payments strictly post-exclusion in PY 2024** ($167K). The Sunshine Act surface is leaking even when the Medicare/Medicaid gates are holding. 2 are VA-resident.

For SC and any other state CMO who lands on the page, the same cross-audit will be available — the structural design is per-state-aware, and we can compute the claims-side findings against any state's cohort on request. SC's 33-NPI cohort is small enough that the per-state run is fast; happy to ship it before you forward if useful.

If you want me to tighten the language or change any framing before you forward — happy to. If you'd rather forward as-is and we iterate from feedback, that works too.

Same offer for any other state CMO who lands in the conversation: the same URL pattern (`/for-state-medicaid/<state-abbrev>`) works for every state + DC. Files are already published for all 51.

— Eugene
