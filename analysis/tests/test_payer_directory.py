"""Tests for the H49 payer provider-directory classifier (FHI-71).

H49 counted a payer directory only when its URL path named itself, and
published 50 for 2026-10-07 when the release carried about four times that.
These tests pin both signals, the provider-own-domain negatives that a looser
host rule would have let through, and the positive control that makes a run
raise when a known payer directory stops classifying.
"""
import pytest

from analysis.payer_directory import (
    KNOWN_NOT_DIRECTORIES,
    KNOWN_PAYER_DIRECTORIES,
    PAYER_NAMED_DIRECTORIES,
    ClassifierControlFailed,
    check_controls,
    classify,
    contract_hosts,
    host_of,
    plan_contracts,
    signal_label,
    summarize,
)

PLANS = [
    {"ownedBy": {"reference": "Organization/Organization-devoted"},
     "alias": ["H7028-002-000", "H7028"]},
    {"ownedBy": {"reference": "Organization/Organization-molina"},
     "alias": ["H5628-001-000", "H5628"]},
    {"ownedBy": {"reference": "Organization/Organization-bswhp"},
     "alias": ["H2032"]},
    {"ownedBy": None, "alias": None},
    {"alias": ["not-a-contract", 7]},
]
CONTRACTS = plan_contracts(PLANS)


def test_plan_contracts_reads_bare_ids_only():
    assert CONTRACTS == {"H7028": "Organization-devoted",
                         "H5628": "Organization-molina",
                         "H2032": "Organization-bswhp"}


# ---- path signal: H49's rule, unchanged ----

def test_path_signal_alone():
    c = classify("https://medicare.peakhealth.org/fhir/provider-directory")
    assert c["directory"] and c["path"] and not c["host"]
    assert signal_label(c) == "path_only"
    assert c["url_kind"] == "provider-directory"


def test_path_signal_variants():
    for a in ("https://fhir.healthy-ar.com/plan-net/H7440/",
              "https://x.example/PlanNet/y", "https://x.example/pdex/r4",
              "https://iopc-pd.api.centene.com/iopc/pd/fhir/providerdirectory"):
        assert classify(a)["path"], a


def test_patient_access_stays_its_own_bucket():
    c = classify("https://apif1.aetna.com/fhir/v2/patientaccess/")
    assert not c["directory"] and c["url_kind"] == "patient-access"


# ---- host signal: contract IDs from InsurancePlan ----

def test_contract_id_in_address_classifies_by_host():
    a = "https://www.molinahealthcare.com/cmsjson/378245/MCareFHIR/H5628/index.json"
    c = classify(a, CONTRACTS)
    assert c["directory"] and c["host"] and not c["path"]
    assert c["basis"] == ["contract"] and c["contracts"] == ["H5628"]
    assert c["bulk"]


def test_contract_must_be_in_the_release_plans():
    # Contract-shaped, but no InsurancePlan in the release carries it.
    c = classify("https://www.molinahealthcare.com/cmsjson/378245/MCareFHIR/H9999/index.json",
                 CONTRACTS)
    assert not c["directory"]


def test_contract_id_must_be_a_whole_token():
    assert not classify("https://epicproxy.et7028.epichosted.com/fhir", CONTRACTS)["directory"]
    assert not classify("https://x.example/fhir/H70281/r4", CONTRACTS)["directory"]


def test_host_inherits_contract_signal_from_neighbour():
    addrs = ["https://fhir.devoted.com/H7028/2027", "https://fhir.devoted.com/fhir"]
    hosts = contract_hosts(addrs, CONTRACTS)
    assert hosts == {"fhir.devoted.com": ["H7028"]}
    c = classify("https://fhir.devoted.com/fhir", CONTRACTS, hosts)
    assert c["directory"] and c["host"] and c["basis"] == ["contract"]
    assert not c["bulk"]


def test_shared_cloud_host_never_lends_the_signal():
    addrs = ["https://wadcdnstorageprod.blob.core.windows.net/bswhp/JSON/BSWHP_CMS_MPF_H2032_2026_Index_FHIR.json",
             "https://wadcdnstorageprod.blob.core.windows.net/someclinic/fhir"]
    hosts = contract_hosts(addrs, CONTRACTS)
    assert hosts == {}
    assert classify(addrs[0], CONTRACTS, hosts)["directory"]
    assert not classify(addrs[1], CONTRACTS, hosts)["directory"]


def test_host_signal_never_overrides_a_non_directory_path():
    hosts = {"eapics.ibx.com": ["H7028"]}
    c = classify("https://eapics.ibx.com/patient/v1/fhir/", CONTRACTS, hosts)
    assert not c["directory"] and c["basis"] == []
    assert not classify("https://api-x-prd.safhir.io/v1/api/carin-bb", CONTRACTS,
                        {"api-x-prd.safhir.io": ["H7028"]})["directory"]


# ---- host signal: curated and payer-name lists ----

