"""Source-file resolution for the parquet exporter.

The 2026-08-20 release renamed every file from `Practitioner.ndjson.zst` to
`06-Practitioner.ndjson.zst`. The exporter built its path by string
interpolation, matched nothing, printed SKIP for all six resources and exited
0 with an empty output directory. Nothing reading the exit code could tell
that from a good run.
"""
from __future__ import annotations

import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from export_parquet import find_source_file  # noqa: E402


def _dir(tmp_path: pathlib.Path, names: list[str]) -> pathlib.Path:
    for n in names:
        (tmp_path / n).touch()
    return tmp_path


NUMBERED = [
    "01-Organization.ndjson.zst",
    "02-Location.ndjson.zst",
    "03-Endpoint.ndjson.zst",
    "06-Practitioner.ndjson.zst",
    "07-PractitionerRole.ndjson.zst",
    "08-OrganizationAffiliation.ndjson.zst",
]
PLAIN = [
    "Organization.ndjson.zst",
    "Practitioner.ndjson.zst",
    "OrganizationAffiliation.ndjson.zst",
]
DATED = [
    "Organization_2026-05-07_2128.ndjson.zst",
    "Practitioner_2026-05-07_2128.ndjson.zst",
    "OrganizationAffiliation_2026-05-07_2128.ndjson.zst",
]


@pytest.mark.parametrize("names", [NUMBERED, PLAIN, DATED], ids=["numbered", "plain", "dated"])
def test_resolves_every_shipped_filename_form(tmp_path, names):
    d = _dir(tmp_path, names)
    got = find_source_file(d, "Practitioner")
    assert got is not None, f"Practitioner unresolved among {names}"
    assert got.name in names


@pytest.mark.parametrize("names", [NUMBERED, PLAIN, DATED], ids=["numbered", "plain", "dated"])
def test_organization_does_not_match_organization_affiliation(tmp_path, names):
    # Without a boundary after the resource name, "Organization" also matches
    # "OrganizationAffiliation" and the affiliation file is exported into the
    # organization table. Same boundary bug as ndh_manifest.
    d = _dir(tmp_path, names)
    org = find_source_file(d, "Organization")
    aff = find_source_file(d, "OrganizationAffiliation")
    assert org is not None and aff is not None
    assert org != aff
    assert "Affiliation" not in org.name


def test_practitioner_does_not_match_practitioner_role(tmp_path):
    d = _dir(tmp_path, NUMBERED)
    prac = find_source_file(d, "Practitioner")
    role = find_source_file(d, "PractitionerRole")
    assert prac.name == "06-Practitioner.ndjson.zst"
    assert role.name == "07-PractitionerRole.ndjson.zst"


def test_returns_none_when_absent_rather_than_raising(tmp_path):
    assert find_source_file(_dir(tmp_path, NUMBERED), "InsurancePlan") is None
    assert find_source_file(tmp_path / "nope", "Practitioner") is None


def test_ignores_unrelated_files(tmp_path):
    d = _dir(tmp_path, ["manifest.json", "README.md", "06-Practitioner.ndjson.zst"])
    assert find_source_file(d, "Practitioner").name == "06-Practitioner.ndjson.zst"
