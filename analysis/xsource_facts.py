"""Per-release cross-source facts table: the one join later products read.

One row per (npi, source, fhir_element, field, value_norm), for practitioners
in scope: active NPD practitioners holding an active PractitionerRole at a
Location in one of the requested states. The same scope rule is used by the
payer sampler's draw (`scope_npis`), so the facts and the sample cannot drift.

Rows, all normalized through `xsource_norm`:

    npd   PractitionerRole.location->Location.address   zip5
    npd   PractitionerRole.location->Location.telecom   phone10
    npd   PractitionerRole.specialty                    taxonomy
    npd   Practitioner.address(physical)                zip5
    npd   Practitioner.telecom                          phone10
    nppes NPPES.practice_location                       zip5, phone10
    nppes NPPES.primary_taxonomy                        taxonomy

Every role location is kept. The 2026-10-28 Humana demo compared a payer's
role location with the practitioner's own NPD address and overstated
disagreement; payer comparisons use the role Location, and the practitioner
address is a separate, labelled comparison (roadmap resolution 10).

`Practitioner.address(physical)` is chosen with `physical_address()` from
fast_ingest_ndh (type physical/both, else use work, else first), read from the
stored resource JSON. The flattened practitioner `_postal_code` column is
`address[0]`, often the billing address, and is deliberately not used.

`compare` counts per field, any-to-any on normalized values. Agreement counts
only between independent sources: NPD equal to NPPES is copy fidelity and is
reported under `by_relation['upstream']` as a match, never as `agree`. Payer
lineage is unknown, so payer pairs land under `by_relation['unknown']`.

Output: analysis/data/xsource/<release>/facts.parquet (gitignored; it holds
per-NPI values and, once payer rows are added, payer values that must not
leave analysis/data/).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Callable, Iterable

import duckdb
import pyarrow as pa
import pyarrow.parquet as pq

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fast_ingest_ndh import physical_address  # noqa: E402
from xsource_norm import (  # noqa: E402
    LINEAGE,
    assert_materialized,
    lineage_label,
    phone10,
    phones_from_telecom,
    relation,
    taxonomy,
    zip5,
)

REPO_ROOT = Path(__file__).resolve().parent.parent
PARQUET_ROOT = REPO_ROOT / "frontend" / "data" / "parquet-export"
NPPES_ROOT = REPO_ROOT / "analysis" / "data" / "nppes"
OUT_ROOT = REPO_ROOT / "analysis" / "data" / "xsource"

RULE_VERSION = "xsource-v1"
FIELDS = ("zip5", "phone10", "taxonomy")
COLUMNS = ["npi", "source", "lineage", "fhir_element", "field",
           "value_norm", "observed_at", "rule_version"]

EL_ROLE_ADDR = "PractitionerRole.location->Location.address"
EL_ROLE_TEL = "PractitionerRole.location->Location.telecom"
EL_ROLE_SPEC = "PractitionerRole.specialty"
EL_PRAC_ADDR = "Practitioner.address(physical)"
EL_PRAC_TEL = "Practitioner.telecom"
EL_NPPES_LOC = "NPPES.practice_location"
EL_NPPES_TAX = "NPPES.primary_taxonomy"

# The NPD element a payer is compared against, per field (the role, always).
ROLE_ELEMENT = {"zip5": EL_ROLE_ADDR, "phone10": EL_ROLE_TEL, "taxonomy": EL_ROLE_SPEC}
# Every NPD element reported under by_element, per field.
NPD_ELEMENTS = {
    "zip5": (EL_ROLE_ADDR, EL_PRAC_ADDR),
    "phone10": (EL_ROLE_TEL, EL_PRAC_TEL),
    "taxonomy": (EL_ROLE_SPEC,),
}


def _q(s: str) -> str:
    return "'" + str(s).replace("'", "''") + "'"


def _inputs(release: str, parquet_root: Path) -> dict[str, Path]:
    d = Path(parquet_root) / release
    return {t: d / f"{t}.parquet" for t in ("practitioner", "practitioner_role", "location")}


_SCOPE_SQL = """
SELECT DISTINCT p._npi AS npi, p._id AS pid
FROM read_parquet({prac}) p
JOIN read_parquet({role}) r ON r._practitioner_id = 'Practitioner/' || p._id
CROSS JOIN UNNEST(string_split(r._location_ids, '|')) AS u(loc_ref)
JOIN read_parquet({loc}) l ON u.loc_ref = 'Location/' || l._id
WHERE p._active AND r._active AND p._npi IS NOT NULL
  AND upper(trim(l._state)) IN ({states})
