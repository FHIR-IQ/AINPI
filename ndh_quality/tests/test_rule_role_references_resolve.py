from ndh_quality.base import open_engine
from ndh_quality.rules.rule_role_references_resolve import RoleReferencesResolve

P = [{"_id": "p1"}, {"_id": "p2"}]
O = [{"_id": "o1"}]


def run(release_dir, roles, practitioners=P, orgs=O, types=None):
    d = release_dir({"practitioner_role": roles, "practitioner": practitioners, "organization": orgs}, types)
    return RoleReferencesResolve.measure(open_engine(), {"release_dir": str(d)})


def role(p, o):
    return {"_practitioner_id": p, "_org_id": o}


def test_all_resolve(release_dir):
    m = run(release_dir, [role("Practitioner/p1", "Organization/o1"), role("Practitioner/p2", "Organization/o1")])
    assert m["status"] == "pass"
    assert m["numerator"] == m["denominator"] == 4


def test_dangling_practitioner(release_dir):
    m = run(release_dir, [role("Practitioner/p1", "Organization/o1"), role("Practitioner/zz", "Organization/o1")])
    assert m["value"] == 0.75
    assert "dangling_practitioner=1" in m["detail"]
    assert "dangling_org=0" in m["detail"]


def test_half_practitioner_refs_dangling(release_dir):
    m = run(release_dir, [role("Practitioner/p1", None), role("Practitioner/zz", None)])
    assert m["value"] == 0.5
    assert m["status"] == "fail"
    assert "dangling_practitioner=1" in m["detail"]


def test_null_org_excluded_from_denominator(release_dir):
    m = run(release_dir, [role("Practitioner/p1", None), role("Practitioner/p2", "Organization/o1")])
    assert m["denominator"] == 3


def test_all_null_practitioner_control_failed(release_dir):
    m = run(release_dir, [role(None, None), role(None, None)])
    assert m["status"] == "control_failed"
