import random

from ndh_quality.base import open_engine
from ndh_quality.rules.rule_npi_check_digit import NpiCheckDigit


def run(release_dir, tables, types=None):
    d = release_dir(tables, types)
    return NpiCheckDigit.measure(open_engine(), {"release_dir": str(d)})


def npi_row(vals):
    return [{"_npi": v} for v in vals]


def test_valid_npis_pass(release_dir):
    m = run(release_dir, {"practitioner": npi_row(["1234567893"]), "organization": []})
    assert m["status"] == "pass"
    assert m["numerator"] == m["denominator"] == 1


def test_bad_check_digit_fails(release_dir):
    vals = ["1234567893"] * 500 + ["1234567894"] * 500
    m = run(release_dir, {"practitioner": npi_row(vals), "organization": []})
    assert m["value"] == 0.5
    assert m["status"] == "fail"


def test_malformed_counts_invalid_not_crash(release_dir):
    m = run(release_dir, {"practitioner": npi_row(["12345678ab", "123", "1234567893"]), "organization": []})
    assert (m["numerator"], m["denominator"]) == (1, 3)


def test_empty_field_control_failed(release_dir):
    m = run(release_dir, {"practitioner": npi_row([None, None]),
                          "organization": []})
    assert m["status"] == "control_failed"


def luhn_ok(npi):
    if len(npi) != 10 or not npi.isdigit():
        return False
    digits = "80840" + npi[:9]
    total = 0
    for i, ch in enumerate(reversed(digits)):
        d = int(ch)
        if i % 2 == 0:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return (10 - total % 10) % 10 == int(npi[9])


def make_npi(body9):
    for c in range(10):
        if luhn_ok(body9 + str(c)):
            return body9 + str(c)
    raise AssertionError


def test_matches_h9_python(release_dir):
    rng = random.Random(9)
    npis = [make_npi("".join(str(rng.randrange(10)) for _ in range(9))) for _ in range(2000)]
    for i in range(200):
        n = npis[i]
        npis[i] = n[:9] + str((int(n[9]) + 1) % 10)
    npis += ["123", "abcdefghij", "12345678ab"]
    expected = sum(luhn_ok(n) for n in npis)
    assert 1700 < expected < 1900
    m = run(release_dir, {"practitioner": npi_row(npis), "organization": []})
    assert m["numerator"] == expected
    assert m["denominator"] == len(npis)
