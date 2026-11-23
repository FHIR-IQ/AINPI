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
    assert ps.lookup_optum(P1, get=lambda url: (404, "  \n"))["status"] == "not_listed"
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


OUTCOME = json.dumps({"resourceType": "OperationOutcome",
                      "issue": [{"severity": "information", "code": "not-found"}]})


def test_404_with_operation_outcome_or_empty_bundle_is_not_listed():
    assert ps.lookup_optum(P1, get=lambda url: (404, OUTCOME))["status"] == "not_listed"
    assert ps.lookup_optum(P1, get=lambda url: (404, EMPTY))["status"] == "not_listed"


def test_404_with_html_or_other_body_is_lookup_failed():
    html = "<html><body>Not Found</body></html>"
    assert ps.lookup_optum(P1, get=lambda url: (404, html))["status"] == "lookup_failed"
    assert ps.lookup_optum(P1, get=lambda url: (404, '{"error": "gone"}'))["status"] == "lookup_failed"
    assert ps.lookup_optum(P1, get=lambda url: (404, prac_bundle(P1)))["status"] == "lookup_failed"
    total3 = json.dumps({"resourceType": "Bundle", "total": 3})
    assert ps.lookup_optum(P1, get=lambda url: (404, total3))["status"] == "lookup_failed"


def test_bundle_with_total_but_no_practitioner_is_lookup_failed():
    b = json.dumps({"resourceType": "Bundle", "total": 2})
    assert ps.lookup_humana(P1, get=lambda url: (200, b))["status"] == "lookup_failed"


def test_bundle_with_only_outcome_entries_is_not_listed():
    b = json.dumps({"resourceType": "Bundle", "total": 0, "entry": [
        {"resource": json.loads(OUTCOME), "search": {"mode": "outcome"}}]})
    assert ps.lookup_humana(P1, get=lambda url: (200, b))["status"] == "not_listed"
    no_total = json.dumps({"resourceType": "Bundle", "entry": [
        {"resource": json.loads(OUTCOME), "search": {"mode": "outcome"}}]})
    assert ps.lookup_humana(P1, get=lambda url: (200, no_total))["status"] == "not_listed"
    with_total = json.dumps({"resourceType": "Bundle", "total": 1, "entry": [
        {"resource": json.loads(OUTCOME), "search": {"mode": "outcome"}}]})
    assert ps.lookup_humana(P1, get=lambda url: (200, with_total))["status"] == "lookup_failed"


def test_non_list_entry_does_not_crash():
    b = json.dumps({"resourceType": "Bundle", "total": 1, "entry": {"resource": {}}})
    assert ps.lookup_humana(P1, get=lambda url: (200, b))["status"] == "lookup_failed"


def _role_with_refs(refs, locs):
    entries = [{"resource": {"resourceType": "PractitionerRole", "id": "r1",
                             "location": [{"reference": r} for r in refs]}}]
    for lid, z in locs:
        entries.append({"resource": {"resourceType": "Location", "id": lid,
                                     "address": {"postalCode": z}}})
    return json.dumps({"resourceType": "Bundle", "entry": entries})


def _two_step(role_body):
    def get(url):
        return (200, prac_bundle(P1)) if npi_in(url) else (200, role_body)
    return get


def test_location_ref_versioned_and_absolute_urls():
    body = _role_with_refs(
        ["Location/abc/_history/2",
         "https://payer.example/fhir/R4/Location/def",
         "https://payer.example/fhir/R4/Location/ghi/_history/7/"],
        [("abc", "15213"), ("def", "17101"), ("ghi", "16501")])
    r = ps.lookup_humana(P1, get=_two_step(body))
    assert r["status"] == "listed"
    assert r["zips"] == {"15213", "17101", "16501"}
    assert r["locations_missing"] is False


def test_location_with_non_string_id_does_not_crash():
    body = json.dumps({"resourceType": "Bundle", "entry": [
        {"resource": {"resourceType": "PractitionerRole", "location": [{"reference": "Location/a"}]}},
        {"resource": {"resourceType": "Location", "id": {"bad": 1}, "address": {"postalCode": "15213"}}},
        {"resource": {"resourceType": "Location", "id": "a", "address": {"postalCode": "17101"}}}]})
    r = ps.lookup_humana(P1, get=_two_step(body))
    assert r["status"] == "listed" and r["zips"] == {"17101"}


