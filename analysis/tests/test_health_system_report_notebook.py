"""Static checks on the health system report notebook.

The notebook runs in a consumer's Databricks workspace against the shared
release archive, so it cannot be executed here. What can be checked without a
cluster is the two mistakes that would make it publish a plausible wrong answer:

  - reading a table the archive does not share (fails only on the consumer's
    side, after they installed the listing), and
  - joining endpoint or location on _id across releases. Those ids are
    regenerated on every export, so the join reports 100% churn and does not
    error.

Each checker is also run against a cell it must reject, so a regex that stops
matching cannot turn this file into a test that always passes.
"""
import ast
import pathlib
import re

import pytest

from analysis.databricks_publish import TABLE_COMMENTS
from analysis.org_endpoint_table import normalize_url

NB_DIR = pathlib.Path(__file__).resolve().parent.parent / "notebooks"
NOTEBOOK = NB_DIR / "health_system_report.py"
QUICKSTART = NB_DIR / "ainpi_archive_quickstart.py"

SEP = "# COMMAND ----------"
UNSTABLE_ID_TABLES = ("endpoint", "location")
SQL_KEYWORDS = {"on", "where", "join", "left", "right", "inner", "full", "outer",
                "cross", "group", "order", "union", "using", "limit", "having"}


# --- notebook parsing -------------------------------------------------------

def cells(path):
    text = path.read_text()
    assert text.startswith("# Databricks notebook source\n"), path
    body = text[len("# Databricks notebook source\n"):]
    return [c.strip("\n") for c in body.split(SEP)]


def is_markdown(cell):
    lines = [l for l in cell.splitlines() if l.strip()]
    return bool(lines) and all(l.startswith("# MAGIC") for l in lines)


def markdown_text(path):
    return "\n".join(
        re.sub(r"^# MAGIC ?", "", l)
        for c in cells(path) if is_markdown(c) for l in c.splitlines()
    )


def code_text(path):
    return "\n\n".join(c for c in cells(path) if not is_markdown(c))


def _render(node):
    """A spark.sql argument as text, with f-string fields kept as {name}."""
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    if isinstance(node, ast.JoinedStr):
        out = []
        for part in node.values:
            if isinstance(part, ast.Constant):
                out.append(part.value)
            else:
                out.append("{" + ast.unparse(part.value) + "}")
        return "".join(out)
    return None


def sql_strings(source):
    out = []
    for node in ast.walk(ast.parse(source)):
        if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                and node.func.attr == "sql" and node.args):
            text = _render(node.args[0])
            if text is not None and not text.strip().upper().startswith("USE "):
                out.append(text)
    return out


def temp_views(source):
    return set(re.findall(r'createOrReplaceTempView\(\s*"(\w+)"\s*\)', source))


# --- checkers ---------------------------------------------------------------

def unknown_tables(sql, allowed):
    ctes = {m.lower() for m in re.findall(r"(?:\bWITH|,)\s*(\w+)\s+AS\s*\(", sql, re.I)}
    refs = re.findall(r"\b(?:FROM|JOIN)\s+([A-Za-z_][\w.]*)", sql, re.I)
    return sorted({r for r in refs
                   if r.lower() not in ctes and r.lower() not in allowed})


def releases_in(sql):
    placeholders = set(re.findall(r"\{(CUR|PRIOR|MAY|AUG)\}", sql))
    literals = set(re.findall(r"'(\d{4}-\d{2}-\d{2})'", sql))
    return placeholders | literals


def cross_release_id_joins(sql):
    """Return a reason string if this SQL uses endpoint/location _id across releases.

    Rule, chosen to be checkable without a SQL parser: if a statement reads
    endpoint or location and touches that table's _id, it must be pinned to
    exactly one release. Two releases, or no release filter at all, fails.
    """
    hits = []
    for table in UNSTABLE_ID_TABLES:
        binds = re.findall(rf"\b(?:FROM|JOIN)\s+{table}\b(?:\s+(?:AS\s+)?(\w+))?",
                           sql, re.I)
        if not binds:
            continue
        aliases = {table} | {a for a in binds if a and a.lower() not in SQL_KEYWORDS}
        qualified = any(re.search(rf"\b{a}\._id\b", sql) for a in aliases)
        # Unqualified _id is ambiguous once the statement reads this table.
        unqualified = re.search(r"(?<![\w.])_id\b", sql) is not None
        if qualified or unqualified:
            hits.append(table)
    if hits and len(releases_in(sql)) != 1:
        return f"{hits} _id used with releases {sorted(releases_in(sql)) or 'unfiltered'}"
    return None


# --- tests against the notebook --------------------------------------------

