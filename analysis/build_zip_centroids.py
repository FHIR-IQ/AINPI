"""Build a ZIP-to-coordinate lookup for the geo search.

Writes frontend/src/data/zip-centroids.json as a compact map:

    {"15213": [40.4444, -79.9539], ...}

Source is the Census Gazetteer ZCTA file, which publishes an official internal
point for every ZCTA. The alternative was to average the coordinates of the
directory's own location records per ZIP, which is what the explorer payload
carries. That is fine for drawing a dot on a map and wrong for search: a ZIP
whose only listed practice sits at its edge would centre the search there, and
a ZIP with no listed practices would have no centre at all. The Census point
does not depend on what the directory happens to contain.

ZIP codes and ZCTAs are not the same thing. ZIPs are delivery routes; ZCTAs are
areal approximations. PO-box-only and single-building ZIPs have no ZCTA and are
therefore absent here, which the caller must handle as "unknown ZIP" rather
than as "nowhere".

Coordinates are rounded to 4 decimals, about 11 metres. Search radii start at
5 km, so more precision is bytes with no effect on a result.

Run:    python analysis/build_zip_centroids.py
"""
from __future__ import annotations

import io
import json
import pathlib
import subprocess
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "frontend" / "src" / "data" / "zip-centroids.json"

GAZETTEER = (
    "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2023_Gazetteer/"
    "2023_Gaz_zcta_national.zip"
)


def main() -> None:
    # curl, not urllib. Python's TLS stack has failed against this exact host
    # already in this project, and the failure is silent: an empty map means
    # every ZIP search returns "unknown ZIP" and nothing errors.
    r = subprocess.run(
        ["curl", "-sSL", "--fail", "--max-time", "120", GAZETTEER],
        capture_output=True,
    )
    if r.returncode != 0:
        raise SystemExit(f"curl exit {r.returncode}: {r.stderr.decode()[:200]}")

    zf = zipfile.ZipFile(io.BytesIO(r.stdout))
    member = next(n for n in zf.namelist() if n.lower().endswith(".txt"))

    out: dict[str, list[float]] = {}
    with io.TextIOWrapper(zf.open(member), encoding="latin-1") as fh:
        header = [h.strip() for h in fh.readline().split("\t")]
        i_zip = header.index("GEOID")
        i_lat = header.index("INTPTLAT")
        i_lng = header.index("INTPTLONG")
        for line in fh:
            parts = line.rstrip("\n").split("\t")
            if len(parts) <= max(i_zip, i_lat, i_lng):
                continue
            z = parts[i_zip].strip()
            try:
                lat = round(float(parts[i_lat]), 4)
                lng = round(float(parts[i_lng]), 4)
            except ValueError:
                continue
            if len(z) == 5:
                out[z] = [lat, lng]

    if len(out) < 20_000:
        # The file has ~33,000 ZCTAs. A short read means a truncated download
        # or a changed layout, and shipping it would silently shrink search
        # coverage rather than fail.
        raise SystemExit(f"only {len(out)} ZCTAs parsed; expected ~33,000. Refusing to write.")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, separators=(",", ":")) + "\n")
    kb = OUT.stat().st_size / 1024
    print(f"wrote {OUT} ({len(out):,} ZCTAs, {kb:.0f} KB)")


if __name__ == "__main__":
    main()
