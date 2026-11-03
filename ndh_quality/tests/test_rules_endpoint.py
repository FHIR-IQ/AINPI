from ndh_quality.base import open_engine
from ndh_quality.rules.rule_endpoint_org_linkage import EndpointOrgLinkage
from ndh_quality.rules.rule_endpoint_types_present import EndpointTypesPresent
from ndh_quality.rules.rule_fhir_rest_endpoint_share import FhirRestEndpointShare


def ep(t, m=None):
    return {"_connection_type": t, "_managing_org_id": m}


def setup(release_dir, endpoints):
    return {"release_dir": str(release_dir({"endpoint": endpoints, "organization": [{"_id": "o1"}]}))}


def test_main_fixture(release_dir):
    s = setup(release_dir, [ep("hl7-fhir-rest", "Organization/o1"), ep("hl7-fhir-rest", "Organization/gone"),
                            ep("hl7-fhir-rest", None), ep("direct-project"), ep("direct-project")])
    eng = open_engine()
    link = EndpointOrgLinkage.measure(eng, s)
    assert (link["numerator"], link["denominator"]) == (1, 3)
    assert link["status"] == "recorded"
    assert "with_reference=2" in link["detail"]
    share = FhirRestEndpointShare.measure(eng, s)
    assert (share["numerator"], share["denominator"]) == (3, 5)
    assert EndpointTypesPresent.measure(eng, s)["status"] == "pass"


def test_no_direct_types_fail(release_dir):
    s = setup(release_dir, [ep("hl7-fhir-rest", "Organization/o1")])
    m = EndpointTypesPresent.measure(open_engine(), s)
    assert (m["numerator"], m["denominator"]) == (1, 2)
    assert m["status"] == "fail"


def test_null_types_control_failed(release_dir):
    s = setup(release_dir, [ep(None), ep(None)])
    eng = open_engine()
    for r in (EndpointTypesPresent, FhirRestEndpointShare, EndpointOrgLinkage):
        assert r.measure(eng, s)["status"] == "control_failed", r.rule_id
