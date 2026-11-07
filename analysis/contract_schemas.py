"""JSON Schemas for the public /api/v1 contract.

The contract had no machine-readable schema. `manifest.json` advertised a
`schema_ref` of `frontend/src/lib/api-v1-types.ts:ApiV1Finding`, which is a
path to a TypeScript file: useful to a human reading the repo, useless to an
external consumer and unenforceable against the Python that writes the files.

That gap is why a whole class of defect shipped this month. TypeScript types
are erased at compile time and never see the JSON; the generators are Python
and can emit anything. Nothing compared the two.

These schemas are published at /api/v1/schemas/ so consumers can validate, and
enforced by `analysis/validate_contract.py` so we do.

Deliberately permissive about optional fields and additive keys: the contract
promises a shape, not an exhaustive field list, and consumers must tolerate
new keys. It is strict about the things that have actually gone wrong -
required identifiers, types, ranges, and enum membership.
"""
from __future__ import annotations

# Every published payload carries these. `release_date` is free-form rather
# than date-formatted on purpose: claims-side findings legitimately carry
# labels like "CY 2023 (RY2025 P05)" because their provenance is a claims year
# and not an NDH release.
_PROVENANCE = {
    "release_date": {"type": ["string", "null"], "minLength": 1},
    "generated_at": {"type": "string", "minLength": 1},
    "methodology_version": {"type": ["string", "null"]},
    "commit_sha": {"type": ["string", "null"]},
}

CHART_SCHEMA = {
    "type": ["object", "null"],
    "properties": {
        "type": {"type": "string", "enum": ["bar", "line", "stacked-bar", "scatter"]},
        "unit": {"type": "string", "enum": ["percent", "count", "usd", "days"]},
        "data": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "label": {"type": ["string", "number"]},
                    # Charts have shipped with string values ("1 of 12,995").
                    # Allowed, because the renderer handles it, but the
                    # validator checks numeric ranges where the value is a
                    # number and the unit says percent.
                    "value": {"type": ["number", "string", "null"]},
                },
                "required": ["label"],
            },
        },
    },
    "required": ["data"],
}

FINDING_SCHEMA = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://ainpi.dev/api/v1/schemas/finding.schema.json",
    "title": "AINPI finding",
    "description": (
        "One pre-registered finding. Published at /api/v1/findings/<slug>.json. "
        "A finding whose numbers have not landed yet still serves this shape "
        "with null numerator and denominator."
    ),
    "type": "object",
    "properties": {
        **_PROVENANCE,
        "slug": {"type": "string", "pattern": "^[a-z0-9-]+$"},
        "title": {"type": ["string", "null"]},
        # H30a / H30b are real: a hypothesis split into two registered halves.
        "hypotheses": {
            "type": "array",
            "items": {"type": "string", "pattern": "^H[0-9]+[a-z]?$"},
        },
        "status": {
            "type": ["string", "null"],
            "enum": ["published", "in-progress", "pre-registered", None],
        },
        "headline": {"type": ["string", "null"]},
        "numerator": {"type": ["number", "null"]},
        "denominator": {"type": ["number", "null"]},
        "chart": CHART_SCHEMA,
        "notes": {"type": ["string", "null"]},
    },
    "required": ["slug", "release_date", "generated_at"],
}

STATS_SCHEMA = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://ainpi.dev/api/v1/schemas/stats.schema.json",
    "title": "AINPI top-line stats",
    "type": "object",
    "properties": {
        **_PROVENANCE,
        "counters": {
            "type": "object",
            "properties": {
                "resources_processed": {"type": "integer", "minimum": 0},
                "npis_checked": {"type": ["integer", "null"], "minimum": 0},
                "npis_flagged": {"type": ["integer", "null"], "minimum": 0},
                "endpoints_live_pct": {
                    "type": ["number", "null"], "minimum": 0, "maximum": 100,
                },
                "findings_published": {"type": "integer", "minimum": 0},
                "findings_in_progress": {"type": "integer", "minimum": 0},
                "findings_pre_registered": {"type": "integer", "minimum": 0},
            },
            "required": ["resources_processed", "findings_published"],
        },
        # Present when a counter is measured against a different release from
        # the one this file pins. Additive, so old consumers are unaffected.
        "counters_as_of": {"type": "object"},
    },
    "required": ["release_date", "generated_at", "counters"],
}

