"""Pure-logic tests for analysis/pa_system_endpoint_gap.py (FHI-19)."""
from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from analysis.pa_system_endpoint_gap import (  # noqa: E402
    classify,
    domain_of,
    domain_regex,
    host_of,
    index_epic_brands,
    match_brands,
    norm_url,
    pairwise_overlap,
    positive_control,
    reach_counts,
    system_links,
    summarize,
)

NPI_SYS = "http://hl7.org/fhir/sid/us-npi"


def _bundle():
    """A two-brand Epic-shaped bundle, referenced by urn:uuid as Epic does."""
    return {"entry": [
        {"fullUrl": "urn:uuid:ep1", "resource": {
            "resourceType": "Endpoint", "id": "ep1",
            "address": "https://Epic.Example.org/FHIR/R4/"}},
        {"fullUrl": "urn:uuid:root", "resource": {
            "resourceType": "Organization", "id": "root", "name": "MyUPMC",
            "identifier": [],
            "address": [{"state": "PA"}],
            "endpoint": [{"reference": "urn:uuid:ep1"}]}},
        {"fullUrl": "urn:uuid:site1", "resource": {
            "resourceType": "Organization", "id": "site1",
            "name": "UPMC Clinic A", "address": [{"state": "PA"}],
            "partOf": {"reference": "urn:uuid:root"}}},
        {"fullUrl": "urn:uuid:site2", "resource": {
            "resourceType": "Organization", "id": "site2",
            "name": "UPMC Clinic B", "address": [{"state": "NY"}],
            "partOf": {"reference": "urn:uuid:site1"}}},
        {"fullUrl": "urn:uuid:ep2", "resource": {
            "resourceType": "Endpoint", "id": "ep2",
            "address": "https://fhir.geisinger.example/r4"}},
        {"fullUrl": "urn:uuid:g", "resource": {
            "resourceType": "Organization", "id": "g", "name": "Geisinger",
            "identifier": [
                {"system": NPI_SYS, "value": "1295834984"},
                # The NDH's newer system URL must be read too.
                {"system": "http://terminology.hl7.org/NamingSystem/npi",
                 "value": "1386323566"}],
            "address": [{"state": "PA"}],
            "endpoint": [{"reference": "urn:uuid:ep2"}]}},
        # An organization with no endpoint anywhere up its tree is not a brand.
        {"fullUrl": "urn:uuid:orphan", "resource": {
            "resourceType": "Organization", "id": "orphan", "name": "Nobody"}},
    ]}


def test_index_walks_partof_and_urn_uuid_references():
    brands = {b["name"]: b for b in index_epic_brands(_bundle())}
    assert set(brands) == {"MyUPMC", "Geisinger"}
    upmc = brands["MyUPMC"]
    assert upmc["urls"] == {"https://epic.example.org/fhir/r4"}
    assert upmc["care_sites"] == 2  # the grandchild resolves through site1
    assert upmc["states"] == {"PA", "NY"}
    assert upmc["npis"] == set()


def test_index_reads_npis_with_both_system_urls():
    g = {b["name"]: b for b in index_epic_brands(_bundle())}["Geisinger"]
    assert g["npis"] == {"1295834984", "1386323566"}
    assert g["root_npis"] == g["npis"]


def test_index_survives_partof_cycle():
    b = _bundle()
    b["entry"][1]["resource"]["partOf"] = {"reference": "urn:uuid:site2"}
    # Must terminate; the cycle's brand still carries the endpoint.
    assert any(x["urls"] for x in index_epic_brands(b))


