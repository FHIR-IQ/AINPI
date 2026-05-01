"""Unit tests for analysis/h26_mco_exposure_va.py.

Pure-function coverage only — HTTP and BigQuery are validated by running
the script end-to-end against live MCO endpoints.

Run:
    cd <repo-root>
    python -m pytest analysis/tests/test_h26_mco_exposure_va.py -v
"""
from __future__ import annotations
import sys
from pathlib import Path

# Add analysis/ to sys.path so we can import the module under test without
# packaging the analysis dir.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import h26_mco_exposure_va as h26  # noqa: E402


def test_filter_cohort_keeps_only_va_critical_excluded():
    rows = [
        # state=VA, critical, oig_excluded → KEEP
        {"npi": "1111111111", "name": "DOE, JANE", "state": "VA",
         "score": "1.5", "bucket": "critical", "reasons": "oig_excluded"},
        # state=VA, critical, sam_excluded → KEEP
        {"npi": "2222222222", "name": "ROE, JOHN", "state": "VA",
         "score": "1.5", "bucket": "critical", "reasons": "sam_excluded"},
        # state=VA, critical, oig+sam → KEEP
        {"npi": "3333333333", "name": "SMITH, A", "state": "VA",
         "score": "3.0", "bucket": "critical", "reasons": "oig_excluded|sam_excluded"},
        # state=VA, high (not critical) → DROP
        {"npi": "4444444444", "name": "JONES, B", "state": "VA",
         "score": "1.0", "bucket": "high", "reasons": "luhn_fail"},
        # state=NY, critical, oig_excluded → DROP (wrong state)
        {"npi": "5555555555", "name": "LEE, C", "state": "NY",
         "score": "1.5", "bucket": "critical", "reasons": "oig_excluded"},
        # state=VA, critical, but only luhn_fail → DROP (not federally excluded)
        {"npi": "6666666666", "name": "POE, D", "state": "VA",
         "score": "1.5", "bucket": "critical", "reasons": "luhn_fail"},
    ]
    kept = h26.filter_cohort(rows, state="VA")
    assert [r["npi"] for r in kept] == ["1111111111", "2222222222", "3333333333"]