STATE_SCHEMA = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://ainpi.dev/api/v1/schemas/state.schema.json",
    "title": "AINPI state slice",
    "type": "object",
    "properties": {
        **_PROVENANCE,
        "state": {"type": "string", "pattern": "^[A-Za-z]{2}$"},
        "state_name": {"type": ["string", "null"]},
        "denominators": {
            "type": "object",
            "properties": {
                "practitioner": {"type": "integer", "minimum": 0},
                "organization": {"type": "integer", "minimum": 0},
                "location": {"type": "integer", "minimum": 0},
            },
        },
        "verify_samples": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "npi": {"type": "string", "pattern": "^[0-9]{10}$"},
                    "flagged_by": {"type": "string"},
                    "flag_reason": {"type": "string"},
                },
                "required": ["npi"],
            },
        },
    },
    "required": ["state", "release_date", "generated_at"],
}

MANIFEST_SCHEMA = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://ainpi.dev/api/v1/schemas/manifest.schema.json",
    "title": "AINPI discovery manifest",
    "description": "Index of every published URL. The entry point for an agent.",
    "type": "object",
    "properties": {
        **_PROVENANCE,
        "service": {"type": "string"},
        "site": {"type": "string", "format": "uri"},
        "findings": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "slug": {"type": "string"},
                    "url": {"type": "string", "format": "uri"},
                },
                "required": ["slug", "url"],
            },
        },
        "states": {"type": "array"},
        "downloads_csv": {"type": "array"},
    },
    "required": ["service", "site", "release_date", "findings"],
}

_NULLABLE_NUM = {"type": ["number", "null"]}

DQ_RESULTS_SCHEMA = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://ainpi.dev/api/v1/schemas/dq_results.schema.json",
    "title": "AINPI data-quality results",
    "description": "One row per (release_date, rule_id, rule_version), merged append-safe by analysis/dq_run.py.",
    "type": "object",
    "properties": {
        "schema_version": {"const": 1},
        "generated_at": {"type": "string", "minLength": 1},
        "rows": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "release_date": {"type": "string", "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}$"},
                    "rule_id": {"type": "string", "minLength": 1},
                    "rule_version": {"type": "integer", "minimum": 1},
                    "hypotheses": {"type": "array", "items": {"type": "string"}},
                    "relation": {"type": "string", "enum": ["implements", "partial", "related", "control"]},
                    "severity": {"type": "string", "enum": ["pipeline", "expect", "monitor"]},
                    "threshold": {
                        "type": ["object", "null"],
                        "properties": {"op": {"type": "string"}, "value": {"type": "number"},
                                       "source_text": {"type": ["string", "null"]}},
                    },
                    "numerator": _NULLABLE_NUM,
                    "denominator": _NULLABLE_NUM,
                    "value": _NULLABLE_NUM,
                    "control_count": _NULLABLE_NUM,
                    "control_previous": _NULLABLE_NUM,
                    "control_passed": {"type": "boolean"},
                    "status": {"type": "string",
                               "enum": ["pass", "fail", "control_failed", "error", "recorded"]},
                    "measure": {"type": ["string", "null"]},
                    "measure_value": _NULLABLE_NUM,
                    "measure_agrees": {"type": "string",
                                       "enum": ["true", "false", "no_point", "not_paired",
                                                "definition_mismatch"]},
                    "input_fingerprint": {"type": "object"},
                    "engine": {"type": "string"},
                    "git_sha": {"type": ["string", "null"]},
                    "run_at": {"type": "string", "minLength": 1},
                    "superseded_by": {"type": ["string", "null"]},
                    "detail": {"type": ["string", "null"]},
                },
                "required": ["release_date", "rule_id", "rule_version", "status", "severity",
                             "measure_agrees", "input_fingerprint", "run_at", "superseded_by"],
            },
        },
    },
    "required": ["schema_version", "generated_at", "rows"],
}

SOURCE_CHANGES_SCHEMA = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://ainpi.dev/api/v1/schemas/source_changes.schema.json",
    "title": "AINPI source-changes log",
    "description": "Curated changes to the CMS NDH export (and two upstream files) that changed how it must be read. Built from analysis/source_changes.yaml.",
    "type": "object",
    "properties": {
        "schema_version": {"const": 1},
        "entries": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "pattern": "^sc-[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z0-9-]+$"},
                    "first_release": {"type": "string", "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}$"},
                    "resource": {"type": "string", "minLength": 1},
                    "element": {"type": "string", "minLength": 1},
                    "kind": {"type": "string",
                             "enum": ["code-system", "identifier", "id-minting", "vocabulary",
                                      "file-layout", "value-pattern", "upstream-file"]},
                    "before": {"type": "string", "minLength": 1},
                    "after": {"type": "string", "minLength": 1},
                    "detected": {"type": "string", "minLength": 1},
                    "impact": {"type": "string", "minLength": 1},
                    "handled_by": {"type": "string", "minLength": 1},
                    "evidence": {"type": "string", "minLength": 1},
                    "evidence_ref": {"type": "string", "minLength": 1},
                    "status": {"type": "string", "enum": ["active", "resolved"]},
                },
                "required": ["id", "first_release", "resource", "element", "kind", "before",
                             "after", "detected", "impact", "handled_by", "evidence", "status"],
            },
        },
    },
    "required": ["schema_version", "entries"],
}

