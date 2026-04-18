"""
Stage 2 — NPI Luhn validation.

NPIs are 10 decimal digits. CMS defines the check-digit algorithm as the
ISO/IEC 7812 Luhn mod-10 check applied to the NPI prefixed by '80840':

    [80840] + npi[:9]   — 14 digits fed to Luhn
    check_digit         — must equal npi[9]

Reference: NPI Check Digit Calculation (45 CFR § 162.406).

This script reads the Practitioner and Organization shards, walks every
NPI identifier (system = 'http://hl7.org/fhir/sid/us-npi'), and emits
one row per (resource_id, resource_type, npi) with a validity code:

    NPI_OK                 — passes structure + Luhn
    NPI_INVALID_STRUCTURE  — not 10 digits or leading digit not 1 or 2
    NPI_LUHN_FAIL          — structurally valid but check digit mismatch
    NPI_MISSING            — identifier absent or empty

Usage:
    python 2_npi_luhn.py --shards out/shards --output out/npi_luhn.parquet

Acceptance: reproducible from shard Parquets + this source file alone.
"""

from __future__ import annotations

import json
import pathlib
import re

import click
import pyarrow as pa
import pyarrow.parquet as pq
from tqdm import tqdm


NPI_SYSTEM = "http://hl7.org/fhir/sid/us-npi"
NPI_PREFIX = "80840"
NPI_RE = re.compile(r"^[12]\d{9}$")  # 10 digits; first digit 1 or 2


def luhn_check(digits: str) -> bool:
    """Classic Luhn mod-10 over a string of decimal digits.

    Returns True iff the checksum is 0 modulo 10.
    """
    total = 0
    # Walk right-to-left. Double every 2nd digit (starting from the 2nd-to-last).
    for i, ch in enumerate(reversed(digits)):
        n = ord(ch) - ord("0")
        if i % 2 == 1:
            n *= 2
            if n > 9:
                n -= 9
        total += n
    return total % 10 == 0


def validate_npi(npi: str | None) -> str:
    """Return one of NPI_OK / NPI_INVALID_STRUCTURE / NPI_LUHN_FAIL / NPI_MISSING."""
    if not npi:
        return "NPI_MISSING"
    if not NPI_RE.match(npi):
        return "NPI_INVALID_STRUCTURE"
    if not luhn_check(NPI_PREFIX + npi):
        return "NPI_LUHN_FAIL"
    return "NPI_OK"


def extract_npis(resource_json: str) -> list[str]:
    """Return all NPI values (system = us-npi) present on the resource."""
    try:
        obj = json.loads(resource_json)
    except json.JSONDecodeError:
        return []
    identifiers = obj.get("identifier") or []
    out = []
    for ident in identifiers:
        if not isinstance(ident, dict):
            continue
        if ident.get("system") == NPI_SYSTEM:
            value = ident.get("value")
            if value:
                out.append(value)
    return out


@click.command()
@click.option("--shards", "shards_dir", required=True, type=click.Path(exists=True, file_okay=False))
@click.option("--output", required=True, type=click.Path(dir_okay=False))
def main(shards_dir: str, output: str) -> None:
    root = pathlib.Path(shards_dir)
    targets = [root / "practitioner.parquet", root / "organization.parquet"]
    targets = [p for p in targets if p.exists()]
    if not targets:
        click.echo(f"No practitioner.parquet or organization.parquet under {root}", err=True)
        raise SystemExit(1)

    rows: list[dict] = []
    for shard_path in targets:
        click.echo(f"→ {shard_path.name}")
        table = pq.read_table(shard_path, columns=["id", "resource_type", "resource"])
        for batch in table.to_batches():
            ids = batch.column("id").to_pylist()
            types = batch.column("resource_type").to_pylist()
            resources = batch.column("resource").to_pylist()
            for rid, rtype, rjson in tqdm(
                zip(ids, types, resources, strict=True),
                total=len(ids),
                unit="rec",
            ):
                npis = extract_npis(rjson)
                if not npis:
                    rows.append(
                        {"resource_id": rid, "resource_type": rtype, "npi": None, "code": "NPI_MISSING"}
                    )
                    continue
                for npi in npis:
                    rows.append(
                        {
                            "resource_id": rid,
                            "resource_type": rtype,
                            "npi": npi,
                            "code": validate_npi(npi),
                        }
                    )

    pathlib.Path(output).parent.mkdir(parents=True, exist_ok=True)
    pq.write_table(pa.Table.from_pylist(rows), output, compression="zstd")
    click.echo(f"wrote {len(rows):,} rows to {output}")

    # Summary to stdout — this is the finding headline for H9
    by_code: dict[str, int] = {}
    for r in rows:
        by_code[r["code"]] = by_code.get(r["code"], 0) + 1
    total = sum(by_code.values())
    click.echo("\nNPI validation summary")
    click.echo("─" * 50)
    for code, n in sorted(by_code.items(), key=lambda kv: -kv[1]):
        click.echo(f"  {code:<26} {n:>12,}  {100*n/total:5.2f}%")
    click.echo(f"  {'TOTAL':<26} {total:>12,}")


if __name__ == "__main__":
    main()
