"""
L0-L7 endpoint liveness level checks.

Walks a single URL through the seven liveness tiers defined in the
methodology. Each tier's outcome is captured on `ProbeResult`. A failure
at tier N short-circuits tiers that depend on it (e.g. L0 DNS failure
means we can't attempt L1+).

Crawl etiquette: 10s connect, 30s read. Exponential backoff w/ jitter
on 429/503 is implemented here because it's specific to the HTTP tier;
per-host rate limiting lives in ratelimit.py.
"""

from __future__ import annotations

import asyncio
import json
import random
import socket
import ssl
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse

import certifi
import httpx


# Shared SSL context: uses certifi's CA bundle so we don't depend on the
# host OS's trust store. macOS Python installs and slim Docker images both
# ship without a system CA trust path — certifi makes the crawler behave
# identically everywhere.
_SSL_CONTEXT: ssl.SSLContext | None = None


def _ssl_context() -> ssl.SSLContext:
    global _SSL_CONTEXT
    if _SSL_CONTEXT is None:
        _SSL_CONTEXT = ssl.create_default_context(cafile=certifi.where())
    return _SSL_CONTEXT

from parsers import (
    CapabilityStatementVerdict,
    SmartConfigVerdict,
    normalize_base_url,
    parse_capability_statement,
    parse_smart_config,
)

USER_AGENT = (
    "AINPI-DirectoryQualityBot/1.0 "
    "(+https://ainpi.vercel.app/crawler; gene@fhiriq.com)"
)

CONNECT_TIMEOUT_S = 10.0
READ_TIMEOUT_S = 30.0
BACKOFF_ATTEMPTS = 3


@dataclass
class ProbeResult:
    endpoint_id: str
    url: str
    host: str
    probed_at: str
    highest_level_reached: int = -1

    l0_dns: bool | None = None
    l0_dns_error: str | None = None

    l1_tcp: bool | None = None
    l1_tcp_error: str | None = None

    l2_tls: bool | None = None
    l2_tls_error: str | None = None
    l2_cert_not_after: str | None = None
    l2_cert_issuer: str | None = None

    l3_http: bool | None = None
    l3_http_status: int | None = None
    l3_http_error: str | None = None

    l4_capability_parseable: bool | None = None
    l4_capability_error: str | None = None

    l5_fhir_version: str | None = None
    l5_capability_conformant: bool | None = None
    l5_software_name: str | None = None
    l5_software_version: str | None = None

    l6_smart_valid: bool | None = None
    l6_smart_pkce_s256: bool | None = None
    l6_smart_error: str | None = None
    l6_smart_grant_types: list[str] = field(default_factory=list)

    l7_unauth_search_status: int | None = None
    l7_unauth_search_pass: bool | None = None
    l7_unauth_search_error: str | None = None

    def to_row(self) -> dict[str, Any]:
        row = asdict(self)
        # Parquet doesn't love list columns mixed with scalars; join for now
        row["l6_smart_grant_types"] = ",".join(row["l6_smart_grant_types"])
        return row


# -----------------------------------------------------------------------------
# L0 — DNS
# -----------------------------------------------------------------------------
async def l0_dns(host: str) -> tuple[bool, str | None]:
    loop = asyncio.get_running_loop()
    try:
        await loop.getaddrinfo(host, None, family=socket.AF_UNSPEC)
        return True, None
    except socket.gaierror as e:
        return False, f"gaierror: {e}"
    except Exception as e:  # noqa: BLE001  — crawler is a boundary
        return False, f"{type(e).__name__}: {e}"


