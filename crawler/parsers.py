"""
Pure-function parsers for CapabilityStatement and SMART well-known config.

These are the L4-L6 content checks. Kept in a separate module so they
can be unit-tested without any network activity. Every function takes
already-decoded JSON (a Python dict) and returns a small dataclass
with the boolean verdict plus any captured details.

References:
- FHIR R4 CapabilityStatement: https://www.hl7.org/fhir/capabilitystatement.html
- SMART on FHIR 2.0: https://hl7.org/fhir/smart-app-launch/conformance.html
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass
class CapabilityStatementVerdict:
    parseable: bool
    fhir_version: str | None
    has_rest_server_mode: bool
    software_name: str | None
    software_version: str | None
    reason: str | None = None


@dataclass
class SmartConfigVerdict:
    valid: bool
    has_token_endpoint: bool
    has_authorization_endpoint: bool
    pkce_s256: bool
    grant_types: list[str]
    reason: str | None = None


REQUIRED_CS_FIELDS = {"resourceType", "status", "date", "kind"}


def parse_capability_statement(obj: Any) -> CapabilityStatementVerdict:
    """Validate a CapabilityStatement JSON body.

    L4 check: parseable JSON and `resourceType == 'CapabilityStatement'`.
    L5 check: `fhirVersion` present and at least one `rest` entry with
    `mode == 'server'`.
    """
    if not isinstance(obj, dict):
        return CapabilityStatementVerdict(
            parseable=False,
            fhir_version=None,
            has_rest_server_mode=False,
            software_name=None,
            software_version=None,
            reason="body is not a JSON object",
        )

    rtype = obj.get("resourceType")
    if rtype != "CapabilityStatement":
        return CapabilityStatementVerdict(
            parseable=False,
            fhir_version=None,
            has_rest_server_mode=False,
            software_name=None,
            software_version=None,
            reason=f"resourceType is {rtype!r}, expected 'CapabilityStatement'",
        )

    fhir_version = obj.get("fhirVersion")
    if not isinstance(fhir_version, str):
        fhir_version = None

    rest = obj.get("rest") or []
    has_rest_server_mode = False
    if isinstance(rest, list):
        for entry in rest:
            if isinstance(entry, dict) and entry.get("mode") == "server":
                has_rest_server_mode = True
                break

    software = obj.get("software")
    software_name = None
    software_version = None
    if isinstance(software, dict):
        if isinstance(software.get("name"), str):
            software_name = software["name"]
        if isinstance(software.get("version"), str):
            software_version = software["version"]

    return CapabilityStatementVerdict(
        parseable=True,
        fhir_version=fhir_version,
        has_rest_server_mode=has_rest_server_mode,
        software_name=software_name,
        software_version=software_version,
        reason=None,
    )


def parse_smart_config(obj: Any) -> SmartConfigVerdict:
    """Validate a /.well-known/smart-configuration body.

    L6 check: required fields present AND `S256` in
    `code_challenge_methods_supported`.
    """
    if not isinstance(obj, dict):
        return SmartConfigVerdict(
            valid=False,
            has_token_endpoint=False,
            has_authorization_endpoint=False,
            pkce_s256=False,
            grant_types=[],
            reason="body is not a JSON object",
        )

    token = obj.get("token_endpoint")
    auth = obj.get("authorization_endpoint")
    has_token = isinstance(token, str) and token.startswith(("http://", "https://"))
    has_auth = isinstance(auth, str) and auth.startswith(("http://", "https://"))

    pkce_methods = obj.get("code_challenge_methods_supported") or []
    pkce_s256 = isinstance(pkce_methods, list) and "S256" in pkce_methods

    grant_types = obj.get("grant_types_supported") or []
    if not isinstance(grant_types, list):
        grant_types = []

    # "Valid" = required endpoints + PKCE S256. The SMART 2.0 spec also
    # requires `grant_types_supported`, but real-world endpoints often omit
    # it; we record but don't gate on it.
    valid = has_token and has_auth and pkce_s256
    reason = None
    if not valid:
        missing = []
        if not has_token:
            missing.append("token_endpoint")
        if not has_auth:
            missing.append("authorization_endpoint")
        if not pkce_s256:
            missing.append("code_challenge_methods_supported=S256")
        reason = "missing: " + ", ".join(missing)

    return SmartConfigVerdict(
        valid=valid,
        has_token_endpoint=has_token,
        has_authorization_endpoint=has_auth,
        pkce_s256=pkce_s256,
        grant_types=[g for g in grant_types if isinstance(g, str)],
        reason=reason,
    )


def normalize_base_url(url: str) -> str:
    """Strip trailing slashes and query/fragment from a base URL."""
    url = (url or "").strip()
    # Drop fragment
    if "#" in url:
        url = url.split("#", 1)[0]
    # Drop query
    if "?" in url:
        url = url.split("?", 1)[0]
    # Strip trailing slashes
    return url.rstrip("/")
