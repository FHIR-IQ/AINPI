"""Unit tests for the health-system rollup in analysis/org_systems.py.

Pure functions only, no BigQuery. The shapes below are taken from the PA slice
of the 2026-08-20 release, where a billing vendor became the third-largest
"system" and sub-organizations named the systems they belong to.
"""
from analysis.org_systems import (
    brand_key,
    build_systems,
    check_system_controls,
    filter_system_endpoints,
    has_third_party_term,
    is_listed_third_party,
    rollup_system_endpoints,
    system_label,
    third_party_reason,
)

STATES = ["PA", "IL", "ME", "NJ", "OH"]


def org(i, name, city="HARRISBURG", state="PA", npi=None, practitioners=10):
    return {
        "org_id": f"Organization-{i}",
        "org_npi": npi or f"1{i:09d}",
        "org_name": name,
        "org_city": city,
        "org_state": state,
        "practitioners": practitioners,
    }


def vendor_shaped(name, n=50, cities=30, start=0):
    return [
        org(start + i, name, city=f"CITY{i % cities}",
            state=STATES[i % len(STATES)])
        for i in range(n)
    ]


# --------------------------------------------------------------------------
# third-party exclusion
# --------------------------------------------------------------------------

def test_listed_vendor_matches_typo_variant():
    assert is_listed_third_party("COBIUS HEALTHCARE SOLUTIONS")
    assert is_listed_third_party("Cobius Healtcare Solutions, LLC")
    assert not is_listed_third_party("GEISINGER CLINIC")


def test_listed_vendor_is_excluded_even_when_small():
    members = [org(1, "COBIUS HEALTHCARE SOLUTIONS"),
               org(2, "COBIUS HEALTHCARE SOLUTIONS")]
    assert third_party_reason(members) == "listed third-party vendor"
    excluded = []
    assert build_systems(members, excluded=excluded) == []
    assert excluded[0]["label"] == "COBIUS"
    assert excluded[0]["organizations"] == 2


def test_listed_vendor_name_does_not_override_attested_parent():
    # The NPPES parent describes the NPI; the vendor name on the record does
    # not. These NPIs belong to the parent's system, not to the vendor's.
    members = [org(1, "COBIUS HEALTHCARE SOLUTIONS", npi="1111111111"),
               org(2, "COBIUS HEALTHCARE SOLUTIONS", npi="2222222222"),
               org(3, "COBIUS HEALTHCARE SOLUTIONS", npi="3333333333")]
    parents = {"1111111111": "LANCASTER GENERAL HOSPITAL",
               "2222222222": "LANCASTER GENERAL HOSPITAL"}
    excluded = []
    systems = build_systems(members, parent_by_npi=parents, excluded=excluded)
    assert [s["label"] for s in systems] == ["LANCASTER GENERAL HOSPITAL"]
    assert systems[0]["organizations"] == 2
    assert excluded[0]["organizations"] == 1


def test_vendor_shape_excluded_by_heuristic_alone():
    members = vendor_shaped("ACME REVENUE SOLUTIONS")
    reason = third_party_reason(members)
    assert reason and "vendor-type name" in reason


def test_real_system_with_shared_name_is_kept():
    # Geisinger: 108 of 126 members named "GEISINGER CLINIC" over 9 cities.
    members = [org(i, "GEISINGER CLINIC", city=f"C{i % 9}") for i in range(108)]
    members += [org(200 + i, f"GEISINGER UNIT {i}") for i in range(18)]
    assert third_party_reason(members) is None
    systems = build_systems(members)
    assert len(systems) == 1 and systems[0]["organizations"] == 126


def test_services_and_partners_are_not_vendor_terms():
    # Pinnacle Health Medical Services is a real system.
    members = vendor_shaped("PINNACLE HEALTH MEDICAL SERVICES")
    assert third_party_reason(members) is None


def test_pain_management_chain_is_kept():
    assert not has_third_party_term("ADVANCED PAIN MANAGEMENT SPECIALISTS")
    assert has_third_party_term("CRH MD MANAGEMENT")
    members = vendor_shaped("SPINE AND PAIN MANAGEMENT CENTERS")
    assert third_party_reason(members) is None


def test_vendor_term_with_low_name_share_is_kept():
    # Half the members share a SOLUTIONS name: a service line, not a vendor.
    members = vendor_shaped("SENTARA ADVANCED IMAGING SOLUTIONS", n=5)
    members += vendor_shaped("SENTARA MEDICAL GROUP", n=5, start=100)
    assert third_party_reason(members) is None


def test_vendor_term_without_spread_is_kept():
    members = [org(i, "LOCAL BILLING SOLUTIONS", city="YORK") for i in range(6)]
    assert third_party_reason(members) is None


