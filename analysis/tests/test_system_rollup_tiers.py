"""FHI-73: the connectivity ledger's health-system rollup.

Pure functions and fixtures only, no BigQuery. The shapes come from the PA
slice of the 2026-10-07 release as measured by FHI-19 (PR #179): Geisinger,
St. Luke's and WellSpan reach their own endpoint through H53 brand
resolution, AHN through CMS enrollment, and UPP not at all until the alias to
Epic's renamed "MyUPMC" brand works.
"""
import csv
import io
import json
import pathlib

import pytest

from analysis import h51_vendor_endpoint_attribution as h51
from analysis import h53_org_endpoint_resolution as h53
from analysis import state_connectivity as sc
from analysis.org_systems import (
    build_systems,
    check_system_controls,
    host_on_domain,
    url_host,
    vendor_brand_conflicts,
)
from analysis.release import CURRENT_RELEASE

NPI_SID = "http://hl7.org/fhir/sid/us-npi"
NPI_TERM = "http://terminology.hl7.org/NamingSystem/npi"


def org(i, name, npi=None, state="PA", practitioners=10):
    return {"org_id": f"Organization-{i}", "org_npi": npi or f"1{i:09d}",
            "org_name": name, "org_city": "X", "org_state": state,
            "practitioners": practitioners}


# --------------------------------------------------------------------------
# defect 4: H51 keeps every NPI published beside a URL
# --------------------------------------------------------------------------

def epic_bundle():
    """An Epic-shaped brand bundle: urn:uuid refs, NPIs on the brand org."""
    return {"entry": [
        {"fullUrl": "urn:uuid:brand-ahn", "resource": {
            "resourceType": "Organization", "id": "brand-ahn",
            "name": "Allegheny Health Network",
            "identifier": [
                {"system": "https://open.epic.com/brand-identifier", "value": "898"},
                {"system": NPI_SID, "value": "1982632311"},
                {"system": NPI_SID, "value": "1013985126"},
                {"system": NPI_TERM, "value": "1720056138"},
                {"system": NPI_SID, "value": "1982632311"},  # duplicate
            ],
            "endpoint": [{"reference": "urn:uuid:ep-ahn"}]}},
        {"fullUrl": "urn:uuid:ep-ahn", "resource": {
            "resourceType": "Endpoint", "id": "ep-ahn",
            "address": "https://epicprisfd.ahn.org/prd-fhir/mychart/api/FHIR/R4/"}},
        {"fullUrl": "urn:uuid:site-1", "resource": {
            "resourceType": "Organization", "id": "site-1",
            "name": "AHN Pediatrics - Chartiers",
            "partOf": {"reference": "urn:uuid:brand-ahn"}}},
        # A second brand on the same endpoint, as Geisinger and CommunityCare.
        {"fullUrl": "urn:uuid:brand-cc", "resource": {
            "resourceType": "Organization", "id": "brand-cc",
            "name": "CommunityCare",
            "identifier": [{"system": NPI_SID, "value": "1306838065"}],
            "endpoint": [{"reference": "urn:uuid:ep-ahn"}]}},
        {"fullUrl": "urn:uuid:brand-none", "resource": {
            "resourceType": "Organization", "id": "brand-none",
            "name": "No NPI Brand",
            "endpoint": [{"reference": "urn:uuid:ep-none"}]}},
        {"fullUrl": "urn:uuid:ep-none", "resource": {
            "resourceType": "Endpoint", "id": "ep-none",
            "address": "https://none.example.org/fhir"}},
    ]}


def test_parse_bundle_keeps_every_npi_in_source_order():
    names, npis, n_orgs, reach = h51.parse_bundle(epic_bundle(), brands=True)
    url = "https://epicprisfd.ahn.org/prd-fhir/mychart/api/fhir/r4"
    assert names[url] == "Allegheny Health Network"
    assert [n for n, _ in npis[url]] == [
        "1982632311", "1013985126", "1720056138", "1306838065"]
    # The NPI keeps the name of the brand that published it.
    assert dict(npis[url])["1306838065"] == "CommunityCare"
    assert dict(npis[url])["1013985126"] == "Allegheny Health Network"
    assert "https://none.example.org/fhir" not in npis
    assert n_orgs == 4 and reach == 4


