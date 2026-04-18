"""Unit tests for parsers.py — no network activity."""

from __future__ import annotations

import sys
import pathlib

# Make the crawler package importable when pytest is run from the crawler/ dir
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from parsers import (  # noqa: E402
    normalize_base_url,
    parse_capability_statement,
    parse_smart_config,
)


# ---------- normalize_base_url ----------


def test_normalize_strips_trailing_slash():
    assert normalize_base_url("https://fhir.example.com/r4/") == "https://fhir.example.com/r4"


def test_normalize_strips_multiple_trailing_slashes():
    assert normalize_base_url("https://fhir.example.com/r4///") == "https://fhir.example.com/r4"


def test_normalize_strips_query_and_fragment():
    assert (
        normalize_base_url("https://fhir.example.com/r4?foo=bar#x")
        == "https://fhir.example.com/r4"
    )


def test_normalize_handles_empty_input():
    assert normalize_base_url("") == ""
    assert normalize_base_url("   ") == ""


# ---------- parse_capability_statement ----------


def test_cs_valid_r4_server():
    cs = {
        "resourceType": "CapabilityStatement",
        "status": "active",
        "date": "2026-01-01",
        "kind": "instance",
        "fhirVersion": "4.0.1",
        "rest": [{"mode": "server", "resource": []}],
        "software": {"name": "HAPI FHIR", "version": "6.10.0"},
    }
    v = parse_capability_statement(cs)
    assert v.parseable is True
    assert v.fhir_version == "4.0.1"
    assert v.has_rest_server_mode is True
    assert v.software_name == "HAPI FHIR"
    assert v.software_version == "6.10.0"
    assert v.reason is None


def test_cs_wrong_resource_type():
    v = parse_capability_statement({"resourceType": "OperationOutcome"})
    assert v.parseable is False
    assert "OperationOutcome" in (v.reason or "")


def test_cs_missing_fhir_version():
    v = parse_capability_statement(
        {
            "resourceType": "CapabilityStatement",
            "status": "active",
            "date": "2026-01-01",
            "kind": "instance",
            "rest": [{"mode": "server"}],
        }
    )
    assert v.parseable is True
    assert v.fhir_version is None
    assert v.has_rest_server_mode is True


def test_cs_client_mode_only():
    v = parse_capability_statement(
        {
            "resourceType": "CapabilityStatement",
            "status": "active",
            "date": "2026-01-01",
            "kind": "instance",
            "fhirVersion": "4.0.1",
            "rest": [{"mode": "client"}],
        }
    )
    assert v.parseable is True
    assert v.has_rest_server_mode is False


def test_cs_not_a_dict():
    v = parse_capability_statement("not json")
    assert v.parseable is False
    assert "object" in (v.reason or "")


def test_cs_empty_rest_list():
    v = parse_capability_statement(
        {
            "resourceType": "CapabilityStatement",
            "status": "active",
            "date": "2026-01-01",
            "kind": "instance",
            "fhirVersion": "4.0.1",
            "rest": [],
        }
    )
    assert v.parseable is True
    assert v.has_rest_server_mode is False


# ---------- parse_smart_config ----------


def test_smart_valid_with_pkce_s256():
    cfg = {
        "token_endpoint": "https://auth.example.com/token",
        "authorization_endpoint": "https://auth.example.com/authorize",
        "code_challenge_methods_supported": ["S256"],
        "grant_types_supported": ["authorization_code", "client_credentials"],
    }
    v = parse_smart_config(cfg)
    assert v.valid is True
    assert v.has_token_endpoint is True
    assert v.has_authorization_endpoint is True
    assert v.pkce_s256 is True
    assert "authorization_code" in v.grant_types
    assert v.reason is None


def test_smart_missing_pkce_s256():
    cfg = {
        "token_endpoint": "https://auth.example.com/token",
        "authorization_endpoint": "https://auth.example.com/authorize",
        "code_challenge_methods_supported": ["plain"],
    }
    v = parse_smart_config(cfg)
    assert v.valid is False
    assert v.pkce_s256 is False
    assert "S256" in (v.reason or "")


def test_smart_missing_endpoints():
    v = parse_smart_config({"code_challenge_methods_supported": ["S256"]})
    assert v.valid is False
    assert "token_endpoint" in (v.reason or "")
    assert "authorization_endpoint" in (v.reason or "")


def test_smart_non_https_endpoints_still_counted_as_present():
    # Some test environments advertise http:// — we still record them
    cfg = {
        "token_endpoint": "http://localhost/token",
        "authorization_endpoint": "http://localhost/authorize",
        "code_challenge_methods_supported": ["S256"],
    }
    v = parse_smart_config(cfg)
    assert v.has_token_endpoint is True
    assert v.has_authorization_endpoint is True
    assert v.valid is True


def test_smart_not_a_dict():
    v = parse_smart_config(["list", "not", "dict"])
    assert v.valid is False
    assert "object" in (v.reason or "")


def test_smart_nonlist_pkce_methods():
    v = parse_smart_config(
        {
            "token_endpoint": "https://auth.example.com/token",
            "authorization_endpoint": "https://auth.example.com/authorize",
            "code_challenge_methods_supported": "S256",  # wrong shape
        }
    )
    assert v.valid is False
    assert v.pkce_s256 is False
