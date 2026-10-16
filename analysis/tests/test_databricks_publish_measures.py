"""The `measures` table in databricks_publish.py, checked without Databricks.

`sql()` is replaced so the tests record the statements that would run. The
point is the load shape: one CREATE OR REPLACE from the whole-series file,
never the per-release DELETE + INSERT the NDH tables use.
"""
import pytest

from analysis import databricks_publish as dp


def test_measures_is_registered_and_selectable():
    assert "measures" in dp.DERIVED_TABLES
    assert "measures" in dp.ALL_TABLES
    assert dp.local_parquet("2026-10-07", "measures") == dp.SERIES_TABLES["measures"]
    assert dp.SERIES_TABLES["measures"].parts[-2:] == ("measures", "measures.parquet")


def test_comment_states_what_a_missing_point_means():
    c = dp.TABLE_COMMENTS["measures"]
    assert "'" not in c.replace("'role-coverage-pa'", "")
    assert "—" not in c
    assert "missing row means the generator refused" in c
    assert "not a zero" in c
    assert "as_published_value" in c


def test_load_is_one_create_or_replace(monkeypatch, tmp_path):
    f = tmp_path / "measures.parquet"
    f.write_bytes(b"x")
    monkeypatch.setitem(dp.SERIES_TABLES, "measures", f)
    ran = []
    monkeypatch.setattr(dp, "sql", lambda s, **k: ran.append(s) or {"status": {"state": "SUCCEEDED"}})
    dp.do_load(only=["2026-05-08", "2026-08-20"], tables=["measures"])
    assert len(ran) == 1
    assert ran[0].startswith("CREATE OR REPLACE TABLE workspace.ainpi.measures")
    assert "PARTITIONED BY (release_date)" in ran[0]
    assert "/series/measures.parquet" in ran[0]
    assert "DELETE" not in ran[0]


def test_per_release_load_never_touches_measures(monkeypatch):
    ran = []
    monkeypatch.setattr(dp, "sql", lambda s, **k: ran.append(s) or {"status": {"state": "SUCCEEDED"}})
    assert dp.load_one_release("2026-10-07", ["measures"]) is True
    assert ran == []


def test_release_flag_is_refused_for_measures(monkeypatch):
    monkeypatch.setattr("sys.argv", ["x", "--load", "--release", "2026-10-07", "--table", "measures"])
    with pytest.raises(SystemExit) as e:
        dp.main()
    assert "drop --release" in str(e.value)


def test_release_run_without_table_skips_measures(monkeypatch, capsys):
    # --release with no --table must upload and load the per-release tables
    # only; the whole-series table would otherwise be rebuilt by a run that
    # was meant to touch one release.
    seen = {}
    monkeypatch.setattr(dp, "do_upload", lambda rel, tables: seen.setdefault("upload", tables))
    monkeypatch.setattr(dp, "do_load", lambda only, tables: seen.setdefault("load", tables) or True)
    monkeypatch.setattr("sys.argv", ["x", "--upload", "--load", "--release", "2026-05-08,2026-10-07"])
    dp.main()
    for step in ("upload", "load"):
        assert "measures" not in seen[step]
        assert "practitioner" in seen[step] and "org_endpoint" in seen[step]
    assert ("measures skipped: whole-series table, run with --table measures "
            "and no --release") in capsys.readouterr().out


def test_single_release_run_never_loads_measures(monkeypatch):
    ran = []
    monkeypatch.setattr(dp, "sql", lambda s, **k: ran.append(s) or {"status": {"state": "SUCCEEDED"}})
    monkeypatch.setattr(dp, "local_parquet", lambda rel, t: dp.ROOT / "does-not-exist" / t)
    monkeypatch.setattr("sys.argv", ["x", "--load", "--release", "2026-10-07"])
    dp.main()
    assert not any("measures" in s for s in ran)


def test_failed_series_load_exits_nonzero(monkeypatch, tmp_path):
    f = tmp_path / "measures.parquet"
    f.write_bytes(b"x")
    monkeypatch.setitem(dp.SERIES_TABLES, "measures", f)
    monkeypatch.setattr(dp, "sql", lambda s, **k: {"status": {"state": "FAILED"}})
    assert dp.do_load(tables=["measures"]) is False
    monkeypatch.setattr("sys.argv", ["x", "--load", "--table", "measures"])
    with pytest.raises(SystemExit) as e:
        dp.main()
    assert e.value.code == 1


def test_successful_series_load_returns_true(monkeypatch, tmp_path):
    f = tmp_path / "measures.parquet"
    f.write_bytes(b"x")
    monkeypatch.setitem(dp.SERIES_TABLES, "measures", f)
    monkeypatch.setattr(dp, "sql", lambda s, **k: {"status": {"state": "SUCCEEDED"}})
    assert dp.do_load(tables=["measures"]) is True