def test_parse_bundle_reads_the_terminology_npi_system():
    # The pre-FHI-73 matcher looked for "us-npi" in the system and missed
    # the URL the NDH switched to in May 2026.
    _, npis, _, _ = h51.parse_bundle(epic_bundle(), brands=True)
    url = "https://epicprisfd.ahn.org/prd-fhir/mychart/api/fhir/r4"
    assert "1720056138" in [n for n, _ in npis[url]]


def test_csv_rows_add_rows_without_changing_columns():
    names, npis, _, _ = h51.parse_bundle(epic_bundle(), brands=True)
    vendors = {u: "Epic (User-access Brands)" for u in names}
    rows = h51.csv_rows(names, npis, vendors, ndh_urls=set(names), owned=set())
    assert all(len(r) == 6 for r in rows)
    url = "https://epicprisfd.ahn.org/prd-fhir/mychart/api/fhir/r4"
    ahn = [r for r in rows if r[0] == url]
    assert [r[2] for r in ahn] == [
        "1982632311", "1013985126", "1720056138", "1306838065"]
    # First row per URL is the NPI the single-NPI file carried.
    assert ahn[0][1] == "Allegheny Health Network"
    assert ahn[3][1] == "CommunityCare"
    bare = [r for r in rows if r[0] == "https://none.example.org/fhir"]
    assert bare == [["https://none.example.org/fhir", "No NPI Brand", "",
                     "Epic (User-access Brands)", "yes", "no"]]


def test_csv_rows_are_readable_by_the_ledger_loader(tmp_path, monkeypatch):
    names, npis, _, _ = h51.parse_bundle(epic_bundle(), brands=True)
    vendors = {u: "Epic (User-access Brands)" for u in names}
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["url", "org_name", "org_npi", "vendor", "in_ndh",
                "ndh_has_owner"])
    w.writerows(h51.csv_rows(names, npis, vendors, set(), set()))
    (tmp_path / "vendor-endpoint-attribution.csv").write_text(buf.getvalue())
    monkeypatch.setattr(sc, "FINDINGS_DIR", tmp_path)
    url_vendor, npi_url, _ = sc.load_vendor_attribution()
    url = "https://epicprisfd.ahn.org/prd-fhir/mychart/api/fhir/r4"
    for npi in ("1982632311", "1013985126", "1720056138", "1306838065"):
        assert npi_url[npi] == url
    brands = sc.load_vendor_brands()
    # Every brand on the shared endpoint is the NPI's brand.
    assert brands["1013985126"] == {"Allegheny Health Network", "CommunityCare"}
    assert brands["1306838065"] == {"Allegheny Health Network", "CommunityCare"}


# --------------------------------------------------------------------------
# defect 3: dead aliases raise
# --------------------------------------------------------------------------

VENDOR_ROWS = [
    {"vendor": "Epic", "name": "UPMC Cole", "brand": "MyUPMC",
     "states": {"PA"}, "url": "https://epicent-prd-rp.upmc.com/prd-oauth2/api/fhir/r4"},
    {"vendor": "Epic", "name": "Allegheny Clinic", "brand": "Allegheny Health Network",
     "states": {"PA"}, "url": "https://epicprisfd.ahn.org/prd-fhir/mychart/api/fhir/r4"},
]


def alias(name, brand, state="PA"):
    return {("X" + name, state): {"ndh_name": name, "brand": brand,
                                  "state": state, "basis": "test"}}


def test_dead_alias_is_reported_and_raises():
    aliases = {**alias("UNIVERSITY OF PITTSBURGH PHYSICIANS", "UPMC"),
               **alias("ALLEGHENY CLINIC", "Allegheny Health Network")}
    dead = h53.dead_aliases(aliases, VENDOR_ROWS)
    assert [a["brand"] for a in dead] == ["UPMC"]
    with pytest.raises(h53.DeadAliasError, match="UPMC"):
        h53.check_aliases(aliases, VENDOR_ROWS)


def test_live_alias_passes_and_state_must_agree():
    h53.check_aliases(alias("UNIVERSITY OF PITTSBURGH PHYSICIANS", "MyUPMC"),
                      VENDOR_ROWS)
    with pytest.raises(h53.DeadAliasError):
        h53.check_aliases(alias("X", "MyUPMC", state="OH"), VENDOR_ROWS)


def test_check_aliases_refuses_an_empty_vendor_cache():
    with pytest.raises(h53.DeadAliasError, match="no vendor rows"):
        h53.check_aliases(alias("X", "MyUPMC"), [])