def test_excluded_orgs_do_not_affect_other_systems():
    rows = vendor_shaped("COBIUS HEALTHCARE SOLUTIONS", n=20)
    rows += [org(500, "WELLSPAN MEDICAL GROUP"), org(501, "WELLSPAN SURGERY")]
    excluded = []
    systems = build_systems(rows, excluded=excluded)
    assert [s["system_key"] for s in systems] == ["brand:WELLSPAN"]
    assert excluded[0]["organizations"] == 20


# --------------------------------------------------------------------------
# label choice
# --------------------------------------------------------------------------

def test_brand_label_is_stem_not_largest_member():
    rows = [
        org(1, "AHN PRIMARY CARE MOBILE CLINIC", practitioners=900),
        org(2, "AHN CARDIOLOGY", practitioners=10),
        org(3, "AHN ORTHOPEDICS", practitioners=10),
    ]
    systems = build_systems(rows)
    assert systems[0]["label"] == "AHN"


def test_parent_lbn_wins_label():
    rows = [
        org(1, "DUBOIS REGIONAL MEDICAL CENTER", npi="1000000001",
            practitioners=500),
        org(2, "CLEARFIELD HOSPITAL", npi="1000000002"),
    ]
    parents = {"1000000001": "Penn Highlands Healthcare",
               "1000000002": "PENN HIGHLANDS HEALTHCARE"}
    systems = build_systems(rows, parent_by_npi=parents)
    assert systems[0]["system_key"] == "parent:PENN HIGHLANDS HEALTHCARE"
    assert systems[0]["label"] in ("Penn Highlands Healthcare",
                                   "PENN HIGHLANDS HEALTHCARE")
    assert systems[0]["label"] != "DUBOIS REGIONAL MEDICAL CENTER"


def test_parent_label_uses_most_frequent_spelling():
    members = [org(i, f"X{i}", npi=f"10000000{i:02d}") for i in range(3)]
    parents = {"1000000000": "WELLSPAN HEALTH", "1000000001": "WELLSPAN HEALTH",
               "1000000002": "WELLSPAN HEALTH INC"}
    assert system_label("nppes-parent", "parent:WELLSPAN HEALTH", members,
                        parent_by_npi=parents) == "WELLSPAN HEALTH"


def test_owner_label_uses_owner_name():
    members = [org(1, "A HOSPITAL", npi="1000000001"),
               org(2, "B HOSPITAL", npi="1000000002")]
    owners = {"1000000001": "UPMC", "1000000002": "UPMC"}
    systems = build_systems(members, owner_by_npi=owners)
    assert systems[0]["label"] == "UPMC"
    assert systems[0]["basis"] == "cms-ownership"


# --------------------------------------------------------------------------
# out-of-state endpoint guard
# --------------------------------------------------------------------------

def cand(url, member, state):
    return {"url": url, "vendor": None, "via_member": member,
            "member_state": state}


def test_guard_drops_out_of_state_member_endpoint():
    kept, dropped, unknown = filter_system_endpoints("PA", "OPTUM", [
        cand("https://a/fhir", "OPTUM MEDICAL CARE OF NEW JERSEY", "NJ"),
        cand("https://b/fhir", "OPTUM MEDICAL CARE PENNSYLVANIA", "PA"),
    ])
    assert [c["url"] for c in kept] == ["https://b/fhir"]
    assert [c["url"] for c in dropped] == ["https://a/fhir"]
    assert unknown == 0


def test_guard_keeps_the_systems_own_entity_out_of_state():
    kept, dropped, _ = filter_system_endpoints("PA", "UPMC", [
        cand("https://upmc/fhir", "UPMC", "MD"),
    ])
    assert len(kept) == 1 and dropped == []


def test_guard_keeps_member_without_state_and_counts_it():
    kept, dropped, unknown = filter_system_endpoints("pa", "PINNACLE", [
        cand("https://p/fhir", "PINNACLE HEALTH MEDICAL SERVICES", None),
        cand("https://q/fhir", "PINNACLE HEALTH MEDICAL SERVICES", ""),
    ])
    assert len(kept) == 2 and dropped == [] and unknown == 2


def test_rollup_in_state_copy_survives_out_of_state_twin():
    # The out-of-state member comes first (more practitioners); the same
    # tenant URL is also carried by an in-state member.
    kept, dropped, _ = rollup_system_endpoints("PA", "LANCASTER", [
        cand("https://athena/1", "LANCASTER OB GYN OF NJ", "NJ"),
        cand("https://athena/1", "LANCASTER GENERAL MEDICAL GROUP", "PA"),
    ])
    assert [c["url"] for c in kept] == ["https://athena/1"]
    assert kept[0]["via_member"] == "LANCASTER GENERAL MEDICAL GROUP"
    assert dropped == []


