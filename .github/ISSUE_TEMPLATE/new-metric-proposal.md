---
name: New metric proposal
about: Propose a new hypothesis to add to the check catalog (H23+)
title: "[H-NEW] "
labels: ["metric-proposal", "needs-triage"]
---

## Hypothesis

State the hypothesis as a single falsifiable sentence.

> Example: *"H23 — Share of Organizations without a state-code value in any address."*

## Null hypothesis

What outcome would make this metric uninteresting?

## Data source

- **Resources / tables used:**
- **Required joins or external data (NPPES, NUCC, USPS, etc.):**
- **Known gaps or limitations:**

## Computation

Pseudocode or SQL sketch. Include the denominator, not just the numerator.

```sql
-- example
SELECT COUNT(*) / (SELECT COUNT(*) FROM organization) AS share
FROM organization
WHERE _state IS NULL;
```

## Output shape

- **Headline number:**
- **Supporting chart type (if any):**
- **FHIR `VerificationResult` fields you'd populate:**

## Newsworthiness threshold

Define the value at which the finding becomes publication-worthy. Without this the metric will be added but won't be prioritized.

## Acceptance checklist (for maintainers)

- [ ] Hypothesis is falsifiable
- [ ] Denominator is explicit
- [ ] Computation uses already-ingested data, or the external source is reproducibly obtainable
- [ ] Check catalog entry + methodology section drafted in the same PR