def test_repointed_alias_resolves_upp_to_myupmc():
    aliases = {(h53.normalize(a["ndh_name"]), a["state"]): a
               for a in alias("UNIVERSITY OF PITTSBURGH PHYSICIANS", "MyUPMC").values()}
    rows, tiers, prac, _ = h53.resolve(
        [org(1, "UNIVERSITY OF PITTSBURGH PHYSICIANS", practitioners=6479)],
        VENDOR_ROWS, {}, {}, aliases)
    assert rows[0]["tier"] == "alias"
    assert "upmc.com" in rows[0]["endpoint"]


def test_curated_alias_file_has_no_penn_state_and_names_live_labels():
    doc = json.loads((pathlib.Path(h53.REPO_ROOT) / "analysis"
                      / "org_aliases.json").read_text())
    brands = {a["ndh_name"]: a["brand"] for a in doc["aliases"]}
    assert brands["UNIVERSITY OF PITTSBURGH PHYSICIANS"] == "MyUPMC"
    assert brands["PINNACLE HEALTH MEDICAL SERVICES"] == "MyUPMC"
    assert brands["TEMPLE PHYSICIANS INC"] == "TempleHealth"
    assert not any("PENN STATE" in n or "HERSHEY" in n for n in brands)


@pytest.mark.skipif(not (h53.CACHE / h53.EPIC_FILE).exists(),
                    reason="vendor cache not present (run H51 first)")
def test_curated_aliases_match_the_cached_vendor_files():
    h53.check_aliases(h53.load_aliases(), h53.load_epic() + h53.load_flat())


# --------------------------------------------------------------------------
# defect 6: H53 release pin
# --------------------------------------------------------------------------

def test_h53_release_is_the_current_release():
    assert h53.NDH_RELEASE == CURRENT_RELEASE


# --------------------------------------------------------------------------
# defect 5: vendor brand vetoes a wrong name group
# --------------------------------------------------------------------------

def test_vendor_brand_conflict_rules():
    ahn = ["Allegheny Health Network"]
    tju = ["Thomas Jefferson University Health System"]
    assert vendor_brand_conflicts("JEFFERSON REGIONAL MEDICAL CENTER", ahn)
    assert not vendor_brand_conflicts("JEFFERSON UNIVERSITY PHYSICIANS", tju)
    assert not vendor_brand_conflicts("AHN CARDIOLOGY", ahn)  # initials
    assert not vendor_brand_conflicts("ALLEGHENY CLINIC", ahn)
    assert not vendor_brand_conflicts("ST LUKE'S HOSPITAL", ["St Luke's"])
    assert not vendor_brand_conflicts("JEFFERSON REGIONAL MEDICAL CENTER", [])
    # One agreeing label is enough.
    assert not vendor_brand_conflicts("GEISINGER CLINIC",
                                      ["CommunityCare", "Geisinger"])


def test_jefferson_group_drops_ahn_hospitals_on_vendor_evidence():
    rows = [org(1, "JEFFERSON HEALTH NORTHEAST"),
            org(2, "JEFFERSON UNIVERSITY PHYSICIANS"),
            org(3, "JEFFERSON REGIONAL MEDICAL CENTER", npi="1013985126",
                practitioners=84),
            org(4, "JEFFERSON HOSPITAL COUNSELING SERVICES", npi="1720056138",
                practitioners=47)]
    brands = {"1013985126": {"Allegheny Health Network"},
              "1720056138": {"Allegheny Health Network"}}
    before = build_systems(rows)
    assert [s["organizations"] for s in before] == [4]
    vetoed = []
    after = build_systems(rows, vendor_brands_by_npi=brands, vetoed=vetoed,
                          veto_prefixes=("JEFFERSON",))
    assert [s["label"] for s in after] == ["JEFFERSON"]
    assert after[0]["organizations"] == 2
    assert {v["org_name"] for v in vetoed} == {
        "JEFFERSON REGIONAL MEDICAL CENTER",
        "JEFFERSON HOSPITAL COUNSELING SERVICES"}
    assert vetoed[0]["vendor_brands"] == ["Allegheny Health Network"]


def test_veto_is_limited_to_known_system_groups():
    # Evangelical's medical group sits under Geisinger's CommunityCare portal.
    # A hosted affiliate is not evidence against its own name group.
    rows = [org(1, "EVANGELICAL COMMUNITY HOSPITAL"),
            org(2, "EVANGELICAL MEDICAL SERVICES ORGANIZATION", npi="1555555555")]
    brands = {"1555555555": {"CommunityCare", "Geisinger"}}
    systems = build_systems(rows, vendor_brands_by_npi=brands,
                            veto_prefixes=("GEISINGER", "JEFFERSON"))
    assert systems[0]["organizations"] == 2


