"""
ainpi-probe — FHIR endpoint liveness crawler, CLI entry.

Reads endpoint URLs from a Parquet or CSV input, probes each one through
L0-L7 (see levels.py), writes one row per endpoint to an output Parquet.

Input shapes accepted:

1. Simple — columns `endpoint_id`, `url`:
       endpoint_id,url
       Endpoint-123,https://fhir.example.com/r4
       ...

2. Raw NDH shard — a parquet with `id` and `resource` (full JSON string).
   The JSON's `address` field is used as the URL. Pass --input-resource.

Run:
    python probe.py --input data/endpoints.parquet --output out/liveness.parquet
"""

from __future__ import annotations

import asyncio
import json
import pathlib
from urllib.parse import urlparse

import click
import httpx
import pyarrow as pa
import pyarrow.parquet as pq
from tqdm.asyncio import tqdm_asyncio

from levels import (
    CONNECT_TIMEOUT_S,
    READ_TIMEOUT_S,
    USER_AGENT,
    ProbeResult,
    probe_endpoint,
)
from ratelimit import PerHostRateLimiter


async def _probe_with_rate_limit(
    client: httpx.AsyncClient,
    limiter: PerHostRateLimiter,
    semaphore: asyncio.Semaphore,
    endpoint_id: str,
    url: str,
) -> ProbeResult:
    parsed = urlparse(url)
    host = parsed.hostname or ""
    async with semaphore:
        if host:
            await limiter.acquire(host)
        return await probe_endpoint(client, endpoint_id, url)


def _load_inputs(
    path: pathlib.Path, is_resource_shard: bool, limit: int | None
) -> list[tuple[str, str]]:
    """Return [(endpoint_id, url), ...] from either input shape."""
    if path.suffix == ".csv":
        import csv

        rows: list[tuple[str, str]] = []
        with path.open("r", encoding="utf-8") as fh:
            for i, row in enumerate(csv.DictReader(fh)):
                if limit and i >= limit:
                    break
                if row.get("url"):
                    rows.append((row.get("endpoint_id") or f"row-{i}", row["url"]))
        return rows

    # Parquet
    if is_resource_shard:
        tbl = pq.read_table(path, columns=["id", "resource"])
        ids = tbl.column("id").to_pylist()
        resources = tbl.column("resource").to_pylist()
        rows = []
        for i, (rid, rj) in enumerate(zip(ids, resources, strict=True)):
            if limit and i >= limit:
                break
            try:
                obj = json.loads(rj)
            except (json.JSONDecodeError, TypeError):
                continue
            url = obj.get("address")
            if isinstance(url, str) and url.startswith(("http://", "https://")):
                rows.append((rid, url))
        return rows

    tbl = pq.read_table(path, columns=["endpoint_id", "url"])
    ids = tbl.column("endpoint_id").to_pylist()
    urls = tbl.column("url").to_pylist()
    rows = list(zip(ids, urls, strict=True))
    return rows[:limit] if limit else rows


@click.command()
@click.option(
    "--input", "input_path", required=True, type=click.Path(exists=True, dir_okay=False),
)
@click.option(
    "--output", required=True, type=click.Path(dir_okay=False),
)
@click.option(
    "--input-resource",
    is_flag=True,
    help="Treat --input as a raw endpoint.parquet shard; extract URL from resource JSON.",
)
@click.option("--concurrency", default=4, show_default=True, help="Global concurrency cap.")
@click.option("--per-host-rps", default=1.0, show_default=True, help="Requests per second per host.")
@click.option("--limit", default=None, type=int, help="Probe only the first N endpoints.")
def main(
    input_path: str,
    output: str,
    input_resource: bool,
    concurrency: int,
    per_host_rps: float,
    limit: int | None,
) -> None:
    in_path = pathlib.Path(input_path)
    out_path = pathlib.Path(output)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    inputs = _load_inputs(in_path, input_resource, limit)
    click.echo(f"Probing {len(inputs):,} endpoints")
    click.echo(f"  concurrency={concurrency}  per-host RPS={per_host_rps}")
    click.echo(f"  User-Agent: {USER_AGENT}")

    if not inputs:
        click.echo("No endpoints to probe.", err=True)
        raise SystemExit(1)

    limiter = PerHostRateLimiter(min_interval_seconds=1.0 / per_host_rps)
    semaphore = asyncio.Semaphore(concurrency)

    async def run() -> list[ProbeResult]:
        timeout = httpx.Timeout(connect=CONNECT_TIMEOUT_S, read=READ_TIMEOUT_S, write=READ_TIMEOUT_S, pool=READ_TIMEOUT_S)
        async with httpx.AsyncClient(
            timeout=timeout,
            headers={"User-Agent": USER_AGENT},
            follow_redirects=True,
            limits=httpx.Limits(max_keepalive_connections=concurrency, max_connections=concurrency * 2),
            verify=True,
        ) as client:
            tasks = [
                _probe_with_rate_limit(client, limiter, semaphore, eid, url)
                for (eid, url) in inputs
            ]
            return await tqdm_asyncio.gather(*tasks, desc="probe", unit="ep")

    results = asyncio.run(run())

    rows = [r.to_row() for r in results]
    pq.write_table(pa.Table.from_pylist(rows), str(out_path), compression="zstd")
    click.echo(f"Wrote {len(rows):,} rows to {out_path}")

    # Headline summary
    by_level: dict[int, int] = {}
    for r in results:
        by_level[r.highest_level_reached] = by_level.get(r.highest_level_reached, 0) + 1
    click.echo("\nHighest level reached (count by tier):")
    for lvl in sorted(by_level.keys()):
        label = f"L{lvl}" if lvl >= 0 else "— (DNS fail)"
        click.echo(f"  {label:<6} {by_level[lvl]:>8,}")


if __name__ == "__main__":
    main()
