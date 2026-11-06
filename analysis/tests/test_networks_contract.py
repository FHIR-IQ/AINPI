"""Invariants of the networks.json contract (analysis/validate_contract.check_networks)."""
import copy

from analysis.validate_contract import check_networks as _check, known_finding_slugs

KNOWN = {"endpoint-url-validity"}


def check_networks(p):
    return _check(p, KNOWN)


SLUGS = ["treatment-records", "individual-access", "find-endpoint", "payer-exchange",
         "encounter-alerts", "public-health", "community-referral"]


def src(primary=True):
    return {"url": "https://example.org/a", "title": "A", "accessed": "2026-11-01", "primary": primary}


def valid():
    return {
        "schema_version": 1,
        "generated_at": "2026-11-06",
        "use_cases": [{"slug": s, "label": s, "summary": "Summary.", "ainpi_links": []} for s in SLUGS],
        "routes": [{
            "id": "r1", "use_case": "treatment-records", "title": "T", "summary": "S",
            "who_can_use": "W", "rule": "R", "standard": "S", "how_to_join": "H",
            "network_types": ["state_hie", "qhin"], "sources": [src()], "ainpi_links": [],
        }],
        "networks": [
            {"id": "n1", "name": "N1", "type": "state_hie", "national": False, "states": ["PA"],
             "detail_level": "full", "routes": ["r1"], "website": "https://example.org",
             "how_to_join": "Join.", "sources": [src()], "last_checked": "2026-11-01"},
            {"id": "n2", "name": "N2", "type": "qhin", "national": True, "states": [],
             "detail_level": "basic", "routes": [], "website": "https://example.org",
             "how_to_join": "Join.", "sources": [src()], "last_checked": "2026-11-01"},
        ],
        "glossary": [{"term": "HIE", "definition": "A health information exchange."}],
    }


def errs(mutate):
    p = copy.deepcopy(valid())
    mutate(p)
    return check_networks(p)


def test_valid_minimal():
    assert check_networks(valid()) == []


def test_network_without_primary_source():
    e = errs(lambda p: p["networks"][0].update(sources=[src(False)]))
    assert e and any("n1" in x for x in e)


def test_non_https_urls_rejected():
    e = errs(lambda p: p["networks"][0].update(website="javascript:alert(1)"))
    assert any("n1" in x and "https" in x for x in e)
    e = errs(lambda p: p["routes"][0]["sources"][0].update(url="http://example.org"))
    assert any("r1" in x and "https" in x for x in e)
    e = errs(lambda p: p["networks"][1]["sources"][0].update(url=None))
    assert any("n2" in x and "https" in x for x in e)


import pytest as _pytest


@_pytest.mark.parametrize("href", ["//evil.com", "https://x", "/\t/evil.com", "/\n/evil.com",
                                   "/ /evil.com", "javascript:alert(1)", 5])
def test_ainpi_href_must_be_internal_path(href):
    e = errs(lambda p: p["routes"][0].update(ainpi_links=[{"label": "L", "href": href}]))
    assert any("r1" in x and "href" in x for x in e)


def test_ainpi_internal_href_ok():
    e = errs(lambda p: p["routes"][0].update(ainpi_links=[{"label": "L", "href": "/states/pa/connectivity"}]))
    assert e == []


def test_route_without_primary_source():
    e = errs(lambda p: p["routes"][0].update(sources=[src(False)]))
    assert e and any("r1" in x for x in e)


def test_unknown_route_reference():
    e = errs(lambda p: p["networks"][0].update(routes=["nope"]))
    assert e and any("n1" in x and "nope" in x for x in e)


def test_route_type_mismatch():
    e = errs(lambda p: p["routes"][0].update(network_types=["qhin"]))
    assert e and any("n1" in x for x in e)


def test_national_with_states():
    e = errs(lambda p: p["networks"][1].update(states=["PA"]))
    assert e and any("n2" in x for x in e)


