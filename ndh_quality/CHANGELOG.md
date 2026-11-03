# Changelog

## 0.1.0

### Known gap (found 2026-11-03)
`npi-check-digit` accepts any 10 digits with a valid check digit. The methodology (`docs/methodology/index.md`, H9) and `analysis/h9_npi_luhn.py` also require a first digit of 1 or 2. At 2026-08-20 this accounts for the published 4 flagged NPIs (4 organization records). Not changed in 0.1.0 so the recorded result stays as measured; a version bump is needed to add the test.
