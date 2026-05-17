"""Build /api/v1/manifest.json — the discovery index for AINPI.

Walks frontend/public/api/v1/{findings,states}/*.{json,csv} and emits a
single manifest enumerating every published artifact, its schema link,
and a one-sentence description. This is the file an AI agent / external
consumer can poll to discover every URL the site publishes.

Run: python analysis/build_manifest.py
"""
from __future__ import annotations
import json
import pathlib
from datetime import datetime, timezone

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
API_V1 = REPO_ROOT / "frontend" / "public" / "api" / "v1"
OUT = API_V1 / "manifest.json"

SITE = "https://ainpi.dev"


def main() -> None:
    findings_dir = API_V1 / "findings"
    states_dir = API_V1 / "states"

    findings = []
    for p in sorted(findings_dir.glob("*.json")):
        if p.name.startswith("_"):
            continue
        try:
            data = json.loads(p.read_text())
        except Exception:
            continue
        slug = data.get("slug") or p.stem
        findings.append({
            "slug": slug,
            "title": data.get("title"),
            "hypotheses": data.get("hypotheses", []),
            "status": data.get("status"),
            "release_date": data.get("release_date"),
            "url": f"{SITE}/api/v1/findings/{p.name}",
            "html_url": f"{SITE}/findings/{slug}",
            "schema_ref": "frontend/src/lib/api-v1-types.ts:ApiV1Finding",
        })

    states = []
    for p in sorted(states_dir.glob("*.json")):
        # Skip non-state JSON in the states/ directory (e.g.
        # va-briefing-summary.json). A 2-letter stem is the only thing
        # that maps to /states/<code> and /for-state-medicaid/<code>.
        if len(p.stem) != 2:
            continue
        try:
            data = json.loads(p.read_text())
        except Exception:
            continue
        code_lower = p.stem
        # Per-state cohort CSV — only populated for states with ≥1 critical NPI
        cohort_csv = states_dir / f"{code_lower}-cohort-critical.csv"
        cohort_count = 0
        if cohort_csv.exists():
            # Lightweight count: total lines minus header
            try:
                cohort_count = sum(1 for _ in cohort_csv.open("r")) - 1
                cohort_count = max(0, cohort_count)
            except Exception:
                cohort_count = 0
        states.append({
            "state": data.get("state") or code_lower.upper(),
            "state_name": data.get("state_name"),
            "release_date": data.get("release_date"),
            "url": f"{SITE}/api/v1/states/{p.name}",
            "html_url": f"{SITE}/states/{code_lower}",
            "cmo_html_url": f"{SITE}/for-state-medicaid/{code_lower}",
            "cohort_csv_url": f"{SITE}/api/v1/states/{code_lower}-cohort-critical.csv" if cohort_csv.exists() else None,
            "cohort_critical_count": cohort_count,
            "schema_ref": "frontend/src/lib/api-v1-types.ts:ApiV1State",
        })

    csvs = []
    for p in sorted(states_dir.glob("*.csv")):
        csvs.append({
            "name": p.stem,
            "url": f"{SITE}/api/v1/states/{p.name}",
            "format": "csv",
        })

    # Read live stats to surface the canonical release_date / commit_sha
    stats_path = API_V1 / "stats.json"
    stats = json.loads(stats_path.read_text()) if stats_path.exists() else {}

    manifest = {
        "service": "AINPI",
        "tagline": "Audit of the CMS National Provider Directory bulk public-use export.",
        "site": SITE,
        "license": {
            "code": "Apache-2.0",
            "data": "Public domain (US federal government work)",
            "citation": f"{SITE}/api/v1/manifest.json + CITATION.cff",
        },
        "release_date": stats.get("release_date"),
        "methodology_version": stats.get("methodology_version"),
        "commit_sha": stats.get("commit_sha"),
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "endpoints": {
            "static_contract": [
                {"path": "/api/v1/stats.json", "summary": "Site-wide counters"},
                {"path": "/api/v1/manifest.json", "summary": "This document — discovery index"},
                {"path": "/api/v1/findings/{slug}.json", "summary": "Per-finding detail (see findings list below)"},
                {"path": "/api/v1/states/{state}.json", "summary": "State-scoped findings (see states list below)"},
            ],
            "live_api": [
                {"path": "/api/npd/search?npi={npi}", "summary": "NDH-only NPI lookup"},
                {"path": "/api/npd/search?family={name}&state={XX}", "summary": "NDH name search"},
                {"path": "/api/provider-search", "summary": "Cross-source merged search (POST)", "method": "POST"},
                {"path": "/api/npd/data-quality?view={summary|states|specialties|endpoints}", "summary": "Pre-aggregated quality summary"},
                {"path": "/api/npd/validation", "summary": "Live BigQuery vs source manifest reconciliation"},
            ],
        },
        "ai_agent_tools": {
            "lookup_npi": {
                "description": "Look up a provider by 10-digit NPI in the federal NDH bulk export.",
                "endpoint": "GET /api/npd/search?npi={npi}",
                "input_schema": {
                    "type": "object",
                    "properties": {"npi": {"type": "string", "pattern": "^\\d{10}$"}},
                    "required": ["npi"],
                },
            },
            "cross_source_search": {
                "description": "Compare a provider record across NDH + NPPES + 4 payer FHIR directories.",
                "endpoint": "POST /api/provider-search",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "npi": {"type": "string", "pattern": "^\\d{10}$"},
                        "family": {"type": "string"},
                        "given": {"type": "string"},
                        "state": {"type": "string", "pattern": "^[A-Z]{2}$"},
                    },
                },
            },
            "get_finding": {
                "description": "Read a published finding's headline + denominator + chart.",
                "endpoint": "GET /api/v1/findings/{slug}.json",
                "input_schema": {
                    "type": "object",
                    "properties": {"slug": {"type": "string"}},
                    "required": ["slug"],
                },
            },
            "get_state_audit": {
                "description": "Read a state-scoped audit slice (denominators + state-vs-national table + verify-yourself sample NPIs).",
                "endpoint": "GET /api/v1/states/{state}.json",
                "input_schema": {
                    "type": "object",
                    "properties": {"state": {"type": "string", "pattern": "^[a-z]{2}$"}},
                    "required": ["state"],
                },
            },
        },
        "findings": findings,
        "states": states,
        "downloads_csv": csvs,
    }

    OUT.write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Wrote {OUT} ({len(findings)} findings, {len(states)} states, {len(csvs)} csvs)")


if __name__ == "__main__":
    main()