def test_local_without_states():
    e = errs(lambda p: p["networks"][0].update(states=[]))
    assert e and any("n1" in x for x in e)


def test_state_code_outside_51():
    e = errs(lambda p: p["networks"][0].update(states=["PR"]))
    assert e and any("n1" in x and "PR" in x for x in e)


def test_dc_allowed():
    assert errs(lambda p: p["networks"][0].update(states=["DC"])) == []


def test_last_checked_in_future():
    e = errs(lambda p: p["networks"][0].update(last_checked="2999-01-01"))
    assert e and any("n1" in x for x in e)


def test_last_checked_not_iso():
    e = errs(lambda p: p["networks"][0].update(last_checked="11/01/2026"))
    assert e and any("n1" in x for x in e)


def test_duplicate_ids():
    def m(p):
        p["networks"][1]["id"] = "n1"
    e = errs(m)
    assert e and any("n1" in x for x in e)


def test_use_cases_not_exactly_seven():
    e = errs(lambda p: p.update(use_cases=p["use_cases"][:-1]))
    assert e and any("community-referral" in x for x in e)


def test_basic_network_with_routes():
    e = errs(lambda p: p["networks"][1].update(routes=["r1"]))
    assert e and any("n2" in x for x in e)


def test_count_in_prose():
    e = errs(lambda p: p["routes"][0].update(summary="Covers 12 QHINs today."))
    assert e and any("r1" in x for x in e)
    e = errs(lambda p: p["glossary"][0].update(definition="There are 40 networks."))
    assert e


def test_em_dash_in_prose():
    e = errs(lambda p: p["use_cases"][0].update(summary="One — two."))
    assert e and any("treatment-records" in x for x in e)


def test_unknown_finding_slug():
    def m(p):
        p["use_cases"][0]["ainpi_links"] = [{"label": "X", "finding_slug": "no-such-finding"}]
    e = errs(m)
    assert e and any("no-such-finding" in x for x in e)
    def ok(p):
        p["use_cases"][0]["ainpi_links"] = [{"label": "X", "finding_slug": "endpoint-url-validity"}]
    assert errs(ok) == []


def test_real_findings_slugs_parse():
    assert "ndh-payer-endpoint-coverage" in known_finding_slugs()


def test_malformed_payload_returns_errors_not_raise():
    p = valid()
    p["routes"] = ["not an object"]
    p["use_cases"][0].pop("slug")
    p["networks"][0]["sources"] = "bad"
    p["networks"][0]["states"] = "PA"
    e = check_networks(p)
    assert e
    assert check_networks([]) and check_networks({"use_cases": 5})


import pytest


def _bad_route_id(p):
    p["routes"][0]["id"] = [1]


def _bad_network_id(p):
    p["networks"][0]["id"] = {"a": 1}


def _bad_state(p):
    p["networks"][0]["states"] = [{"x": 1}]


def _bad_network_types(p):
    p["routes"][0]["network_types"] = [["state_hie"], "qhin"]


def _bad_route_ref(p):
    p["networks"][0]["routes"] = [{"x": 1}]


def _bad_network_type(p):
    p["networks"][0]["type"] = ["state_hie"]


@pytest.mark.parametrize("mutate", [_bad_route_id, _bad_network_id, _bad_state,
                                    _bad_network_types, _bad_route_ref, _bad_network_type])
def test_unhashable_values_return_errors(mutate):
    assert errs(mutate)


def test_state_hie_routes_do_not_assume_every_state_has_a_listed_hie():
    import json
    from pathlib import Path

    p = json.loads((Path(__file__).resolve().parents[2] / "frontend/public/api/v1/networks.json").read_text())
    routes = {r["id"]: r for r in p["routes"]}
    for rid in ("treatment-records-state-hie", "encounter-alerts-state-hie"):
        text = routes[rid]["how_to_join"]
        assert "if one is listed" in text, rid
        assert "—" not in text, rid