_NETWORK_TYPES = ["state_hie", "multi_state", "qhin", "vendor_network", "payer_api", "direct"]
USE_CASE_SLUGS = ["treatment-records", "individual-access", "find-endpoint", "payer-exchange",
                  "encounter-alerts", "public-health", "community-referral"]
# The 50 states and DC. Territories are out of scope for the networks map.
STATE_CODES_51 = (
    "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO "
    "MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY"
).split()
_ISO_DATE_PATTERN = "^[0-9]{4}-[0-9]{2}-[0-9]{2}$"
# The page renders these as hrefs; only https is ever a link.
_HTTPS_URL = {"type": "string", "pattern": "^https://[^\\s]+$"}
_AINPI_LINK = {
    "type": "object",
    "properties": {
        "label": {"type": "string", "minLength": 1},
        "href": {"type": "string"},
        "finding_slug": {"type": "string"},
    },
    "required": ["label"],
}
_NETWORK_SOURCE = {
    "type": "object",
    "properties": {
        "url": _HTTPS_URL,
        "title": {"type": "string", "minLength": 1},
        "accessed": {"type": "string", "pattern": _ISO_DATE_PATTERN},
        "primary": {"type": "boolean"},
    },
    "required": ["url", "title", "accessed", "primary"],
}

NETWORKS_SCHEMA = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://ainpi.dev/api/v1/schemas/networks.schema.json",
    "title": "AINPI health data networks guide",
    "description": "Use cases, the routes data can take for each, and the networks that carry those routes, by state. Every network and route cites at least one primary source.",
    "type": "object",
    "properties": {
        "schema_version": {"const": 1},
        "generated_at": {"type": "string", "minLength": 1},
        "use_cases": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "slug": {"enum": USE_CASE_SLUGS},
                    "label": {"type": "string", "minLength": 1},
                    "summary": {"type": "string", "minLength": 1},
                    "ainpi_links": {"type": "array", "items": _AINPI_LINK},
                },
                "required": ["slug", "label", "summary", "ainpi_links"],
            },
        },
        "routes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "minLength": 1},
                    "use_case": {"enum": USE_CASE_SLUGS},
                    "title": {"type": "string", "minLength": 1},
                    "summary": {"type": "string", "minLength": 1},
                    "who_can_use": {"type": "string", "minLength": 1},
                    "rule": {"type": "string", "minLength": 1},
                    "standard": {"type": "string", "minLength": 1},
                    "how_to_join": {"type": "string", "minLength": 1},
                    "network_types": {"type": "array", "items": {"enum": _NETWORK_TYPES}},
                    "sources": {"type": "array", "items": _NETWORK_SOURCE},
                    "ainpi_links": {"type": "array", "items": _AINPI_LINK},
                },
                "required": ["id", "use_case", "title", "summary", "who_can_use", "rule",
                             "standard", "how_to_join", "network_types", "sources", "ainpi_links"],
            },
        },
        "networks": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "minLength": 1},
                    "name": {"type": "string", "minLength": 1},
                    "type": {"enum": _NETWORK_TYPES},
                    "national": {"type": "boolean"},
                    "states": {"type": "array", "items": {"enum": STATE_CODES_51}},
                    "detail_level": {"enum": ["basic", "full"]},
                    "routes": {"type": "array", "items": {"type": "string"}},
                    "website": _HTTPS_URL,
                    "how_to_join": {"type": "string", "minLength": 1},
                    "sources": {"type": "array", "items": _NETWORK_SOURCE},
                    "last_checked": {"type": "string", "pattern": _ISO_DATE_PATTERN},
                },
                "required": ["id", "name", "type", "national", "states", "detail_level",
                             "routes", "website", "how_to_join", "sources", "last_checked"],
            },
        },
        "glossary": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "term": {"type": "string", "minLength": 1},
                    "definition": {"type": "string", "minLength": 1},
                },
                "required": ["term", "definition"],
            },
        },
    },
    "required": ["schema_version", "generated_at", "use_cases", "routes", "networks", "glossary"],
}

SCHEMAS = {
    "finding": FINDING_SCHEMA,
    "stats": STATS_SCHEMA,
    "state": STATE_SCHEMA,
    "manifest": MANIFEST_SCHEMA,
    "dq_results": DQ_RESULTS_SCHEMA,
    "source_changes": SOURCE_CHANGES_SCHEMA,
    "networks": NETWORKS_SCHEMA,
}