def test_match_brands_label_prefix_and_curated():
    brands = index_epic_brands(_bundle())
    got = match_brands("GEISINGER", brands, "PA", curated={})
    assert [(b["name"], basis) for b, basis in got] == [("Geisinger", "label-prefix")]
    got = match_brands("UNIVERSITY OF PITTSBURGH", brands, "PA",
                       curated={"UNIVERSITY OF PITTSBURGH": ("MYUPMC", "basis")})
    assert [(b["name"], basis) for b, basis in got] == [("MyUPMC", "curated")]
    # Without a curated row, a label sharing no token with the brand finds
    # nothing, and that is reported, not guessed.
    assert match_brands("UNIVERSITY OF PITTSBURGH", brands, "PA", curated={}) == []
    # A brand with no care site in the state does not match.
    assert match_brands("GEISINGER", brands, "OH", curated={}) == []


def test_match_brands_is_token_wise_not_substring():
    brands = [{"name": "Geisingerville Health", "states": {"PA"}, "urls": {"x"}}]
    assert match_brands("GEISINGER", brands, "PA", curated={}) == []


def test_url_host_domain():
    assert norm_url("HTTP://A.B.com/X/") == "https://a.b.com/x"
    assert host_of("https://epicent-prd-rp.upmc.com/PRD/api") == "epicent-prd-rp.upmc.com"
    assert host_of("direct@direct.ahn.org") is None
    assert domain_of("epic-fhir-prd.upmc.com") == "upmc.com"
    assert domain_of("geisapi.geisinger.edu:443") == "geisinger.edu"
    assert domain_of(None) is None


def test_domain_regex_matches_domain_not_lookalike():
    import re
    rx = re.compile(domain_regex(["upmc.com"]))
    assert rx.search("https://epic-fhir-prd.upmc.com/fhir")
    assert rx.search("someone@direct.upmc.com")
    assert not rx.search("https://apis.upmchp.com/fhir")
    assert domain_regex([]) == "^$"


def test_reach_counts_counts_each_practitioner_once_at_best_tier():
    prac_orgs = {
        "1": {"a", "b"},      # a is strict
        "2": {"b", "c"},      # b resolved only
        "3": {"c"},           # enrollment only
        "4": {"c"},           # nothing
        "5": {"z"},           # not a member
    }
    got = reach_counts(prac_orgs, {"a", "b", "c"}, strict_orgs={"a"},
                       resolved_orgs={"b"}, enrollment_npis={"3", "1"})
    assert got == {"practitioners": 4, "strict": 1, "vendor_list": 0,
                   "resolution": 1, "enrollment": 1, "none": 1,
                   "reaches_any": 3}


def test_reach_counts_puts_vendor_list_below_strict_above_resolution():
    prac_orgs = {"1": {"a", "l"}, "2": {"l", "b"}, "3": {"b"}}
    got = reach_counts(prac_orgs, {"a", "b", "l"}, strict_orgs={"a"},
                       resolved_orgs={"b"}, enrollment_npis=set(),
                       list_orgs={"l"})
    assert (got["strict"], got["vendor_list"], got["resolution"]) == (1, 1, 1)
    assert got["reaches_any"] == 3


def test_reach_counts_has_stable_keys_when_empty():
    got = reach_counts({}, set(), set(), set(), set())
    assert got["strict"] == 0 and got["reaches_any"] == 0


def _metrics(**over):
    m = {
        "published": True, "npis_matching_members": 0,
        "ndh_endpoints": [{"managed": True, "manager_holds_practitioners": False}],
        "members_with_partof_to_endpoint_holder": 0,
        "ledger_endpoint_count": 0, "reach_resolution": 10,
        "reach_enrollment": 0, "reach_enrollment_own_domain": 0,
        "dead_aliases": 0, "h51_dropped_member_npis": 0,
        "shared_brand_with": [],
    }
    m.update(over)
    return m


def test_classify_typical_large_system():
    assert classify(_metrics()) == [
        "vendor-brand-without-entity-npi",
        "endpoint-on-leaf-without-practitioners",
        "no-hierarchy",
        "rollup-omits-h53-tier",
    ]


def test_classify_absent_everywhere_is_the_only_system_cause():
    assert classify(_metrics(published=False, ndh_endpoints=[])) == [
        "no-endpoint-published"]


