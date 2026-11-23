"""Unit tests for analysis/payer_sample.py. No network: a fake curl callable
and a fake clock are injected everywhere. Synthetic NPIs only."""
from __future__ import annotations

import json
import sys
import urllib.parse
from pathlib import Path

import pyarrow.parquet as pq
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import payer_sample as ps  # noqa: E402
from ndh_fixture import P1, P2, P3, build_export  # noqa: E402

RELEASE = "2026-10-07"
EMPTY = json.dumps({"resourceType": "Bundle", "type": "searchset", "total": 0})


def prac_bundle(npi, pid="abc"):
    return json.dumps({"resourceType": "Bundle", "total": 1, "entry": [{"resource": {
        "resourceType": "Practitioner", "id": pid,
        "identifier": [{"system": "http://hl7.org/fhir/sid/us-npi", "value": npi}]}}]})


def role_bundle(zips=("15213-1234",), phones=("1-412-555-0122",)):
    entries = [{"resource": {"resourceType": "PractitionerRole", "id": "r1",
                             "location": [{"reference": f"Location/loc{i}"} for i in range(len(zips))]},
                "search": {"mode": "match"}}]
    for i, z in enumerate(zips):
        entries.append({"resource": {
            "resourceType": "Location", "id": f"loc{i}",
            "address": {"postalCode": z},
            "telecom": [{"system": "phone", "value": phones[i] if i < len(phones) else ""},
                        {"system": "fax", "value": "4125559999"}]},
            "search": {"mode": "include"}})
    # A Location the role does not reference must not be counted.
    entries.append({"resource": {"resourceType": "Location", "id": "other",
                                 "address": {"postalCode": "90210"}}})
    return json.dumps({"resourceType": "Bundle", "entry": entries})


def npi_in(url):
    q = urllib.parse.unquote(url)
    return q.rsplit("|", 1)[-1] if "identifier=" in q else None


class FakeCurl:
    """Answers like a payer that lists every NPI with one role location."""

    def __init__(self, listed=True, clock=None, step=0.0):
        self.urls: list[str] = []
        self.listed = listed
        self.clock = clock
        self.step = step

    def __call__(self, url):
        self.urls.append(url)
        if self.clock is not None:
            self.clock.t += self.step
        npi = npi_in(url)
        if npi:
            return 200, prac_bundle(npi) if self.listed else EMPTY
        return 200, role_bundle()


class FakeClock:
    def __init__(self):
        self.t = 1000.0
        self.sleeps: list[float] = []

    def __call__(self):
        return self.t

    def sleep(self, s):
        self.sleeps.append(s)
        self.t += s


@pytest.fixture
def export(tmp_path):
    return build_export(tmp_path / "export", RELEASE)


# --- lookups -----------------------------------------------------------------

def test_empty_bundle_is_not_listed():
    r = ps.lookup_humana(P1, get=lambda url: (200, EMPTY))
    assert r["status"] == "not_listed" and r["zips"] == set() and r["phones"] == set()


def test_html_body_is_lookup_failed():
    r = ps.lookup_humana(P1, get=lambda url: (200, "<html><body>Access denied</body></html>"))
    assert r["status"] == "lookup_failed"


def test_404_is_not_listed_and_5xx_is_lookup_failed():
    assert ps.lookup_optum(P1, get=lambda url: (404, ""))["status"] == "not_listed"
    assert ps.lookup_optum(P1, get=lambda url: (503, EMPTY))["status"] == "lookup_failed"
    assert ps.lookup_optum(P1, get=lambda url: (0, ""))["status"] == "lookup_failed"


def test_listed_collects_role_location_zips_and_phones():
    fake = FakeCurl()
    r = ps.lookup_humana(P1, get=fake)
    assert r["status"] == "listed"
    assert r["zips"] == {"15213"} and r["phones"] == {"4125550122"}
    assert len(fake.urls) == 2
    assert fake.urls[0].startswith(ps.PAYERS["humana"] + "/Practitioner?identifier=")
    assert "/PractitionerRole?practitioner=Practitioner%2Fabc" in fake.urls[1]
    assert "_include=PractitionerRole%3Alocation" in fake.urls[1] and "_count=50" in fake.urls[1]


def test_practitioner_without_the_npi_is_lookup_failed():
    # A server that ignores the identifier parameter returns someone else.
    r = ps.lookup_humana(P1, get=lambda url: (200, prac_bundle(P2)))
    assert r["status"] == "lookup_failed"