"""


def _scope_sql(paths: dict[str, Path], states: list[str]) -> str:
    if not states:
        raise ValueError("at least one state is required")
    return _SCOPE_SQL.format(
        prac=_q(paths["practitioner"]), role=_q(paths["practitioner_role"]),
        loc=_q(paths["location"]),
        states=", ".join(_q(s.strip().upper()) for s in states),
    )


def scope_npis(release: str, states: list[str], *, parquet_root: Path | None = None,
               stat: Callable = os.stat) -> set[str]:
    """Active practitioners with an active NPD role at a Location in `states`."""
    paths = _inputs(release, parquet_root or PARQUET_ROOT)
    for p in paths.values():
        assert_materialized(p, stat=stat)
    con = duckdb.connect()
    return {r[0] for r in con.execute(f"SELECT npi FROM ({_scope_sql(paths, states)})").fetchall()}


def build(release: str, nppes_month: str, states: list[str], *,
          parquet_root: Path | None = None, nppes_root: Path | None = None,
          out_root: Path | None = None, taxonomy_map: dict | None = None,
          stat: Callable = os.stat) -> Path:
    """Write analysis/data/xsource/<release>/facts.parquet and return its path."""
    paths = _inputs(release, parquet_root or PARQUET_ROOT)
    nppes_path = Path(nppes_root or NPPES_ROOT) / nppes_month / "nppes.parquet"
    for p in (*paths.values(), nppes_path):
        assert_materialized(p, stat=stat)

    if taxonomy_map is None:
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        from nucc_taxonomy import load_taxonomy
        taxonomy_map = load_taxonomy()

    con = duckdb.connect()
    con.execute(f"CREATE TEMP TABLE scope AS {_scope_sql(paths, states)}")

    role_locs = con.execute(f"""
        SELECT s.npi, l._postal_code, l._telecom
        FROM scope s
        JOIN read_parquet({_q(paths['practitioner_role'])}) r
          ON r._practitioner_id = 'Practitioner/' || s.pid AND r._active
        CROSS JOIN UNNEST(string_split(r._location_ids, '|')) AS u(loc_ref)
        JOIN read_parquet({_q(paths['location'])}) l ON u.loc_ref = 'Location/' || l._id
    """).fetchall()
    role_specs = con.execute(f"""
        SELECT s.npi, r._specialty_codes
        FROM scope s
        JOIN read_parquet({_q(paths['practitioner_role'])}) r
          ON r._practitioner_id = 'Practitioner/' || s.pid AND r._active
        WHERE r._specialty_codes IS NOT NULL
    """).fetchall()
    practs = con.execute(f"""
        SELECT s.npi, p.resource, p._telecom
        FROM scope s JOIN read_parquet({_q(paths['practitioner'])}) p ON p._id = s.pid
    """).fetchall()
    nppes = con.execute(f"""
        SELECT n.npi, n.practice_zip5, n.practice_phone10, n.primary_taxonomy
        FROM read_parquet({_q(nppes_path)}) n
        WHERE n.npi IN (SELECT npi FROM scope)
    """).fetchall()

    rows: set[tuple] = set()

    def add(npi, source, element, field, value, observed):
        if value:
            rows.add((npi, source, lineage_label(source), element, field, value,
                      observed, RULE_VERSION))

    for npi, postal, telecom in role_locs:
        add(npi, "npd", EL_ROLE_ADDR, "zip5", zip5(postal), release)
        for ph in phones_from_telecom(telecom):
            add(npi, "npd", EL_ROLE_TEL, "phone10", ph, release)
    n_role_loc = len({r for r in rows if r[3] == EL_ROLE_ADDR})
    if not role_locs or n_role_loc == 0:
        raise RuntimeError(
            f"zero NPD role-location facts for {states} in {release}; the join found "
            f"nothing, which is a broken input or reference format, not an empty state"
        )
    for npi, codes in role_specs:
        for c in str(codes).split("|"):
            add(npi, "npd", EL_ROLE_SPEC, "taxonomy", taxonomy(c, taxonomy_map), release)
    for npi, resource, telecom in practs:
        try:
            res = json.loads(resource) if resource else {}
        except (TypeError, ValueError):
            res = {}
        addr = physical_address(res.get("address")) if isinstance(res, dict) else {}
        add(npi, "npd", EL_PRAC_ADDR, "zip5", zip5(addr.get("postalCode")), release)
        for ph in phones_from_telecom(telecom):
            add(npi, "npd", EL_PRAC_TEL, "phone10", ph, release)
    for npi, z, ph, tax in nppes:
        add(npi, "nppes", EL_NPPES_LOC, "zip5", zip5(z), nppes_month)
        add(npi, "nppes", EL_NPPES_LOC, "phone10", phone10(ph), nppes_month)
        add(npi, "nppes", EL_NPPES_TAX, "taxonomy", taxonomy(tax, taxonomy_map), nppes_month)

    out_dir = Path(out_root or OUT_ROOT) / release
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / "facts.parquet"
    table = pa.Table.from_pylist(
        [dict(zip(COLUMNS, r)) for r in sorted(rows)],
        schema=pa.schema([pa.field(c, pa.string()) for c in COLUMNS]),
    )
    tmp = out.with_suffix(".parquet.partial")
    pq.write_table(table, tmp, compression="zstd")
    tmp.replace(out)
    return out


# --------------------------------------------------------------------------
# Comparison
# --------------------------------------------------------------------------

def _as_rows(facts) -> list[dict]:
    if isinstance(facts, (str, Path)):
        return pq.read_table(facts).to_pylist()
    if hasattr(facts, "to_pylist"):
        return facts.to_pylist()
    if hasattr(facts, "to_dict"):
        return facts.to_dict("records")
    return list(facts)


def _classify(a: set, b: set) -> str:
    if a and b:
        return "match" if a & b else "differ"
    if a or b:
        return "one_sided"
    return "neither"


_TOP = {"match": "agree", "differ": "disagree", "one_sided": "one_sided", "neither": "neither"}


def _zero_rel() -> dict:
    return {"match": 0, "differ": 0, "one_sided": 0, "neither": 0}


def compare(facts, npi_set: Iterable[str], payer_rows: Iterable[dict]) -> dict:
    """Counts per field for the NPIs in `npi_set`.

    payer_rows: dicts with npi, source (a LINEAGE key), field, value_norm, all
    from one payer. Returns, per field:

        agree, disagree, one_sided, neither
            payer vs the NPD role element (Location address or telecom, role
            specialty), any-to-any. Sums to len(npi_set). "agree" is a value
            match with a source of unknown lineage, not corroboration.
        by_element[<npd element>]
            the same tallies against each NPD element separately, so a match
            only on the practitioner's own address is visible and labelled.
        by_relation[upstream|independent|unknown]
            match / differ / one_sided / neither for every source pair,
            grouped by lineage relation: NPD vs NPPES is upstream, payer vs
            NPD and payer vs NPPES are unknown.
    """
    npis = set(npi_set)
    payer_rows = [r for r in payer_rows if r.get("npi") in npis]
    payers = {r["source"] for r in payer_rows}
    if len(payers) > 1:
        raise ValueError("compare takes rows from one payer at a time")
    payer = payers.pop() if payers else None
    if payer is not None and payer not in LINEAGE:
        raise ValueError(f"payer source {payer!r} is not in LINEAGE")

    vals: dict[tuple, set] = {}
    for r in _as_rows(facts):
        if r["npi"] in npis:
            vals.setdefault((r["npi"], r["source"], r["fhir_element"], r["field"]), set()).add(r["value_norm"])
    pay: dict[tuple, set] = {}
    for r in payer_rows:
        if r.get("value_norm"):
            pay.setdefault((r["npi"], r["field"]), set()).add(r["value_norm"])

    def nppes_vals(npi, field):
        out = set()
        for el in (EL_NPPES_LOC, EL_NPPES_TAX):
            out |= vals.get((npi, "nppes", el, field), set())
        return out

    result = {}
    for field in FIELDS:
        top = {"agree": 0, "disagree": 0, "one_sided": 0, "neither": 0}
        by_el = {el: {"agree": 0, "disagree": 0, "one_sided": 0, "neither": 0}
                 for el in NPD_ELEMENTS[field]}
        by_rel = {k: _zero_rel() for k in ("upstream", "independent", "unknown")}
        for npi in npis:
            p = pay.get((npi, field), set())
            role = vals.get((npi, "npd", ROLE_ELEMENT[field], field), set())
            nppes_v = nppes_vals(npi, field)
            top[_TOP[_classify(p, role)]] += 1
            for el in NPD_ELEMENTS[field]:
                by_el[el][_TOP[_classify(p, vals.get((npi, "npd", el, field), set()))]] += 1
            by_rel[relation("npd", "nppes")][_classify(role, nppes_v)] += 1
            if payer is not None:
                by_rel[relation(payer, "npd")][_classify(p, role)] += 1
                by_rel[relation(payer, "nppes")][_classify(p, nppes_v)] += 1
        result[field] = {**top, "by_element": by_el, "by_relation": by_rel}
    return result


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Build the per-release cross-source facts table.")
    ap.add_argument("--release", required=True)
    ap.add_argument("--nppes-month", required=True, help="YYYY-MM of the loaded NPPES file")
    ap.add_argument("--states", required=True, help="comma-separated, e.g. PA")
    args = ap.parse_args(argv)
    out = build(args.release, args.nppes_month, [s for s in args.states.split(",") if s])
    t = pq.read_table(out)
    print(f"wrote {out}: {t.num_rows} rows, "
          f"{len(set(t.column('npi').to_pylist()))} practitioners")
    return 0


if __name__ == "__main__":
    sys.exit(main())