def test_referenced_locations_not_returned_are_flagged():
    body = _role_with_refs(["Location/a", "Location/b"], [("a", "15213")])
    r = ps.lookup_humana(P1, get=_two_step(body))
    assert r["status"] == "listed" and r["locations_missing"] is True
    assert r["zips"] == {"15213"}


def test_role_without_location_refs_is_not_missing():
    body = _role_with_refs([], [])
    r = ps.lookup_humana(P1, get=_two_step(body))
    assert r["status"] == "listed" and r["locations_missing"] is False


def test_listed_result_has_flags():
    r = ps.lookup_humana(P1, get=FakeCurl())
    assert r["truncated"] is False and r["locations_missing"] is False


def _pracs(npi, pids, next_url=None):
    doc = {"resourceType": "Bundle", "total": len(pids), "entry": [{"resource": {
        "resourceType": "Practitioner", "id": pid,
        "identifier": [{"system": "http://hl7.org/fhir/sid/us-npi", "value": npi}]}}
        for pid in pids]}
    if next_url:
        doc["link"] = [{"relation": "next", "url": next_url}]
    return json.dumps(doc)


def test_all_matching_practitioners_are_queried():
    pids = [f"p{i}" for i in range(5)]
    urls = []

    def get(url):
        urls.append(url)
        if npi_in(url):
            return 200, _pracs(P1, pids)
        n = int(urllib.parse.unquote(url).split("Practitioner/p")[1].split("&")[0])
        return 200, role_bundle(zips=(f"1520{n}",), phones=(f"412555010{n}",))

    r = ps.lookup_humana(P1, get=get)
    assert r["status"] == "listed" and r["truncated"] is False
    assert len(urls) == 6
    assert r["zips"] == {f"1520{n}" for n in range(5)}


def test_role_paging_follows_next_within_base():
    base = ps.PAYERS["humana"]
    page2 = base + "/PractitionerRole?page=2"
    # Page 1: the role references L2, which only arrives on page 2.
    p1 = json.dumps({"resourceType": "Bundle", "link": [{"relation": "next", "url": page2}],
                     "entry": [{"resource": {"resourceType": "PractitionerRole",
                                             "location": [{"reference": "Location/L2"}]}}]})
    p2 = json.dumps({"resourceType": "Bundle", "entry": [
        {"resource": {"resourceType": "Location", "id": "L2", "address": {"postalCode": "17101"}}}]})
    urls = []

    def get(url):
        urls.append(url)
        if npi_in(url):
            return 200, prac_bundle(P1)
        return 200, p2 if url == page2 else p1

    r = ps.lookup_humana(P1, get=get)
    assert urls[-1] == page2 and len(urls) == 3
    assert r["status"] == "listed" and r["zips"] == {"17101"}
    assert r["locations_missing"] is False and r["truncated"] is False


def test_next_link_off_base_or_looping_is_truncated():
    off = json.dumps({"resourceType": "Bundle", "link": [
        {"relation": "next", "url": "https://elsewhere.example/fhir/PractitionerRole?page=2"}],
        "entry": []})
    urls = []

    def get(url):
        urls.append(url)
        return (200, prac_bundle(P1)) if npi_in(url) else (200, off)

    r = ps.lookup_humana(P1, get=get)
    assert r["status"] == "listed" and r["truncated"] is True and len(urls) == 2

    base = ps.PAYERS["humana"]
    loop_url = base + "/PractitionerRole?page=same"
    loop = json.dumps({"resourceType": "Bundle", "link": [{"relation": "next", "url": loop_url}]})
    urls.clear()

    def get2(url):
        urls.append(url)
        return (200, prac_bundle(P1)) if npi_in(url) else (200, loop)

    r = ps.lookup_humana(P1, get=get2)
    assert r["truncated"] is True and len(urls) == 3


def test_page_bound_records_truncation():
    base = ps.PAYERS["humana"]
    urls = []

    def get(url):
        urls.append(url)
        if npi_in(url):
            return 200, prac_bundle(P1)
        nxt = f"{base}/PractitionerRole?page={len(urls)}"
        return 200, json.dumps({"resourceType": "Bundle", "link": [{"relation": "next", "url": nxt}]})

    r = ps.lookup_humana(P1, get=get)
    assert r["truncated"] is True
    assert len(urls) == 1 + ps.MAX_PAGES_PER_SEARCH


