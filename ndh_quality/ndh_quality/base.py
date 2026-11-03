"""Rule base for NDH data-quality checks. CC0 1.0."""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Iterable

import sqlalchemy
from inlaw import InLaw

SF_DATALESS = 0x40000000


def parquet_source(release_dir: str | Path, resource: str) -> str:
    path = f"{Path(release_dir)}/{resource}.parquet".replace("'", "''")
    return f"read_parquet('{path}')"


def assert_not_dataless(paths: Iterable[Path]) -> None:
    """Fail loudly on macOS iCloud placeholder files, which read as empty or hang."""
    for p in paths:
        flags = getattr(os.stat(p), "st_flags", 0)
        if flags & SF_DATALESS:
            raise RuntimeError(f"{p} is dataless (not downloaded locally); materialize it first")


def field_control(count: int, previous: int | None, floor: float = 0.5) -> bool:
    """A field with no rows, or one that fell below floor x the previous count, cannot be trusted."""
    if not count or count <= 0:
        return False
    if previous is None:
        return True
    return count >= floor * previous


_OPS = {
    ">=": lambda v, t: v >= t,
    "<=": lambda v, t: v <= t,
    "<": lambda v, t: v < t,
    ">": lambda v, t: v > t,
    "==": lambda v, t: v == t,
}


def evaluate(threshold: dict | None, value: float | None, control_passed: bool, severity: str) -> str:
    if not control_passed:
        return "control_failed"
    if severity == "monitor" or threshold is None:
        return "recorded"
    if value is None:
        return "fail"
    op = threshold["op"]
    if op not in _OPS:
        raise ValueError(f"unknown threshold op {op!r}")
    return "pass" if _OPS[op](value, threshold["value"]) else "fail"


def open_engine() -> sqlalchemy.Engine:
    return sqlalchemy.create_engine("duckdb:///:memory:")


def _bounds(threshold: dict) -> dict[str, Any]:
    op, v = threshold["op"], threshold["value"]
    if op == ">=":
        return {"min_value": v}
    if op == ">":
        return {"min_value": v, "strict_min": True}
    if op == "<=":
        return {"max_value": v}
    if op == "<":
        return {"max_value": v, "strict_max": True}
    if op == "==":
        return {"min_value": v, "max_value": v}
    raise ValueError(f"unknown threshold op {op!r}")


class NdhRule(InLaw):
    rule_id: str = ""
    rule_version: int = 1
    hypotheses: list[str] = []
    relation: str = "related"  # implements | partial | related | control
    measure_name: str | None = None  # brief calls this "measure"; renamed since method measure() shares the name
    severity: str = "monitor"
    threshold: dict | None = None
    resources: list[str] = []

    @classmethod
    def measure_sql(cls, settings) -> str:
        """One row: numerator, denominator, control_count, detail. Never select NPIs or matched values."""
        raise NotImplementedError

    @classmethod
    def _row(cls, engine, settings) -> dict:
        with engine.connect() as c:
            r = c.execute(sqlalchemy.text(cls.measure_sql(settings))).mappings().one()
        return dict(r)

    @classmethod
    def measure(cls, engine, settings, previous: int | None = None) -> dict:
        r = cls._row(engine, settings)
        num, den = r["numerator"], r["denominator"]
        value = (num / den) if den else None
        cc = int(r["control_count"] or 0)
        passed = field_control(cc, previous)
        return {
            "rule_id": cls.rule_id,
            "rule_version": cls.rule_version,
            "hypotheses": list(cls.hypotheses),
            "relation": cls.relation,
            "measure": cls.measure_name,
            "severity": cls.severity,
            "threshold": cls.threshold,
            "numerator": num,
            "denominator": den,
            "value": value,
            "control_count": cc,
            "control_previous": previous,
            "control_passed": passed,
            "status": evaluate(cls.threshold, value, passed, cls.severity),
            "detail": r.get("detail"),
        }

    @classmethod
    def run(cls, engine, settings=None) -> bool | str:
        """InLaw interface: True on success, else a message with the counts."""
        if cls.threshold is None:
            return True
        row = cls._row(engine, settings)
        num, den = int(row["numerator"] or 0), int(row["denominator"] or 0)
        if not den:
            return f"{cls.rule_id}: no denominator (numerator={num}, denominator={den})"
        sql = f"select {num} * 1.0 / {den} as value"
        gx = InLaw.sql_to_gx_df(sql=sql, engine=engine)
        res = gx.expect_column_values_to_be_between(column="value", **_bounds(cls.threshold))
        if res.success:
            return True
        return (f"{cls.rule_id}: {num}/{den} = {num / den:.6f} "
                f"violates {cls.threshold['op']} {cls.threshold['value']}")
