"""
Stage 0 — Shard CMS NPD bulk export by resourceType.

Reads zstd-compressed NDJSON files from --input and writes one Parquet
shard per FHIR resourceType to --output. Each output row is:

    id (str)              — FHIR Resource.id
    resource_type (str)   — top-level resourceType
    resource (str)        — full JSON payload, verbatim
    meta_last_updated (str | null) — meta.lastUpdated ISO timestamp
    _size_bytes (int)     — size of the JSON payload (useful for H20)

The full JSON is preserved so downstream SQL can JSON-extract arbitrary
paths without re-reading the source NDJSON.

Usage:
    python 0_shard_by_type.py --input data/raw --output out/shards
"""

from __future__ import annotations

import json
import pathlib
import sys
from collections import defaultdict
from typing import IO

import click
import pyarrow as pa
import pyarrow.parquet as pq
import zstandard as zstd
from tqdm import tqdm


NDH_RESOURCE_TYPES = {
    "Practitioner",
    "PractitionerRole",
    "Organization",
    "OrganizationAffiliation",
    "Location",
    "Endpoint",
    "HealthcareService",
    "InsurancePlan",
}


def _iter_ndjson(path: pathlib.Path) -> IO[bytes]:
    """Return a text-mode iterator over lines in a .ndjson or .ndjson.zst file."""
    if path.suffix == ".zst":
        dctx = zstd.ZstdDecompressor()
        fh = path.open("rb")
        stream = dctx.stream_reader(fh)
        return _text_lines(stream)
    return path.open("r", encoding="utf-8")  # type: ignore[return-value]


def _text_lines(stream):
    """Yield decoded lines from a binary stream without loading the whole thing."""
    buf = b""
    while True:
        chunk = stream.read(1 << 20)  # 1 MB
        if not chunk:
            if buf:
                yield buf.decode("utf-8")
            return
        buf += chunk
        lines = buf.split(b"\n")
        buf = lines.pop()
        for line in lines:
            if line:
                yield line.decode("utf-8")


@click.command()
@click.option("--input", "input_dir", required=True, type=click.Path(exists=True, file_okay=False))
@click.option("--output", "output_dir", required=True, type=click.Path(file_okay=False))
@click.option(
    "--max-errors",
    default=1000,
    show_default=True,
    help="Stop if this many lines fail to parse; prevents silent corruption.",
)
def main(input_dir: str, output_dir: str, max_errors: int) -> None:
    in_root = pathlib.Path(input_dir)
    out_root = pathlib.Path(output_dir)
    out_root.mkdir(parents=True, exist_ok=True)

    sources = sorted([*in_root.glob("*.ndjson"), *in_root.glob("*.ndjson.zst")])
    if not sources:
        click.echo(f"No NDJSON files under {in_root}", err=True)
        sys.exit(1)

    # Accumulate per-type rows, flush per source file to keep memory bounded.
    buffers: dict[str, list[dict]] = defaultdict(list)
    errors = 0

    for src in sources:
        click.echo(f"→ {src.name}")
        for line in tqdm(_iter_ndjson(src), unit="rec"):
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                errors += 1
                if errors >= max_errors:
                    click.echo(f"Too many parse errors ({errors}); aborting.", err=True)
                    sys.exit(2)
                continue

            rtype = obj.get("resourceType")
            if not rtype:
                continue

            rid = obj.get("id") or ""
            meta_last = (obj.get("meta") or {}).get("lastUpdated")

            buffers[rtype].append(
                {
                    "id": rid,
                    "resource_type": rtype,
                    "resource": line,
                    "meta_last_updated": meta_last,
                    "_size_bytes": len(line.encode("utf-8")),
                }
            )

        # Flush per-source to avoid unbounded memory growth
        for rtype, rows in list(buffers.items()):
            if not rows:
                continue
            shard_path = out_root / f"{rtype.lower()}.parquet"
            _append_parquet(shard_path, rows)
            buffers[rtype] = []

    click.echo(f"done; parse errors: {errors}")


def _append_parquet(path: pathlib.Path, rows: list[dict]) -> None:
    """Append rows to a Parquet file (rewrites the file for simplicity).

    At NPD scale (~27M records, ~40GB total) the write cost dominates parse
    cost; a full rewrite per shard per source file is acceptable and keeps
    the code simple. Swap to `pq.ParquetWriter` with row-group flushes if
    this becomes a bottleneck.
    """
    table = pa.Table.from_pylist(rows)
    if path.exists():
        existing = pq.read_table(path)
        table = pa.concat_tables([existing, table])
    pq.write_table(table, path, compression="zstd")


if __name__ == "__main__":
    main()