def test_paging_goes_through_the_throttle_cap():
    base = ps.PAYERS["humana"]
    calls = []

    def fetch(url):
        calls.append(url)
        if npi_in(url):
            return 200, prac_bundle(P1)
        return 200, json.dumps({"resourceType": "Bundle", "link": [
            {"relation": "next", "url": f"{base}/PractitionerRole?page={len(calls)}"}]})

    clock = FakeClock()
    t = ps.Throttle(fetch, 4, 2.0, clock=clock, sleep=clock.sleep)
    with pytest.raises(ps.BudgetExhausted):
        ps.lookup_humana(P1, get=t.get)
    assert len(calls) == 4 and t.requests == 4


def test_non_string_practitioner_id_is_skipped():
    b = json.dumps({"resourceType": "Bundle", "total": 1, "entry": [{"resource": {
        "resourceType": "Practitioner", "id": 42,
        "identifier": [{"system": "http://hl7.org/fhir/sid/us-npi", "value": P1}]}}]})
    assert ps.lookup_humana(P1, get=lambda url: (200, b))["status"] == "lookup_failed"


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
    path = tmp_path / "out" / "humana" / "2026-11-22-seed11.parquet"
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


def test_same_day_rerun_does_not_overwrite(export, tmp_path):
    _run(export, tmp_path)
    _run(export, tmp_path)
    names = sorted(p.name for p in (tmp_path / "out" / "humana").glob("*.parquet"))
    assert names == ["2026-11-22-seed11-2.parquet", "2026-11-22-seed11.parquet"]


def test_interrupt_still_saves_completed_lookups(export, tmp_path):
    inner = FakeCurl()

    def fetch(url):
        if len(inner.urls) >= 2:
            raise KeyboardInterrupt
        return inner(url)

    with pytest.raises(KeyboardInterrupt):
        _run(export, tmp_path, fetch=fetch)
    rows = pq.read_table(tmp_path / "out" / "humana" / "2026-11-22-seed11.parquet").to_pylist()
    assert len(rows) == 1 and rows[0]["status"] == "listed"


def test_malformed_payload_records_lookup_failed_not_crash(export, tmp_path):
    def fetch(url):
        if npi_in(url):
            return 200, json.dumps({"resourceType": "Bundle", "total": 1, "entry": [
                {"resource": {"resourceType": "Practitioner", "id": ["x"],
                              "identifier": [{"system": "http://hl7.org/fhir/sid/us-npi",
                                              "value": npi_in(url)}]}}]})
        return 200, role_bundle()
    counts, _, _ = _run(export, tmp_path, fetch=fetch)
    assert counts["lookup_failed"] == 2 and counts["queried"] == 2


def test_deadline_covers_the_draw(export, tmp_path, monkeypatch):
    clock = FakeClock()
    real_draw = ps.draw

    def slow_draw(*a, **k):
        clock.t += 61 * 60
        return real_draw(*a, **k)

    monkeypatch.setattr(ps, "draw", slow_draw)
    fake = FakeCurl()
    counts, _, _ = _run(export, tmp_path, clock=clock, fetch=fake)
    assert counts["stopped"] == "timeout" and fake.urls == [] and counts["queried"] == 0


def test_all_not_listed_run_is_flagged_suspect(export, tmp_path, capsys):
    counts, _, _ = _run(export, tmp_path, fetch=FakeCurl(listed=False), suspect_min=2)
    assert counts["suspect_all_not_listed"] is True
    captured = capsys.readouterr()
    assert "suspect" in captured.err.lower()
    assert len(captured.out.strip().splitlines()) == 1


def test_mixed_run_is_not_suspect(export, tmp_path):
    counts, _, _ = _run(export, tmp_path, suspect_min=2)
    assert counts["suspect_all_not_listed"] is False


def test_small_all_not_listed_run_is_not_suspect_by_default(export, tmp_path):
    counts, _, _ = _run(export, tmp_path, fetch=FakeCurl(listed=False))
    assert counts["suspect_all_not_listed"] is False


def test_counts_report_truncated_and_locations_missing(export, tmp_path):
    def fetch(url):
        if npi_in(url):
            return 200, prac_bundle(npi_in(url))
        return 200, _role_with_refs(["Location/a", "Location/b"], [("a", "15213")])
    counts, _, _ = _run(export, tmp_path, fetch=fetch)
    assert counts["locations_missing"] == 2 and counts["truncated"] == 0
    rows = pq.read_table(tmp_path / "out" / "humana" / "2026-11-22-seed11.parquet").to_pylist()
    assert all(r["locations_missing"] is True and r["truncated"] is False for r in rows)