def test_fhi71_hosts_classify_by_host():
    for a, payer in (
        ("https://apicmsqa.hmhs.com/cms/fhir/v4/providers/HMWVMS/Practitioner", "Highmark"),
        ("https://eapics.ibx.com/provider/v1/fhir", "Independence Blue Cross"),
        ("https://eapics.amerihealth.com/provider/v1/fhir", "AmeriHealth"),
        ("https://api.capitalbluecrossfhir.com/r4/public-ma/", "Capital BlueCross"),
    ):
        c = classify(a)
        assert c["directory"] and c["host"] and not c["path"], a
        assert c["basis"] == ["curated"] and c["payer"] == payer


def test_both_signals():
    c = classify("https://fhir.iehp.org/provider-directory/metadata?_format=json",
                 CONTRACTS, {"fhir.iehp.org": ["H7028"]})
    assert signal_label(c) == "both"


def test_listed_host_outside_its_prefix_is_not_a_directory():
    # Same payer host, authenticated member API at the bare base.
    assert not classify("https://api.capitalbluecrossfhir.com/r4")["directory"]
    assert not classify("https://api.vivahealthfhir.com/r4/")["directory"]


# ---- negatives: a provider's own server is not a payer directory ----

@pytest.mark.parametrize("address", [
    # Provider EHR servers whose organization name resembles a payer's.
    "https://eproxy.mercycare.org/oauth2/STEINDLER/api/FHIR/R4",
    "https://ehrlivefhir.corp.communitycare.com/R4/open-R4",
    "https://proxy.healthpartners.com/FHIRProxy/api/FHIR/R4/",
    # "health" in the host is not evidence of a payer.
    "https://fhir.ssmhc.com/fhir/api/FHIR/DSTU2/",
    "https://epicfhir.msmc.com/proxysite-prd/api/FHIR/R4",
    "https://api.platform.athenahealth.com/11194/brand/1/csg/1/fhir/r4",
    # UPMC Health Plan's authenticated member API (401 on /Practitioner).
    "https://apis.upmchp.com/FHIR/R4/",
])
def test_provider_own_domain_negatives(address):
    assert not classify(address, CONTRACTS)["directory"]


def test_upmc_directory_still_counts_by_path():
    c = classify("https://apis.upmchp.com/FHIR/R4/Group/Providerdirectory/$export")
    assert c["directory"] and c["path"] and c["bulk"]


# ---- breakdown ----

def test_summarize_splits_by_signal_basis_and_shape():
    hosts = {"fhir.devoted.com": ["H7028"]}
    rows = [classify(a, CONTRACTS, hosts) for a in (
        "https://medicare.peakhealth.org/fhir/provider-directory",       # path
        "https://fhir.devoted.com/H7028/2027",                           # host, bulk
        "https://fhir.devoted.com/fhir",                                 # host
        "https://fhir.iehp.org/provider-directory/H7028/index.json",     # both, bulk
        "https://fhir.ssmhc.com/fhir/api/FHIR/DSTU2/",                   # none
    )]
    s = summarize(rows)
    assert s["total"] == 4
    assert s["by_signal"] == {"path_only": 1, "host_only": 2, "both": 1}
    assert s["host_signal_by_basis"]["contract"] == 3
    assert s["bulk_mpf_index"] == 2 and s["searchable_api"] == 2


def test_host_of_is_lowercase_and_drops_port_and_dot():
    assert host_of("https://API-MPHC-prd.safhir.io/v1") == "api-mphc-prd.safhir.io"
    assert host_of("https://interop.metroplus.org:9443/fhir") == "interop.metroplus.org"
    assert host_of("https://epicproxy-pub.et1089.epichosted.com./FHIRProxy") == "epicproxy-pub.et1089.epichosted.com"
    assert host_of("not a url") == ""


# ---- positive control ----

def test_controls_pass_on_the_shipped_lists():
    check_controls(CONTRACTS, plans_present=True)


def test_every_listed_sample_classifies():
    for e in KNOWN_PAYER_DIRECTORIES + PAYER_NAMED_DIRECTORIES:
        assert classify(e["sample"])["host"], e["sample"]
    for a in KNOWN_NOT_DIRECTORIES:
        assert not classify(a)["directory"], a


def test_control_raises_when_plans_yield_no_contracts():
    with pytest.raises(ClassifierControlFailed, match="no contract ID"):
        check_controls({}, plans_present=True)


def test_control_raises_when_a_known_directory_stops_classifying(monkeypatch):
    import analysis.payer_directory as pd
    broken = ({**pd.KNOWN_PAYER_DIRECTORIES[0], "prefix": "/nowhere/"},) + pd.KNOWN_PAYER_DIRECTORIES[1:]
    monkeypatch.setattr(pd, "KNOWN_PAYER_DIRECTORIES", broken)
    with pytest.raises(ClassifierControlFailed, match="did not classify"):
        pd.check_controls(CONTRACTS)


def test_control_raises_when_a_known_non_directory_classifies(monkeypatch):
    import analysis.payer_directory as pd
    monkeypatch.setattr(pd, "KNOWN_NOT_DIRECTORIES",
                        pd.KNOWN_NOT_DIRECTORIES + ("https://x.example/provider-directory",))
    with pytest.raises(ClassifierControlFailed, match="non-directory classified"):
        pd.check_controls(CONTRACTS)
