"""Rule registry and release runner. CC0 1.0."""
from __future__ import annotations

from pathlib import Path

from ndh_quality.base import NdhRule, assert_not_dataless, open_engine
from ndh_quality.rules.rule_endpoint_org_linkage import EndpointOrgLinkage
from ndh_quality.rules.rule_endpoint_types_present import EndpointTypesPresent
from ndh_quality.rules.rule_fhir_rest_endpoint_share import FhirRestEndpointShare
from ndh_quality.rules.rule_npi_check_digit import NpiCheckDigit
from ndh_quality.rules.rule_role_references_resolve import RoleReferencesResolve

_RULES = [EndpointOrgLinkage, EndpointTypesPresent, FhirRestEndpointShare,
          NpiCheckDigit, RoleReferencesResolve]


def all_rules() -> list[type[NdhRule]]:
    return sorted(_RULES, key=lambda r: r.rule_id)


def _inputs(release_dir) -> list[Path]:
    names = sorted({res for r in all_rules() for res in r.resources})
    return [p for p in (Path(release_dir) / f"{n}.parquet" for n in names) if p.exists()]


def _msg(exc: Exception) -> str:
    first = (str(exc).splitlines() or [""])[0][:200]
    return f"{type(exc).__name__}: {first}"


def _error_row(rule: type[NdhRule], exc: Exception, note: str = "") -> dict:
    return {
        "rule_id": rule.rule_id, "rule_version": rule.rule_version,
        "hypotheses": list(rule.hypotheses), "relation": rule.relation,
        "measure": rule.measure_name, "severity": rule.severity,
        "threshold": rule.threshold, "numerator": None, "denominator": None,
        "value": None, "control_count": None, "control_previous": None,
        "control_passed": False, "status": "error", "detail": _msg(exc) + note,
    }


def run_release(release_dir, previous_dir=None) -> list[dict]:
    release_dir = Path(release_dir)
    assert_not_dataless(_inputs(release_dir))
    if previous_dir is not None:
        previous_dir = Path(previous_dir)
        assert_not_dataless(_inputs(previous_dir))
    engine = open_engine()
    rows = []
    for rule in all_rules():
        previous, note = None, ""
        if previous_dir is not None:
            try:
                previous = int(rule._row(engine, {"release_dir": str(previous_dir)})["control_count"] or 0)
            except Exception as exc:
                note = f" (previous release not measured: {_msg(exc)})"
        try:
            row = rule.measure(engine, {"release_dir": str(release_dir)}, previous)
            if note:
                row["detail"] = f"{row['detail'] or ''}{note}".strip()
            rows.append(row)
        except Exception as exc:
            rows.append(_error_row(rule, exc, note))
    return rows