# -----------------------------------------------------------------------------
# L1 — TCP + L2 — TLS (+ cert capture)
# -----------------------------------------------------------------------------
async def l1_l2_tcp_tls(host: str, port: int, use_tls: bool) -> dict[str, Any]:
    """Open a TCP (and optionally TLS) connection; capture peer cert if TLS.

    Returns a dict with:
        l1_tcp, l1_tcp_error,
        l2_tls (None if use_tls=False), l2_tls_error,
        l2_cert_not_after, l2_cert_issuer
    """
    out: dict[str, Any] = {
        "l1_tcp": False,
        "l1_tcp_error": None,
        "l2_tls": None,
        "l2_tls_error": None,
        "l2_cert_not_after": None,
        "l2_cert_issuer": None,
    }

    ssl_ctx = _ssl_context() if use_tls else None
    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(host=host, port=port, ssl=ssl_ctx, server_hostname=host if use_tls else None),
            timeout=CONNECT_TIMEOUT_S,
        )
    except asyncio.TimeoutError:
        out["l1_tcp_error"] = f"timeout after {CONNECT_TIMEOUT_S}s"
        return out
    except ssl.SSLError as e:
        out["l1_tcp"] = True  # TCP succeeded, TLS failed
        out["l2_tls"] = False
        out["l2_tls_error"] = f"ssl: {e}"
        return out
    except Exception as e:  # noqa: BLE001
        out["l1_tcp_error"] = f"{type(e).__name__}: {e}"
        return out

    out["l1_tcp"] = True

    if use_tls:
        out["l2_tls"] = True
        try:
            ssl_obj = writer.get_extra_info("ssl_object")
            peercert = ssl_obj.getpeercert() if ssl_obj is not None else None
            if peercert:
                not_after = peercert.get("notAfter")
                if not_after:
                    # Normalize 'Jun  1 12:00:00 2027 GMT' to ISO-ish
                    try:
                        dt = datetime.strptime(not_after, "%b %d %H:%M:%S %Y %Z")
                        out["l2_cert_not_after"] = dt.replace(tzinfo=timezone.utc).isoformat()
                    except ValueError:
                        out["l2_cert_not_after"] = not_after
                issuer = peercert.get("issuer")
                if issuer:
                    # ((('countryName', 'US'),), (('organizationName', '...'),), ...)
                    out["l2_cert_issuer"] = "/".join(
                        f"{k}={v}" for tup in issuer for (k, v) in tup
                    )
        except Exception as e:  # noqa: BLE001
            out["l2_tls_error"] = f"cert parse: {type(e).__name__}: {e}"

    writer.close()
    try:
        await writer.wait_closed()
    except Exception:  # noqa: BLE001
        pass
    return out


# -----------------------------------------------------------------------------
# L3 — HTTP at base URL
# L4 — CapabilityStatement at /metadata
# L5 — CapabilityStatement conformance
# L6 — SMART config at /.well-known/smart-configuration
# L7 — Unauthenticated Practitioner search
# -----------------------------------------------------------------------------
async def _get_with_backoff(client: httpx.AsyncClient, url: str, **kwargs: Any) -> httpx.Response | None:
    """GET with exponential backoff + jitter on 429/503. Returns None on hard failure."""
    last: httpx.Response | None = None
    for attempt in range(BACKOFF_ATTEMPTS):
        try:
            resp = await client.get(url, **kwargs)
        except httpx.TimeoutException:
            if attempt == BACKOFF_ATTEMPTS - 1:
                return None
            await asyncio.sleep(2 ** attempt + random.uniform(0, 0.5))
            continue
        except httpx.RequestError:
            return None
        last = resp
        if resp.status_code in (429, 503) and attempt < BACKOFF_ATTEMPTS - 1:
            await asyncio.sleep(2 ** attempt + random.uniform(0, 0.5))
            continue
        return resp
    return last


async def l3_http(client: httpx.AsyncClient, base: str) -> tuple[bool, int | None, str | None]:
    resp = await _get_with_backoff(client, base)
    if resp is None:
        return False, None, "request failed after retries"
    # L3 = "server answered HTTP." Any non-5xx counts as reachable. FHIR
    # doesn't require servers to respond at the bare base URL (only at
    # /metadata per §2.3.1) so 4xx here is common and not a liveness
    # failure. Status code is recorded for downstream analysis.
    passing = resp.status_code < 500
    return passing, resp.status_code, None


async def l4_l5_capability(
    client: httpx.AsyncClient, base: str
) -> tuple[CapabilityStatementVerdict | None, str | None]:
    url = base + "/metadata"
    resp = await _get_with_backoff(
        client, url, headers={"Accept": "application/fhir+json,application/json;q=0.9"}
    )
    if resp is None:
        return None, "request failed after retries"
    if resp.status_code >= 400:
        return None, f"HTTP {resp.status_code}"
    try:
        body = resp.json()
    except json.JSONDecodeError:
        return None, "body is not valid JSON"
    return parse_capability_statement(body), None


async def l6_smart(client: httpx.AsyncClient, base: str) -> tuple[SmartConfigVerdict | None, str | None]:
    url = base + "/.well-known/smart-configuration"
    resp = await _get_with_backoff(client, url, headers={"Accept": "application/json"})
    if resp is None:
        return None, "request failed after retries"
    if resp.status_code == 404:
        # SMART is optional; absence is informational, not an error
        return None, "no /.well-known/smart-configuration (404)"
    if resp.status_code >= 400:
        return None, f"HTTP {resp.status_code}"
    try:
        body = resp.json()
    except json.JSONDecodeError:
        return None, "body is not valid JSON"
    return parse_smart_config(body), None