def test_rollup_dedupes_dropped_urls():
    kept, dropped, _ = rollup_system_endpoints("PA", "DLP", [
        cand("https://athena/9", "DLP WESTERN CAROLINA", "NC"),
        cand("https://athena/9", "DLP WESTERN CAROLINA LLC", "NC"),
        cand("https://athena/8", "DLP CONEMAUGH", "PA"),
    ])
    assert [c["url"] for c in kept] == ["https://athena/8"]
    assert [c["url"] for c in dropped] == ["https://athena/9"]


def test_guard_state_match_is_case_insensitive():
    kept, dropped, _ = filter_system_endpoints("pa", "X", [
        cand("https://x/fhir", "X CLINIC", "pa"),
    ])
    assert len(kept) == 1 and dropped == []


# --------------------------------------------------------------------------
# brand key: generic and clinical-specialty openers (FHI-39)
# --------------------------------------------------------------------------

def test_clinical_opener_does_not_merge_unrelated_practices():
    penn = brand_key("CLINICAL CARE ASSOCIATES OF THE UNIVERSITY OF PENNSYLVANIA")
    renal = brand_key("CLINICAL RENAL ASSOCIATES")
    nj = brand_key("CLINICAL HEALTH CARE ASSOCIATES OF NEW JERSEY PC")
    assert penn is None
    assert renal == "CLINICAL RENAL"
    assert nj is None
    systems = build_systems([
        org(1, "CLINICAL CARE ASSOCIATES OF THE UNIVERSITY OF PENNSYLVANIA"),
        org(2, "CLINICAL RENAL ASSOCIATES"),
        org(3, "CLINICAL HEALTH CARE ASSOCIATES OF NEW JERSEY PC"),
    ])
    assert systems == []


def test_main_line_still_groups():
    names = ["MAIN LINE HEALTHCARE", "MAIN LINE HEALTH INC",
             "MAIN LINE EMERGENCY MED ASCS"]
    assert {brand_key(n) for n in names} == {"MAIN LINE"}
    systems = build_systems([org(i, n) for i, n in enumerate(names)])
    assert len(systems) == 1
    assert systems[0]["label"] == "MAIN LINE"
    assert systems[0]["organizations"] == 3


def test_main_alone_is_not_a_brand():
    assert brand_key("MAIN LINE HEALTHCARE") != brand_key("MAIN STREET FAMILY DOCTORS")
    assert brand_key("MAIN") is None


def test_specialty_openers_need_a_distinctive_token():
    # Each of these formed a cross-organization group on its first word in
    # the PA slice of the 2026-08-20 release.
    assert brand_key("EMERGENCY CARE SERVICES OF PENNSYLVANIA PC") is None
    assert brand_key("EMERGENCY PHY ASSOC OF PA PC") is None
    assert brand_key("INTERNAL MED-TOWER HEALTH MED GRP") == "INTERNAL MED TOWER"
    assert brand_key("CARDIOLOGY LIMERICK TOWER HEALTH") == "CARDIOLOGY LIMERICK"
    assert brand_key("CENTER FOR COMMUNITY HOSPITALIST MEDICINE") is None
    assert brand_key("CMS HIH") == "CMS HIH"
    assert brand_key("CARDIOLOGY ASSOCIATES OF LANCASTER") == (
        "CARDIOLOGY ASSOCIATES OF LANCASTER")
    systems = build_systems([
        org(1, "EMERGENCY CARE SERVICES OF PENNSYLVANIA PC"),
        org(2, "EMERGENCY PHYSICIANS OF CENTRAL PA"),
        org(3, "CARDIOLOGY ASSOCIATES OF LANCASTER"),
        org(4, "CARDIOLOGY CONSULTANTS OF PHILADELPHIA"),
    ])
    assert systems == []


def test_real_system_brands_unchanged():
    assert brand_key("UPMC PRESBYTERIAN SHADYSIDE") == "UPMC"
    assert brand_key("UNIVERSITY OF PITTSBURGH PHYSICIANS") == (
        "UNIVERSITY OF PITTSBURGH")
    assert brand_key("ST LUKE'S PHYSICIAN GROUP INC") == "ST LUKE"
    assert brand_key("PENN STATE HEALTH COMMUNITY MEDICAL GROUP LLC") == "PENN"
    assert brand_key("AHN PRIMARY CARE MOBILE CLINIC") == "AHN"
    assert brand_key("WELLSPAN DIGESTIVE HEALTH") == "WELLSPAN"


# --------------------------------------------------------------------------
# positive control on the rollup (FHI-39)
# --------------------------------------------------------------------------