def test_vendor_brand_does_not_override_an_attested_parent():
    rows = [org(1, "JEFFERSON REGIONAL MEDICAL CENTER", npi="1013985126"),
            org(2, "JEFFERSON HILLS CLINIC", npi="2000000002")]
    parents = {"1013985126": "JEFFERSON HEALTH", "2000000002": "JEFFERSON HEALTH"}
    systems = build_systems(rows, parent_by_npi=parents,
                            vendor_brands_by_npi={"1013985126": {"Allegheny Health Network"}})
    assert systems[0]["organizations"] == 2


# --------------------------------------------------------------------------
# defect 2: distinct practitioners
# --------------------------------------------------------------------------

def test_system_counts_distinct_practitioners_and_keeps_link_sum():
    rows = [org(1, "UPMC PRESBYTERIAN", practitioners=3),
            org(2, "UPMC SHADYSIDE", practitioners=3)]
    by_org = {"Organization-1": {"a", "b", "c"},
              "Organization-2": {"a", "b", "d"}}
    s = build_systems(rows, practitioners_by_org=by_org)[0]
    assert s["practitioners"] == 4
    assert s["practitioner_org_links"] == 6
    assert s["practitioners_counted"] == "distinct"
    legacy = build_systems(rows)[0]
    assert legacy["practitioners"] == 6
    assert legacy["practitioners_counted"] == "link-sum"


# --------------------------------------------------------------------------
# defect 1: tiered reach
# --------------------------------------------------------------------------

GEIS = "https://geisapi.geisinger.edu/fhir/api/fhir/r4"
AHN = "https://epicprisfd.ahn.org/prd-fhir/mychart/api/fhir/r4"
UPMC = "https://epicent-prd-rp.upmc.com/prd-oauth2/api/fhir/r4"
OTHER = "https://fhir.other-system.example.org/r4"


def run_reach(systems, org_rows, prac_by_org, ep_by_id=None, npi_url=None,
              org_resolution=None, enrollment=None, state="PA"):
    org_by_id = {o["org_id"]: o for o in org_rows}
    return sc.rollup_system_reach(
        state, systems, org_by_id, prac_by_org,
        member_endpoint=lambda o: sc.member_endpoint(
            o, ep_by_id or {}, {}, npi_url or {}, org_resolution or {}),
        enrollment_endpoints=enrollment or {},
        url_vendor={GEIS: "Epic (User-access Brands)"})


def test_h53_tier_reaches_geisinger_and_is_labelled():
    rows = [org(1, "GEISINGER CLINIC"), org(2, "GEISINGER MEDICAL CENTER")]
    by_org = {"Organization-1": {"a", "b"}, "Organization-2": {"b", "c"}}
    systems = build_systems(rows, practitioners_by_org=by_org)
    res = run_reach(systems, rows, by_org, org_resolution={
        "Organization-1": (GEIS, "brand-state"),
        "Organization-2": (GEIS, "brand-state")})
    s = systems[0]
    assert s["endpoint_count"] == 1
    assert s["endpoint_count_deterministic"] == 0
    assert s["endpoints"][0]["tier"] == "brand-state"
    assert s["endpoints"][0]["practitioners"] == 3
    assert s["reaches_endpoint"] == 3
    assert s["reaches_endpoint_deterministic"] == 0
    assert s["reach_by_tier"]["brand-state"] == 3
    assert res["reach_by_system"][s["system_key"]] == {GEIS: {"brand-state": 3}}


def test_practitioner_counts_once_at_the_strongest_tier():
    rows = [org(1, "WELLSPAN HEALTH"), org(2, "WELLSPAN PHYSICIANS")]
    by_org = {"Organization-1": {"a", "b"}, "Organization-2": {"b"}}
    systems = build_systems(rows, practitioners_by_org=by_org)
    run_reach(systems, rows, by_org,
              ep_by_id={"Organization-2": GEIS},
              org_resolution={"Organization-1": (GEIS, "brand-state")})
    t = systems[0]["reach_by_tier"]
    assert t["ndh"] == 1 and t["brand-state"] == 1
    assert systems[0]["reaches_endpoint"] == 2
    assert systems[0]["endpoints"][0]["tier"] == "ndh"