async def l7_unauth_practitioner_search(
    client: httpx.AsyncClient, base: str
) -> tuple[int | None, bool, str | None]:
    url = base + "/Practitioner"
    resp = await _get_with_backoff(
        client,
        url,
        params={"_count": "1"},
        headers={"Accept": "application/fhir+json"},
    )
    if resp is None:
        return None, False, "request failed after retries"
    # 200 = public read (discoverable), 401 = protected-but-discoverable.
    # Both count as "reachable" per the methodology.
    return resp.status_code, resp.status_code in (200, 401), None


# -----------------------------------------------------------------------------
# Full probe — orchestrates L0 through L7 for one endpoint
# -----------------------------------------------------------------------------
async def probe_endpoint(
    client: httpx.AsyncClient,
    endpoint_id: str,
    url: str,
) -> ProbeResult:
    base = normalize_base_url(url)
    parsed = urlparse(base)
    host = parsed.hostname or ""
    is_https = parsed.scheme == "https"
    port = parsed.port or (443 if is_https else 80)

    result = ProbeResult(
        endpoint_id=endpoint_id,
        url=base,
        host=host,
        probed_at=datetime.now(timezone.utc).isoformat(),
    )

    if not host:
        result.l0_dns_error = "no hostname in URL"
        result.l0_dns = False
        return result

    # L0
    dns_ok, dns_err = await l0_dns(host)
    result.l0_dns = dns_ok
    result.l0_dns_error = dns_err
    if not dns_ok:
        return result
    result.highest_level_reached = 0

    # L1 + L2 via raw TCP / TLS
    tcp_tls = await l1_l2_tcp_tls(host, port, use_tls=is_https)
    result.l1_tcp = tcp_tls["l1_tcp"]
    result.l1_tcp_error = tcp_tls["l1_tcp_error"]
    if not result.l1_tcp:
        return result
    result.highest_level_reached = 1

    if is_https:
        result.l2_tls = tcp_tls["l2_tls"]
        result.l2_tls_error = tcp_tls["l2_tls_error"]
        result.l2_cert_not_after = tcp_tls["l2_cert_not_after"]
        result.l2_cert_issuer = tcp_tls["l2_cert_issuer"]
        if not result.l2_tls:
            return result
        result.highest_level_reached = 2
    else:
        # Plain HTTP — L2 is trivially "not applicable"; record and proceed
        result.highest_level_reached = 2

    # L3
    http_ok, status, http_err = await l3_http(client, base)
    result.l3_http = http_ok
    result.l3_http_status = status
    result.l3_http_error = http_err
    if not http_ok:
        return result
    result.highest_level_reached = 3

    # L4 + L5
    cs, cs_err = await l4_l5_capability(client, base)
    if cs is None:
        result.l4_capability_parseable = False
        result.l4_capability_error = cs_err
    else:
        result.l4_capability_parseable = cs.parseable
        result.l4_capability_error = cs.reason
        result.l5_fhir_version = cs.fhir_version
        result.l5_capability_conformant = cs.parseable and bool(cs.fhir_version) and cs.has_rest_server_mode
        result.l5_software_name = cs.software_name
        result.l5_software_version = cs.software_version
        if cs.parseable:
            result.highest_level_reached = 4
            if result.l5_capability_conformant:
                result.highest_level_reached = 5

    # L6 (optional; absence is not a hard failure)
    smart, smart_err = await l6_smart(client, base)
    if smart is None:
        result.l6_smart_error = smart_err
    else:
        result.l6_smart_valid = smart.valid
        result.l6_smart_pkce_s256 = smart.pkce_s256
        result.l6_smart_grant_types = smart.grant_types
        result.l6_smart_error = smart.reason
        if smart.valid:
            result.highest_level_reached = max(result.highest_level_reached, 6)

    # L7
    l7_status, l7_pass, l7_err = await l7_unauth_practitioner_search(client, base)
    result.l7_unauth_search_status = l7_status
    result.l7_unauth_search_pass = l7_pass
    result.l7_unauth_search_error = l7_err
    if l7_pass:
        result.highest_level_reached = max(result.highest_level_reached, 7)

    return result