def test_classify_unmanaged_and_missing_ndh_endpoint():
    got = classify(_metrics(ndh_endpoints=[
        {"managed": False, "manager_holds_practitioners": False}]))
    assert "endpoint-without-managing-org" in got
    assert "endpoint-on-leaf-without-practitioners" not in got
    assert "no-ndh-endpoint" in classify(_metrics(ndh_endpoints=[]))


def test_classify_linked_system_has_no_vendor_or_hierarchy_cause():
    got = classify(_metrics(
        npis_matching_members=3,
        ndh_endpoints=[{"managed": True, "manager_holds_practitioners": True}],
        members_with_partof_to_endpoint_holder=5, ledger_endpoint_count=1))
    assert got == []


def test_classify_ainpi_defects():
    got = classify(_metrics(dead_aliases=1, h51_dropped_member_npis=2,
                            shared_brand_with=["brand:UPMC"]))
    assert {"dead-curated-alias", "h51-one-npi-per-url",
            "system-split-across-groups"} <= set(got)
    # A rollup that already shows an endpoint is not under-counting.
    got = classify(_metrics(ledger_endpoint_count=2, reach_enrollment=10,
                            reach_enrollment_own_domain=10))
    assert not {"rollup-omits-h53-tier",
                "rollup-omits-enrollment-own-domain"} & set(got)


def test_classify_splits_h53_from_enrollment_own_domain():
    # AHN shape: no H53 reach, enrollment lands mostly on the own domain.
    got = classify(_metrics(reach_resolution=0, reach_enrollment=2723,
                            reach_enrollment_own_domain=2673))
    assert "rollup-omits-enrollment-own-domain" in got
    assert "rollup-omits-h53-tier" not in got
    # UPP shape: enrollment reach mostly lands on someone else's endpoint.
    got = classify(_metrics(reach_resolution=0, reach_enrollment=725,
                            reach_enrollment_own_domain=86))
    assert not {"rollup-omits-h53-tier",
                "rollup-omits-enrollment-own-domain"} & set(got)
    # Enrollment reach off the own domain never raises the enrollment cause.
    assert "rollup-omits-enrollment-own-domain" not in classify(
        _metrics(reach_enrollment=5, reach_enrollment_own_domain=0))


def _control_inputs(**over):
    sysrow = {"system_key": "brand:G", "organizations": 2, "practitioners": 7,
              "member_org_ids": ["o1", "o2"]}
    args = {
        "conn_release": "2026-10-07", "release": "2026-10-07",
        "chosen": [sysrow],
        "payload_rows": {"brand:G": {"organizations": 2, "practitioners": 7,
                                     "member_org_ids": ["o1"]}},
        "n_brands": 1282,
        "hosts": ["geisapi.geisinger.edu"], "domains": ["geisinger.edu"],
        "ndh_eps": [{"connection_type": "hl7-fhir-rest",
                     "address": "https://geisapi.geisinger.edu/fhir"}],
        "prac_orgs": {"111": {"o1"}},
    }
    args.update(over)
    return args


def test_positive_control_passes_on_good_inputs():
    assert positive_control(**_control_inputs()) == []


def test_positive_control_accepts_the_fhi73_payload_shape():
    # After FHI-73 `practitioners` is distinct and the link sum moved to
    # `practitioner_org_links`; the rebuilt link sum must match the latter.
    rows = {"brand:G": {"organizations": 2, "practitioners": 4,
                        "practitioner_org_links": 7,
                        "member_org_ids": ["o1"]}}
    assert positive_control(**_control_inputs(payload_rows=rows)) == []


def test_positive_control_compares_links_not_distinct_on_new_payloads():
    rows = {"brand:G": {"organizations": 2, "practitioners": 7,
                        "practitioner_org_links": 9,
                        "member_org_ids": ["o1"]}}
    got = positive_control(**_control_inputs(payload_rows=rows))
    assert len(got) == 1 and "(7 links)" in got[0] and "(9)" in got[0]