def test_enrollment_on_another_systems_endpoint_is_not_rolled_up():
    rows = [org(1, "UNIVERSITY OF PITTSBURGH PHYSICIANS"),
            org(2, "UNIVERSITY OF PITTSBURGH MEDICAL CENTER")]
    by_org = {"Organization-1": {"a", "b"}, "Organization-2": {"c"}}
    systems = build_systems(rows, practitioners_by_org=by_org)
    run_reach(systems, rows, by_org, enrollment={
        "a": (OTHER, "brand-state", "Epic", "SOME OTHER GROUP"),
        "b": (UPMC, "alias", "Epic", "UPMC PHYSICIAN SERVICES")})
    s = systems[0]
    # "b" lands on upmc.com, the system's curated own domain; "a" does not.
    assert s["reaches_endpoint"] == 1
    assert s["reach_by_tier"]["cms-enrollment-own-endpoint"] == 1
    assert [e["url"] for e in s["endpoints"]] == [UPMC]
    assert s["endpoints"][0]["tier"] == "cms-enrollment-own-endpoint"


def test_enrollment_on_an_endpoint_a_member_reaches_counts():
    rows = [org(1, "ST LUKES PHYSICIAN GROUP", state="ZZ"),
            org(2, "ST LUKES HOSPITAL", state="ZZ")]
    by_org = {"Organization-1": {"a"}, "Organization-2": {"b"}}
    systems = build_systems(rows, practitioners_by_org=by_org)
    slhn = "https://fhir.slhn.org/fhir/api/fhir/r4"
    run_reach(systems, rows, by_org, state="ZZ",
              org_resolution={"Organization-1": (slhn, "brand-state")},
              enrollment={"b": (slhn, "brand-state", "Epic", "ST LUKES")})
    assert systems[0]["reach_by_tier"]["brand-state"] == 1
    assert systems[0]["reach_by_tier"]["cms-enrollment-own-endpoint"] == 1


def test_out_of_state_member_endpoint_reaches_nobody():
    rows = [org(1, "GEISINGER CLINIC"),
            org(2, "GEISINGER NEW YORK", state="NY")]
    by_org = {"Organization-1": {"a"}, "Organization-2": {"b"}}
    systems = build_systems(rows, practitioners_by_org=by_org)
    res = run_reach(systems, rows, by_org,
                    org_resolution={"Organization-2": (OTHER, "brand-state")})
    assert systems[0]["reaches_endpoint"] == 0
    assert systems[0]["endpoint_count"] == 0
    assert res["out_of_state_dropped"][0]["tier"] == "brand-state"


# --------------------------------------------------------------------------
# defect 7: a known system with an own-domain endpoint must reach someone
# --------------------------------------------------------------------------

KNOWN = {"Geisinger": ("GEISINGER",)}
DOMAINS = {"Geisinger": ("geisinger.edu",)}


def geisinger_systems():
    return [{"system_key": "brand:GEISINGER", "label": "GEISINGER"}]


def test_domain_helpers():
    assert url_host(GEIS) == "geisapi.geisinger.edu"
    assert host_on_domain("geisapi.geisinger.edu", "geisinger.edu")
    assert host_on_domain("upmc.com", "upmc.com")
    assert not host_on_domain("apis.upmchp.com", "upmc.com")


def test_reach_control_fires_when_own_domain_endpoint_reaches_nobody():
    problems = check_system_controls(
        "PA", [], geisinger_systems(), [], known=KNOWN,
        reach_by_system={"brand:GEISINGER": {}}, available_urls={GEIS},
        known_domains=DOMAINS)
    assert any("geisinger.edu" in p for p in problems)


def test_reach_control_passes_when_reached_or_nothing_published():
    ok = check_system_controls(
        "PA", [], geisinger_systems(), [], known=KNOWN,
        reach_by_system={"brand:GEISINGER": {GEIS: 5199}},
        available_urls={GEIS}, known_domains=DOMAINS)
    assert ok == []
    nothing = check_system_controls(
        "PA", [], geisinger_systems(), [], known=KNOWN,
        reach_by_system={"brand:GEISINGER": {}},
        available_urls={OTHER}, known_domains=DOMAINS)
    assert nothing == []


