# Changelog

## 0.1.0

First release. `npi-check-digit` implements H9 as the methodology defines it: ten digits, first digit 1 or 2, and a valid Luhn check digit. The first-digit rule was found missing during the 2026-08-20 backfill, before anything was published, so it is part of 0.1.0 and rule version 1. Before the fix the rule counted 0 invalid NPIs in that release against the 4 H9 published; with it the two agree.