PA_SYSTEM_NAMES = [
    "UPMC PRESBYTERIAN", "UPMC PASSAVANT",
    "AHN PRIMARY CARE", "AHN CARDIOLOGY",
    "GEISINGER CLINIC", "GEISINGER MEDICAL CENTER",
    "WELLSPAN MEDICAL GROUP", "WELLSPAN DIGESTIVE HEALTH",
    "ST LUKE'S PHYSICIAN GROUP INC", "ST LUKE'S HOSPITAL",
    "LEHIGH VALLEY ANESTHESIA SERVICES P C", "LEHIGH VALLEY PHYSICIAN GROUP",
    "JEFFERSON RADIOLOGY", "JEFFERSON EMERGENCY SERVICES",
    "MAIN LINE HEALTHCARE", "MAIN LINE EMERGENCY MED ASCS",
]


def pa_rows():
    rows = [org(i, n) for i, n in enumerate(PA_SYSTEM_NAMES)]
    # Penn State Health arrives through the NPPES parent tier.
    rows += [org(100, "PENN STATE HEALTH COMMUNITY MEDICAL GROUP LLC",
                 npi="1999999991"),
             org(101, "HAMPDEN MEDICAL CENTER", npi="1999999992")]
    rows += [org(200 + i, "COBIUS HEALTHCARE SOLUTIONS",
                 city=f"CITY{i}", state=STATES[i % len(STATES)])
             for i in range(6)]
    return rows


PA_PARENTS = {"1999999991": "PENN STATE HEALTH",
              "1999999992": "PENN STATE HEALTH"}


def run_controls(rows, parents=PA_PARENTS, **kw):
    excluded = []
    systems = build_systems(rows, parent_by_npi=parents, excluded=excluded)
    return check_system_controls("PA", rows, systems, excluded,
                                 parent_by_npi=parents, **kw)


def test_controls_pass_on_a_healthy_rollup():
    assert run_controls(pa_rows()) == []


def test_controls_fail_when_cobius_is_not_excluded():
    rows = pa_rows()
    excluded = []
    systems = build_systems(rows, parent_by_npi=PA_PARENTS, excluded=excluded)
    # Simulate a regression that grouped the vendor instead of excluding it.
    excluded = [r for r in excluded if r["label"] != "COBIUS"]
    problems = check_system_controls("PA", rows, systems, excluded,
                                     parent_by_npi=PA_PARENTS)
    assert any("COBIUS" in p and "not excluded" in p for p in problems)


def test_controls_do_not_demand_cobius_where_there_is_none():
    rows = [o for o in pa_rows() if "COBIUS" not in o["org_name"]]
    assert run_controls(rows) == []


def test_controls_ignore_cobius_claimed_by_an_attested_parent():
    rows = [org(1, "COBIUS HEALTHCARE SOLUTIONS", npi="1888888881")]
    parents = {"1888888881": "LANCASTER GENERAL HOSPITAL"}
    excluded = []
    systems = build_systems(rows, parent_by_npi=parents, excluded=excluded,
                            min_members=1)
    assert check_system_controls("PA", rows, systems, excluded, known={},
                                 parent_by_npi=parents) == []


def test_controls_fail_when_a_known_system_is_excluded():
    rows = pa_rows()
    excluded = []
    systems = build_systems(rows, parent_by_npi=PA_PARENTS, excluded=excluded)
    excluded.append({"system_key": "brand:UPMC", "label": "UPMC",
                     "reason": "vendor-type name", "organizations": 2,
                     "practitioners": 20})
    problems = check_system_controls("PA", rows, systems, excluded,
                                     parent_by_npi=PA_PARENTS)
    assert any("UPMC was excluded" in p for p in problems)


def test_controls_fail_when_a_known_system_vanishes():
    rows = [o for o in pa_rows() if not o["org_name"].startswith("MAIN LINE")]
    problems = run_controls(rows)
    assert problems == [
        "known system Main Line Health is not among the grouped systems "
        "(looked for labels starting MAIN LINE)"]


def test_control_label_match_is_token_wise():
    rows = pa_rows()
    excluded = []
    systems = build_systems(rows, parent_by_npi=PA_PARENTS, excluded=excluded)
    # "STATION ..." starts with the letters ST but is not St. Luke's, and a
    # label that merely contains AHN is not Allegheny Health Network.
    excluded.append({"system_key": "brand:STATION", "label": "STATION MEDICAL",
                     "reason": "x", "organizations": 5, "practitioners": 5})
    excluded.append({"system_key": "brand:JAHN", "label": "JAHN",
                     "reason": "x", "organizations": 5, "practitioners": 5})
    assert check_system_controls("PA", rows, systems, excluded,
                                 parent_by_npi=PA_PARENTS) == []