def test_positive_control_with_a_rebuilt_row_carrying_both_fields():
    # build_systems since FHI-73 emits both fields; without the distinct
    # mapping `practitioners` equals the link sum. Both payload shapes pass.
    rebuilt = {"system_key": "brand:G", "organizations": 2, "practitioners": 7,
               "practitioner_org_links": 7, "member_org_ids": ["o1", "o2"]}
    old = {"brand:G": {"organizations": 2, "practitioners": 7,
                       "member_org_ids": ["o1"]}}
    new = {"brand:G": {"organizations": 2, "practitioners": 3,
                       "practitioner_org_links": 7, "member_org_ids": ["o1"]}}
    for rows in (old, new):
        assert positive_control(**_control_inputs(
            chosen=[rebuilt], payload_rows=rows)) == []


def test_system_links_reads_either_shape():
    assert system_links({"practitioners": 7}) == 7
    assert system_links({"practitioners": 3, "practitioner_org_links": 7}) == 7


def test_positive_control_fails_on_release_mismatch():
    got = positive_control(**_control_inputs(conn_release="2026-08-20"))
    assert len(got) == 1 and "2026-08-20" in got[0]


def test_positive_control_fails_on_empty_hosts():
    got = positive_control(**_control_inputs(hosts=[], domains=[]))
    assert any("no host" in p for p in got)


def test_positive_control_fails_when_ndh_has_no_fhir_endpoint_on_domains():
    # A Direct address on the domain is not a FHIR endpoint found.
    got = positive_control(**_control_inputs(ndh_eps=[
        {"connection_type": "direct-project",
         "address": "someone@direct.geisinger.edu"}]))
    assert any("no FHIR endpoint" in p for p in got)


def test_positive_control_fails_on_membership_mismatch():
    rows = {"brand:G": {"organizations": 2, "practitioners": 7,
                        "member_org_ids": ["o1", "o9"]}}
    got = positive_control(**_control_inputs(payload_rows=rows))
    assert any("not in the rebuilt grouping" in p for p in got)
    rows = {"brand:G": {"organizations": 3, "practitioners": 7,
                        "member_org_ids": ["o1"]}}
    assert any("members, rebuilt has" in p
               for p in positive_control(**_control_inputs(payload_rows=rows)))


def test_positive_control_fails_on_no_practitioners_and_few_brands():
    got = positive_control(**_control_inputs(prac_orgs={}, n_brands=12))
    assert any("no practitioners" in p for p in got)
    assert any("12 brands" in p for p in got)


def test_pairwise_overlap():
    prac_orgs = {"1": {"a"}, "2": {"a", "b"}, "3": {"b"}, "4": {"c"}}
    got = pairwise_overlap(prac_orgs, [("A", {"a"}), ("B", {"b"}), ("C", {"c"})])
    assert got == [{"a": "A", "b": "B", "both": 1, "either": 3}]


def test_summarize_is_conditional_on_counts():
    row = {
        "vendor_brands": [{"npis_matching_members": []}],
        "ndh_endpoints_on_system_hosts": [{"manager_holds_practitioners": False}],
        "chain": {"members_with_partof": 0},
    }
    unpublished = {"vendor_brands": [], "ndh_endpoints_on_system_hosts": [],
                   "chain": {"members_with_partof": 2}}
    union = {"practitioners": 10, "reaches_any": 4, "strict": 0,
             "resolution": 3, "enrollment": 1}
    text = summarize([row, unpublished], union)
    assert not text.startswith("The zero the system table showed")
    assert "1 of 2 systems publish" in text
    assert "In 1 of 2 no member organization carries partOf" in text
    assert summarize([row], union).startswith("The zero the system table showed")
    assert "the only links the system rollup counts" not in text
