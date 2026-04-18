---
name: NPI exception report
about: AINPI flagged a valid NPI as invalid, or missed an invalid one
title: "[NPI] "
labels: ["npi-validation", "needs-triage"]
---

## The NPI

- **NPI (10 digits):**
- **Resource ID(s) in the NPD dump where it appears:**
- **Resource type(s):** Practitioner / Organization

## What AINPI reported

- [ ] AINPI flagged this NPI as **invalid** but I believe it's valid
- [ ] AINPI reported this NPI as **valid** but NPPES shows it's deactivated or malformed
- [ ] AINPI's name / specialty match disagrees with NPPES

## NPPES evidence

- **NPPES dissemination file vintage:**
- **NPPES API or file record** (paste the relevant fields or link):

## AINPI output

- **Page / finding URL:**
- **Specific column(s) / field(s) showing the problem:**

## Expected resolution

- [ ] Fix the check
- [ ] Add this NPI to a known-exception list with a documented reason
- [ ] Update the methodology to describe this edge case

## Additional context

Any upstream CMS communication about this record, known data-cleanup events, etc.