def test_acknowledged_gap_is_published_and_cannot_go_stale():
    acknowledged = []
    problems = check_system_controls(
        "PA", [], geisinger_systems(), [], known=KNOWN,
        reach_by_system={"brand:GEISINGER": {}}, available_urls={GEIS},
        known_domains=DOMAINS, known_unreached={"Geisinger": "evidence"},
        acknowledged=acknowledged)
    assert problems == []
    assert acknowledged == [{"system": "Geisinger",
                             "domains": ["geisinger.edu"],
                             "reason": "evidence"}]
    stale = check_system_controls(
        "PA", [], geisinger_systems(), [], known=KNOWN,
        reach_by_system={"brand:GEISINGER": {GEIS: 3}}, available_urls={GEIS},
        known_domains=DOMAINS, known_unreached={"Geisinger": "evidence"})
    assert any("remove the entry" in p for p in stale)


def test_reach_control_fails_with_no_endpoint_urls_loaded():
    problems = check_system_controls(
        "PA", [], geisinger_systems(), [], known=KNOWN,
        reach_by_system={"brand:GEISINGER": {}}, available_urls=set(),
        known_domains=DOMAINS)
    assert any("no endpoint URLs were loaded" in p for p in problems)


def test_enrollment_alone_does_not_satisfy_the_reach_control():
    only_enrollment = {"brand:GEISINGER": {
        GEIS: {"cms-enrollment-own-endpoint": 40}}}
    problems = check_system_controls(
        "PA", [], geisinger_systems(), [], known=KNOWN,
        reach_by_system=only_enrollment, available_urls={GEIS},
        known_domains=DOMAINS)
    assert any("member tier" in p for p in problems)
    with_member = {"brand:GEISINGER": {
        GEIS: {"cms-enrollment-own-endpoint": 40, "brand-state": 1}}}
    assert check_system_controls(
        "PA", [], geisinger_systems(), [], known=KNOWN,
        reach_by_system=with_member, available_urls={GEIS},
        known_domains=DOMAINS) == []


def test_reach_on_another_domain_does_not_satisfy_the_control():
    problems = check_system_controls(
        "PA", [], geisinger_systems(), [], known=KNOWN,
        reach_by_system={"brand:GEISINGER": {OTHER: 40}},
        available_urls={GEIS, OTHER}, known_domains=DOMAINS)
    assert problems


# --------------------------------------------------------------------------
# build(): the payload carries the tiers, distinct counts and corrections
# --------------------------------------------------------------------------

def prac(npi, org_ids):
    return {"npi": npi, "zip": None, "n_roles": len(org_ids),
            "n_resolved_orgs": len(org_ids), "n_orgs_with_npi": len(org_ids),
            "n_roles_with_location": 0, "org_ids": org_ids,
            "org_npis": [], "org_names": []}


def test_build_payload_systems_block():
    orgs = [org(1, "GEISINGER CLINIC", state="ZZ", practitioners=2),
            org(2, "GEISINGER MEDICAL CENTER", state="ZZ", practitioners=2)]
    rows = [prac("a", ["Organization-1"]),
            prac("b", ["Organization-1", "Organization-2"]),
            prac("c", ["Organization-2"])]
    payload = sc.build(
        "ZZ", rows, orgs, [], {}, {}, {},
        {"Organization-1": (GEIS, "brand-state"),
         "Organization-2": (GEIS, "brand-state")},
        {}, {}, {GEIS: "Epic (User-access Brands)"}, {}, {}, None)
    systems = payload["systems"]
    row = systems["rows"][0]
    assert row["practitioners"] == 3
    assert row["practitioner_org_links"] == 4
    assert row["reach_by_tier"]["brand-state"] == 3
    assert row["endpoint_count"] == 1
    assert "_all_member_org_ids" not in row
    assert systems["practitioners_in_a_system_that_reaches_an_endpoint"] == 3
    assert systems["practitioners_reached_through_a_system"]["by_tier"][
        "brand-state"] == 3
    assert systems["systems_reaching_an_endpoint_deterministic"] == 0
    assert systems["corrections"] and all(
        c["issue"] == "FHI-73" for c in systems["corrections"])
    assert systems["tiers"]["order"][0] == "ndh"
    link = payload["graph"]["links"][0]
    assert link["tier"] == "brand-state"
    node = next(n for n in payload["graph"]["nodes"] if n["type"] == "system")
    assert node["connected"] is True
    assert node["connected_deterministic"] is False
    assert systems[
        "practitioners_in_a_system_that_reaches_an_endpoint_deterministic"] == 0
    assert "_deterministic keys" in systems["tiers"]["note"]
