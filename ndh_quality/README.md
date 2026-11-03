# ndh-quality

Five data-quality rules over parquet exports of the CMS National Directory of Healthcare (NDH) bulk files. Released under CC0 1.0.

## Install and run

```bash
python -m venv .venv && .venv/bin/pip install -e .
.venv/bin/ndh-quality run --release-dir /path/to/release [--previous-dir /path/to/earlier-release] [--json]
```

`python -m ndh_quality run ...` does the same. The command prints one line per rule. With `--json` it prints the rows as a JSON list. It exits 1 if any `pipeline` rule is not `pass`, otherwise 0.

## Rules

| Rule | Severity | Measures |
| --- | --- | --- |
| `npi-check-digit` | expect | Share of Practitioner and Organization NPIs that are 10 digits with a valid Luhn check digit (H9, partial: NPPES agreement is not covered). Expectation: at least 99.9%. |
| `role-references-resolve` | expect | Share of PractitionerRole practitioner and organization references that resolve to a record in the same export (H6 to H8, role side only). Expectation: at least 99%. |
| `endpoint-types-present` | pipeline | Control. Both `hl7-fhir-rest` and `direct-project` endpoint types appear in the export. |
| `fhir-rest-endpoint-share` | monitor | Share of Endpoint resources that are `hl7-fhir-rest`, the subset an integrator can GET (H28). |
| `endpoint-org-linkage` | monitor | Share of `hl7-fhir-rest` endpoints whose managing organization is present in the Organization file (H50). |

Every row also carries a control: a count that must be nonzero, and must not fall below half of the previous release's count when `--previous-dir` is given. A rule whose control fails reports `control_failed` instead of a result, because an empty or truncated field would otherwise read as a plausible number.

## Statuses

- `pass`: the registered expectation holds for this release.
- `fail`: the registered expectation does not hold for this release. It says nothing about why.
- `control_failed`: the control did not hold, so the measured value is not trusted.
- `error`: the rule could not run (for example a missing file). The detail names the exception type and its first line. Other rules still run.
- `recorded`: a `monitor` rule, or a rule with no threshold. The value is stored, not judged.

## Severities

- `pipeline`: the export itself is unusable if this is not `pass`. The CLI exits 1.
- `expect`: a registered expectation about the data. A `fail` is a finding, not a pipeline stop.
- `monitor`: recorded each release so change can be seen. Never fails.

## Input

The rules read `<release_dir>/<resource>.parquet` and nothing else. They use only these flattened columns:

| File | Columns |
| --- | --- |
| `practitioner.parquet` | `_id`, `_npi` |
| `organization.parquet` | `_id`, `_npi` |
| `practitioner_role.parquet` | `_practitioner_id`, `_org_id` |
| `endpoint.parquet` | `_connection_type`, `_managing_org_id` |

`_id` is the bare resource id. The two `_*_id` reference columns hold full references such as `Practitioner/Practitioner-1234567890`; the rules compare them to `'Practitioner/' || _id`.

### (a) AINPI parquet export

The AINPI repository writes this layout with `analysis/export_parquet.py`, one directory per release.

### (b) OpenSharing (formerly Delta Sharing) archive

The AINPI archive is shared over open OpenSharing (formerly Delta Sharing). Share `ainpi-ndh-archive`, schema `ainpi`, one table per resource, each partitioned by `release_date`. A credential file (`ainpi.share`) comes from gene@fhiriq.com. Install the client with `pip install delta-sharing`, then pull one release:

```python
import os
import delta_sharing

profile = "ainpi.share"
release = "2026-10-07"
out = f"releases/{release}"
os.makedirs(out, exist_ok=True)
for resource in ["practitioner", "practitioner_role", "organization", "endpoint"]:
    url = f"{profile}#ainpi-ndh-archive.ainpi.{resource}"
    df = delta_sharing.load_as_pandas(
        url, jsonPredicateHints='{"op":"equal","children":[{"op":"column","name":"release_date","valueType":"string"},{"op":"literal","value":"%s","valueType":"string"}]}' % release)
    df = df[df["release_date"].astype(str) == release]  # the hint is not a guarantee
    df.drop(columns=["release_date"]).to_parquet(f"{out}/{resource}.parquet")
```

Then run `ndh-quality run --release-dir releases/2026-10-07`. The partition predicate is a hint the server may ignore, so the pandas filter is required. Without the hint, the whole archive is read, which is large. Check the column types you get: `to_parquet` needs `pyarrow`.

### (c) Only the latest release exists at CMS

CMS serves only the current export; earlier releases are removed when a new one lands. To compare releases with `--previous-dir`, you need a copy of the earlier release, either your own archive or the OpenSharing archive above.

## Notes

Rules never select NPIs or other matched values, only counts. Files marked as macOS iCloud placeholders (dataless) stop the run before any read, because reading them hangs. A missing file is not a placeholder and becomes an `error` row.

## License

CC0 1.0 Universal. See `LICENSE`.
