import json

from ndh_quality import cli
from ndh_quality.registry import all_rules, run_release


def _tables(direct=True):
    eps = [{"_connection_type": "hl7-fhir-rest", "_managing_org_id": "Organization/o1"}]
    if direct:
        eps.append({"_connection_type": "direct-project", "_managing_org_id": None})
    return {
        "practitioner": [{"_id": "p1", "_npi": "1234567893"}],
        "organization": [{"_id": "o1", "_npi": "1234567893"}],
        "practitioner_role": [{"_practitioner_id": "Practitioner/p1", "_org_id": "Organization/o1"}],
        "endpoint": eps,
    }


def test_all_rules_sorted():
    ids = [r.rule_id for r in all_rules()]
    assert len(ids) == 5 and ids == sorted(ids)


def test_cli_exit_codes(release_dir, capsys):
    d = release_dir(_tables())
    assert cli.main(["run", "--release-dir", str(d)]) == 0
    assert "endpoint-types-present" in capsys.readouterr().out


def test_cli_fails_without_direct_rows(release_dir):
    d = release_dir(_tables(direct=False))
    assert cli.main(["run", "--release-dir", str(d)]) == 1


def test_cli_json(release_dir, capsys):
    d = release_dir(_tables())
    cli.main(["run", "--release-dir", str(d), "--json"])
    rows = json.loads(capsys.readouterr().out)
    assert len(rows) == 5


def test_rule_error_is_reported(release_dir):
    t = _tables()
    del t["organization"]
    d = release_dir(t)
    rows = {r["rule_id"]: r for r in run_release(d)}
    assert rows["npi-check-digit"]["status"] == "error"
    assert rows["endpoint-types-present"]["status"] == "pass"


def test_previous_dir_feeds_control(release_dir, tmp_path_factory):
    d = release_dir(_tables())
    rows = run_release(d, previous_dir=d)
    assert all(r["control_previous"] is not None for r in rows)
    assert run_release(d)[0]["control_previous"] is None
