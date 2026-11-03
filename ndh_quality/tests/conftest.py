import sys
from pathlib import Path

import duckdb
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


@pytest.fixture
def release_dir(tmp_path):
    """Factory: make_release(tables, types=None) writes <resource>.parquet per table.

    tables: {resource: list[dict]}. Column types are inferred from rows by
    DuckDB. For an empty list there is nothing to infer, so the file gets the
    columns in types ({resource: {col: sqltype}}), defaulting to `_npi VARCHAR`.
    """
    def make_release(tables, types=None):
        types = types or {}
        con = duckdb.connect()
        for name, rows in tables.items():
            out = tmp_path / f"{name}.parquet"
            if rows:
                cols = list(rows[0])
                con.execute(f"create or replace table t as select * from (values {','.join('(' + ','.join('?' * len(cols)) + ')' for _ in rows)}) v({','.join(cols)})",
                            [r.get(c) for r in rows for c in cols])
            else:
                spec = types.get(name, {"_npi": "VARCHAR"})
                con.execute("create or replace table t (" + ",".join(f"{c} {t}" for c, t in spec.items()) + ")")
            con.execute(f"copy t to '{out}' (format parquet)")
        return tmp_path
    return make_release