def test_failed_role_request_is_lookup_failed():
    def get(url):
        return (200, prac_bundle(P1)) if npi_in(url) else (500, "error")
    assert ps.lookup_humana(P1, get=get)["status"] == "lookup_failed"


# --- draw --------------------------------------------------------------------

def test_draw_is_seeded_and_excludes_suppressed(export):
    a = ps.draw(RELEASE, "PA", 10, 7, set(), parquet_root=export)
    assert sorted(a) == sorted([P1, P2])
    assert a == ps.draw(RELEASE, "PA", 10, 7, set(), parquet_root=export)
    assert ps.draw(RELEASE, "PA", 10, 7, {P1}, parquet_root=export) == [P2]
    assert len(ps.draw(RELEASE, "PA", 1, 7, set(), parquet_root=export)) == 1
    assert P3 not in a  # inactive practitioner


# --- run ---------------------------------------------------------------------

def _run(export, tmp_path, **kw):
    clock = kw.pop("clock", FakeClock())
    fake = kw.pop("fetch", FakeCurl())
    counts = ps.run("humana", RELEASE, "PA", seed=11, suppressed=kw.pop("suppressed", set()),
                    fetch=fake, clock=clock, sleep=clock.sleep,
                    parquet_root=export, out_root=tmp_path / "out", today="2026-11-22", **kw)
    return counts, fake, clock


def test_request_counter_stops_at_max_requests(export, tmp_path):
    counts, fake, _ = _run(export, tmp_path, max_requests=3)
    assert len(fake.urls) == 3 and counts["requests"] == 3
    assert counts["queried"] == 1           # the cut-off second lookup is discarded
    assert counts["stopped"] == "max_requests"


def test_suppressed_npi_is_never_requested(export, tmp_path):
    counts, fake, _ = _run(export, tmp_path, suppressed={P1})
    assert not any(P1 in urllib.parse.unquote(u) for u in fake.urls)
    assert counts["queried"] == 1 and counts["listed"] == 1


def test_rate_limiter_spaces_calls(export, tmp_path):
    clock = FakeClock()
    times = []
    inner = FakeCurl()

    def fetch(url):
        times.append(clock())
        return inner(url)

    _run(export, tmp_path, clock=clock, fetch=fetch, rps=2.0)
    assert len(times) == 4
    assert all(b - a >= 0.5 - 1e-9 for a, b in zip(times, times[1:]))
    assert clock.sleeps and all(s > 0 for s in clock.sleeps)


def test_timeout_stops_the_run(export, tmp_path):
    clock = FakeClock()
    fake = FakeCurl(clock=clock, step=40 * 60)  # each call takes 40 minutes
    counts, _, _ = _run(export, tmp_path, clock=clock, fetch=fake)
    assert counts["stopped"] == "timeout"
    assert counts["queried"] == 1


def test_target_found_stops_early(export, tmp_path):
    counts, fake, _ = _run(export, tmp_path, target_found=1)
    assert counts["listed"] == 1 and counts["stopped"] == "target_found"
    assert len(fake.urls) == 2


def test_counts_only_on_stdout_and_parquet_written(export, tmp_path, capsys):
    counts, _, _ = _run(export, tmp_path, fetch=FakeCurl(listed=False))
    out = capsys.readouterr().out
    assert P1 not in out and P2 not in out
    assert counts["not_listed"] == 2 and counts["listed"] == 0 and counts["seed"] == 11
    assert str(11) in out
    path = tmp_path / "out" / "humana" / "2026-11-22.parquet"
    rows = pq.read_table(path).to_pylist()
    assert {r["npi"] for r in rows} == {P1, P2}
    assert {r["seed"] for r in rows} == {11}


def test_run_rejects_unknown_payer(export, tmp_path):
    with pytest.raises(ValueError):
        ps.run("cigna", RELEASE, "PA", suppressed=set(), fetch=FakeCurl(), parquet_root=export)


def test_fact_rows_for_compare():
    res = {P1: {"status": "listed", "zips": {"15213"}, "phones": {"4125550122"}},
           P2: {"status": "lookup_failed", "zips": set(), "phones": set()}}
    rows = ps.to_fact_rows(res, "humana", "2026-11-22")
    assert {(r["npi"], r["field"], r["value_norm"]) for r in rows} == {
        (P1, "zip5", "15213"), (P1, "phone10", "4125550122")}
    assert {r["source"] for r in rows} == {"humana"}