def test_notebook_has_databricks_cell_format():
    cs = cells(NOTEBOOK)
    assert len(cs) > 10
    assert is_markdown(cs[0])


def test_code_cells_compile():
    compile(code_text(NOTEBOOK), str(NOTEBOOK), "exec")


def test_notebook_has_sql():
    # Positive control for the two SQL tests below: if extraction broke they
    # would pass vacuously.
    sqls = sql_strings(code_text(NOTEBOOK))
    assert len(sqls) >= 10
    assert any("endpoint" in s for s in sqls)
    assert any("org_endpoint" in s for s in sqls)


def test_sql_reads_only_shared_tables():
    src = code_text(NOTEBOOK)
    allowed = {t.lower() for t in TABLE_COMMENTS} | {v.lower() for v in temp_views(src)}
    bad = {}
    for sql in sql_strings(src):
        u = unknown_tables(sql, allowed)
        if u:
            bad[sql.strip()[:80]] = u
    assert not bad, bad


def test_temp_views_do_not_shadow_archive_tables():
    shadow = temp_views(code_text(NOTEBOOK)) & set(TABLE_COMMENTS)
    assert not shadow, shadow


def test_no_endpoint_or_location_id_join_across_releases():
    bad = [r for r in map(cross_release_id_joins, sql_strings(code_text(NOTEBOOK))) if r]
    assert not bad, bad


def test_endpoint_cross_release_key_is_address():
    src = code_text(NOTEBOOK)
    assert "norm_url(e._address)" in src
    assert "hl7-fhir-rest" in src


def test_five_sections_present():
    md = markdown_text(NOTEBOOK)
    for n in range(1, 6):
        assert re.search(rf"^## {n}\. ", md, re.M), f"section {n} missing"
    assert "What we could not determine" in md


def test_general_reader_wording():
    md = markdown_text(NOTEBOOK)
    assert "web address for data exchange" in md
    assert "FHIR endpoint" in md
    assert not re.search(r"\bH\d{1,2}\b", md), "hypothesis numbers in reader-facing text"


def test_limits_cell_names_each_known_limit():
    md = markdown_text(NOTEBOOK).lower()
    for phrase in ("location", "nppes", "name match", "vendor"):
        assert phrase in md, phrase


def test_norm_url_matches_org_endpoint_builder():
    tree = ast.parse(code_text(NOTEBOOK))
    fn = next(n for n in tree.body
              if isinstance(n, ast.FunctionDef) and n.name == "norm_url")
    ns = {}
    exec(compile(ast.Module(body=[fn], type_ignores=[]), "norm_url", "exec"), ns)
    samples = [
        None, "", "  ",
        "HTTPS://FHIR.Example.ORG/api/FHIR/R4/",
        "https://fhir.example.org/r4/EBAEAA//",
        "https://h.example/fhir?tenant=A/",
        " https://h.example/x#frag ",
    ]
    for s in samples:
        assert ns["norm_url"](s) == normalize_url(s), s


# --- the checkers must reject what they exist to reject ---------------------

def test_checker_flags_quickstart_id_demonstration():
    # The quickstart deliberately intersects endpoint ids across two releases
    # to show the trap. The checker must see it.
    flagged = [r for r in map(cross_release_id_joins, sql_strings(code_text(QUICKSTART))) if r]
    assert flagged


@pytest.mark.parametrize("sql", [
    "SELECT * FROM endpoint a JOIN endpoint b ON a._id = b._id "
    "WHERE a.release_date = '{PRIOR}' AND b.release_date = '{CUR}'",
    "SELECT l._id FROM location l WHERE l.release_date IN ('{CUR}', '{PRIOR}')",
    "SELECT _id FROM endpoint",
])
def test_checker_flags_cross_release_id_use(sql):
    assert cross_release_id_joins(sql)


@pytest.mark.parametrize("sql", [
    "SELECT e._address FROM endpoint e WHERE e.release_date IN ('{CUR}', '{PRIOR}')",
    "SELECT e._id FROM endpoint e WHERE e.release_date = '{CUR}'",
    "SELECT p._id FROM practitioner p WHERE p.release_date IN ('{CUR}', '{PRIOR}')",
])
def test_checker_allows_safe_sql(sql):
    assert cross_release_id_joins(sql) is None


def test_table_checker_flags_unknown_table():
    allowed = {t.lower() for t in TABLE_COMMENTS}
    assert unknown_tables("SELECT * FROM nppes_npi JOIN endpoint e ON 1=1", allowed) == ["nppes_npi"]
    assert unknown_tables("WITH x AS (SELECT 1) SELECT * FROM x", allowed) == []
