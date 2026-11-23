"""A tiny NDH parquet export built through the real extractors.

Fixtures go through `fast_ingest_ndh` extractors and `export_parquet.schema_for`
so the reference shapes (`Practitioner/Practitioner-<npi>`,
`Location/Location-<id>`) and the pipe-joined columns are exactly what the
exporter writes. A hand-made fixture can pass while real data joins to zero.

Synthetic check-digit-valid NPIs only.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from export_parquet import schema_for  # noqa: E402
from fast_ingest_ndh import (  # noqa: E402
    extract_location,
    extract_practitioner,
    extract_practitioner_role,
)

P1, P2, P3, P4, P5 = "1234567893", "1111111112", "2222222228", "3333333334", "4444444440"
NPI_SYSTEM = "http://terminology.hl7.org/NamingSystem/npi"
TAX_SYSTEM = "http://hl7.org/fhir/us/ndh/ValueSet/HealthcareIndividualTaxonomyVS"
NUCC = {"207Q00000X": {}, "363LF0000X": {}, "1223G0001X": {}}


def practitioner(npi, active=True, addresses=None, phone=None):
    r = {
        "resourceType": "Practitioner",
        "id": f"Practitioner-{npi}",
        "identifier": [{"system": NPI_SYSTEM, "value": npi}],
        "active": active,
        "name": [{"family": "SAMPLE", "given": ["PAT"]}],
    }
    if addresses:
        r["address"] = addresses
    if phone:
        r["telecom"] = [{"system": "fax", "value": "4125559999"}, {"system": "phone", "value": phone}]
    return r


def role(rid, npi, loc_ids, active=True, specialties=()):
    return {
        "resourceType": "PractitionerRole",
        "id": rid,
        "active": active,
        "practitioner": {"reference": f"Practitioner/Practitioner-{npi}"},
        "location": [{"reference": f"Location/{lid}"} for lid in loc_ids],
        "specialty": [{"coding": [{"system": TAX_SYSTEM, "code": c}]} for c in specialties],
    }


def location(lid, state, postal, phone=None):
    r = {
        "resourceType": "Location",
        "id": lid,
        "address": {"line": ["1 SAMPLE ST"], "city": "X", "state": state, "postalCode": postal},
    }
    if phone:
        r["telecom"] = [{"system": "phone", "value": phone}]
    return r


def write_table(path: Path, extractor, resources):
    schema = schema_for(extractor)
    rows = []
    for r in resources:
        row = {"resource": json.dumps(r)}
        row.update(extractor(r))
        rows.append(row)
    pq.write_table(pa.Table.from_pylist(rows, schema=schema), path)


def build_export(root: Path, release: str = "2026-10-07") -> Path:
    """Write practitioner, practitioner_role and location parquet for `release`.

    P1: active, two PA role locations (15206, 15213), a postal billing address
        in 19103 listed first and a physical address in 15232.
    P2: active, one PA role location (17101), physical address 16501.
    P3: inactive practitioner with a PA role: out of scope.
    P4: active, role only in NJ: out of scope for PA.
    P5: active, PA role that is inactive: out of scope.
    """
    d = root / release
    d.mkdir(parents=True, exist_ok=True)
    practs = [
        practitioner(P1, addresses=[
            {"type": "postal", "state": "PA", "postalCode": "19103"},
            {"type": "physical", "state": "PA", "postalCode": "15232-1111"},
        ], phone="1 (412) 555-0101"),
        practitioner(P2, addresses=[{"use": "work", "state": "PA", "postalCode": "16501"}]),
        practitioner(P3, active=False, addresses=[{"state": "PA", "postalCode": "15206"}]),
        practitioner(P4, addresses=[{"state": "NJ", "postalCode": "07030"}]),
        practitioner(P5, addresses=[{"state": "PA", "postalCode": "19104"}]),
    ]
    roles = [
        role("R1", P1, ["L1"], specialties=["207Q00000X"]),
        role("R2", P1, ["L2"], specialties=["207Q00000X", "14-50"]),
        role("R3", P2, ["L3"], specialties=["363LF0000X"]),
        role("R4", P3, ["L1"]),
        role("R5", P4, ["L4"]),
        role("R6", P5, ["L1"], active=False),
    ]
    locs = [
        location("L1", "PA", "15206", phone="412-555-0111"),
        location("L2", "PA", "152131234", phone="(412) 555-0122"),
        location("L3", "PA", "17101"),
        location("L4", "NJ", "07030"),
    ]
    write_table(d / "practitioner.parquet", extract_practitioner, practs)
    write_table(d / "practitioner_role.parquet", extract_practitioner_role, roles)
    write_table(d / "location.parquet", extract_location, locs)
    return root


def build_nppes(root: Path, month: str = "2026-11") -> Path:
    """A matching nppes.parquet in the nppes_monthly layout."""
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from nppes_monthly import COLUMNS, SCHEMA

    def rec(npi, zip5=None, phone=None, tax=None):
        r = {c: None for c in COLUMNS}
        r.update(npi=npi, entity_type="1", practice_zip5=zip5, practice_phone10=phone,
                 primary_taxonomy=tax)
        return r

    d = root / month
    d.mkdir(parents=True, exist_ok=True)
    rows = [
        rec(P1, "15206", "4125550111", "207Q00000X"),
        rec(P2, "16501", None, "363LF0000X"),
        rec(P4, "07030", None, None),
    ]
    pq.write_table(pa.Table.from_pylist(rows, schema=SCHEMA), d / "nppes.parquet")
    return root
